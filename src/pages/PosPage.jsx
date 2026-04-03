import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { downloadKitchenTicketPdf } from '../lib/kitchenTicketPdf'
import { getSocket } from '../lib/socket'
import { orderStatusLabel } from '../lib/statusLabels'

const todayIso = new Date().toISOString().slice(0, 10)

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function normalizeLabel(label) {
  return String(label || '').replace(/^Entrada extra:\s*/i, '')
}

function mapOptions(items) {
  return items.map((item) => ({
    id: item.id,
    name: normalizeLabel(item.name),
    price: Number(item.basePrice || 0),
    variants: Array.isArray(item.variants) ? item.variants : ['normal'],
  }))
}

function createPersonDraft() {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mainId: '',
    entryId: '',
    kitchenNote: '',
    showExtras: false,
    extraEntryEnabled: false,
    beverageEnabled: false,
    extraEntryIds: [],
    beverageIds: [],
  }
}

function mergeIdsWithQty(ids) {
  const grouped = new Map()
  for (const id of ids) {
    if (!id) continue
    grouped.set(id, (grouped.get(id) || 0) + 1)
  }
  return Array.from(grouped.entries()).map(([productId, quantity]) => ({ productId, quantity }))
}

function subtotalOfPerson(person, mainMap, entryMap, beverageMap) {
  let subtotal = 0

  if (person.mainId) {
    subtotal += Number(mainMap.get(person.mainId)?.price || 0)
  }

  if (person.extraEntryEnabled) {
    for (const id of person.extraEntryIds || []) {
      subtotal += Number(entryMap.get(id)?.price || 0)
    }
  }

  if (person.beverageEnabled) {
    for (const id of person.beverageIds || []) {
      subtotal += Number(beverageMap.get(id)?.price || 0)
    }
  }

  return Number(subtotal.toFixed(2))
}

const ORDER_PENDING_STATUSES = new Set(['DRAFT', 'PENDING_WAITER_APPROVAL', 'APPROVED'])
const ORDER_IN_PROCESS_STATUSES = new Set(['SENT_TO_KITCHEN', 'PREPARING', 'READY'])
const ORDER_DELIVERED_STATUSES = new Set(['DELIVERED'])

function summarizeLiveOrders(orders) {
  const summary = {
    total: 0,
    pending: 0,
    inProcess: 0,
    delivered: 0,
  }

  for (const order of orders) {
    if (ORDER_PENDING_STATUSES.has(order.status)) summary.pending += 1
    else if (ORDER_IN_PROCESS_STATUSES.has(order.status)) summary.inProcess += 1
    else if (ORDER_DELIVERED_STATUSES.has(order.status)) summary.delivered += 1
  }

  summary.total = summary.pending + summary.inProcess + summary.delivered
  return summary
}

export default function PosPage() {
  const queryClient = useQueryClient()

  const [selectedTableId, setSelectedTableId] = useState('')
  const [persons, setPersons] = useState([])
  const [orderViewMode, setOrderViewMode] = useState('TABLES')
  const [tableStateFilter, setTableStateFilter] = useState('ALL')
  const [isOrderDrawerOpen, setOrderDrawerOpen] = useState(false)
  const [isComposeMode, setComposeMode] = useState(false)

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
  })

  const menusQuery = useQuery({
    queryKey: ['menus', todayIso],
    queryFn: () => api.getMenus(todayIso),
  })

  const ordersQuery = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.listOrders(),
  })

  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data])

  const menuItems = useMemo(() => menusQuery.data?.items ?? [], [menusQuery.data])

  const mainOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type !== 'ADDON' && item.type !== 'BEVERAGE')),
    [menuItems],
  )

  const entryOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type === 'ADDON')),
    [menuItems],
  )

  const beverageOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type === 'BEVERAGE')),
    [menuItems],
  )

  const mainMap = useMemo(() => new Map(mainOptions.map((option) => [option.id, option])), [mainOptions])
  const entryMap = useMemo(() => new Map(entryOptions.map((option) => [option.id, option])), [entryOptions])
  const beverageMap = useMemo(() => new Map(beverageOptions.map((option) => [option.id, option])), [beverageOptions])

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [tables, selectedTableId],
  )

  const selectedTableQrOrders = useMemo(() => {
    if (!selectedTable) return []
    return orders
      .filter((order) => order.tableId === selectedTable.id && order.source === 'QR')
      .filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [orders, selectedTable])

  const liveOrders = useMemo(
    () => orders.filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED'),
    [orders],
  )

  const selectedTableLiveOrders = useMemo(() => {
    if (!selectedTable) return []
    return liveOrders
      .filter((order) => order.tableId === selectedTable.id && order.source !== 'QR')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [liveOrders, selectedTable])

  const orderSummary = useMemo(() => summarizeLiveOrders(liveOrders), [liveOrders])

  const takeAwayOrders = useMemo(
    () =>
      liveOrders
        .filter((order) => {
          if (!order.tableId) return true
          const items = Array.isArray(order.items) ? order.items : []
          return items.some((item) => item.serviceMode === 'TAKEAWAY')
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [liveOrders],
  )

  const tableCards = useMemo(
    () =>
      tables.map((table) => {
        const tableOrders = liveOrders.filter((order) => order.tableId === table.id)
        const pendingCount = tableOrders.filter((order) => ORDER_PENDING_STATUSES.has(order.status)).length
        const inProcessCount = tableOrders.filter((order) => ORDER_IN_PROCESS_STATUSES.has(order.status)).length
        const deliveredCount = tableOrders.filter((order) => ORDER_DELIVERED_STATUSES.has(order.status)).length

        let stateCode = 'AVAILABLE'
        if (inProcessCount > 0) stateCode = 'IN_PROCESS'
        else if (pendingCount > 0) stateCode = 'PENDING'
        else if (deliveredCount > 0) stateCode = 'DELIVERED'
        else if (table.status === 'OCCUPIED') stateCode = 'OCCUPIED'

        const stateMeta = {
          AVAILABLE: { label: 'Disponible', tone: 'available' },
          OCCUPIED: { label: 'Ocupada', tone: 'occupied' },
          PENDING: { label: 'Pendiente', tone: 'pending' },
          IN_PROCESS: { label: 'En proceso', tone: 'process' },
          DELIVERED: { label: 'Entregado', tone: 'delivered' },
        }[stateCode]

        return {
          table,
          guestCount: table.activeSession?.guestsActive || 0,
          pendingCount,
          inProcessCount,
          deliveredCount,
          stateCode,
          stateMeta,
        }
      }),
    [tables, liveOrders],
  )

  const filteredTableCards = useMemo(
    () =>
      tableCards.filter((row) => {
        if (tableStateFilter === 'ALL') return true
        if (tableStateFilter === 'AVAILABLE') return row.stateCode === 'AVAILABLE'
        if (tableStateFilter === 'OCCUPIED') return row.stateCode === 'OCCUPIED'
        if (tableStateFilter === 'PENDING') return row.stateCode === 'PENDING'
        if (tableStateFilter === 'IN_PROCESS') return row.stateCode === 'IN_PROCESS'
        if (tableStateFilter === 'DELIVERED') return row.stateCode === 'DELIVERED'
        return true
      }),
    [tableCards, tableStateFilter],
  )

  const selectedTableCard = useMemo(
    () => tableCards.find((row) => row.table.id === selectedTableId) || null,
    [tableCards, selectedTableId],
  )

  const personSubtotals = useMemo(
    () => persons.map((person) => subtotalOfPerson(person, mainMap, entryMap, beverageMap)),
    [persons, mainMap, entryMap, beverageMap],
  )

  const totalAmount = useMemo(
    () => personSubtotals.reduce((sum, subtotal) => sum + subtotal, 0),
    [personSubtotals],
  )

  const openSessionMutation = useMutation({
    mutationFn: ({ tableId, guests }) => api.openTableSession(tableId, { guests }),
  })

  const updateGuestsMutation = useMutation({
    mutationFn: ({ tableId, guests }) => api.updateSessionGuests(tableId, { guests }),
  })

  const createOrderMutation = useMutation({
    mutationFn: ({ tableId }) => api.createOrder({ tableId, source: 'WAITER' }),
  })

  const addItemsMutation = useMutation({
    mutationFn: ({ orderId, payload }) => api.addItems(orderId, payload),
  })

  const sendKitchenMutation = useMutation({
    mutationFn: (orderId) => api.sendKitchen(orderId),
  })

  const approveQrOrderMutation = useMutation({
    mutationFn: (orderId) => api.approveOrder(orderId),
  })

  const isConfirming =
    openSessionMutation.isPending ||
    updateGuestsMutation.isPending ||
    createOrderMutation.isPending ||
    addItemsMutation.isPending ||
    sendKitchenMutation.isPending ||
    approveQrOrderMutation.isPending

  useEffect(() => {
    const socket = getSocket()

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    }

    socket.on('table.session.updated', refresh)
    socket.on('order.updated', refresh)
    socket.on('kitchen.ticket.updated', refresh)

    return () => {
      socket.off('table.session.updated', refresh)
      socket.off('order.updated', refresh)
      socket.off('kitchen.ticket.updated', refresh)
    }
  }, [queryClient])

  useEffect(() => {
    if (!isOrderDrawerOpen) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOrderDrawerOpen(false)
        setComposeMode(false)
        setSelectedTableId('')
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOrderDrawerOpen])

  function selectTable(table) {
    setSelectedTableId(table.id)

    const initialPeople = Math.max(table.activeSession?.guestsActive || 1, 1)
    const draft = Array.from({ length: initialPeople }, () => createPersonDraft())
    setPersons(draft)
    setComposeMode(false)
    setOrderDrawerOpen(true)
  }

  function closeOrderDrawer() {
    setOrderDrawerOpen(false)
    setComposeMode(false)
    setSelectedTableId('')
  }

  function openComposerForTable() {
    if (!selectedTable) return
    setComposeMode(true)
  }

  function updatePerson(index, patch) {
    setPersons((prev) => prev.map((person, idx) => (idx === index ? { ...person, ...patch } : person)))
  }

  function toggleExtraType(index, type, enabled) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryEnabled: enabled,
            extraEntryIds: enabled ? (person.extraEntryIds.length ? person.extraEntryIds : [entryOptions[0]?.id || '']) : [],
          }
        }

        return {
          ...person,
          beverageEnabled: enabled,
          beverageIds: enabled ? (person.beverageIds.length ? person.beverageIds : [beverageOptions[0]?.id || '']) : [],
        }
      }),
    )
  }

  function addExtraRow(index, type) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryIds: [...person.extraEntryIds, entryOptions[0]?.id || ''],
          }
        }

        return {
          ...person,
          beverageIds: [...person.beverageIds, beverageOptions[0]?.id || ''],
        }
      }),
    )
  }

  function updateExtraRow(index, type, rowIndex, value) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          const next = [...person.extraEntryIds]
          next[rowIndex] = value
          return { ...person, extraEntryIds: next }
        }

        const next = [...person.beverageIds]
        next[rowIndex] = value
        return { ...person, beverageIds: next }
      }),
    )
  }

  function removeExtraRow(index, type, rowIndex) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryIds: person.extraEntryIds.filter((_, pos) => pos !== rowIndex),
          }
        }

        return {
          ...person,
          beverageIds: person.beverageIds.filter((_, pos) => pos !== rowIndex),
        }
      }),
    )
  }

  function addPerson() {
    if (!selectedTable) {
      toast.error('Selecciona una mesa primero')
      return
    }

    if (persons.length >= selectedTable.capacity) {
      toast.error(`Aforo maximo alcanzado (${selectedTable.capacity})`)
      return
    }

    setPersons((prev) => [...prev, createPersonDraft()])
  }

  async function ensureTableSession(guests) {
    if (!selectedTable) {
      throw new Error('Mesa no seleccionada')
    }

    if (selectedTable.activeSession) {
      if (selectedTable.activeSession.guestsActive !== guests) {
        await updateGuestsMutation.mutateAsync({ tableId: selectedTable.id, guests })
      }
      return
    }

    await openSessionMutation.mutateAsync({ tableId: selectedTable.id, guests })
  }

  function buildOrderItems() {
    if (!persons.length) {
      throw new Error('No hay personas en la mesa')
    }

    const generatedItems = persons.flatMap((person, index) => {
      const guestNumber = index + 1
      const extraEntryIds = person.extraEntryEnabled ? person.extraEntryIds.filter(Boolean) : []
      const beverageIds = person.beverageEnabled ? person.beverageIds.filter(Boolean) : []
      const extraIds = [...extraEntryIds, ...beverageIds]
      const hasExtras = extraIds.length > 0
      const customNote = String(person.kitchenNote || '').trim()

      if (person.mainId) {
        if (!person.entryId) {
          throw new Error(`Persona ${guestNumber}: selecciona entrada del menu`)
        }

        const main = mainMap.get(person.mainId)
        const entry = entryMap.get(person.entryId)
        const notesParts = [`Entrada incluida: ${entry?.name || 'N/A'}`]

        if (customNote) {
          notesParts.push(`Detalle: ${customNote}`)
        }

        return [{
          productId: person.mainId,
          quantity: 1,
          variant: main?.variants?.[0] || 'normal',
          guestNumber,
          serviceMode: 'DINE_IN',
          notes: notesParts.join(' | '),
          extras: mergeIdsWithQty(extraIds),
        }]
      }

      if (person.entryId && !person.mainId) {
        throw new Error(`Persona ${guestNumber}: la entrada incluida requiere plato principal`)
      }

      if (hasExtras) {
        return mergeIdsWithQty(extraIds).map((extraLine) => ({
          productId: extraLine.productId,
          quantity: extraLine.quantity,
          variant: 'normal',
          guestNumber,
          serviceMode: 'DINE_IN',
          notes: customNote ? `Detalle: ${customNote}` : '',
          extras: [],
        }))
      }

      if (customNote) {
        throw new Error(`Persona ${guestNumber}: agrega un plato o un extra para registrar el detalle`)
      }

      return []
    })

    if (!generatedItems.length) {
      throw new Error('No hay items nuevos para confirmar en la mesa')
    }

    return generatedItems
  }

  async function confirmOrder() {
    try {
      if (!selectedTable) {
        toast.error('Selecciona una mesa primero')
        return
      }

      const items = buildOrderItems()

      await ensureTableSession(persons.length)

      const order = await createOrderMutation.mutateAsync({ tableId: selectedTable.id })
      await addItemsMutation.mutateAsync({ orderId: order.id, payload: { items } })
      const kitchenResult = await sendKitchenMutation.mutateAsync(order.id)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ])

      setPersons((prev) => prev.map(() => createPersonDraft()))

      let pdfGenerated = false
      if (kitchenResult?.ticket) {
        try {
          await downloadKitchenTicketPdf(kitchenResult.ticket, { tableNumber: selectedTable.number })
          pdfGenerated = true
        } catch {
          pdfGenerated = false
        }
      }

      toast.success(
        pdfGenerated
          ? 'Pedido confirmado, enviado a cocina y comanda PDF generada'
          : 'Pedido confirmado y enviado a cocina',
      )
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function approveQrOrder(order) {
    try {
      await approveQrOrderMutation.mutateAsync(order.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
      ])
      toast.success(`Pedido QR aprobado: ${order.id.slice(0, 8)}`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function sendQrOrderToKitchen(order) {
    try {
      const result = await sendKitchenMutation.mutateAsync(order.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ])

      let pdfGenerated = false
      if (result?.ticket) {
        try {
          await downloadKitchenTicketPdf(result.ticket, { tableNumber: selectedTable?.number || '-' })
          pdfGenerated = true
        } catch {
          pdfGenerated = false
        }
      }

      toast.success(
        pdfGenerated
          ? `Pedido QR enviado a cocina: ${order.id.slice(0, 8)} (comanda PDF)`
          : `Pedido QR enviado a cocina: ${order.id.slice(0, 8)}`,
      )
    } catch (error) {
      toast.error(error.message)
    }
  }

  function createTakeAwayOrder() {
    setOrderViewMode('TAKEAWAY')
    setOrderDrawerOpen(false)
    setComposeMode(false)
    setSelectedTableId('')
    toast.info('Flujo para llevar preparado en esta vista. Siguiente paso: registrar pedido rapido para takeaway.')
  }

  return (
    <div className="page-stack pos-orders-page">
      <section className="pos-orders-shell">
        <div className="section-head pos-orders-head">
          <div>
            <h2 className="section-title">Pedidos</h2>
            <p className="section-subtitle">Gestion de pedidos por mesa y para llevar</p>
          </div>
          <button className="btn btn-alt" onClick={createTakeAwayOrder} type="button">
            + Crear pedido para llevar
          </button>
        </div>

        <div className="pos-orders-kpis">
          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon total"><i className="fi fi-rr-receipt" /></span>
              <p>Total de pedidos</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.total}</p>
            <div className="pos-orders-kpi-track"><span className="pos-orders-kpi-fill total" style={{ width: '100%' }} /></div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon pending"><i className="fi fi-rr-hourglass-end" /></span>
              <p>Pendientes</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.pending}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill pending"
                style={{ width: `${orderSummary.total ? (orderSummary.pending / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon process"><i className="fi fi-rr-fire-flame-curved" /></span>
              <p>En proceso</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.inProcess}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill process"
                style={{ width: `${orderSummary.total ? (orderSummary.inProcess / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon delivered"><i className="fi fi-rr-check" /></span>
              <p>Entregados</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.delivered}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill delivered"
                style={{ width: `${orderSummary.total ? (orderSummary.delivered / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>
        </div>

        <div className="pos-orders-toolbar">
          <div className="pos-orders-view-tabs">
            <button
              className={`pos-orders-tab ${orderViewMode === 'TABLES' ? 'active' : ''}`}
              onClick={() => setOrderViewMode('TABLES')}
              type="button"
            >
              Mesas
            </button>
            <button
              className={`pos-orders-tab ${orderViewMode === 'TAKEAWAY' ? 'active' : ''}`}
              onClick={() => setOrderViewMode('TAKEAWAY')}
              type="button"
            >
              Para llevar <span className="badge">{takeAwayOrders.length}</span>
            </button>
          </div>

          {orderViewMode === 'TABLES' && (
            <select onChange={(event) => setTableStateFilter(event.target.value)} value={tableStateFilter}>
              <option value="ALL">Estado: Todos</option>
              <option value="AVAILABLE">Disponibles</option>
              <option value="OCCUPIED">Ocupadas</option>
              <option value="PENDING">Pendientes</option>
              <option value="IN_PROCESS">En proceso</option>
              <option value="DELIVERED">Entregadas</option>
            </select>
          )}
        </div>

        {orderViewMode === 'TABLES' && (
          <div className="pos-orders-table-grid">
            {filteredTableCards.map((row) => (
              <button
                className={`pos-orders-table-card tone-${row.stateMeta.tone} ${selectedTableId === row.table.id ? 'active' : ''}`}
                key={row.table.id}
                onClick={() => selectTable(row.table)}
                type="button"
              >
                <div className="pos-orders-table-head">
                  <p className="pos-orders-table-number">{String(row.table.number).padStart(2, '0')}</p>
                  <span className="pos-orders-table-guests"><i className="fi fi-rr-users" /> {row.guestCount}</span>
                </div>

                <div className="pos-orders-table-status">
                  <span className={`pos-orders-dot ${row.stateMeta.tone}`} />
                  <span>{row.stateMeta.label}</span>
                </div>

                <div className="pos-orders-table-counters">
                  <span className="counter pending"><i className="fi fi-rr-hourglass-end" /> {row.pendingCount}</span>
                  <span className="counter process"><i className="fi fi-rr-fire-flame-curved" /> {row.inProcessCount}</span>
                  <span className="counter delivered"><i className="fi fi-rr-check" /> {row.deliveredCount}</span>
                </div>
              </button>
            ))}

            {!filteredTableCards.length && (
              <div className="alert alert-info">No hay mesas para el filtro seleccionado.</div>
            )}
          </div>
        )}

        {orderViewMode === 'TAKEAWAY' && (
          <div className="panel-soft">
            <div className="section-head">
              <h3 className="section-title" style={{ fontSize: 20 }}>Pedidos para llevar</h3>
              <span className="badge">{takeAwayOrders.length} activos</span>
            </div>

            {!takeAwayOrders.length && (
              <p className="small muted" style={{ marginTop: 10 }}>
                Aun no hay pedidos para llevar en curso.
              </p>
            )}

            {!!takeAwayOrders.length && (
              <div className="column-list" style={{ marginTop: 10 }}>
                {takeAwayOrders.map((order) => (
                  <article className="card-mini" key={order.id}>
                    <div className="section-head">
                      <div>
                        <p className="small"><strong>Pedido:</strong> {order.id.slice(0, 8)}</p>
                        <p className="small muted">Estado: {orderStatusLabel(order.status)}</p>
                      </div>
                      <strong>{formatMoney(order.totals?.total || 0)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {isOrderDrawerOpen && selectedTable && (
        <div className="pos-order-drawer-backdrop" onClick={closeOrderDrawer}>
          <section className="pos-order-drawer" onClick={(event) => event.stopPropagation()}>
            <header className="pos-order-drawer-head">
              <div>
                <h3 className="pos-order-drawer-title">Mesa {selectedTable.number}</h3>
                <p className={`pos-order-drawer-status ${selectedTableCard?.stateMeta?.tone || 'occupied'}`}>
                  <span className={`pos-orders-dot ${selectedTableCard?.stateMeta?.tone || 'occupied'}`} />
                  {selectedTableCard?.stateMeta?.label || 'Ocupada'}
                </p>
              </div>
              <button aria-label="Cerrar modal mesa" className="pos-order-drawer-close" onClick={closeOrderDrawer} type="button">
                <i className="fi fi-rr-cross-small" />
              </button>
            </header>

            {!isComposeMode && (
              <div className="pos-order-drawer-body">
                {!selectedTableLiveOrders.length && !selectedTableQrOrders.length && (
                  <p className="pos-order-drawer-empty-title">Sin pedidos</p>
                )}

                {!!selectedTableLiveOrders.length && (
                  <div className="column-list">
                    {selectedTableLiveOrders.map((order) => (
                      <article className="card-mini" key={order.id}>
                        <div className="section-head">
                          <div>
                            <p className="small"><strong>Pedido:</strong> {order.id.slice(0, 8)}</p>
                            <p className="small muted">Estado: {orderStatusLabel(order.status)}</p>
                          </div>
                          <strong>{formatMoney(order.totals?.total || 0)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <button className="btn btn-alt pos-order-drawer-add-btn" onClick={openComposerForTable} type="button">
                  + Anadir pedido
                </button>
              </div>
            )}

            {isComposeMode && (
          <div className="page-stack">
            <div className="pos-main-header">
              <div className="inline-actions">
                <span className="pos-mesa-badge">Mesa {selectedTable.number}</span>
                <p className="section-subtitle" style={{ marginTop: 0 }}>
                  {persons.length} persona{persons.length === 1 ? '' : 's'} en la mesa
                </p>
              </div>

              <div className="inline-actions">
                <span className="aforo-pill">Aforo max. {selectedTable.capacity} por mesa</span>
                <span className="small muted">Aforo:</span>
                <div className="pos-pips">
                  {Array.from({ length: selectedTable.capacity }, (_, index) => (
                    <span className={`pos-pip ${index < persons.length ? 'on' : ''}`} key={`aforo-${selectedTable.id}-${index}`} />
                  ))}
                </div>
                <span className="small muted">{persons.length}/{selectedTable.capacity}</span>
                <button className="btn btn-soft" onClick={() => setComposeMode(false)} type="button">
                  Volver
                </button>
              </div>
            </div>

            <section className="panel-soft">
              <div className="section-head">
                <h3 className="section-title" style={{ fontSize: 20 }}>Pedidos QR en espera</h3>
                <span className="badge">Mesa {selectedTable.number}: {selectedTableQrOrders.length}</span>
              </div>

              {!selectedTableQrOrders.length && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  No hay pedidos QR pendientes para esta mesa.
                </p>
              )}

              {!!selectedTableQrOrders.length && (
                <div className="column-list" style={{ marginTop: 8 }}>
                  {selectedTableQrOrders.map((order) => (
                    <article className="card-mini" key={order.id}>
                      <div className="section-head">
                        <div>
                          <p className="small"><strong>Pedido:</strong> {order.id.slice(0, 8)}</p>
                          <p className="small muted">
                            Estado: {orderStatusLabel(order.status)} | Items: {order.items?.length || 0}
                          </p>
                          <p className="small muted">
                            Total: {formatMoney(order.totals?.total || 0)}
                          </p>
                        </div>
                        <div className="inline-actions">
                          {order.status === 'PENDING_WAITER_APPROVAL' && (
                            <button
                              className="btn btn-main"
                              disabled={isConfirming}
                              onClick={() => approveQrOrder(order)}
                              type="button"
                            >
                              Aprobar
                            </button>
                          )}
                          {order.status === 'APPROVED' && (
                            <button
                              className="btn btn-good"
                              disabled={isConfirming}
                              onClick={() => sendQrOrderToKitchen(order)}
                              type="button"
                            >
                              Enviar a cocina
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {persons.map((person, index) => {
              const personNumber = index + 1
              const extraCount =
                (person.extraEntryEnabled ? person.extraEntryIds.filter(Boolean).length : 0) +
                (person.beverageEnabled ? person.beverageIds.filter(Boolean).length : 0)
              const subtotal = personSubtotals[index] || 0

              return (
                <article className="person-card" key={person.id}>
                  <div className="person-head">
                    <div className="person-head-left">
                      <span className="person-avatar">P{personNumber}</span>
                      <div>
                        <p className="person-title">Persona {personNumber}</p>
                        <p className="small muted">{extraCount > 0 ? `${extraCount} extra(s) anadido(s)` : 'Sin extras'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="person-body">
                    <div className="form-grid-2 person-main-grid">
                      <div className="compact-field">
                        <label className="form-label">Plato principal</label>
                        <select
                          className="person-select"
                          onChange={(event) => updatePerson(index, { mainId: event.target.value })}
                          value={person.mainId}
                        >
                          <option value="">-- Seleccionar plato --</option>
                          {mainOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} - {formatMoney(option.price)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="compact-field">
                        <label className="form-label">Entrada (incluida)</label>
                        <select
                          className="person-select"
                          onChange={(event) => updatePerson(index, { entryId: event.target.value })}
                          value={person.entryId}
                        >
                          <option value="">-- Seleccionar entrada --</option>
                          {entryOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="person-detail-row">
                      <label className="form-label detail-label">Detalle:</label>
                      <input
                        className="person-detail-input"
                        onChange={(event) => updatePerson(index, { kitchenNote: event.target.value })}
                        placeholder="Ej: Con menestra o sin ensalada"
                        value={person.kitchenNote}
                      />
                    </div>

                    <div className="person-extra-trigger-row">
                      <button
                        className={`extra-trigger-btn ${person.showExtras ? 'active' : ''}`}
                        onClick={() => updatePerson(index, { showExtras: !person.showExtras })}
                        type="button"
                      >
                        {person.showExtras ? '- Cerrar extras' : '+ Anadir extra'}
                        {extraCount > 0 && <span className="extra-count-badge">{extraCount}</span>}
                      </button>
                    </div>

                    {person.showExtras && (
                      <div className="extra-chooser">
                        <div className="chooser-title">Que desea agregar?</div>

                        <div className="chooser-options">
                          <label className={`chk-option ${person.extraEntryEnabled ? 'selected-en' : ''}`}>
                            <span className="chk-box">{person.extraEntryEnabled && <span className="chk-tick">&#10003;</span>}</span>
                            <input
                              checked={person.extraEntryEnabled}
                              onChange={(event) => toggleExtraType(index, 'entry', event.target.checked)}
                              style={{ display: 'none' }}
                              type="checkbox"
                            />
                            <span className="chk-label">Entrada extra</span>
                          </label>

                          <label className={`chk-option ${person.beverageEnabled ? 'selected-beb' : ''}`}>
                            <span className="chk-box">{person.beverageEnabled && <span className="chk-tick">&#10003;</span>}</span>
                            <input
                              checked={person.beverageEnabled}
                              onChange={(event) => toggleExtraType(index, 'beverage', event.target.checked)}
                              style={{ display: 'none' }}
                              type="checkbox"
                            />
                            <span className="chk-label">Bebida</span>
                          </label>
                        </div>

                        {person.extraEntryEnabled && (
                          <div className="chooser-list cl-en">
                            <p className="chooser-list-title">Entradas extra</p>

                            {(person.extraEntryIds.length ? person.extraEntryIds : ['']).map((value, rowIndex) => (
                              <div className="extra-item" key={`entry-extra-${person.id}-${rowIndex}`}>
                                <select
                                  onChange={(event) => updateExtraRow(index, 'entry', rowIndex, event.target.value)}
                                  value={value}
                                >
                                  <option value="">Seleccionar entrada</option>
                                  {entryOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name} - {formatMoney(option.price)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="btn-rm-extra rm-en"
                                  onClick={() => removeExtraRow(index, 'entry', rowIndex)}
                                  type="button"
                                >
                                  x
                                </button>
                              </div>
                            ))}

                            <button className="btn-add-more add-more-en" onClick={() => addExtraRow(index, 'entry')} type="button">
                              + Agregar otra entrada
                            </button>
                          </div>
                        )}

                        {person.beverageEnabled && (
                          <div className="chooser-list cl-beb">
                            <p className="chooser-list-title">Bebidas</p>

                            {(person.beverageIds.length ? person.beverageIds : ['']).map((value, rowIndex) => (
                              <div className="extra-item" key={`bev-extra-${person.id}-${rowIndex}`}>
                                <select
                                  onChange={(event) => updateExtraRow(index, 'beverage', rowIndex, event.target.value)}
                                  value={value}
                                >
                                  <option value="">Seleccionar bebida</option>
                                  {beverageOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name} - {formatMoney(option.price)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="btn-rm-extra rm-beb"
                                  onClick={() => removeExtraRow(index, 'beverage', rowIndex)}
                                  type="button"
                                >
                                  x
                                </button>
                              </div>
                            ))}

                            <button className="btn-add-more add-more-beb" onClick={() => addExtraRow(index, 'beverage')} type="button">
                              + Agregar otra bebida
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="chip-list">
                      {person.mainId && <span className="chip chip-green">{mainMap.get(person.mainId)?.name}</span>}
                      {person.entryId && <span className="chip chip-amber">{entryMap.get(person.entryId)?.name}</span>}
                      {person.extraEntryEnabled &&
                        person.extraEntryIds.map((id, pos) =>
                          id ? (
                            <span className="chip chip-purple" key={`entry-chip-${person.id}-${pos}`}>
                              {entryMap.get(id)?.name}
                            </span>
                          ) : null,
                        )}
                      {person.beverageEnabled &&
                        person.beverageIds.map((id, pos) =>
                          id ? (
                            <span className="chip chip-blue" key={`bev-chip-${person.id}-${pos}`}>
                              {beverageMap.get(id)?.name}
                            </span>
                          ) : null,
                        )}
                    </div>

                    <div className="person-subtotal-row">
                      <span>Subtotal:</span>
                      <strong>{formatMoney(subtotal)}</strong>
                    </div>
                  </div>
                </article>
              )
            })}

            <button className="btn-add-p" onClick={addPerson} type="button">
              + Anadir persona a la mesa
            </button>

            <section className="summary-card">
              <div className="summary-head">RESUMEN DEL PEDIDO</div>

              <div className="summary-lines">
                {persons.map((person, index) => (
                  <div className="summary-line" key={`summary-${person.id}`}>
                    <span>Persona {index + 1}</span>
                    <span>{formatMoney(personSubtotals[index] || 0)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-total">
                <span>Total</span>
                <strong>{formatMoney(totalAmount)}</strong>
              </div>

              <button className="summary-confirm" disabled={isConfirming} onClick={confirmOrder} type="button">
                {isConfirming ? 'Confirmando...' : 'Confirmar pedido'}
              </button>
            </section>
          </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
