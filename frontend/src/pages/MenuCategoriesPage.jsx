import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

export default function MenuCategoriesPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [sectionFilter, setSectionFilter] = useState('')
  const [form, setForm] = useState({
    sectionId: '',
    name: '',
    description: '',
    sortOrder: '1',
    active: true,
  })

  const sectionsQuery = useQuery({
    queryKey: scopedQueryKey('menu-sections', user),
    queryFn: () => api.getMenuSections({ active: true }),
  })

  const categoriesQuery = useQuery({
    queryKey: scopedQueryKey('menu-categories', user, sectionFilter),
    queryFn: () => api.getMenuCategories({ sectionId: sectionFilter || undefined }),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuCategory,
    onSuccess: async () => {
      toast.success('Categoria creada')
      setForm({
        sectionId: '',
        name: '',
        description: '',
        sortOrder: '1',
        active: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['menu-categories'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ categoryId, body }) => api.updateMenuCategory(categoryId, body),
    onSuccess: async () => {
      toast.success('Categoria actualizada')
      await queryClient.invalidateQueries({ queryKey: ['menu-categories'] })
      await queryClient.invalidateQueries({ queryKey: ['menu-products'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const sections = sectionsQuery.data || []
  const rows = categoriesQuery.data || []
  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections])

  function submitCreate(event) {
    event.preventDefault()
    const sectionId = String(form.sectionId || sections[0]?.id || '').trim()
    const name = String(form.name || '').trim()
    if (!sectionId) {
      toast.error('Selecciona una seccion')
      return
    }
    if (!name) {
      toast.error('Ingresa nombre de categoria')
      return
    }

    createMutation.mutate({
      sectionId,
      name,
      description: String(form.description || '').trim() || undefined,
      sortOrder: Number(form.sortOrder || 1),
      active: Boolean(form.active),
    })
  }

  function editCategory(category) {
    const nextName = window.prompt('Nombre de categoria', category.name || '')
    if (nextName == null) return
    const nextSectionId = window.prompt('Section ID', category.sectionId || '')
    if (nextSectionId == null) return
    const nextOrder = window.prompt('Orden', String(category.sortOrder || 1))
    if (nextOrder == null) return

    updateMutation.mutate({
      categoryId: category.id,
      body: {
        sectionId: String(nextSectionId || '').trim(),
        name: String(nextName || '').trim(),
        sortOrder: Number(nextOrder || category.sortOrder || 1),
      },
    })
  }

  function toggleActive(category) {
    updateMutation.mutate({
      categoryId: category.id,
      body: { active: !category.active },
    })
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Menu - Categorias</h2>
            <p className="section-subtitle">Nivel 2 del menu: agrupacion de platos por seccion.</p>
          </div>
          <span className="badge">Total: {rows.length}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Nueva categoria</h3>
        </div>

        <form className="form-grid-3" onSubmit={submitCreate} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Seccion</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, sectionId: event.target.value }))}
              value={form.sectionId}
            >
              <option value="">Selecciona seccion</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
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
              Crear categoria
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Listado de categorias</h3>
          <div className="inline-actions">
            <label className="form-label">Filtrar por seccion</label>
            <select onChange={(event) => setSectionFilter(event.target.value)} value={sectionFilter}>
              <option value="">Todas</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
        </div>

        {categoriesQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando categorias...</p>}
        {!categoriesQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay categorias registradas.</p>}

        {!!rows.length && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Seccion</th>
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
                    <td>{sectionById.get(row.sectionId)?.name || row.sectionName || '-'}</td>
                    <td>{row.sortOrder}</td>
                    <td>
                      <span className={`status-pill ${row.active ? 'status-ready' : 'status-closed'}`}>
                        {row.active ? 'ACTIVA' : 'INACTIVA'}
                      </span>
                    </td>
                    <td>{row.description || '-'}</td>
                    <td>
                      <div className="inline-actions">
                        <button className="btn btn-soft" onClick={() => editCategory(row)} type="button">
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
