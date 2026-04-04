import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

export default function MenuSectionsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    sortOrder: '1',
    active: true,
  })

  const sectionsQuery = useQuery({
    queryKey: scopedQueryKey('menu-sections', user),
    queryFn: () => api.getMenuSections({}),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuSection,
    onSuccess: async () => {
      toast.success('Seccion creada')
      setForm({
        name: '',
        code: '',
        description: '',
        sortOrder: '1',
        active: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['menu-sections'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ sectionId, body }) => api.updateMenuSection(sectionId, body),
    onSuccess: async () => {
      toast.success('Seccion actualizada')
      await queryClient.invalidateQueries({ queryKey: ['menu-sections'] })
      await queryClient.invalidateQueries({ queryKey: ['menu-categories'] })
      await queryClient.invalidateQueries({ queryKey: ['menu-products'] })
    },
    onError: (error) => toast.error(error.message),
  })

  function submitCreate(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    if (!name) {
      toast.error('Ingresa nombre de seccion')
      return
    }

    createMutation.mutate({
      name,
      code: String(form.code || '').trim() || undefined,
      description: String(form.description || '').trim() || undefined,
      sortOrder: Number(form.sortOrder || 1),
      active: Boolean(form.active),
    })
  }

  function editSection(section) {
    const nextName = window.prompt('Nombre de seccion', section.name || '')
    if (nextName == null) return
    const nextCode = window.prompt('Codigo (opcional)', section.code || '')
    if (nextCode == null) return
    const nextOrder = window.prompt('Orden', String(section.sortOrder || 1))
    if (nextOrder == null) return

    updateMutation.mutate({
      sectionId: section.id,
      body: {
        name: String(nextName || '').trim(),
        code: String(nextCode || '').trim(),
        sortOrder: Number(nextOrder || section.sortOrder || 1),
      },
    })
  }

  function toggleActive(section) {
    updateMutation.mutate({
      sectionId: section.id,
      body: { active: !section.active },
    })
  }

  const rows = sectionsQuery.data || []

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Menu - Secciones</h2>
            <p className="section-subtitle">Nivel 1 del menu: bloques de horario o linea de negocio.</p>
          </div>
          <span className="badge">Total: {rows.length}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nueva seccion</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>
          <div>
            <label className="form-label">Codigo</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
              placeholder="Ej: MENU_DIA"
              value={form.code}
            />
          </div>
          <div>
            <label className="form-label">Orden</label>
            <input
              min={1}
              onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: event.target.value }))}
              type="number"
              value={form.sortOrder}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Descripcion</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
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
              Crear seccion
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Listado de secciones</h3>
        </div>

        {sectionsQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando secciones...</p>}
        {!sectionsQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay secciones registradas.</p>}

        {!!rows.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Codigo</th>
                  <th>Orden</th>
                  <th>Estado</th>
                  <th>Descripcion</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.code || '-'}</td>
                    <td>{row.sortOrder}</td>
                    <td>
                      <span className={`status-pill ${row.active ? 'status-ready' : 'status-closed'}`}>
                        {row.active ? 'ACTIVA' : 'INACTIVA'}
                      </span>
                    </td>
                    <td>{row.description || '-'}</td>
                    <td>
                      <div className="inline-actions">
                        <button className="btn btn-soft" onClick={() => editSection(row)} type="button">
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
