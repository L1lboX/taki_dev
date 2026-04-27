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

const SYSTEM_CATEGORIES = {
  SALES_CASH: 'Ventas en efectivo',
  SALES_DIGITAL: 'Ventas por billetera digital',
  SALES: 'Ventas del sistema',
}

function categoryOptionsFor(type) {
  if (type === 'INCOME') return INCOME_CATEGORIES
  if (type === 'EXPENSE') return EXPENSE_CATEGORIES
  return []
}

function categoryLabel(value) {
  const options = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]
  return SYSTEM_CATEGORIES[value] || options.find((item) => item.value === value)?.label || value || '-'
}

function sourceLabel(value) {
  const source = String(value || '').toUpperCase()
  if (source === 'CASH_CLOSURE') return 'Cierre de caja'
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

function txDirection(row) {
  if (row.type === 'EXPENSE') return 'down'
  if (row.type === 'TRANSFER') return 'swap'
  return 'up'
}

function createInitialForm() {
  return {
    type: 'INCOME',
    amount: '0',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    note: '',
    reference: '',
    category: 'LOAN',
  }
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
  const [isModalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(createInitialForm)

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
      setForm(createInitialForm())
      setModalOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-summary'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const accounts = accountsQuery.data || []
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
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

  return (
    <div className="page-stack finance-transactions-page">
      <section className="finance-hero-panel">
        <div>
          <p className="finance-kicker">Finanzas</p>
          <h2 className="finance-title">Transacciones</h2>
          <p className="finance-copy">Ventas desde caja, ingresos manuales y egresos operativos.</p>
        </div>
        <button className="btn btn-main" onClick={() => setModalOpen(true)} type="button">
          Nueva transaccion
        </button>
      </section>

      <section className="panel finance-system-panel">
        <div className="section-head">
          <div>
            <h3 className="section-title">Ventas del sistema</h3>
            <p className="section-subtitle">Estos montos se registran en finanzas al cerrar caja, separados por metodo de pago.</p>
          </div>
          <div className="inline-actions">
            <input onChange={(event) => setSummaryDate(event.target.value)} type="date" value={summaryDate} />
            <input onChange={(event) => setSummaryMonth(event.target.value)} type="month" value={summaryMonth} />
          </div>
        </div>

        <div className="finance-summary-grid">
          <article className="finance-metric">
            <span>Venta del dia</span>
            <strong>{formatMoney(summary?.todaySales || 0)}</strong>
          </article>
          <article className="finance-metric">
            <span>Ventas del mes</span>
            <strong>{formatMoney(summary?.monthSales || 0)}</strong>
          </article>
          <article className="finance-metric">
            <span>Efectivo registrado</span>
            <strong>{formatMoney(summary?.monthCashIncome || 0)}</strong>
          </article>
          <article className="finance-metric">
            <span>Billeteras digitales</span>
            <strong>{formatMoney(summary?.monthDigitalIncome || 0)}</strong>
          </article>
          <article className="finance-metric">
            <span>Ingresos manuales</span>
            <strong>{formatMoney(summary?.monthManualIncome || 0)}</strong>
          </article>
          <article className="finance-metric danger">
            <span>Egresos del mes</span>
            <strong>{formatMoney(summary?.monthExpenses || 0)}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h3 className="section-title">Historial</h3>
            <p className="section-subtitle">Los ingresos suben en verde; los egresos bajan en clay.</p>
          </div>
          <span className="badge">{rows.length} movimientos</span>
        </div>

        <div className="form-grid-3 finance-filter-grid">
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

        {transactionsQuery.isLoading && <p className="alert alert-info">Cargando transacciones...</p>}
        {!transactionsQuery.isLoading && !rows.length && <p className="alert alert-info">No hay transacciones para esos filtros.</p>}

        {!!rows.length && (
          <div className="finance-history-list">
            {rows.map((row) => {
              const direction = txDirection(row)
              const accountName = accountById.get(row.accountId)?.name
              const fromName = accountById.get(row.fromAccountId)?.name
              const toName = accountById.get(row.toAccountId)?.name
              const accountText = row.type === 'TRANSFER' ? `${fromName || '-'} -> ${toName || '-'}` : accountName || '-'

              return (
                <article className={`finance-history-row ${direction}`} key={row.id}>
                  <span className="finance-direction" aria-hidden="true">
                    {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '↔'}
                  </span>
                  <div className="finance-history-main">
                    <strong>{categoryLabel(row.category)}</strong>
                    <span>{formatDate(row.createdAt)} · {sourceLabel(row.source)} · {accountText}</span>
                    {(row.reference || row.note) && <small>{row.reference || row.note}</small>}
                  </div>
                  <strong className="finance-history-amount">
                    {row.type === 'EXPENSE' ? '-' : row.type === 'INCOME' ? '+' : ''}
                    {formatMoney(row.amount)}
                  </strong>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {isModalOpen && (
        <div className="modal-backdrop finance-modal-backdrop" role="presentation">
          <form className="panel modal-card finance-modal-card" onSubmit={submitCreate}>
            <div className="section-head">
              <div>
                <p className="finance-kicker">Movimiento manual</p>
                <h3 className="modal-title">Nueva transaccion</h3>
              </div>
              <button className="btn btn-soft" onClick={() => setModalOpen(false)} type="button">Cerrar</button>
            </div>

            <div className="form-grid-2" style={{ marginTop: 14 }}>
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
                <input min={0} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} step="0.01" type="number" value={form.amount} />
              </div>

              {form.type !== 'TRANSFER' && (
                <>
                  <div>
                    <label className="form-label">Cuenta</label>
                    <select onChange={(event) => setForm((prev) => ({ ...prev, accountId: event.target.value }))} value={form.accountId}>
                      <option value="">Selecciona cuenta</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Categoria</label>
                    <select onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} value={form.category}>
                      {categoryOptions.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {form.type === 'TRANSFER' && (
                <>
                  <div>
                    <label className="form-label">Cuenta origen</label>
                    <select onChange={(event) => setForm((prev) => ({ ...prev, fromAccountId: event.target.value }))} value={form.fromAccountId}>
                      <option value="">Selecciona origen</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Cuenta destino</label>
                    <select onChange={(event) => setForm((prev) => ({ ...prev, toAccountId: event.target.value }))} value={form.toAccountId}>
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
                <input onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder="Ej: prestamo, planilla, mesas nuevas" value={form.reference} />
              </div>
              <div>
                <label className="form-label">Nota</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} value={form.note} />
              </div>
            </div>

            <div className="inline-actions modal-actions">
              <button className="btn btn-soft" onClick={() => setModalOpen(false)} type="button">Cancelar</button>
              <button className="btn btn-main" disabled={createMutation.isPending} type="submit">Registrar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
