import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { downloadKitchenTicketPdf } from '../lib/kitchenTicketPdf'
import { scopedQueryKey } from '../lib/queryAuth'
import { getSocket } from '../lib/socket'
import { kitchenStatusLabel } from '../lib/statusLabels'
import { useAuthStore } from '../store/authStore'

const COLUMNS = ['PENDING', 'PREPARING', 'READY', 'DELIVERED']

const NEXT_STATUS = {
  PENDING: 'PREPARING',
  PREPARING: 'READY',
  READY: 'DELIVERED',
  DELIVERED: null,
}

function statusClass(status) {
  if (status === 'PENDING') return 'status-pill status-pending'
  if (status === 'PREPARING') return 'status-pill status-progress'
  if (status === 'READY') return 'status-pill status-ready'
  return 'status-pill status-closed'
}

export default function KitchenPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const ticketsQuery = useQuery({
    queryKey: scopedQueryKey('tickets', user),
    queryFn: api.listKitchenTickets,
    refetchInterval: 5000,
  })

  const incidentsQuery = useQuery({
    queryKey: scopedQueryKey('incidents', user),
    queryFn: api.listKitchenIncidents,
    refetchInterval: 5000,
  })

  useEffect(() => {
    const socket = getSocket()
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    }

    socket.on('kitchen.ticket.updated', refresh)

    return () => {
      socket.off('kitchen.ticket.updated', refresh)
    }
  }, [queryClient])

  const updateStatusMutation = useMutation({
    mutationFn: ({ ticketId, status }) => api.updateKitchenStatus(ticketId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const grouped = COLUMNS.map((column) => ({
    column,
    items: (ticketsQuery.data || []).filter((ticket) => ticket.status === column),
  }))

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Cocina Kanban</h2>
            <p className="section-subtitle">Estados: pendiente, preparando, listo y entregado. Avance automatico: 5 / 12 / 20 min.</p>
          </div>
          <span className="badge">Sincronizacion en tiempo real</span>
        </div>

        <div className="kitchen-grid" style={{ marginTop: 12 }}>
          {grouped.map((group) => (
            <div className="panel-soft" key={group.column}>
              <div className="section-head" style={{ marginBottom: 8 }}>
                <h3 className="section-title" style={{ fontSize: 18 }}>{kitchenStatusLabel(group.column)}</h3>
                <span className={statusClass(group.column)}>{group.items.length}</span>
              </div>
              <div className="column-list">
                {group.items.length === 0 && <p className="small muted">Sin tickets</p>}
                {group.items.map((ticket) => (
                  <article className="card-mini" key={ticket.id}>
                    <p style={{ fontWeight: 700 }}>Ticket {ticket.id.slice(0, 6)}</p>
                    <p className="small">Mesa {ticket.tableId.replace('t', '')}</p>
                    <p className="small muted">Impreso: {ticket.printed ? 'Si' : 'No'} | Intentos: {ticket.printAttempts}</p>
                    <div className="column-list" style={{ marginTop: 6 }}>
                      {ticket.items.map((item, index) => (
                        <div className="card-mini" key={`${ticket.id}-${index}`}>
                          <p className="small">
                            {item.quantity}x {item.productName}
                          </p>
                          {Array.isArray(item.servingLines) &&
                            item.servingLines.map((line, lineIndex) => (
                              <p className="small" key={`${ticket.id}-${index}-line-${lineIndex}`}>
                                {line.quantity}x {line.name}
                              </p>
                            ))}
                          {item.detail && (
                            <>
                              <p className="small muted">Detalle:</p>
                              <p className="small muted">{item.detail}</p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="inline-actions" style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-soft"
                        onClick={() => {
                          downloadKitchenTicketPdf(ticket, { tableNumber: ticket.tableId.replace(/^t/i, '') }).catch(() => {
                            toast.error('No se pudo generar el PDF de la comanda')
                          })
                        }}
                        style={{ flex: 1 }}
                        type="button"
                      >
                        Descargar PDF
                      </button>

                      {NEXT_STATUS[group.column] && (
                        <button
                          className="btn btn-main"
                          onClick={() => updateStatusMutation.mutate({ ticketId: ticket.id, status: NEXT_STATUS[group.column] })}
                          style={{ flex: 1 }}
                          type="button"
                        >
                          Mover a {kitchenStatusLabel(NEXT_STATUS[group.column])}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Incidentes de impresion</h2>
            <p className="section-subtitle">Se registran cuando la impresora de cocina falla o no responde.</p>
          </div>
        </div>

        <div className="column-list" style={{ marginTop: 12 }}>
          {(incidentsQuery.data || []).length === 0 && <p className="alert alert-info">Sin incidentes de impresora.</p>}
          {(incidentsQuery.data || []).map((incident) => (
            <div className="alert alert-error" key={incident.id}>
              <p style={{ fontWeight: 700 }}>{incident.kind}</p>
              <p>{incident.message}</p>
              <p className="small">Ticket: {incident.ticketId}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
