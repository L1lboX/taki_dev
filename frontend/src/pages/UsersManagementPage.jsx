import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'CASHIER', 'COOK', 'WAITER']

export default function UsersManagementPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const canWrite = user?.role === 'SUPER_ADMIN'
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'WAITER',
    active: true,
  })

  const usersQuery = useQuery({
    queryKey: scopedQueryKey('admin-users', user),
    queryFn: api.getAdminUsers,
  })

  const createMutation = useMutation({
    mutationFn: api.createAdminUser,
    onSuccess: async () => {
      toast.success('Usuario creado')
      setForm({
        username: '',
        password: '',
        name: '',
        role: 'WAITER',
        active: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ userId, body }) => api.updateAdminUser(userId, body),
    onSuccess: async () => {
      toast.success('Usuario actualizado')
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => toast.error(error.message),
  })

  function submitCreate(event) {
    event.preventDefault()
    if (!canWrite) {
      toast.error('Solo SUPER_ADMIN puede crear usuarios')
      return
    }

    const username = String(form.username || '').trim()
    const password = String(form.password || '').trim()
    const name = String(form.name || '').trim()
    if (!username || !password || !name) {
      toast.error('Completa usuario, password y nombre')
      return
    }

    createMutation.mutate({
      username,
      password,
      name,
      role: form.role,
      active: Boolean(form.active),
    })
  }

  function editUser(row) {
    if (!canWrite) {
      toast.error('Solo SUPER_ADMIN puede editar usuarios')
      return
    }

    const nextName = window.prompt('Nombre', row.name || '')
    if (nextName == null) return
    const nextRole = window.prompt(`Rol (${ROLES.join(', ')})`, row.role || 'WAITER')
    if (nextRole == null) return
    const normalizedRole = String(nextRole || '').trim().toUpperCase()
    if (!ROLES.includes(normalizedRole)) {
      toast.error('Rol invalido')
      return
    }

    updateMutation.mutate({
      userId: row.id,
      body: {
        name: String(nextName || '').trim(),
        role: normalizedRole,
      },
    })
  }

  function toggleActive(row) {
    if (!canWrite) {
      toast.error('Solo SUPER_ADMIN puede activar/desactivar usuarios')
      return
    }

    updateMutation.mutate({
      userId: row.id,
      body: { active: !row.active },
    })
  }

  const rows = usersQuery.data || []

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Gestion de usuarios</h2>
            <p className="section-subtitle">Administra cuentas internas y roles del sistema.</p>
          </div>
          <span className="badge">Total: {rows.length}</span>
        </div>
        {!canWrite && (
          <p className="alert alert-info" style={{ marginTop: 12 }}>
            Modo lectura: solo SUPER_ADMIN puede crear o editar usuarios.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nuevo usuario</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Usuario</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} value={form.username} />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              type="password"
              value={form.password}
            />
          </div>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>
          <div>
            <label className="form-label">Rol</label>
            <select onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))} value={form.role}>
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
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
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={!canWrite || createMutation.isPending} type="submit">
              Crear usuario
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Usuarios registrados</h3>
        </div>

        {usersQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando usuarios...</p>}
        {!usersQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay usuarios.</p>}

        {!!rows.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.username}</td>
                    <td>{row.name}</td>
                    <td>{row.role}</td>
                    <td>
                      <span className={`status-pill ${row.active ? 'status-ready' : 'status-closed'}`}>
                        {row.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button className="btn btn-soft" onClick={() => editUser(row)} type="button">
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
