import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { getSocket } from '../lib/socket'
import { orderStatusLabel } from '../lib/statusLabels'
import { useAuthStore } from '../store/authStore'

function localTodayIso() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('es-PE', { hour12: false })
}

function normalizeLabel(label) {
  return String(label || '').replace(/^Entrada extra:\s*/i, '').trim()
}

function orderStatusClass(status) {
  if (status === 'CLOSED') return 'status-pill status-ready'
  if (status === 'DELIVERED') return 'status-pill status-progress'
  if (status === 'CANCELLED') return 'status-pill status-closed'
  return 'status-pill status-pending'
}

const HISTORY_STATUS_OPTIONS = [
  'DRAFT',
  'PENDING_WAITER_APPROVAL',
  'APPROVED',
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'DELIVERED',
  'CLOSED',
  'CANCELLED',
]

export default function CashHistoryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const canChangeStatus = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [historyScope, setHistoryScope] = useState('SOLD')
  const [historyDate, setHistoryDate] = useState('')
  const [historySearchInput, setHistorySearchInput] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [statusModal, setStatusModal] = useState({ open: false, order: null, status: 'DELIVERED' })
  const [editModal, setEditModal] = useState({ open: false, order: null, status: 'DELIVERED', tableId: '' })
  const [deleteModal, setDeleteModal] = useState({ open: false, order: null })

  const tablesQuery = useQuery({
    queryKey: scopedQueryKey('tables', user),
    queryFn: api.getTables,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      setHistorySearch(historySearchInput.trim())
      setHistoryPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [historySearchInput])

  const historyQuery = useQuery({
    queryKey: scopedQueryKey(
      ['orders', 'history'],
      user,
      historyPage,
      historyPageSize,
      historyScope,
      historyDate,
      historySearch,
    ),
    queryFn: () => api.listOrderHistory({
      page: historyPage,
      pageSize: historyPageSize,
      scope: historyScope,
      date: historyDate,
      search: historySearch,
    }),
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    const socket = getSocket()
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['orders', 'history'] })
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    }

    socket.on('order.updated', refresh)
    socket.on('cash.session.updated', refresh)
    socket.on('table.session.updated', refresh)

    return () => {
      socket.off('order.updated', refresh)
      socket.off('cash.session.updated', refresh)
      socket.off('table.session.updated', refresh)
    }
  }, [queryClient])

  async function refreshHistoryData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['orders', 'history'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['cash'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['kpis-daily'] }),
      queryClient.invalidateQueries({ queryKey: ['kpis-monthly'] }),
      queryClient.invalidateQueries({ queryKey: ['kpis-top-dishes'] }),
    ])
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ orderId, status }) => api.updateHistoryOrder(orderId, { status }),
    onSuccess: async () => {
      toast.success('Estado actualizado')
      setStatusModal({ open: false, order: null, status: 'DELIVERED' })
      await refreshHistoryData()
    },
    onError: (error) => toast.error(error.message),
  })

  const editOrderMutation = useMutation({
    mutationFn: ({ orderId, status, tableId }) => api.updateHistoryOrder(orderId, { status, tableId }),
    onSuccess: async () => {
      toast.success('Pedido actualizado')
      setEditModal({ open: false, order: null, status: 'DELIVERED', tableId: '' })
      await refreshHistoryData()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteOrderMutation = useMutation({
    mutationFn: (orderId) => api.deleteHistoryOrder(orderId),
    onSuccess: async () => {
      toast.success('Pedido eliminado')
      setDeleteModal({ open: false, order: null })
      await refreshHistoryData()
    },
    onError: (error) => toast.error(error.message),
  })

  const tableNumberById = new Map((tablesQuery.data || []).map((table) => [table.id, table.number]))
  const historyResult = historyQuery.data || {
    items: [],
    page: 1,
    pageSize: historyPageSize,
    totalItems: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  }
  const historyItems = Array.isArray(historyResult.items) ? historyResult.items : []

  function openStatusChange(order) {
    setStatusModal({
      open: true,
      order,
      status: order.status || 'DELIVERED',
    })
  }

  function openEdit(order) {
    setEditModal({
      open: true,
      order,
      status: order.status || 'DELIVERED',
      tableId: order.tableId || '',
    })
  }

  function openDelete(order) {
    setDeleteModal({
      open: true,
      order,
    })
  }

  function submitStatusChange() {
    if (!statusModal.order) return
    updateStatusMutation.mutate({
      orderId: statusModal.order.id,
      status: statusModal.status,
    })
  }

  function submitEditOrder() {
    if (!editModal.order) return
    editOrderMutation.mutate({
      orderId: editModal.order.id,
      status: editModal.status,
      tableId: editModal.tableId,
    })
  }

  function submitDeleteOrder() {
    if (!deleteModal.order) return
    deleteOrderMutation.mutate(deleteModal.order.id)
  }

  return (
    <div className="page-stack cash-history-page">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Historial de pedidos</h2>
            <p className="section-subtitle">Vista independiente con paginacion. `CERRADO` = vendido/cobrado. `CANCELADO` = anulado.</p>
          </div>
          <button className="btn btn-soft" onClick={() => navigate('/cash')} type="button">
            Volver a caja
          </button>
        </div>

        <div className="page-stack" style={{ marginTop: 12 }}>
          <div className="panel-soft cash-history-toolbar">
            <div className="cash-history-filters">
              <div className="cash-filter-field">
                <label className="form-label">Vista</label>
                <select
                  onChange={(event) => {
                    setHistoryScope(event.target.value)
                    setHistoryPage(1)
                  }}
                  value={historyScope}
                >
                  <option value="SOLD">Solo cobrados (cerrados)</option>
                  <option value="ALL">Todos menos anulados</option>
                  <option value="ALL_WITH_CANCELLED">Todos (incluye anulados)</option>
                </select>
              </div>

              <div className="cash-filter-field">
                <label className="form-label">Fecha</label>
                <div className="cash-date-tools">
                  <input
                    onChange={(event) => {
                      setHistoryDate(event.target.value)
                      setHistoryPage(1)
                    }}
                    type="date"
                    value={historyDate}
                  />
                  <button
                    className="btn btn-soft btn-xs"
                    onClick={() => {
                      setHistoryDate(localTodayIso())
                      setHistoryPage(1)
                    }}
                    type="button"
                  >
                    Hoy
                  </button>
                  <button
                    className="btn btn-soft btn-xs"
                    onClick={() => {
                      setHistoryDate('')
                      setHistoryPage(1)
                    }}
                    type="button"
                  >
                    Todas
                  </button>
                </div>
              </div>

              <div className="cash-filter-field">
                <label className="form-label">Buscar ticket/plato</label>
                <input
                  onChange={(event) => {
                    setHistorySearchInput(event.target.value)
                  }}
                  placeholder="Ej: 73400c o pollo"
                  value={historySearchInput}
                />
              </div>

              <div className="cash-filter-field">
                <label className="form-label">Por pagina</label>
                <select
                  onChange={(event) => {
                    setHistoryPageSize(Number(event.target.value))
                    setHistoryPage(1)
                  }}
                  value={historyPageSize}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            <div className="cash-filter-meta">
              <span className="badge">Total: {historyResult.totalItems} ticket(s)</span>
            </div>
          </div>

          {historyQuery.isPending && historyItems.length === 0 && <p className="alert alert-info">Cargando historial...</p>}

          {!historyQuery.isPending && historyItems.length === 0 && (
            <p className="alert alert-info">No hay tickets para los filtros seleccionados.</p>
          )}

          {!historyQuery.isPending && historyItems.length > 0 && (
            <div className="column-list">
              {historyItems.map((order) => {
                const tableNumber = tableNumberById.get(order.tableId) || order.tableId.replace(/^t/i, '')
                const total = Number(order.totals?.total || 0)
                const items = Array.isArray(order.items) ? order.items : []
                const referenceDate = historyScope === 'SOLD'
                  ? (order.closedAt || order.createdAt)
                  : order.createdAt

                return (
                  <article className="panel-soft cash-history-card" key={order.id}>
                    <div className="cash-history-head">
                      <div>
                        <p className="cash-order-ticket">Ticket {order.id.slice(0, 6)}</p>
                        <p className="small muted">Mesa {tableNumber} | {formatDateTime(referenceDate)}</p>
                      </div>
                      <div className="cash-history-right">
                        <span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span>
                        <strong>{formatMoney(total)}</strong>
                      </div>
                    </div>

                    <div className="chip-list" style={{ marginTop: 8 }}>
                      {items.slice(0, 8).map((item) => (
                        <span className="chip chip-green" key={item.id}>
                          P{item.guestNumber || '-'} {item.quantity}x {normalizeLabel(item.productName)}
                        </span>
                      ))}
                      {items.length > 8 && <span className="chip chip-amber">+{items.length - 8} item(s)</span>}
                    </div>

                    {(canChangeStatus || isSuperAdmin) && (
                      <div className="cash-history-actions">
                        {canChangeStatus && (
                          <button className="btn btn-soft btn-xs" onClick={() => openStatusChange(order)} type="button">
                            Cambiar estado
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button className="btn btn-soft btn-xs" onClick={() => openEdit(order)} type="button">
                            Editar
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button className="btn-danger-soft btn-xs" onClick={() => openDelete(order)} type="button">
                            Eliminar
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          <div className="cash-history-pagination">
            <button
              className="btn btn-soft"
              disabled={!historyResult.hasPrev}
              onClick={() => setHistoryPage((currentPage) => Math.max(1, currentPage - 1))}
              type="button"
            >
              Anterior
            </button>
            <span className="small muted">
              Pagina {historyResult.page} de {historyResult.totalPages}
            </span>
            <button
              className="btn btn-soft"
              disabled={!historyResult.hasNext}
              onClick={() => setHistoryPage((currentPage) => currentPage + 1)}
              type="button"
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>

      {statusModal.open && statusModal.order && (
        <div className="modal-backdrop" role="dialog">
          <div className="panel modal-card">
            <h3 className="modal-title">Cambiar estado</h3>
            <p className="small muted">Ticket {statusModal.order.id.slice(0, 6)}</p>
            <div className="form-stack" style={{ marginTop: 10 }}>
              <div className="cash-filter-field">
                <label className="form-label">Estado</label>
                <select
                  onChange={(event) => setStatusModal((prev) => ({ ...prev, status: event.target.value }))}
                  value={statusModal.status}
                >
                  {HISTORY_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {orderStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="inline-actions modal-actions">
              <button
                className="btn btn-soft"
                onClick={() => setStatusModal({ open: false, order: null, status: 'DELIVERED' })}
                type="button"
              >
                Cancelar
              </button>
              <button className="btn btn-main" onClick={submitStatusChange} type="button">
                {updateStatusMutation.isPending ? 'Guardando...' : 'Guardar estado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSuperAdmin && editModal.open && editModal.order && (
        <div className="modal-backdrop" role="dialog">
          <div className="panel modal-card">
            <h3 className="modal-title">Editar pedido</h3>
            <p className="small muted">Ticket {editModal.order.id.slice(0, 6)}</p>

            <div className="form-stack" style={{ marginTop: 10 }}>
              <div className="cash-filter-field">
                <label className="form-label">Estado</label>
                <select
                  onChange={(event) => setEditModal((prev) => ({ ...prev, status: event.target.value }))}
                  value={editModal.status}
                >
                  {HISTORY_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {orderStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cash-filter-field">
                <label className="form-label">Mesa</label>
                <select
                  onChange={(event) => setEditModal((prev) => ({ ...prev, tableId: event.target.value }))}
                  value={editModal.tableId}
                >
                  {(tablesQuery.data || []).map((table) => (
                    <option key={table.id} value={table.id}>
                      Mesa {table.number}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="inline-actions modal-actions">
              <button
                className="btn btn-soft"
                onClick={() => setEditModal({ open: false, order: null, status: 'DELIVERED', tableId: '' })}
                type="button"
              >
                Cancelar
              </button>
              <button className="btn btn-main" onClick={submitEditOrder} type="button">
                {editOrderMutation.isPending ? 'Guardando...' : 'Actualizar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSuperAdmin && deleteModal.open && deleteModal.order && (
        <div className="modal-backdrop" role="dialog">
          <div className="panel modal-card">
            <h3 className="modal-title">Eliminar pedido</h3>
            <p className="small muted">Ticket {deleteModal.order.id.slice(0, 6)}</p>
            <p className="alert alert-warn" style={{ marginTop: 10 }}>
              Esta accion elimina el registro del historial, pagos y comprobante vinculados.
            </p>

            <div className="inline-actions modal-actions">
              <button
                className="btn btn-soft"
                onClick={() => setDeleteModal({ open: false, order: null })}
                type="button"
              >
                Cancelar
              </button>
              <button className="btn-danger-soft" onClick={submitDeleteOrder} type="button">
                {deleteOrderMutation.isPending ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
