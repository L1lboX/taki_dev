import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { getSocket } from '../lib/socket'

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function normalizeLabel(label) {
  return String(label || '').replace(/^Entrada extra:\s*/i, '').trim()
}

function parseOrderNotes(rawNotes) {
  const parts = String(rawNotes || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

  let includedEntry = ''
  let detail = ''
  const others = []

  for (const part of parts) {
    if (/^Entrada incluida:/i.test(part)) {
      includedEntry = part.replace(/^Entrada incluida:\s*/i, '').trim()
      continue
    }

    if (/^Detalle:/i.test(part)) {
      detail = part.replace(/^Detalle:\s*/i, '').trim()
      continue
    }

    others.push(part)
  }

  return { includedEntry, detail, others }
}

function itemLineTotal(item) {
  const quantity = Number(item.quantity || 0)
  const base = Number(item.unitPrice || 0) * quantity
  const extras = (item.extras || []).reduce(
    (sum, extra) => sum + Number(extra.unitPrice || 0) * Number(extra.quantity || 0),
    0,
  )
  const takeawayFee = item.isMenu && item.serviceMode === 'TAKEAWAY' ? quantity : 0
  return Number((base + extras + takeawayFee).toFixed(2))
}

function summarizeOrderByGuest(order) {
  const grouped = new Map()

  for (const item of order.items || []) {
    const guestNumber = Number(item.guestNumber) > 0 ? Number(item.guestNumber) : 0
    if (!grouped.has(guestNumber)) {
      grouped.set(guestNumber, {
        guestNumber,
        total: 0,
        lines: [],
      })
    }

    const target = grouped.get(guestNumber)
    const parsed = parseOrderNotes(item.notes)
    const extras = (item.extras || []).map((extra) => ({
      name: normalizeLabel(extra.name),
      quantity: Number(extra.quantity || 0),
      unitPrice: Number(extra.unitPrice || 0),
    }))

    target.lines.push({
      quantity: Number(item.quantity || 0),
      productName: normalizeLabel(item.productName),
      unitPrice: Number(item.unitPrice || 0),
      includedEntry: normalizeLabel(parsed.includedEntry),
      detail: parsed.detail,
      note: parsed.others.join(' | '),
      extras,
      takeawayFee: item.isMenu && item.serviceMode === 'TAKEAWAY' ? Number(item.quantity || 0) : 0,
      total: itemLineTotal(item),
    })

    target.total += itemLineTotal(item)
  }

  const people = Array.from(grouped.values())
    .sort((a, b) => {
      if (a.guestNumber === 0) return 1
      if (b.guestNumber === 0) return -1
      return a.guestNumber - b.guestNumber
    })
    .map((person) => ({
      ...person,
      label: person.guestNumber > 0 ? `Persona ${person.guestNumber}` : 'Persona sin numero',
      total: Number(person.total.toFixed(2)),
    }))

  const computed = people.reduce((sum, person) => sum + person.total, 0)
  const total = Number(order.totals?.total ?? computed)

  return {
    people,
    total: Number(total.toFixed(2)),
  }
}

function orderGroupKey(order) {
  return order.tableSessionId || `table:${order.tableId}`
}

function orderTotal(order) {
  return Number(order.totals?.total || 0)
}

function mergePaymentLine(payments, method, amount) {
  const value = Number(amount || 0)
  if (!(value > 0)) return

  const existing = payments.find((payment) => payment.method === method)
  if (existing) {
    existing.amount = Number((existing.amount + value).toFixed(2))
    return
  }

  payments.push({
    method,
    amount: Number(value.toFixed(2)),
  })
}

function buildPaymentPlanForGroup(group, draft) {
  const sortedOrders = [...group.orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  const plan = []

  let remainingCash = Number(draft.cashAmount) || 0
  let remainingTransfer = Number(draft.transferAmount) || 0

  for (const order of sortedOrders) {
    let pending = orderTotal(order)
    const payments = []

    const payCash = Math.min(remainingCash, pending)
    if (payCash > 0) {
      mergePaymentLine(payments, 'CASH', payCash)
      remainingCash -= payCash
      pending -= payCash
    }

    const payTransfer = Math.min(remainingTransfer, pending)
    if (payTransfer > 0) {
      mergePaymentLine(payments, 'TRANSFER', payTransfer)
      remainingTransfer -= payTransfer
      pending -= payTransfer
    }

    if (pending > 0.0001) {
      throw new Error(`Monto insuficiente para cubrir el ticket ${order.id.slice(0, 6)}`)
    }

    plan.push({
      orderId: order.id,
      payload: {
        splitMode: draft.splitMode || 'TABLE_TOTAL',
        payments,
      },
    })
  }

  const leftovers = Number((remainingCash + remainingTransfer).toFixed(2))
  if (leftovers > 0 && plan.length > 0) {
    const last = plan[plan.length - 1]
    if (remainingCash > 0) {
      mergePaymentLine(last.payload.payments, 'CASH', remainingCash)
    }
    if (remainingTransfer > 0) {
      mergePaymentLine(last.payload.payments, 'TRANSFER', remainingTransfer)
    }
  }

  return plan
}

function buildDeliveredGroups(orders) {
  const groups = new Map()

  for (const order of orders) {
    const key = orderGroupKey(order)
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        tableId: order.tableId,
        tableSessionId: order.tableSessionId || null,
        orders: [],
        peopleMap: new Map(),
        total: 0,
        createdAt: order.createdAt,
      })
    }

    const group = groups.get(key)
    group.orders.push(order)
    group.total += orderTotal(order)
    if (new Date(order.createdAt) < new Date(group.createdAt)) {
      group.createdAt = order.createdAt
    }

    const summary = summarizeOrderByGuest(order)
    for (const person of summary.people) {
      const guestKey = person.guestNumber
      if (!group.peopleMap.has(guestKey)) {
        group.peopleMap.set(guestKey, {
          guestNumber: person.guestNumber,
          label: person.label,
          total: 0,
          lines: [],
        })
      }

      const target = group.peopleMap.get(guestKey)
      target.total += person.total
      for (const line of person.lines) {
        target.lines.push({
          ...line,
          ticketCode: order.id.slice(0, 6),
        })
      }
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const people = Array.from(group.peopleMap.values())
        .sort((a, b) => {
          if (a.guestNumber === 0) return 1
          if (b.guestNumber === 0) return -1
          return a.guestNumber - b.guestNumber
        })
        .map((person) => ({
          ...person,
          total: Number(person.total.toFixed(2)),
        }))

      const tickets = group.orders
        .slice()
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((order) => order.id.slice(0, 6))

      return {
        id: group.id,
        tableId: group.tableId,
        tableSessionId: group.tableSessionId,
        orders: group.orders,
        tickets,
        people,
        total: Number(group.total.toFixed(2)),
        createdAt: group.createdAt,
      }
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
}

export default function CashPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [openingAmount, setOpeningAmount] = useState(0)
  const [countedAmount, setCountedAmount] = useState(0)
  const [paymentDrafts, setPaymentDrafts] = useState({})
  const [payingGroupId, setPayingGroupId] = useState('')

  const currentQuery = useQuery({
    queryKey: ['cash'],
    queryFn: api.getCashCurrent,
    refetchInterval: 5000,
  })

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
    refetchInterval: 5000,
  })

  const deliveredOrdersQuery = useQuery({
    queryKey: ['orders', 'delivered'],
    queryFn: () => api.listOrders('status=DELIVERED'),
    refetchInterval: 5000,
  })

  const openMutation = useMutation({
    mutationFn: () => api.openCash({ openingAmount: Number(openingAmount) || 0 }),
    onSuccess: () => {
      toast.success('Caja abierta')
      queryClient.invalidateQueries({ queryKey: ['cash'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const closeMutation = useMutation({
    mutationFn: () => api.closeCash({ countedCashAmount: Number(countedAmount) || 0 }),
    onSuccess: (result) => {
      toast.success(`Caja cerrada. Ventas: ${formatMoney(result.summary.total)}`)
      queryClient.invalidateQueries({ queryKey: ['cash'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['kpis-daily'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const deliveredOrders = useMemo(
    () =>
      [...(deliveredOrdersQuery.data || [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [deliveredOrdersQuery.data],
  )

  const deliveredGroups = useMemo(
    () => buildDeliveredGroups(deliveredOrders),
    [deliveredOrders],
  )

  const pendingTicketsCount = useMemo(
    () => deliveredGroups.reduce((sum, group) => sum + group.orders.length, 0),
    [deliveredGroups],
  )

  const tableNumberById = useMemo(
    () =>
      new Map((tablesQuery.data || []).map((table) => [table.id, table.number])),
    [tablesQuery.data],
  )

  useEffect(() => {
    const socket = getSocket()
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['cash'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['orders', 'delivered'] })
      queryClient.invalidateQueries({ queryKey: ['orders', 'history'] })
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    }

    socket.on('order.updated', refresh)
    socket.on('cash.session.updated', refresh)
    socket.on('kitchen.ticket.updated', refresh)
    socket.on('table.session.updated', refresh)

    return () => {
      socket.off('order.updated', refresh)
      socket.off('cash.session.updated', refresh)
      socket.off('kitchen.ticket.updated', refresh)
      socket.off('table.session.updated', refresh)
    }
  }, [queryClient])

  function updateDraft(groupId, patch) {
    setPaymentDrafts((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] || {}),
        ...patch,
      },
    }))
  }

  function draftForGroup(group) {
    const current = paymentDrafts[group.id] || {}
    return {
      splitMode: current.splitMode || 'TABLE_TOTAL',
      cashAmount: current.cashAmount ?? Number(group.total || 0),
      transferAmount: current.transferAmount ?? 0,
    }
  }

  async function submitChargeGroup(group) {
    if (!current) {
      toast.error('Abre caja antes de cobrar')
      return
    }

    const draft = draftForGroup(group)
    const cashAmount = Number(draft.cashAmount) || 0
    const transferAmount = Number(draft.transferAmount) || 0
    const amountToPay = Number(group.total || 0)

    if (cashAmount <= 0 && transferAmount <= 0) {
      toast.error('Ingresa monto en efectivo o transferencia')
      return
    }

    const entered = cashAmount + transferAmount
    if (entered + 0.0001 < amountToPay) {
      toast.error(`Monto insuficiente. Total pendiente: ${formatMoney(amountToPay)}`)
      return
    }

    try {
      setPayingGroupId(group.id)

      const plan = buildPaymentPlanForGroup(group, draft)
      for (const payment of plan) {
        await api.payOrder(payment.orderId, payment.payload)
      }

      toast.success(`Cuenta cobrada: mesa ${group.tableId.replace(/^t/i, '')} (${group.orders.length} ticket(s))`)

      setPaymentDrafts((prev) => {
        const next = { ...prev }
        delete next[group.id]
        return next
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cash'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['orders', 'delivered'] }),
        queryClient.invalidateQueries({ queryKey: ['orders', 'history'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['kpis-daily'] }),
      ])
    } catch (error) {
      toast.error(error.message)
    } finally {
      setPayingGroupId('')
    }
  }

  const current = currentQuery.data

  return (
    <div className="page-stack">
      <section className="panel cash-ready-panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Caja diaria</h2>
            <p className="section-subtitle">Apertura y cierre diario con conciliacion por metodo de pago.</p>
          </div>
          <button className="btn btn-soft" onClick={() => navigate('/cash/history')} type="button">
            Historial de pedidos
          </button>
        </div>

        {!current && (
          <div className="panel-soft" style={{ marginTop: 12, maxWidth: 380 }}>
            <div className="form-stack">
              <label className="form-label">Monto de apertura</label>
              <input onChange={(event) => setOpeningAmount(event.target.value)} type="number" value={openingAmount} />
              <button className="btn btn-good" onClick={() => openMutation.mutate()} type="button">
                Abrir caja
              </button>
            </div>
          </div>
        )}

        {current && (
          <div className="page-stack" style={{ marginTop: 12 }}>
            <div className="cash-kpi-grid">
              <article className="kpi-card">
                <p className="kpi-label">Apertura</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.openingAmount)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Ventas totales</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary.total)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Pagos en efectivo</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary.cashTotal)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Pagos por transferencia</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary.transferTotal)}</p>
              </article>
            </div>

            <div className="panel-soft" style={{ maxWidth: 380 }}>
              <div className="form-stack">
                <label className="form-label">Efectivo contado al cierre</label>
                <input onChange={(event) => setCountedAmount(event.target.value)} type="number" value={countedAmount} />
                <button className="btn btn-danger-soft" onClick={() => closeMutation.mutate()} type="button">
                  Cerrar caja
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Pedidos listos para cobrar</h2>
            <p className="section-subtitle">Se agrupan por mesa/sesion. Los extras posteriores se suman en la misma cuenta por persona.</p>
          </div>
          <span className="badge">{deliveredGroups.length} cuenta(s) / {pendingTicketsCount} ticket(s)</span>
        </div>

        {!current && (
          <p className="alert alert-warn" style={{ marginTop: 12 }}>
            Caja cerrada. Abre caja para registrar cobros.
          </p>
        )}

        <div className="column-list cash-ready-list" style={{ marginTop: 12 }}>
          {deliveredGroups.length === 0 && (
            <p className="alert alert-info">No hay pedidos ENTREGADOS pendientes de cobro.</p>
          )}

          {deliveredGroups.map((group) => {
            const draft = draftForGroup(group)
            const orderTotal = Number(group.total || 0)
            const enteredAmount = Number(draft.cashAmount || 0) + Number(draft.transferAmount || 0)
            const tableNumber = tableNumberById.get(group.tableId) || group.tableId.replace(/^t/i, '')
            const isPaying = payingGroupId === group.id

            return (
              <article className="panel-soft cash-order-card cash-order-card-compact" key={group.id}>
                <div className="cash-order-head">
                  <div>
                    <p className="cash-order-ticket">Mesa {tableNumber}</p>
                    <p className="small muted">
                      Tickets: {group.tickets.join(', ')} | {group.people.length} persona(s)
                    </p>
                  </div>
                  <span className="status-pill status-ready">ENTREGADO</span>
                </div>

                <div className="cash-breakdown-list">
                  {group.people.map((person) => (
                    <div className="cash-person-block" key={`${group.id}-guest-${person.guestNumber}`}>
                      <div className="cash-person-head">
                        <strong>{person.label}</strong>
                        <strong>{formatMoney(person.total)}</strong>
                      </div>

                      <div className="cash-line-list">
                        {person.lines.map((line, lineIndex) => (
                          <div className="cash-line-item" key={`${group.id}-line-${person.guestNumber}-${lineIndex}`}>
                            <p className="small">
                              {line.quantity}x {line.productName} - {formatMoney(line.unitPrice * line.quantity)}
                            </p>
                            {line.ticketCode && <p className="small muted">Ticket: {line.ticketCode}</p>}
                            {line.includedEntry && (
                              <p className="small muted">Entrada incluida: {line.includedEntry}</p>
                            )}
                            {line.extras.length > 0 && (
                              <p className="small muted">
                                Extras:{' '}
                                {line.extras
                                  .map((extra) => `${extra.quantity}x ${extra.name} (${formatMoney(extra.unitPrice * extra.quantity)})`)
                                  .join(' | ')}
                              </p>
                            )}
                            {line.detail && <p className="small muted">Detalle: {line.detail}</p>}
                            {line.note && <p className="small muted">Nota: {line.note}</p>}
                            {line.takeawayFee > 0 && (
                              <p className="small muted">Recargo para llevar: {formatMoney(line.takeawayFee)}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="cash-order-total">
                  <span>Total de la cuenta</span>
                  <strong>{formatMoney(orderTotal)}</strong>
                </div>

                <div className="cash-pay-grid cash-pay-grid-inline">
                  <div className="compact-field">
                    <label className="form-label">Modo</label>
                    <select
                      onChange={(event) => updateDraft(group.id, { splitMode: event.target.value })}
                      value={draft.splitMode || 'TABLE_TOTAL'}
                    >
                      <option value="TABLE_TOTAL">Cuenta total</option>
                      <option value="SPLIT">Division de cuenta</option>
                    </select>
                  </div>
                  <div className="compact-field">
                    <label className="form-label">Efectivo</label>
                    <input
                      min={0}
                      onChange={(event) => updateDraft(group.id, { cashAmount: event.target.value })}
                      step="0.01"
                      type="number"
                      value={draft.cashAmount}
                    />
                  </div>
                  <div className="compact-field">
                    <label className="form-label">Transferencia</label>
                    <input
                      min={0}
                      onChange={(event) => updateDraft(group.id, { transferAmount: event.target.value })}
                      step="0.01"
                      type="number"
                      value={draft.transferAmount}
                    />
                  </div>
                  <div className="compact-field cash-pay-action">
                    <label className="form-label">Cobro</label>
                    <button
                      className="btn btn-main btn-pay-compact"
                      disabled={!current || isPaying}
                      onClick={() => submitChargeGroup(group)}
                      type="button"
                    >
                      {isPaying ? 'Cobrando...' : 'Cobrar cuenta'}
                    </button>
                  </div>
                </div>

                <div className="cash-pay-footer cash-pay-footer-compact">
                  <p className={`small ${enteredAmount + 0.0001 < orderTotal ? 'cash-pay-warning' : 'muted'}`}>
                    Ingresado: {formatMoney(enteredAmount)}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      </section>

    </div>
  )
}
