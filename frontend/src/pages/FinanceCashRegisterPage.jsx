import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

export default function FinanceCashRegisterPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [openingAmount, setOpeningAmount] = useState(0)
  const [countedAmount, setCountedAmount] = useState(0)

  const currentQuery = useQuery({
    queryKey: scopedQueryKey(['cash-register', 'current'], user),
    queryFn: api.getCashRegisterCurrent,
    refetchInterval: 5000,
  })

  const transactionsQuery = useQuery({
    queryKey: scopedQueryKey(['cash-register', 'transactions'], user, currentQuery.data?.id || 'none'),
    queryFn: () => api.getCashRegisterTransactions({ cashSessionId: currentQuery.data?.id }),
    enabled: Boolean(currentQuery.data?.id),
    refetchInterval: 5000,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cash-register'] }),
      queryClient.invalidateQueries({ queryKey: ['bills'] }),
      queryClient.invalidateQueries({ queryKey: ['cash'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] }),
    ])
  }

  const openMutation = useMutation({
    mutationFn: () => api.openCashRegister({ openingAmount: Number(openingAmount) || 0 }),
    onSuccess: async () => {
      toast.success('Caja abierta')
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  const closeMutation = useMutation({
    mutationFn: () => api.closeCashRegister({ countedCashAmount: Number(countedAmount) || 0 }),
    onSuccess: async (result) => {
      const financeCount = result?.financeTransactions?.length || 0
      toast.success(`Caja cerrada. Diferencia: ${formatMoney(result?.closure?.discrepancy || 0)}. Finanzas: ${financeCount} movimiento(s).`)
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  const current = currentQuery.data

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Caja (turno)</h2>
            <p className="section-subtitle">Apertura y cierre de turno con cuadre operativo.</p>
          </div>
        </div>

        {!current && (
          <div className="panel-soft" style={{ marginTop: 12, maxWidth: 380 }}>
            <div className="form-stack">
              <label className="form-label">Monto de apertura</label>
              <input onChange={(event) => setOpeningAmount(event.target.value)} type="number" value={openingAmount} />
              <button className="btn btn-main" disabled={openMutation.isPending} onClick={() => openMutation.mutate()} type="button">
                Abrir caja
              </button>
            </div>
          </div>
        )}

        {current && (
          <div className="page-stack" style={{ marginTop: 12 }}>
            <div className="kpi-grid">
              <article className="kpi-card">
                <p className="kpi-label">Apertura</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.openingAmount)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Total cobrado</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary?.total)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Efectivo</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary?.cashTotal)}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Digital</p>
                <p className="kpi-value" style={{ fontSize: 22 }}>{formatMoney(current.summary?.transferTotal)}</p>
              </article>
            </div>

            <p className="alert alert-info">
              Al cerrar caja, el efectivo se registra en Caja General y las billeteras digitales en Billetera Digital dentro de Finanzas.
            </p>

            <div className="panel-soft" style={{ maxWidth: 380 }}>
              <div className="form-stack">
                <label className="form-label">Efectivo contado</label>
                <input onChange={(event) => setCountedAmount(event.target.value)} type="number" value={countedAmount} />
                <button className="btn btn-danger-soft" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()} type="button">
                  Cerrar caja
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <h2 className="section-title">Movimientos de caja</h2>
          <span className="badge">{transactionsQuery.data?.length || 0}</span>
        </div>

        {!current && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay caja abierta.</p>}
        {current && !(transactionsQuery.data?.length) && <p className="alert alert-info" style={{ marginTop: 12 }}>Aun no hay cobros registrados.</p>}

        {!!transactionsQuery.data?.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Metodo</th>
                  <th>Monto</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {transactionsQuery.data.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString('es-PE', { hour12: false })}</td>
                    <td>{row.type}</td>
                    <td>{row.method}</td>
                    <td>{formatMoney(row.amount)}</td>
                    <td>{row.billId ? row.billId.slice(0, 8) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
