import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const WAITER_PERIODS = ['TODAY', 'WEEK', 'MONTH']
const PIE_COLORS = ['#5cb85c', '#4e79a7', '#8e6bbd', '#f28e2b', '#59a14f', '#edc949', '#76b7b2', '#e15759', '#b07aa1', '#9c755f']

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function formatDelta(value) {
  const amount = Number(value || 0)
  if (amount > 0) return `+${formatMoney(amount)}`
  if (amount < 0) return `-${formatMoney(Math.abs(amount))}`
  return formatMoney(0)
}

function periodLabel(period) {
  if (period === 'TODAY') return 'Diario'
  if (period === 'MONTH') return 'Mensual'
  return 'Semanal'
}

export default function KpiPage() {
  const user = useAuthStore((state) => state.user)
  const [waiterPeriod, setWaiterPeriod] = useState('WEEK')

  const clientsQuery = useQuery({
    queryKey: scopedQueryKey(['kpi-card', 'clients'], user),
    queryFn: () => api.getKpiClientsSummary(),
    refetchInterval: 10000,
  })

  const monthlyProfitQuery = useQuery({
    queryKey: scopedQueryKey(['kpi-card', 'monthly-profit'], user),
    queryFn: () => api.getKpiMonthlyProfitSummary(),
    refetchInterval: 10000,
  })

  const incomesQuery = useQuery({
    queryKey: scopedQueryKey(['kpi-card', 'incomes'], user),
    queryFn: () => api.getKpiIncomesSummary(),
    refetchInterval: 10000,
  })

  const ordersQuery = useQuery({
    queryKey: scopedQueryKey(['kpi-card', 'orders'], user),
    queryFn: () => api.getKpiOrdersSummary(),
    refetchInterval: 10000,
  })

  const topProductsQuery = useQuery({
    queryKey: scopedQueryKey('kpi-top-products', user),
    queryFn: () => api.getKpiTopProducts({ limit: 10 }),
    refetchInterval: 10000,
  })

  const waitersQuery = useQuery({
    queryKey: scopedQueryKey('kpi-waiters', user, waiterPeriod),
    queryFn: () => api.getKpiWaitersSummary({ period: waiterPeriod }),
    refetchInterval: 10000,
  })

  const waitersRows = waitersQuery.data?.rows || []
  const pieData = waitersRows.map((row) => ({
    name: row.userName,
    value: Number(row.amount || 0),
  }))

  const incomesDeltaClass = Number(incomesQuery.data?.deltaVsYesterday || 0) >= 0 ? 'chip chip-green' : 'chip chip-amber'

  return (
    <div className="kpi-dashboard-page">
      <div className="kpi-dashboard-shell">
        <header className="kpi-dashboard-header">
          <h2 className="section-title">Dashboard</h2>
          <p className="section-subtitle">Resumen operativo y comercial del dia</p>
        </header>

        <section className="kpi-summary-grid">
          <article className="kpi-summary-card">
            <div className="kpi-summary-head">
              <p className="kpi-label">Clientes</p>
              <span className="badge">Ver todo</span>
            </div>
            <p className="kpi-value">{clientsQuery.data?.totalUniqueClients ?? 0}</p>
            <p className="small muted">Con documento y nombre</p>
          </article>

          <article className="kpi-summary-card">
            <div className="kpi-summary-head">
              <p className="kpi-label">Ganancia mensual</p>
              <span className="badge">Ver todo</span>
            </div>
            <p className="kpi-value">{formatMoney(monthlyProfitQuery.data?.netProfit)}</p>
            <p className="small muted">Ventas {formatMoney(monthlyProfitQuery.data?.grossSales)}</p>
          </article>

          <article className="kpi-summary-card">
            <div className="kpi-summary-head">
              <p className="kpi-label">Caja</p>
              <span className="badge">Ver mas</span>
            </div>
            <p className="kpi-value">{formatMoney(incomesQuery.data?.totalToday)}</p>
            <span className={incomesDeltaClass}>vs ayer: {formatDelta(incomesQuery.data?.deltaVsYesterday)}</span>
          </article>

          <article className="kpi-summary-card">
            <div className="kpi-summary-head">
              <p className="kpi-label">Pedidos</p>
              <span className="badge">Ver mas</span>
            </div>
            <p className="kpi-value">{ordersQuery.data?.closedToday ?? 0}</p>
            <span className="chip chip-blue">{ordersQuery.data?.activeNow ?? 0} activos</span>
          </article>
        </section>

        <section className="kpi-bottom-grid">
          <article className="panel kpi-products-panel">
            <div className="section-head">
              <div>
                <h3 className="section-title" style={{ fontSize: 24 }}>Productos</h3>
                <p className="section-subtitle">Productos mas vendidos del mes</p>
              </div>
              <span className="badge">Top 10</span>
            </div>

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoria</th>
                    <th>Cantidad</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(topProductsQuery.data || []).map((item) => (
                    <tr key={item.productId}>
                      <td>{item.productName}</td>
                      <td>
                        <span className="badge">{item.categoryName || '-'}</span>
                      </td>
                      <td>{item.quantitySold}</td>
                      <td>{formatMoney(item.revenue)}</td>
                    </tr>
                  ))}
                  {(topProductsQuery.data || []).length === 0 && (
                    <tr>
                      <td className="muted" colSpan={4}>
                        Aun no hay ventas cerradas para el mes actual.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel kpi-waiters-panel">
            <div className="section-head">
              <div>
                <h3 className="section-title" style={{ fontSize: 24 }}>Meseros</h3>
                <p className="section-subtitle">Desempeno de ventas por mesero</p>
              </div>
            </div>

            <div className="kpi-waiters-toolbar">
              {WAITER_PERIODS.map((period) => (
                <button
                  className={`btn ${waiterPeriod === period ? 'btn-main' : 'btn-soft'}`}
                  key={period}
                  onClick={() => setWaiterPeriod(period)}
                  type="button"
                >
                  {periodLabel(period)}
                </button>
              ))}
            </div>

            <div className="kpi-waiters-chart-wrap">
              {pieData.length > 0 ? (
                <ResponsiveContainer height={250} width="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={52} outerRadius={95} paddingAngle={2}>
                      {pieData.map((entry, index) => (
                        <Cell fill={PIE_COLORS[index % PIE_COLORS.length]} key={`${entry.name}-${index}`} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => formatMoney(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="alert alert-info">Sin datos para el periodo seleccionado.</p>
              )}
            </div>

            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Mesero</th>
                    <th>Monto</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {waitersRows.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.userName}</td>
                      <td>{formatMoney(row.amount)}</td>
                      <td>{Number(row.percentage || 0).toFixed(2)}%</td>
                    </tr>
                  ))}
                  {waitersRows.length === 0 && (
                    <tr>
                      <td className="muted" colSpan={3}>
                        No hay ventas cerradas para este periodo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
