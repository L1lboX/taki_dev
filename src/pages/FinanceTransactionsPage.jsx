import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'

const TX_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER']

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
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    accountId: '',
    type: '',
  })

  const [form, setForm] = useState({
    type: 'INCOME',
    amount: '0',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    note: '',
    reference: '',
  })

  const accountsQuery = useQuery({
    queryKey: ['finance-accounts', 'all'],
    queryFn: () => api.getFinanceAccounts({}),
  })

  const transactionsQuery = useQuery({
    queryKey: ['finance-transactions', filters],
    queryFn: () => api.getFinanceTransactions({
      from: filters.from || undefined,
      to: filters.to || undefined,
      accountId: filters.accountId || undefined,
      type: filters.type || undefined,
    }),
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

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Finanzas - Transacciones</h2>
            <p className="section-subtitle">Registro gerencial de ingresos, egresos y transferencias entre cuentas.</p>
          </div>
          <span className="badge">Movimientos: {rows.length}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nueva transaccion</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Tipo</label>
            <select onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))} value={form.type}>
              {TX_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
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
                <option key={type} value={type}>{type}</option>
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
                    <td>{row.type}</td>
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
