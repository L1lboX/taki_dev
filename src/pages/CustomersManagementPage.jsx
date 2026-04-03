import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'

function parseBooleanFilter(raw) {
  if (raw === 'all') return undefined
  return raw === 'true'
}

export default function CustomersManagementPage() {
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState('all')
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    document: '',
    notes: '',
    active: true,
  })

  const customersQuery = useQuery({
    queryKey: ['customers', activeFilter],
    queryFn: () => api.getCustomers({ active: parseBooleanFilter(activeFilter) }),
  })

  const createMutation = useMutation({
    mutationFn: api.createCustomer,
    onSuccess: async () => {
      toast.success('Cliente creado')
      setForm({
        name: '',
        phone: '',
        email: '',
        document: '',
        notes: '',
        active: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ customerId, body }) => api.updateCustomer(customerId, body),
    onSuccess: async () => {
      toast.success('Cliente actualizado')
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => toast.error(error.message),
  })

  function submitCreate(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    if (!name) {
      toast.error('Ingresa nombre del cliente')
      return
    }

    createMutation.mutate({
      name,
      phone: String(form.phone || '').trim(),
      email: String(form.email || '').trim(),
      document: String(form.document || '').trim(),
      notes: String(form.notes || '').trim(),
      active: Boolean(form.active),
    })
  }

  function editCustomer(customer) {
    const nextName = window.prompt('Nombre', customer.name || '')
    if (nextName == null) return
    const nextPhone = window.prompt('Telefono', customer.phone || '')
    if (nextPhone == null) return
    const nextEmail = window.prompt('Email', customer.email || '')
    if (nextEmail == null) return

    updateMutation.mutate({
      customerId: customer.id,
      body: {
        name: String(nextName || '').trim(),
        phone: String(nextPhone || '').trim(),
        email: String(nextEmail || '').trim(),
      },
    })
  }

  function toggleActive(customer) {
    updateMutation.mutate({
      customerId: customer.id,
      body: { active: !customer.active },
    })
  }

  const rows = customersQuery.data || []

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Gestion de clientes</h2>
            <p className="section-subtitle">Registro basico de clientes para seguimiento comercial y fidelizacion.</p>
          </div>
          <span className="badge">Total: {rows.length}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nuevo cliente</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>
          <div>
            <label className="form-label">Telefono</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} value={form.phone} />
          </div>
          <div>
            <label className="form-label">Email</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} value={form.email} />
          </div>
          <div>
            <label className="form-label">Documento</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, document: event.target.value }))} value={form.document} />
          </div>
          <div>
            <label className="form-label">Activo</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.value === 'true' }))}
              value={String(form.active)}
            >
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Notas</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} value={form.notes} />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={createMutation.isPending} type="submit">
              Crear cliente
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Clientes registrados</h3>
          <div className="inline-actions">
            <label className="form-label">Estado</label>
            <select onChange={(event) => setActiveFilter(event.target.value)} value={activeFilter}>
              <option value="all">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>
        </div>

        {customersQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando clientes...</p>}
        {!customersQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay clientes.</p>}

        {!!rows.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Telefono</th>
                  <th>Email</th>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.phone || '-'}</td>
                    <td>{row.email || '-'}</td>
                    <td>{row.document || '-'}</td>
                    <td>
                      <span className={`status-pill ${row.active ? 'status-ready' : 'status-closed'}`}>
                        {row.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button className="btn btn-soft" onClick={() => editCustomer(row)} type="button">
                          Editar
                        </button>
                        <button className="btn btn-soft" onClick={() => toggleActive(row)} type="button">
                          {row.active ? 'Desactivar' : 'Activar'}
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
