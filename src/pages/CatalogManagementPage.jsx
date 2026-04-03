import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { buildCategoryOptions, categoryLabel } from '../lib/catalogMeta'
import { useAuthStore } from '../store/authStore'

function toBooleanFilter(raw) {
  if (raw === 'all') return undefined
  return raw === 'true'
}

function parseVariants(rawValue) {
  const values = String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (values.length > 0) return values
  return ['normal']
}

function createEmptyDishForm(defaultCategory = 'MENU') {
  return {
    id: '',
    name: '',
    category: defaultCategory,
    basePrice: '10',
    imageUrl: '',
    variantsText: 'normal',
    active: true,
  }
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function fallbackInitial(value) {
  return String(value || 'P').trim().slice(0, 1).toUpperCase() || 'P'
}

export default function CatalogManagementPage() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState({
    active: 'all',
    category: '',
    search: '',
  })
  const [dishForm, setDishForm] = useState(createEmptyDishForm())
  const [categoryName, setCategoryName] = useState('')
  const [dishModalOpen, setDishModalOpen] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const deferredSearch = useDeferredValue(filters.search)

  const categoriesQuery = useQuery({
    queryKey: ['catalog-categories'],
    queryFn: () => api.getCatalogCategories({ active: true }),
    enabled: isAdmin,
  })

  const catalogQuery = useQuery({
    queryKey: ['catalog-items', filters.active, filters.category],
    queryFn: () => api.getCatalogItems({ active: toBooleanFilter(filters.active), category: filters.category || undefined }),
    enabled: isAdmin,
  })

  const categories = useMemo(
    () => buildCategoryOptions(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  )

  const rows = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data])
  const visibleRows = useMemo(() => {
    const needle = String(deferredSearch || '').trim().toLowerCase()
    if (!needle) return rows

    return rows.filter((item) => {
      const haystack = [
        item.name,
        item.categoryName || categoryLabel(item.category, categories),
        Array.isArray(item.variants) ? item.variants.join(' ') : '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(needle)
    })
  }, [categories, deferredSearch, rows])

  const stats = useMemo(() => {
    const total = rows.length
    const active = rows.filter((item) => item.active !== false).length
    const withImage = rows.filter((item) => String(item.imageUrl || '').trim()).length

    return {
      total,
      active,
      withImage,
      visible: visibleRows.length,
    }
  }, [rows, visibleRows.length])

  const dishPreview = useMemo(() => ({
    name: dishForm.name || 'Nuevo plato',
    category: dishForm.category,
    basePrice: Number(dishForm.basePrice || 0),
    imageUrl: dishForm.imageUrl,
    variants: parseVariants(dishForm.variantsText),
    active: Boolean(dishForm.active),
  }), [dishForm.active, dishForm.basePrice, dishForm.category, dishForm.imageUrl, dishForm.name, dishForm.variantsText])

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
      queryClient.invalidateQueries({ queryKey: ['menus'] }),
      queryClient.invalidateQueries({ queryKey: ['qr-menus'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
  }

  const createCategoryMutation = useMutation({
    mutationFn: api.createCatalogCategory,
    onSuccess: async (result) => {
      toast.success('Categoria creada')
      setCategoryName('')
      setCategoryModalOpen(false)
      setDishForm((prev) => ({ ...prev, category: result.id }))
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const createMutation = useMutation({
    mutationFn: api.createCatalogItem,
    onSuccess: async () => {
      toast.success('Plato creado')
      setDishForm(createEmptyDishForm(categories[0]?.id || 'MENU'))
      setDishModalOpen(false)
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ itemId, body }) => api.updateCatalogItem(itemId, body),
    onSuccess: async () => {
      toast.success('Plato actualizado')
      setDishForm(createEmptyDishForm(categories[0]?.id || 'MENU'))
      setDishModalOpen(false)
      await refreshAll()
    },
    onError: (error) => toast.error(error.message),
  })

  const openCreateDishModal = () => {
    setDishForm(createEmptyDishForm(categories[0]?.id || 'MENU'))
    setDishModalOpen(true)
  }

  const openEditDishModal = (item) => {
    setDishForm({
      id: item.id,
      name: item.name,
      category: item.category,
      basePrice: String(Number(item.basePrice || 0)),
      imageUrl: item.imageUrl || '',
      variantsText: Array.isArray(item.variants) && item.variants.length ? item.variants.join(', ') : 'normal',
      active: item.active !== false,
    })
    setDishModalOpen(true)
  }

  const closeDishModal = () => {
    setDishModalOpen(false)
    setDishForm(createEmptyDishForm(categories[0]?.id || 'MENU'))
  }

  const submitDish = (event) => {
    event.preventDefault()

    const body = {
      name: dishForm.name.trim(),
      category: dishForm.category,
      basePrice: Number(dishForm.basePrice),
      imageUrl: dishForm.imageUrl.trim(),
      variants: parseVariants(dishForm.variantsText),
      active: Boolean(dishForm.active),
    }

    if (!body.name) {
      toast.error('Ingresa el nombre del plato')
      return
    }

    if (!body.category) {
      toast.error('Selecciona una categoria')
      return
    }

    if (!Number.isFinite(body.basePrice) || body.basePrice < 0) {
      toast.error('Ingresa un precio valido')
      return
    }

    if (dishForm.id) {
      updateMutation.mutate({ itemId: dishForm.id, body })
      return
    }

    createMutation.mutate(body)
  }

  const submitCategory = (event) => {
    event.preventDefault()

    const name = categoryName.trim()
    if (!name) {
      toast.error('Ingresa el nombre de la categoria')
      return
    }

    createCategoryMutation.mutate({ name })
  }

  const toggleActive = (item) => {
    updateMutation.mutate({
      itemId: item.id,
      body: { active: !item.active },
    })
  }

  if (!isAdmin) {
    return (
      <section className="panel">
        <p className="alert alert-error">No tienes permisos para acceder a este modulo.</p>
      </section>
    )
  }

  return (
    <section className="catalog-management-page">
      <div className="catalog-library-shell">
        <header className="catalog-library-head">
          <div className="catalog-library-copy">
            <p className="catalog-library-kicker">Catalogo de platos</p>
            <h2 className="section-title">Biblioteca visual de tu carta</h2>
            <p className="section-subtitle">
              Explora, filtra y edita platos desde una sola biblioteca. La creacion de platos y categorias vive en modales separados.
            </p>
          </div>

          <div className="catalog-library-actions">
            <button className="btn btn-soft" onClick={() => setCategoryModalOpen(true)} type="button">
              Nueva categoria
            </button>
            <button className="btn btn-main" onClick={openCreateDishModal} type="button">
              Nuevo plato
            </button>
          </div>
        </header>

        <div className="catalog-library-summary">
          <article className="catalog-library-stat">
            <span className="catalog-library-stat-label">Platos</span>
            <strong className="catalog-library-stat-value">{stats.total}</strong>
          </article>
          <article className="catalog-library-stat">
            <span className="catalog-library-stat-label">Activos</span>
            <strong className="catalog-library-stat-value">{stats.active}</strong>
          </article>
          <article className="catalog-library-stat">
            <span className="catalog-library-stat-label">Con imagen</span>
            <strong className="catalog-library-stat-value">{stats.withImage}</strong>
          </article>
          <article className="catalog-library-stat">
            <span className="catalog-library-stat-label">Visibles</span>
            <strong className="catalog-library-stat-value">{stats.visible}</strong>
          </article>
        </div>

        <section className="panel catalog-library-panel">
          <div className="catalog-library-toolbar">
            <div className="catalog-library-search">
              <label className="form-label">Buscar plato</label>
              <input
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="Nombre, variante o categoria"
                value={filters.search}
              />
            </div>
            <div>
              <label className="form-label">Estado</label>
              <select onChange={(event) => setFilters((prev) => ({ ...prev, active: event.target.value }))} value={filters.active}>
                <option value="all">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
            </div>
          </div>

          <div aria-label="Filtrar por categoria" className="catalog-category-tabs" role="tablist">
            <button
              className={`catalog-category-tab${filters.category === '' ? ' active' : ''}`}
              onClick={() => setFilters((prev) => ({ ...prev, category: '' }))}
              type="button"
            >
              Todas
            </button>
            {categories.map((category) => (
              <button
                className={`catalog-category-tab${filters.category === category.id ? ' active' : ''}`}
                key={category.id}
                onClick={() => setFilters((prev) => ({ ...prev, category: category.id }))}
                type="button"
              >
                {category.name}
              </button>
            ))}
          </div>

          {catalogQuery.isLoading && (
            <p className="alert alert-info" style={{ marginTop: 14 }}>
              Cargando biblioteca de platos...
            </p>
          )}

          {catalogQuery.error && (
            <p className="alert alert-error" style={{ marginTop: 14 }}>
              {catalogQuery.error.message}
            </p>
          )}

          {!catalogQuery.isLoading && !visibleRows.length && (
            <div className="catalog-empty-state">
              <p className="catalog-empty-title">No hay platos con esos filtros.</p>
              <p className="small muted">Prueba otra categoria o crea un nuevo plato desde el boton superior.</p>
            </div>
          )}

          {!!visibleRows.length && (
            <div className="catalog-library-grid">
              {visibleRows.map((item) => (
                <article className="catalog-library-card" key={item.id}>
                  <div className="catalog-library-card-media">
                    {item.imageUrl ? (
                      <img alt={item.name} loading="lazy" src={item.imageUrl} />
                    ) : (
                      <div className="catalog-library-fallback">
                        <span>{fallbackInitial(item.name)}</span>
                      </div>
                    )}
                  </div>

                  <div className="catalog-library-card-body">
                    <div className="catalog-library-card-topline">
                      <span className="badge">{item.categoryName || categoryLabel(item.category, categories)}</span>
                      <span className={item.active ? 'status-pill status-ready' : 'status-pill status-pending'}>
                        {item.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </div>
                    <h3 className="catalog-library-card-title">{item.name}</h3>
                    <p className="catalog-library-card-price">{formatMoney(item.basePrice)}</p>
                    <p className="catalog-library-card-variants">
                      {Array.isArray(item.variants) && item.variants.length ? item.variants.join(', ') : 'Sin variantes'}
                    </p>
                  </div>

                  <div className="catalog-library-card-actions">
                    <button className="btn btn-soft" onClick={() => openEditDishModal(item)} type="button">
                      Editar
                    </button>
                    <button className="btn btn-soft" onClick={() => toggleActive(item)} type="button">
                      {item.active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {dishModalOpen && (
        <div className="catalog-modal-overlay" onClick={closeDishModal}>
          <section className="catalog-modal catalog-dish-modal" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-head">
              <div>
                <p className="catalog-library-kicker">Plato</p>
                <h3 className="section-title">{dishForm.id ? 'Editar plato' : 'Crear plato'}</h3>
                <p className="section-subtitle">Configura nombre, categoria, precio e imagen de referencia.</p>
              </div>
              <button className="btn btn-soft" onClick={closeDishModal} type="button">Cerrar</button>
            </div>

            <div className="catalog-modal-layout">
              <div className="catalog-modal-preview">
                <div className="catalog-modal-preview-media">
                  {dishPreview.imageUrl ? (
                    <img alt={dishPreview.name} src={dishPreview.imageUrl} />
                  ) : (
                    <div className="catalog-library-fallback">
                      <span>{fallbackInitial(dishPreview.name)}</span>
                    </div>
                  )}
                </div>
                <div className="catalog-modal-preview-copy">
                  <span className="badge">{categoryLabel(dishPreview.category, categories)}</span>
                  <h4 className="catalog-modal-preview-title">{dishPreview.name}</h4>
                  <p className="catalog-modal-preview-price">{formatMoney(dishPreview.basePrice)}</p>
                  <div className="catalog-modal-preview-tags">
                    {dishPreview.variants.map((variant) => (
                      <span className="badge" key={variant}>{variant}</span>
                    ))}
                  </div>
                </div>
              </div>

              <form className="catalog-modal-form" onSubmit={submitDish}>
                <div className="form-grid-2">
                  <div>
                    <label className="form-label">Nombre</label>
                    <input
                      onChange={(event) => setDishForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Ej: Lomo saltado"
                      value={dishForm.name}
                    />
                  </div>
                  <div>
                    <label className="form-label">Categoria</label>
                    <select
                      onChange={(event) => setDishForm((prev) => ({ ...prev, category: event.target.value }))}
                      value={dishForm.category}
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-grid-2">
                  <div>
                    <label className="form-label">Precio</label>
                    <input
                      min="0"
                      onChange={(event) => setDishForm((prev) => ({ ...prev, basePrice: event.target.value }))}
                      step="0.01"
                      type="number"
                      value={dishForm.basePrice}
                    />
                  </div>
                  <div>
                    <label className="form-label">Estado</label>
                    <select
                      onChange={(event) => setDishForm((prev) => ({ ...prev, active: event.target.value === 'true' }))}
                      value={String(dishForm.active)}
                    >
                      <option value="true">Activo</option>
                      <option value="false">Inactivo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label">Imagen referencial URL</label>
                  <input
                    onChange={(event) => setDishForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
                    placeholder="https://..."
                    value={dishForm.imageUrl}
                  />
                </div>

                <div>
                  <label className="form-label">Variantes</label>
                  <input
                    onChange={(event) => setDishForm((prev) => ({ ...prev, variantsText: event.target.value }))}
                    placeholder="normal, familiar, con arroz"
                    value={dishForm.variantsText}
                  />
                </div>

                <div className="catalog-modal-actions">
                  <button className="btn btn-soft" onClick={closeDishModal} type="button">Cancelar</button>
                  <button className="btn btn-main" disabled={createMutation.isPending || updateMutation.isPending} type="submit">
                    {dishForm.id ? 'Guardar cambios' : 'Crear plato'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      )}

      {categoryModalOpen && (
        <div className="catalog-modal-overlay" onClick={() => setCategoryModalOpen(false)}>
          <section className="catalog-modal catalog-category-modal" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-head">
              <div>
                <p className="catalog-library-kicker">Categoria</p>
                <h3 className="section-title">Crear categoria</h3>
                <p className="section-subtitle">Solo define el nombre. Luego podras usarla al crear platos.</p>
              </div>
              <button className="btn btn-soft" onClick={() => setCategoryModalOpen(false)} type="button">Cerrar</button>
            </div>

            <form className="catalog-modal-form" onSubmit={submitCategory}>
              <div>
                <label className="form-label">Nombre de la categoria</label>
                <input
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="Ej: Postres"
                  value={categoryName}
                />
              </div>

              <div className="catalog-modal-actions">
                <button className="btn btn-soft" onClick={() => setCategoryModalOpen(false)} type="button">Cancelar</button>
                <button className="btn btn-main" disabled={createCategoryMutation.isPending} type="submit">
                  Crear categoria
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
