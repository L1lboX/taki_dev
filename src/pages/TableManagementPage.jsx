import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { downloadTableQrBatchPdf } from '../lib/tableQrPdf'
import { useAuthStore } from '../store/authStore'

const QR_STATUS = {
  PENDING: 'PENDING',
  GENERATED: 'GENERATED',
  PRINTED: 'PRINTED',
}

function parseIntField(value, fallback = null) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function qrStatusLabel(status) {
  if (status === QR_STATUS.PENDING) return 'PENDIENTE'
  if (status === QR_STATUS.GENERATED) return 'GENERADO'
  if (status === QR_STATUS.PRINTED) return 'IMPRESO'
  return status || '-'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-PE', { hour12: false })
}

function toBooleanFilter(raw) {
  if (raw === 'all') return undefined
  return raw === 'true'
}

export default function TableManagementPage() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const queryClient = useQueryClient()

  const [tableFilters, setTableFilters] = useState({
    salonId: '',
    active: 'all',
    qrStatus: '',
  })

  const [singleForm, setSingleForm] = useState({
    salonId: '',
    number: 1,
    capacity: 4,
  })

  const [bulkForm, setBulkForm] = useState({
    salonId: '',
    startNumber: 1,
    count: 5,
    capacity: 4,
  })

  const [lastGeneratedRows, setLastGeneratedRows] = useState([])

  const salonsQuery = useQuery({
    queryKey: ['salons-admin'],
    queryFn: () => api.getSalons(),
    enabled: isAdmin,
  })

  const tablesQuery = useQuery({
    queryKey: ['tables-admin', tableFilters],
    queryFn: () =>
      api.getTablesAdmin({
        salonId: tableFilters.salonId || undefined,
        active: toBooleanFilter(tableFilters.active),
        qrStatus: tableFilters.qrStatus || undefined,
      }),
    enabled: isAdmin,
  })

  const qrQuery = useQuery({
    queryKey: ['tables-qr-pending'],
    queryFn: api.getPendingQrs,
    enabled: isAdmin,
  })

  const salons = useMemo(() => salonsQuery.data ?? [], [salonsQuery.data])
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])
  const qrSummary = useMemo(
    () => qrQuery.data?.summary || { pending: 0, generated: 0, printed: 0, total: 0 },
    [qrQuery.data?.summary],
  )
  const pendingQrRows = useMemo(() => qrQuery.data?.pending ?? [], [qrQuery.data?.pending])
  const generatedQrRows = useMemo(() => qrQuery.data?.generated ?? [], [qrQuery.data?.generated])

  const canUseSalon = useMemo(() => salons.filter((salon) => salon.active), [salons])

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['salons-admin'] }),
      queryClient.invalidateQueries({ queryKey: ['tables-admin'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['tables-qr-pending'] }),
    ])
  }

  const createSalonMutation = useMutation({
    mutationFn: api.createSalon,
    onSuccess: async () => {
      toast.success('Salon creado')
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateSalonMutation = useMutation({
    mutationFn: ({ salonId, body }) => api.updateSalon(salonId, body),
    onSuccess: async () => {
      toast.success('Salon actualizado')
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const createTableMutation = useMutation({
    mutationFn: api.createTable,
    onSuccess: async () => {
      toast.success('Mesa creada')
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const createBulkTablesMutation = useMutation({
    mutationFn: api.createTablesBulk,
    onSuccess: async (result) => {
      toast.success(`Mesas creadas: ${result.count || 0}`)
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateTableMutation = useMutation({
    mutationFn: ({ tableId, body }) => api.updateTable(tableId, body),
    onSuccess: async () => {
      toast.success('Mesa actualizada')
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const generatePendingMutation = useMutation({
    mutationFn: api.generatePendingQrs,
    onSuccess: async (result) => {
      const generated = result?.generated || []
      setLastGeneratedRows(generated)
      await refreshAll()

      if (!generated.length) {
        toast.info('No hay mesas pendientes por generar')
        return
      }

      try {
        await downloadTableQrBatchPdf(generated, { title: 'TAKI POS - QRs de Mesas' })
        toast.success(`QRs generados y exportados: ${generated.length}`)
      } catch (error) {
        toast.error(error.message)
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const markPrintedMutation = useMutation({
    mutationFn: () => api.markPrintedQrs({}),
    onSuccess: async (result) => {
      toast.success(`Mesas marcadas como impresas: ${result.marked || 0}`)
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const exportGeneratedPdf = async () => {
    const rows = generatedQrRows.length ? generatedQrRows : lastGeneratedRows
    if (!rows.length) {
      toast.info('No hay QRs generados para exportar')
      return
    }

    try {
      await downloadTableQrBatchPdf(rows, { title: 'TAKI POS - QRs de Mesas' })
    } catch (error) {
      toast.error(error.message)
    }
  }

  const editSalon = (salon) => {
    const nextName = window.prompt('Nuevo nombre del salon', salon.name)
    if (nextName == null) return
    const cleanName = String(nextName).trim()
    if (!cleanName) {
      toast.error('Nombre invalido')
      return
    }

    const sortOrderRaw = window.prompt('Nuevo orden del salon', String(salon.sortOrder))
    if (sortOrderRaw == null) return
    const sortOrder = parseIntField(sortOrderRaw)
    if (!sortOrder) {
      toast.error('Orden invalido')
      return
    }

    updateSalonMutation.mutate({
      salonId: salon.id,
      body: {
        name: cleanName,
        sortOrder,
      },
    })
  }

  const editTable = (table) => {
    const nextSalonId = window.prompt(
      `Salon ID (actual: ${table.salon?.name || table.salonId})`,
      table.salonId,
    )
    if (nextSalonId == null) return

    const nextNumberRaw = window.prompt('Numero de mesa', String(table.number))
    if (nextNumberRaw == null) return
    const nextCapacityRaw = window.prompt('Aforo', String(table.capacity))
    if (nextCapacityRaw == null) return

    const number = parseIntField(nextNumberRaw)
    const capacity = parseIntField(nextCapacityRaw)
    const salonId = String(nextSalonId).trim()

    if (!salonId || !number || !capacity) {
      toast.error('Datos de mesa invalidos')
      return
    }

    updateTableMutation.mutate({
      tableId: table.id,
      body: {
        salonId,
        number,
        capacity,
      },
    })
  }

  if (!isAdmin) {
    return (
      <section className="panel">
        <p className="alert alert-error">No tienes permisos para acceder a este modulo.</p>
      </section>
    )
  }

  return (
    <div className="page-stack table-management-page">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Gestion de Mesas</h2>
            <p className="section-subtitle">Administra salones, mesas y QR fisicos por estado.</p>
          </div>
          <div className="inline-actions">
            <span className="badge">Pendientes: {qrSummary.pending}</span>
            <span className="badge">Generados: {qrSummary.generated}</span>
            <span className="badge">Impresos: {qrSummary.printed}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">1) Salones</h3>
        </div>

        <form
          className="form-grid-3"
          onSubmit={(event) => {
            event.preventDefault()
            const formData = new FormData(event.currentTarget)
            const name = String(formData.get('name') || '').trim()
            const sortOrder = parseIntField(formData.get('sortOrder'), undefined)
            if (!name) {
              toast.error('Nombre de salon requerido')
              return
            }
            createSalonMutation.mutate({ name, sortOrder })
            event.currentTarget.reset()
          }}
          style={{ marginTop: 10 }}
        >
          <div>
            <label className="form-label">Nombre de salon</label>
            <input name="name" placeholder="Ej: Terraza" />
          </div>
          <div>
            <label className="form-label">Orden</label>
            <input defaultValue={salons.length + 1} min={1} name="sortOrder" type="number" />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={createSalonMutation.isPending} type="submit">
              Crear salon
            </button>
          </div>
        </form>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th>Salon</th>
                <th>Orden</th>
                <th>Estado</th>
                <th>Mesas activas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {salons.map((salon) => (
                <tr key={salon.id}>
                  <td>{salon.name}</td>
                  <td>{salon.sortOrder}</td>
                  <td>
                    <span className={`status-pill ${salon.active ? 'status-ready' : 'status-closed'}`}>
                      {salon.active ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                  </td>
                  <td>{salon.activeTablesCount}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        className="btn btn-soft"
                        onClick={() => editSalon(salon)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn-soft"
                        onClick={() => {
                          updateSalonMutation.mutate({
                            salonId: salon.id,
                            body: { active: !salon.active },
                          })
                        }}
                        type="button"
                      >
                        {salon.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!salons.length && (
                <tr>
                  <td colSpan={5}>No hay salones registrados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">2) Mesas</h3>
        </div>

        <div className="section-grid-2" style={{ marginTop: 10 }}>
          <form
            className="panel-soft form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              const salonId = singleForm.salonId || canUseSalon[0]?.id
              if (!salonId) {
                toast.error('Primero crea o activa un salon')
                return
              }

              createTableMutation.mutate({
                salonId,
                number: Number(singleForm.number),
                capacity: Number(singleForm.capacity),
              })
            }}
          >
            <h4 className="section-title">Alta individual</h4>
            <div className="form-grid-3">
              <div>
                <label className="form-label">Salon</label>
                <select
                  onChange={(event) => setSingleForm((prev) => ({ ...prev, salonId: event.target.value }))}
                  value={singleForm.salonId}
                >
                  <option value="">Selecciona</option>
                  {canUseSalon.map((salon) => (
                    <option key={salon.id} value={salon.id}>{salon.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Numero</label>
                <input
                  min={1}
                  onChange={(event) => setSingleForm((prev) => ({ ...prev, number: Number(event.target.value) }))}
                  type="number"
                  value={singleForm.number}
                />
              </div>
              <div>
                <label className="form-label">Aforo</label>
                <input
                  min={1}
                  onChange={(event) => setSingleForm((prev) => ({ ...prev, capacity: Number(event.target.value) }))}
                  type="number"
                  value={singleForm.capacity}
                />
              </div>
            </div>
            <button className="btn btn-main" disabled={createTableMutation.isPending} type="submit">Crear mesa</button>
          </form>

          <form
            className="panel-soft form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              const salonId = bulkForm.salonId || canUseSalon[0]?.id
              if (!salonId) {
                toast.error('Primero crea o activa un salon')
                return
              }

              createBulkTablesMutation.mutate({
                salonId,
                startNumber: Number(bulkForm.startNumber),
                count: Number(bulkForm.count),
                capacity: Number(bulkForm.capacity),
              })
            }}
          >
            <h4 className="section-title">Alta por lote</h4>
            <div className="form-grid-2">
              <div>
                <label className="form-label">Salon</label>
                <select
                  onChange={(event) => setBulkForm((prev) => ({ ...prev, salonId: event.target.value }))}
                  value={bulkForm.salonId}
                >
                  <option value="">Selecciona</option>
                  {canUseSalon.map((salon) => (
                    <option key={salon.id} value={salon.id}>{salon.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Numero inicial</label>
                <input
                  min={1}
                  onChange={(event) => setBulkForm((prev) => ({ ...prev, startNumber: Number(event.target.value) }))}
                  type="number"
                  value={bulkForm.startNumber}
                />
              </div>
              <div>
                <label className="form-label">Cantidad</label>
                <input
                  min={1}
                  onChange={(event) => setBulkForm((prev) => ({ ...prev, count: Number(event.target.value) }))}
                  type="number"
                  value={bulkForm.count}
                />
              </div>
              <div>
                <label className="form-label">Aforo</label>
                <input
                  min={1}
                  onChange={(event) => setBulkForm((prev) => ({ ...prev, capacity: Number(event.target.value) }))}
                  type="number"
                  value={bulkForm.capacity}
                />
              </div>
            </div>
            <button className="btn btn-good" disabled={createBulkTablesMutation.isPending} type="submit">
              Crear lote
            </button>
          </form>
        </div>

        <div className="section-grid-2" style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Filtro salon</label>
            <select
              onChange={(event) => setTableFilters((prev) => ({ ...prev, salonId: event.target.value }))}
              value={tableFilters.salonId}
            >
              <option value="">Todos</option>
              {salons.map((salon) => (
                <option key={salon.id} value={salon.id}>{salon.name}</option>
              ))}
            </select>
          </div>
          <div className="form-grid-2">
            <div>
              <label className="form-label">Filtro activo</label>
              <select
                onChange={(event) => setTableFilters((prev) => ({ ...prev, active: event.target.value }))}
                value={tableFilters.active}
              >
                <option value="all">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
            </div>
            <div>
              <label className="form-label">Filtro QR</label>
              <select
                onChange={(event) => setTableFilters((prev) => ({ ...prev, qrStatus: event.target.value }))}
                value={tableFilters.qrStatus}
              >
                <option value="">Todos</option>
                <option value={QR_STATUS.PENDING}>Pendiente</option>
                <option value={QR_STATUS.GENERATED}>Generado</option>
                <option value={QR_STATUS.PRINTED}>Impreso</option>
              </select>
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th>Salon</th>
                <th>Mesa</th>
                <th>Aforo</th>
                <th>Estado</th>
                <th>Activo</th>
                <th>QR</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => (
                <tr key={table.id}>
                  <td>{table.salon?.name || '-'}</td>
                  <td>{table.number}</td>
                  <td>{table.capacity}</td>
                  <td>{table.status}</td>
                  <td>{table.active ? 'SI' : 'NO'}</td>
                  <td>{qrStatusLabel(table.qrStatus)}</td>
                  <td>
                    <div className="inline-actions">
                      <button className="btn btn-soft" onClick={() => editTable(table)} type="button">
                        Editar
                      </button>
                      <button
                        className="btn btn-soft"
                        onClick={() =>
                          updateTableMutation.mutate({
                            tableId: table.id,
                            body: { active: !table.active },
                          })
                        }
                        type="button"
                      >
                        {table.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tables.length && (
                <tr>
                  <td colSpan={7}>No hay mesas para los filtros seleccionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">3) QRs fisicos</h3>
          <div className="inline-actions">
            <button
              className="btn btn-main"
              disabled={generatePendingMutation.isPending}
              onClick={() => generatePendingMutation.mutate()}
              type="button"
            >
              Generar pendientes + PDF
            </button>
            <button className="btn btn-soft" onClick={exportGeneratedPdf} type="button">
              Exportar PDF de generados
            </button>
            <button
              className="btn btn-good"
              disabled={markPrintedMutation.isPending}
              onClick={() => markPrintedMutation.mutate()}
              type="button"
            >
              Marcar generados como impresos
            </button>
          </div>
        </div>

        <div className="kpi-grid" style={{ marginTop: 12 }}>
          <article className="kpi-card">
            <p className="kpi-label">Pendientes</p>
            <p className="kpi-value">{qrSummary.pending}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Generados</p>
            <p className="kpi-value">{qrSummary.generated}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Impresos</p>
            <p className="kpi-value">{qrSummary.printed}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Total activos</p>
            <p className="kpi-value">{qrSummary.total}</p>
          </article>
        </div>

        <div className="section-grid-2" style={{ marginTop: 12 }}>
          <div className="panel-soft">
            <h4 className="section-title">Pendientes</h4>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Salon</th>
                    <th>Mesa</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingQrRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.salonName}</td>
                      <td>{row.number}</td>
                      <td>{qrStatusLabel(row.qrStatus)}</td>
                    </tr>
                  ))}
                  {!pendingQrRows.length && (
                    <tr>
                      <td colSpan={3}>No hay pendientes.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-soft">
            <h4 className="section-title">Generados</h4>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Salon</th>
                    <th>Mesa</th>
                    <th>Generado</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedQrRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.salonName}</td>
                      <td>{row.number}</td>
                      <td>{formatDate(row.qrGeneratedAt)}</td>
                    </tr>
                  ))}
                  {!generatedQrRows.length && (
                    <tr>
                      <td colSpan={3}>No hay QRs generados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
