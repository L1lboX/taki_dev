import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const TX_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER']
const todayIso = new Date().toISOString().slice(0, 10)
const currentMonthIso = todayIso.slice(0, 7)

const TYPE_LABELS = {
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
  TRANSFER: 'Transferencia',
}

const INCOME_CATEGORIES = [
  { value: 'SALES', label: 'Ventas del sistema' },
  { value: 'LOAN', label: 'Prestamo recibido' },
  { value: 'CAPITAL', label: 'Aporte de capital' },
  { value: 'OTHER_INCOME', label: 'Otro ingreso' },
]

const EXPENSE_CATEGORIES = [
  { value: 'SUPPLIES', label: 'Compras / insumos' },
  { value: 'PAYROLL', label: 'Pago de personal' },
  { value: 'EQUIPMENT', label: 'Activos / equipos' },
  { value: 'SERVICES', label: 'Servicios' },
  { value: 'DEBT_PAYMENT', label: 'Pago de deuda' },
  { value: 'OTHER_EXPENSE', label: 'Otro egreso' },
]

function categoryOptionsFor(type) {
  if (type === 'INCOME') return INCOME_CATEGORIES
  if (type === 'EXPENSE') return EXPENSE_CATEGORIES
  return []
}

function categoryLabel(value) {
  const options = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]
  return options.find((item) => item.value === value)?.label || value || '-'
}

function sourceLabel(value) {
  const source = String(value || '').toUpperCase()
  if (source === 'SALES_DAILY') return 'Ventas sistema'
  if (source === 'MANUAL') return 'Manual'
  return source || '-'
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('es-PE', { hour12: false })
}

function accountLabel(account) {
  if (!account) return '-'
  return `${account.name} (${account.type})`
}

export default function FinanceTransactionsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [filters, setFilters] = useState({
    from: `${currentMonthIso}-01`,
    to: todayIso,
    accountId: '',
    type: '',
  })
  const [summaryDate, setSummaryDate] = useState(todayIso)
  const [summaryMonth, setSummaryMonth] = useState(currentMonthIso)
  const [salesAccountId, setSalesAccountId] = useState('')

  const [form, setForm] = useState({
    type: 'INCOME',
    amount: '0',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    note: '',
    reference: '',
    category: 'OTHER_INCOME',
  })

  const accountsQuery = useQuery({
    queryKey: scopedQueryKey('finance-accounts', user, 'all'),
    queryFn: () => api.getFinanceAccounts({}),
  })

  const transactionsQuery = useQuery({
    queryKey: scopedQueryKey('finance-transactions', user, filters),
    queryFn: () => api.getFinanceTransactions({
      from: filters.from || undefined,
      to: filters.to || undefined,
      accountId: filters.accountId || undefined,
      type: filters.type || undefined,
    }),
  })

  const summaryQuery = useQuery({
    queryKey: scopedQueryKey('finance-summary', user, summaryDate, summaryMonth),
    queryFn: () => api.getFinanceSummary({ date: summaryDate, month: summaryMonth }),
  })

  const createMutation = useMutation({
    mutationFn: api.createFinanceTransaction,
    onSuccess: async () => {
      toast.success('Transaccion registrada')
      setForm((prev) => ({
        ...prev,
        amount: '0',
        note: '',
        reference: '',
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-accounts'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const registerSalesMutation = useMutation({
    mutationFn: api.registerDailySalesFinanceTransaction,
    onSuccess: async () => {
      toast.success('Ventas del dia registradas como ingreso')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-accounts'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const accounts = accountsQuery.data || []
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])

  function submitCreate(event) {
    event.preventDefault()
    const amount = Number(form.amount || 0)
    if (!(amount > 0)) {
      toast.error('Ingresa un monto valido')
      return
    }

    const payload = {
      type: form.type,
      amount,
      note: String(form.note || '').trim(),
      reference: String(form.reference || '').trim(),
      category: String(form.category || '').trim(),
      source: 'MANUAL',
    }

    if (form.type === 'TRANSFER') {
      const fromAccountId = String(form.fromAccountId || '').trim()
      const toAccountId = String(form.toAccountId || '').trim()
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        toast.error('Selecciona cuentas origen y destino validas')
        return
      }
      payload.fromAccountId = fromAccountId
      payload.toAccountId = toAccountId
    } else {
      const accountId = String(form.accountId || '').trim()
      if (!accountId) {
        toast.error('Selecciona una cuenta')
        return
      }
      payload.accountId = accountId
    }

    createMutation.mutate(payload)
  }

  const rows = transactionsQuery.data || []
  const summary = summaryQuery.data || null
  const categoryOptions = categoryOptionsFor(form.type)

  function updateType(type) {
    setForm((prev) => ({
      ...prev,
      type,
      category: categoryOptionsFor(type)[0]?.value || '',
    }))
  }

  function registerSales() {
    if (!salesAccountId) {
      toast.error('Selecciona la cuenta donde ingresaran las ventas')
      return
    }
    registerSalesMutation.mutate({
      date: summaryDate,
      accountId: salesAccountId,
      note: `Ingreso automatico por ventas cerradas del ${summaryDate}`,
    })
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Finanzas - Transacciones</h2>
            <p className="section-subtitle">Ingresos por ventas, prestamos o aportes; egresos por compras, planilla, activos y pagos.</p>
          </div>
          <span className="badge">Movimientos: {rows.length}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h3 className="section-title">Ventas del sistema</h3>
            <p className="section-subtitle">Jala ventas cerradas y permite registrarlas como ingreso contable.</p>
          </div>
          {summary?.registeredTodaySales && <span className="badge">Ventas del dia registradas</span>}
        </div>

        <div className="finance-summary-grid" style={{ marginTop: 12 }}>
          <div className="kpi-card">
            <p className="kpi-label">Fecha de ventas</p>
            <input onChange={(event) => setSummaryDate(event.target.value)} type="date" value={summaryDate} />
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Mes acumulado</p>
            <input onChange={(event) => setSummaryMonth(event.target.value)} type="month" value={summaryMonth} />
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Venta del dia</p>
            <p className="kpi-value">{formatMoney(summary?.todaySales || 0)}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Ventas del mes</p>
            <p className="kpi-value">{formatMoney(summary?.monthSales || 0)}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Ingresos manuales del mes</p>
            <p className="kpi-value">{formatMoney(summary?.monthManualIncome || 0)}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Egresos del mes</p>
            <p className="kpi-value">{formatMoney(summary?.monthExpenses || 0)}</p>
          </div>
        </div>

        <div className="form-grid-3" style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Cuenta destino para ventas</label>
            <select onChange={(event) => setSalesAccountId(event.target.value)} value={salesAccountId}>
              <option value="">Selecciona cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              className="btn btn-main"
              disabled={registerSalesMutation.isPending || Boolean(summary?.registeredTodaySales) || !(summary?.todaySales > 0)}
              onClick={registerSales}
              type="button"
            >
              Registrar ventas del dia
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nueva transaccion</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Tipo</label>
            <select onChange={(event) => updateType(event.target.value)} value={form.type}>
              {TX_TYPES.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Monto</label>
            <input
              min={0}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              step="0.01"
              type="number"
              value={form.amount}
            />
          </div>

          {form.type !== 'TRANSFER' && (
            <div>
              <label className="form-label">Cuenta</label>
              <select onChange={(event) => setForm((prev) => ({ ...prev, accountId: event.target.value }))} value={form.accountId}>
                <option value="">Selecciona cuenta</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                ))}
              </select>
            </div>
          )}

          {form.type !== 'TRANSFER' && (
            <div>
              <label className="form-label">Categoria</label>
              <select onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} value={form.category}>
                {categoryOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          )}

          {form.type === 'TRANSFER' && (
            <>
              <div>
                <label className="form-label">Cuenta origen</label>
                <select
                  onChange={(event) => setForm((prev) => ({ ...prev, fromAccountId: event.target.value }))}
                  value={form.fromAccountId}
                >
                  <option value="">Selecciona origen</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Cuenta destino</label>
                <select
                  onChange={(event) => setForm((prev) => ({ ...prev, toAccountId: event.target.value }))}
                  value={form.toAccountId}
                >
                  <option value="">Selecciona destino</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="form-label">Referencia</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))}
              placeholder="Ej: Dep. caja cierre noche"
              value={form.reference}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Nota</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} value={form.note} />
          </div>

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={createMutation.isPending} type="submit">
              Registrar transaccion
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Historial de transacciones</h3>
        </div>

        <div className="form-grid-3" style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Desde</label>
            <input onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))} type="date" value={filters.from} />
          </div>
          <div>
            <label className="form-label">Hasta</label>
            <input onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))} type="date" value={filters.to} />
          </div>
          <div>
            <label className="form-label">Tipo</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))} value={filters.type}>
              <option value="">Todos</option>
              {TX_TYPES.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Cuenta</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, accountId: event.target.value }))} value={filters.accountId}>
              <option value="">Todas</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </div>
        </div>

        {transactionsQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando transacciones...</p>}
        {!transactionsQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay transacciones para esos filtros.</p>}

        {!!rows.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Origen</th>
                  <th>Monto</th>
                  <th>Cuenta</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>{TYPE_LABELS[row.type] || row.type}</td>
                    <td>{categoryLabel(row.category)}</td>
                    <td>{sourceLabel(row.source)}</td>
                    <td>{formatMoney(row.amount)}</td>
                    <td>{accountById.get(row.accountId)?.name || '-'}</td>
                    <td>{accountById.get(row.fromAccountId)?.name || '-'}</td>
                    <td>{accountById.get(row.toAccountId)?.name || '-'}</td>
                    <td>{row.reference || row.note || '-'}</td>
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
