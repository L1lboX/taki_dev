import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'

const ACCOUNT_TYPES = ['CASH', 'BANK', 'DIGITAL']

function parseBooleanFilter(raw) {
  if (raw === 'all') return undefined
  return raw === 'true'
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

export default function FinanceAccountsPage() {
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState('all')
  const [form, setForm] = useState({
    name: '',
    type: 'BANK',
    balance: '0',
    description: '',
    active: true,
  })

  const accountsQuery = useQuery({
    queryKey: ['finance-accounts', activeFilter],
    queryFn: () => api.getFinanceAccounts({ active: parseBooleanFilter(activeFilter) }),
  })

  const createMutation = useMutation({
    mutationFn: api.createFinanceAccount,
    onSuccess: async () => {
      toast.success('Cuenta financiera creada')
      setForm({
        name: '',
        type: 'BANK',
        balance: '0',
        description: '',
        active: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['finance-accounts'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ accountId, body }) => api.updateFinanceAccount(accountId, body),
    onSuccess: async () => {
      toast.success('Cuenta actualizada')
      await queryClient.invalidateQueries({ queryKey: ['finance-accounts'] })
      await queryClient.invalidateQueries({ queryKey: ['finance-transactions'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const accounts = accountsQuery.data || []
  const totalBalance = useMemo(
    () => accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0),
    [accounts],
  )

  function submitCreate(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    if (!name) {
      toast.error('Ingresa nombre de cuenta')
      return
    }

    createMutation.mutate({
      name,
      type: form.type,
      balance: Number(form.balance || 0),
      description: String(form.description || '').trim(),
      active: Boolean(form.active),
    })
  }

  function toggleActive(account) {
    updateMutation.mutate({
      accountId: account.id,
      body: { active: !account.active },
    })
  }

  function editAccount(account) {
    const nextName = window.prompt('Nombre de cuenta', account.name || '')
    if (nextName == null) return

    const nextType = window.prompt(
      `Tipo (${ACCOUNT_TYPES.join(', ')})`,
      String(account.type || 'BANK').toUpperCase(),
    )
    if (nextType == null) return

    const nextBalance = window.prompt('Saldo actual', String(Number(account.balance || 0)))
    if (nextBalance == null) return

    const normalizedType = String(nextType || '').trim().toUpperCase()
    if (!ACCOUNT_TYPES.includes(normalizedType)) {
      toast.error('Tipo invalido')
      return
    }

    updateMutation.mutate({
      accountId: account.id,
      body: {
        name: String(nextName || '').trim(),
        type: normalizedType,
        balance: Number(nextBalance || 0),
      },
    })
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Finanzas - Cuentas</h2>
            <p className="section-subtitle">Repositorios reales de dinero: bancos, caja fuerte y billeteras.</p>
          </div>
          <span className="badge">Saldo total: {formatMoney(totalBalance)}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nueva cuenta</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>
          <div>
            <label className="form-label">Tipo</label>
            <select onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))} value={form.type}>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Saldo inicial</label>
            <input
              min={0}
              onChange={(event) => setForm((prev) => ({ ...prev, balance: event.target.value }))}
              step="0.01"
              type="number"
              value={form.balance}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Descripcion</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Ej: Cuenta operativa principal"
              value={form.description}
            />
          </div>
          <div>
            <label className="form-label">Estado</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.value === 'true' }))}
              value={String(form.active)}
            >
              <option value="true">Activa</option>
              <option value="false">Inactiva</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={createMutation.isPending} type="submit">
              Crear cuenta
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Listado de cuentas</h3>
          <div className="inline-actions">
            <label className="form-label">Estado</label>
            <select onChange={(event) => setActiveFilter(event.target.value)} value={activeFilter}>
              <option value="all">Todas</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </div>
        </div>

        {accountsQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando cuentas...</p>}
        {!accountsQuery.isLoading && !accounts.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay cuentas registradas.</p>}

        {!!accounts.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                  <th>Descripcion</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.name}</td>
                    <td>{account.type}</td>
                    <td>{formatMoney(account.balance)}</td>
                    <td>
                      <span className={`status-pill ${account.active ? 'status-ready' : 'status-closed'}`}>
                        {account.active ? 'ACTIVA' : 'INACTIVA'}
                      </span>
                    </td>
                    <td>{account.description || '-'}</td>
                    <td>
                      <div className="inline-actions">
                        <button className="btn btn-soft" onClick={() => editAccount(account)} type="button">
                          Editar
                        </button>
                        <button className="btn btn-soft" onClick={() => toggleActive(account)} type="button">
                          {account.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
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
