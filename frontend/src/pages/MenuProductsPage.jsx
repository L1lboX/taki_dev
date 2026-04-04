import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const PRODUCT_STATUS = ['AVAILABLE', 'OUT_OF_STOCK', 'OUT_OF_SEASON']

function parseBooleanFilter(raw) {
  if (raw === 'all') return undefined
  return raw === 'true'
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function optionsToText(options = []) {
  return options
    .map((option) => {
      const name = String(option.name || '').trim()
      const extraPrice = Number(option.extraPrice || 0)
      if (!name) return ''
      if (extraPrice > 0) return `${name}:${extraPrice.toFixed(2)}`
      return name
    })
    .filter(Boolean)
    .join(', ')
}

function parseOptions(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [namePart, extraPricePart] = chunk.split(':')
      const name = String(namePart || '').trim()
      const extraPrice = Number(extraPricePart || 0)
      return {
        name,
        extraPrice: Number.isFinite(extraPrice) ? extraPrice : 0,
      }
    })
    .filter((option) => option.name)
}

function normalizeInitial(value) {
  return String(value || 'P').slice(0, 1).toUpperCase()
}

export default function MenuProductsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [filters, setFilters] = useState({
    sectionId: '',
    categoryId: '',
    active: 'all',
    status: '',
    isPublic: 'all',
  })
  const [form, setForm] = useState({
    id: '',
    sectionId: '',
    categoryId: '',
    name: '',
    productionAreaId: 'KITCHEN',
    price: '0',
    unitCost: '0',
    iva: '0',
    quantity: '0',
    status: 'AVAILABLE',
    isActive: true,
    isPublic: true,
    imageUrl: '',
    optionsText: '',
  })

  const sectionsQuery = useQuery({
    queryKey: scopedQueryKey('menu-sections', user),
    queryFn: () => api.getMenuSections({ active: true }),
  })

  const categoriesQuery = useQuery({
    queryKey: scopedQueryKey('menu-categories', user, 'all'),
    queryFn: () => api.getMenuCategories({}),
  })

  const productsQuery = useQuery({
    queryKey: scopedQueryKey('menu-products', user, filters),
    queryFn: () => api.getMenuProducts({
      sectionId: filters.sectionId || undefined,
      categoryId: filters.categoryId || undefined,
      active: parseBooleanFilter(filters.active),
      status: filters.status || undefined,
      isPublic: parseBooleanFilter(filters.isPublic),
    }),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuProduct,
    onSuccess: async () => {
      toast.success('Producto creado')
      setForm({
        id: '',
        sectionId: '',
        categoryId: '',
        name: '',
        productionAreaId: 'KITCHEN',
        price: '0',
        unitCost: '0',
        iva: '0',
        quantity: '0',
        status: 'AVAILABLE',
        isActive: true,
        isPublic: true,
        imageUrl: '',
        optionsText: '',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ productId, body }) => api.updateMenuProduct(productId, body),
    onSuccess: async () => {
      toast.success('Producto actualizado')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const sections = sectionsQuery.data || []
  const categories = categoriesQuery.data || []
  const rows = productsQuery.data || []

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections])

  const categoriesForForm = useMemo(() => {
    const currentSectionId = form.sectionId || sections[0]?.id || ''
    if (!currentSectionId) return categories
    return categories.filter((category) => category.sectionId === currentSectionId)
  }, [categories, form.sectionId, sections])

  const categoriesForFilters = useMemo(() => {
    if (!filters.sectionId) return categories
    return categories.filter((category) => category.sectionId === filters.sectionId)
  }, [categories, filters.sectionId])

  function buildPayloadFromForm() {
    const sectionId = String(form.sectionId || sections[0]?.id || '').trim()
    const categoryId = String(form.categoryId || categoriesForForm[0]?.id || '').trim()
    const name = String(form.name || '').trim()
    const price = Number(form.price || 0)

    if (!sectionId) throw new Error('Selecciona una seccion')
    if (!categoryId) throw new Error('Selecciona una categoria')
    if (!name) throw new Error('Ingresa nombre del producto')
    if (!(price >= 0)) throw new Error('Ingresa un precio valido')

    return {
      sectionId,
      categoryId,
      name,
      productionAreaId: String(form.productionAreaId || '').trim() || 'KITCHEN',
      price,
      unitCost: Number(form.unitCost || 0),
      iva: Number(form.iva || 0),
      quantity: Number(form.quantity || 0),
      status: form.status,
      isActive: Boolean(form.isActive),
      isPublic: Boolean(form.isPublic),
      imageUrl: String(form.imageUrl || '').trim(),
      options: parseOptions(form.optionsText),
    }
  }

  function submitProduct(event) {
    event.preventDefault()
    let payload
    try {
      payload = buildPayloadFromForm()
    } catch (error) {
      toast.error(error.message)
      return
    }

    if (form.id) {
      updateMutation.mutate({
        productId: form.id,
        body: payload,
      })
      return
    }

    createMutation.mutate(payload)
  }

  function toggleActive(product) {
    updateMutation.mutate({
      productId: product.id,
      body: { isActive: !product.isActive },
    })
  }

  function togglePublic(product) {
    updateMutation.mutate({
      productId: product.id,
      body: { isPublic: !product.isPublic },
    })
  }

  function editProduct(product) {
    setForm({
      id: product.id,
      sectionId: product.sectionId || '',
      categoryId: product.categoryId || '',
      name: product.name || '',
      productionAreaId: product.productionAreaId || 'KITCHEN',
      price: String(Number(product.price || 0)),
      unitCost: String(Number(product.unitCost || 0)),
      iva: String(Number(product.iva || 0)),
      quantity: String(Number(product.quantity || 0)),
      status: product.status || 'AVAILABLE',
      isActive: product.isActive !== false,
      isPublic: product.isPublic !== false,
      imageUrl: product.imageUrl || '',
      optionsText: optionsToText(product.options || []),
    })
  }

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.isActive !== false).length,
    public: rows.filter((row) => row.isPublic !== false).length,
  }), [rows])

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Menu - Productos</h2>
            <p className="section-subtitle">Nivel 3 del menu: platos con precio, costo, stock, IVA, area y visibilidad.</p>
          </div>
          <div className="inline-actions">
            <span className="badge">Total: {stats.total}</span>
            <span className="badge">Activos: {stats.active}</span>
            <span className="badge">Publicos: {stats.public}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">{form.id ? 'Editar producto' : 'Nuevo producto'}</h3>
          {form.id && (
            <button
              className="btn btn-soft"
              onClick={() => setForm({
                id: '',
                sectionId: '',
                categoryId: '',
                name: '',
                productionAreaId: 'KITCHEN',
                price: '0',
                unitCost: '0',
                iva: '0',
                quantity: '0',
                status: 'AVAILABLE',
                isActive: true,
                isPublic: true,
                imageUrl: '',
                optionsText: '',
              })}
              type="button"
            >
              Limpiar
            </button>
          )}
        </div>

        <form className="form-grid-3" onSubmit={submitProduct} style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Seccion</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, sectionId: event.target.value, categoryId: '' }))}
              value={form.sectionId}
            >
              <option value="">Selecciona seccion</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Categoria</label>
            <select onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))} value={form.categoryId}>
              <option value="">Selecciona categoria</option>
              {categoriesForForm.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Nombre</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>

          <div>
            <label className="form-label">Area de produccion</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, productionAreaId: event.target.value }))}
              placeholder="Ej: BAR, PARRILLA, COCINA"
              value={form.productionAreaId}
            />
          </div>
          <div>
            <label className="form-label">Precio venta</label>
            <input min={0} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))} step="0.01" type="number" value={form.price} />
          </div>
          <div>
            <label className="form-label">Costo unitario</label>
            <input min={0} onChange={(event) => setForm((prev) => ({ ...prev, unitCost: event.target.value }))} step="0.01" type="number" value={form.unitCost} />
          </div>

          <div>
            <label className="form-label">IVA (%)</label>
            <input min={0} onChange={(event) => setForm((prev) => ({ ...prev, iva: event.target.value }))} step="0.01" type="number" value={form.iva} />
          </div>
          <div>
            <label className="form-label">Cantidad</label>
            <input min={0} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} type="number" value={form.quantity} />
          </div>
          <div>
            <label className="form-label">Estado operacional</label>
            <select onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} value={form.status}>
              {PRODUCT_STATUS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Activo</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value === 'true' }))}
              value={String(form.isActive)}
            >
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label className="form-label">Publico QR</label>
            <select
              onChange={(event) => setForm((prev) => ({ ...prev, isPublic: event.target.value === 'true' }))}
              value={String(form.isPublic)}
            >
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label className="form-label">Imagen URL</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
              placeholder="https://..."
              value={form.imageUrl}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Opciones / guarniciones (nombre:precio, separado por coma)</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, optionsText: event.target.value }))}
              placeholder="Arroz extra:2.50, Sin cebolla"
              value={form.optionsText}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={createMutation.isPending || updateMutation.isPending} type="submit">
              {form.id ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">Biblioteca de productos</h3>
        </div>

        <div className="form-grid-3" style={{ marginTop: 12 }}>
          <div>
            <label className="form-label">Seccion</label>
            <select
              onChange={(event) => setFilters((prev) => ({ ...prev, sectionId: event.target.value, categoryId: '' }))}
              value={filters.sectionId}
            >
              <option value="">Todas</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Categoria</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, categoryId: event.target.value }))} value={filters.categoryId}>
              <option value="">Todas</option>
              {categoriesForFilters.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Estado producto</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} value={filters.status}>
              <option value="">Todos</option>
              {PRODUCT_STATUS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Activo</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, active: event.target.value }))} value={filters.active}>
              <option value="all">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>
          <div>
            <label className="form-label">Publico</label>
            <select onChange={(event) => setFilters((prev) => ({ ...prev, isPublic: event.target.value }))} value={filters.isPublic}>
              <option value="all">Todos</option>
              <option value="true">Publicos</option>
              <option value="false">Privados</option>
            </select>
          </div>
        </div>

        {productsQuery.isLoading && <p className="alert alert-info" style={{ marginTop: 12 }}>Cargando productos...</p>}
        {!productsQuery.isLoading && !rows.length && <p className="alert alert-info" style={{ marginTop: 12 }}>No hay productos para estos filtros.</p>}

        {!!rows.length && (
          <div className="catalog-library-grid" style={{ marginTop: 16 }}>
            {rows.map((row) => (
              <article className="catalog-library-card" key={row.id}>
                <div className="catalog-library-card-media">
                  {row.imageUrl ? (
                    <img alt={row.name} loading="lazy" src={row.imageUrl} />
                  ) : (
                    <div className="catalog-library-fallback">
                      <span>{normalizeInitial(row.name)}</span>
                    </div>
                  )}
                </div>

                <div className="catalog-library-card-body">
                  <div className="catalog-library-card-topline">
                    <span className="badge">{categoryById.get(row.categoryId)?.name || row.categoryName || 'Categoria'}</span>
                    <span className={row.isActive ? 'status-pill status-ready' : 'status-pill status-pending'}>
                      {row.isActive ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                  </div>
                  <h3 className="catalog-library-card-title">{row.name}</h3>
                  <p className="catalog-library-card-price">{formatMoney(row.price)}</p>
                  <p className="small muted">
                    Seccion: {sectionById.get(row.sectionId)?.name || row.sectionName || '-'} | Area: {row.productionAreaId || '-'}
                  </p>
                  <p className="small muted">
                    Costo: {formatMoney(row.unitCost)} | IVA: {Number(row.iva || 0)}% | Stock: {Number(row.quantity || 0)}
                  </p>
                  <div className="chip-list">
                    <span className={`chip ${row.isPublic ? 'chip-green' : 'chip-amber'}`}>
                      {row.isPublic ? 'PUBLICO QR' : 'NO PUBLICO'}
                    </span>
                    <span className="chip chip-blue">{row.status || 'AVAILABLE'}</span>
                  </div>
                </div>

                <div className="catalog-library-card-actions">
                  <button className="btn btn-soft" onClick={() => editProduct(row)} type="button">
                    Editar
                  </button>
                  <button className="btn btn-soft" onClick={() => toggleActive(row)} type="button">
                    {row.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn btn-soft" onClick={() => togglePublic(row)} type="button">
                    {row.isPublic ? 'Hacer privado' : 'Hacer publico'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
