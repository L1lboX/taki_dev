import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

export default function OrdersBillsPage() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('OPEN')
  const [drafts, setDrafts] = useState({})

  const billsQuery = useQuery({
    queryKey: ['bills', status],
    queryFn: () => api.getBills({ status: status || undefined }),
    refetchInterval: 5000,
  })

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
    refetchInterval: 10000,
  })

  const tableNumberById = useMemo(() => new Map((tablesQuery.data || []).map((table) => [table.id, table.number])), [tablesQuery.data])

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bills'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['cash-register'] }),
      queryClient.invalidateQueries({ queryKey: ['cash'] }),
    ])
  }

  const generateMutation = useMutation({
    mutationFn: api.generateBills,
    onSuccess: async (result) => {
      toast.success(`Cuentas generadas/actualizadas: ${result.count || 0}`)
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const payMutation = useMutation({
    mutationFn: ({ billId, body }) => api.payBill(billId, body),
    onSuccess: async () => {
      toast.success('Cuenta cobrada')
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  function draftForBill(bill) {
    const current = drafts[bill.id] || {}
    return {
      cash: current.cash ?? Number(bill.dueAmount || bill.total || 0),
      transfer: current.transfer ?? 0,
      splitMode: current.splitMode || 'TABLE_TOTAL',
    }
  }

  function updateDraft(billId, patch) {
    setDrafts((prev) => ({
      ...prev,
      [billId]: {
        ...(prev[billId] || {}),
        ...patch,
      },
    }))
  }

  function submitPayment(bill) {
    const draft = draftForBill(bill)
    const cash = Number(draft.cash) || 0
    const transfer = Number(draft.transfer) || 0

    const payments = []
    if (cash > 0) payments.push({ method: 'CASH', amount: cash })
    if (transfer > 0) payments.push({ method: 'TRANSFER', amount: transfer })

    if (!payments.length) {
      toast.error('Ingresa al menos un monto para cobrar')
      return
    }

    payMutation.mutate({
      billId: bill.id,
      body: {
        splitMode: draft.splitMode,
        payments,
      },
    })
  }

  const bills = billsQuery.data || []

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Cuentas de pedidos</h2>
            <p className="section-subtitle">Genera cuentas por persona y cobra en esta bandeja operativa.</p>
          </div>
          <button className="btn btn-main" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate({})} type="button">
            Generar cuentas
          </button>
        </div>

        <div className="inline-actions" style={{ marginTop: 12 }}>
          <label className="form-label">Estado</label>
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">Todas</option>
            <option value="OPEN">Abiertas</option>
            <option value="PARTIALLY_PAID">Parciales</option>
            <option value="PAID">Pagadas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
          <span className="badge">Total: {bills.length}</span>
        </div>
      </section>

      <section className="panel">
        {billsQuery.isLoading && <p className="alert alert-info">Cargando cuentas...</p>}
        {!billsQuery.isLoading && !bills.length && <p className="alert alert-info">No hay cuentas en este estado.</p>}

        {!!bills.length && (
          <div className="column-list">
            {bills.map((bill) => {
              const draft = draftForBill(bill)
              const tableNumber = tableNumberById.get(bill.tableId) || bill.tableId?.replace(/^t/i, '') || '-'
              const canPay = bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID'

              return (
                <article className="panel-soft" key={bill.id}>
                  <div className="section-head">
                    <div>
                      <p className="small muted">Cuenta {bill.id.slice(0, 8)}</p>
                      <h3 className="section-title" style={{ fontSize: 20 }}>Mesa {tableNumber} - {bill.label}</h3>
                      <p className="small muted">Items: {bill.lines?.length || 0} | Estado: {bill.status}</p>
                    </div>
                    <div>
                      <p className="small muted">Total</p>
                      <p className="kpi-value" style={{ fontSize: 24 }}>{formatMoney(bill.total)}</p>
                      <p className="small">Pendiente: {formatMoney(bill.dueAmount)}</p>
                    </div>
                  </div>

                  {!!bill.lines?.length && (
                    <div className="table-wrap" style={{ marginTop: 10 }}>
                      <table className="app-table">
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th>Cant.</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bill.lines.map((line) => (
                            <tr key={line.id}>
                              <td>{line.productName}</td>
                              <td>{line.quantity}</td>
                              <td>{formatMoney(line.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canPay && (
                    <div className="form-grid-3" style={{ marginTop: 10 }}>
                      <div>
                        <label className="form-label">Efectivo</label>
                        <input min="0" onChange={(event) => updateDraft(bill.id, { cash: event.target.value })} step="0.01" type="number" value={draft.cash} />
                      </div>
                      <div>
                        <label className="form-label">Transferencia</label>
                        <input min="0" onChange={(event) => updateDraft(bill.id, { transfer: event.target.value })} step="0.01" type="number" value={draft.transfer} />
                      </div>
                      <div>
                        <label className="form-label">Modo</label>
                        <select onChange={(event) => updateDraft(bill.id, { splitMode: event.target.value })} value={draft.splitMode}>
                          <option value="TABLE_TOTAL">Cuenta total</option>
                          <option value="SPLIT">Division</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {canPay && (
                    <div className="inline-actions" style={{ marginTop: 10 }}>
                      <button className="btn btn-good" disabled={payMutation.isPending} onClick={() => submitPayment(bill)} type="button">
                        Cobrar cuenta
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
