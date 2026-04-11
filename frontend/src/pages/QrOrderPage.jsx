import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { CATALOG_CATEGORIES } from '../lib/catalogMeta'
import { orderStatusLabel } from '../lib/statusLabels'

const RECOMMENDED_GROUP_IDS = ['MENU', 'PRINCIPALES', 'A_LA_CARTA']
const RESTAURANT_NAME = 'TAKI'
const PICKER = {
  ENTRY_INCLUDED: 'ENTRY_INCLUDED',
  ENTRY_EXTRA: 'ENTRY_EXTRA',
  BEVERAGES: 'BEVERAGES',
}

const GROUP_CONFIG = {
  [CATALOG_CATEGORIES.MENU]: {
    label: 'Menu',
    subLabel: 'Daily Menu',
    hint: 'Menu del dia con entrada sugerida',
    rank: 1,
    imageQuery: 'menu peruano casero',
    tone: 'menu',
  },
  [CATALOG_CATEGORIES.PRINCIPALES]: {
    label: 'Platos Principales',
    subLabel: 'Main Course',
    hint: 'Platos fuertes y clasicos',
    rank: 2,
    imageQuery: 'plato principal peruano',
    tone: 'main',
  },
  [CATALOG_CATEGORIES.A_LA_CARTA]: {
    label: 'A la carta',
    subLabel: 'A La Carte',
    hint: 'Especiales de la casa',
    rank: 3,
    imageQuery: 'a la carta peru',
    tone: 'carta',
  },
  [CATALOG_CATEGORIES.CEVICHES]: {
    label: 'Ceviches y marinos',
    subLabel: 'Seafood',
    hint: 'Opciones frescas sin entrada incluida',
    rank: 4,
    imageQuery: 'ceviche peruano',
    tone: 'ceviche',
  },
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function normalizeName(value) {
  return String(value || '').trim()
}

function isCevicheName(name) {
  return /ceviche|marino|marisco|duo|trio/.test(name)
}

function isCartaName(name) {
  return /lomo|pobre|chuleta|bistec|parrilla/.test(name)
}

function toMainGroup(item) {
  const explicitCategory = String(item?.category || '').toUpperCase()
  if (GROUP_CONFIG[explicitCategory]) return explicitCategory

  const type = String(item?.type || '').toUpperCase()
  const name = normalizeName(item?.name).toLowerCase()

  if (type === 'MARINO_MENU' || isCevicheName(name)) return CATALOG_CATEGORIES.CEVICHES
  if (type === 'MENU') return CATALOG_CATEGORIES.MENU
  if (type === 'A_LA_CARTA_MENU' && isCartaName(name)) return CATALOG_CATEGORIES.A_LA_CARTA
  if (type === 'A_LA_CARTA_MENU') return CATALOG_CATEGORIES.PRINCIPALES
  return CATALOG_CATEGORIES.PRINCIPALES
}

function mergeIdsWithQty(ids) {
  const grouped = new Map()
  for (const id of ids) {
    if (!id) continue
    grouped.set(id, (grouped.get(id) || 0) + 1)
  }
  return Array.from(grouped.entries()).map(([productId, quantity]) => ({ productId, quantity }))
}

function isMainGroupPicker(value) {
  return Boolean(value && GROUP_CONFIG[value])
}

function pickerTitle(activePicker) {
  if (activePicker === PICKER.ENTRY_INCLUDED) return 'Selecciona una entrada'
  if (activePicker === PICKER.ENTRY_EXTRA) return 'Selecciona entradas extra'
  if (activePicker === PICKER.BEVERAGES) return 'Selecciona bebidas'
  if (isMainGroupPicker(activePicker)) return `Selecciona ${GROUP_CONFIG[activePicker].label}`
  return 'Selecciona opcion'
}

function pickerImageUrl(item, activePicker) {
  const explicitImage = String(item?.imageUrl || '').trim()
  if (explicitImage) return explicitImage

  const name = normalizeName(item?.name)
  let suffix = 'plato peruano'
  if (activePicker === PICKER.ENTRY_INCLUDED || activePicker === PICKER.ENTRY_EXTRA) {
    suffix = 'entrada peruana'
  } else if (activePicker === PICKER.BEVERAGES) {
    suffix = 'bebida fria'
  } else if (isMainGroupPicker(activePicker)) {
    suffix = GROUP_CONFIG[activePicker]?.imageQuery || 'plato peruano'
  }

  return `https://source.unsplash.com/320x320/?${encodeURIComponent(`${name} ${suffix}`)}`
}

function statusTone(status) {
  const value = String(status || '').toUpperCase()
  if (!value || value === 'DRAFT' || value === 'PENDING_WAITER_APPROVAL') return 'warm'
  if (value === 'CANCELLED') return 'bad'
  if (value === 'READY' || value === 'DELIVERED' || value === 'CLOSED') return 'good'
  return 'accent'
}

function pickerCaption(activePicker) {
  if (activePicker === PICKER.ENTRY_INCLUDED) return 'Elige una entrada que acompañe tu pedido'
  if (activePicker === PICKER.ENTRY_EXTRA) return 'Suma algo extra para compartir o complementar'
  if (activePicker === PICKER.BEVERAGES) return 'Añade una bebida para cerrar tu mesa'
  if (isMainGroupPicker(activePicker)) return 'Toca un plato para verlo mejor y agregarlo'
  return 'Selecciona una opcion de la carta'
}

function pickerSectionLabel(activePicker) {
  if (activePicker === PICKER.ENTRY_INCLUDED) return 'Entradas'
  if (activePicker === PICKER.ENTRY_EXTRA) return 'Entradas extra'
  if (activePicker === PICKER.BEVERAGES) return 'Bebidas'
  if (isMainGroupPicker(activePicker)) return GROUP_CONFIG[activePicker]?.label || 'Carta'
  return 'Carta'
}

function renderCategoryIcon(categoryId) {
  if (categoryId === 'ENTRADAS') {
    return (
      <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3V9M7 3V9M4 6H7M6 9V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M15 3V9C15 10.1 15.9 11 17 11C18.1 11 19 10.1 19 9V3M17 3V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  return (
    <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 14H21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M5 14C5 10.1 8.1 7 12 7C15.9 7 19 10.1 19 14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 7V5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M10 18H14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

export default function QrOrderPage() {
  const { tableId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const qrTokenFromUrl = searchParams.get('token') || searchParams.get('qrToken') || ''

  const [order, setOrder] = useState(null)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [productId, setProductId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [variant, setVariant] = useState('normal')
  const [notes, setNotes] = useState('')
  const [serviceMode, setServiceMode] = useState('DINE_IN')
  const [quantity, setQuantity] = useState(1)
  const [selectedEntryExtras, setSelectedEntryExtras] = useState([])
  const [selectedBeverages, setSelectedBeverages] = useState([])
  const [activePicker, setActivePicker] = useState(null)
  const [pickerFocusId, setPickerFocusId] = useState('')
  const [imageFallbackById, setImageFallbackById] = useState({})

  const qrAccessQuery = useQuery({
    queryKey: ['qr-access', tableId, qrTokenFromUrl],
    queryFn: () => api.resolveQrAccess(tableId, qrTokenFromUrl),
    enabled: Boolean(tableId && qrTokenFromUrl),
    retry: false,
    staleTime: 60_000,
  })

  const allProducts = useMemo(() => qrAccessQuery.data?.menu?.items || [], [qrAccessQuery.data?.menu?.items])

  const mainProducts = useMemo(() => (
    allProducts.filter((item) => item.type !== 'ADDON' && item.type !== 'BEVERAGE')
  ), [allProducts])

  const entryProducts = useMemo(() => allProducts.filter((item) => item.type === 'ADDON'), [allProducts])

  const beverageProducts = useMemo(
    () => allProducts.filter((item) => item.type === 'BEVERAGE'),
    [allProducts],
  )

  const groupBuckets = useMemo(() => {
    const grouped = new Map()
    for (const item of mainProducts) {
      const groupId = toMainGroup(item)
      const config = GROUP_CONFIG[groupId]
      if (!grouped.has(groupId)) {
        grouped.set(groupId, {
          id: groupId,
          label: config?.label || groupId,
          hint: config?.hint || '',
          rank: config?.rank || 99,
          items: [],
        })
      }
      grouped.get(groupId).items.push(item)
    }

    return Array.from(grouped.values()).sort((a, b) => a.rank - b.rank)
  }, [mainProducts])

  const activeGroupId = useMemo(() => {
    if (!groupBuckets.length) return ''
    if (selectedGroupId && groupBuckets.some((bucket) => bucket.id === selectedGroupId)) {
      return selectedGroupId
    }
    return groupBuckets[0].id
  }, [groupBuckets, selectedGroupId])

  const activeGroupConfig = GROUP_CONFIG[activeGroupId] || null
  const resolvedTableId = qrAccessQuery.data?.tableId || tableId
  const qrToken = qrTokenFromUrl
  const sessionOpen = Boolean(qrAccessQuery.data?.sessionOpen)

  const selectedMain = useMemo(
    () => mainProducts.find((item) => item.id === productId) || null,
    [mainProducts, productId],
  )

  const selectedMainGroupId = selectedMain ? toMainGroup(selectedMain) : ''
  const canPickEntry = selectedMainGroupId !== 'CEVICHES'

  const selectedEntry = useMemo(
    () => {
      const activeEntryId = canPickEntry ? entryId : ''
      return entryProducts.find((item) => item.id === activeEntryId) || null
    },
    [canPickEntry, entryId, entryProducts],
  )

  const selectedEntryExtrasData = useMemo(
    () => selectedEntryExtras.map((id) => entryProducts.find((item) => item.id === id)).filter(Boolean),
    [entryProducts, selectedEntryExtras],
  )

  const selectedBeveragesData = useMemo(
    () => selectedBeverages.map((id) => beverageProducts.find((item) => item.id === id)).filter(Boolean),
    [beverageProducts, selectedBeverages],
  )

  const draftSubtotal = useMemo(() => {
    const mainTotal = Number(selectedMain?.basePrice || 0) * Number(quantity || 1)
    const extrasTotal = selectedEntryExtrasData.reduce((sum, item) => sum + Number(item.basePrice || 0), 0)
    const beverageTotal = selectedBeveragesData.reduce((sum, item) => sum + Number(item.basePrice || 0), 0)
    return Number((mainTotal + extrasTotal + beverageTotal).toFixed(2))
  }, [quantity, selectedBeveragesData, selectedEntryExtrasData, selectedMain?.basePrice])

  const recommendedGroupIds = useMemo(
    () => RECOMMENDED_GROUP_IDS.filter((id) => groupBuckets.some((bucket) => bucket.id === id)),
    [groupBuckets],
  )

  const selectedVariantOptions = useMemo(
    () => (selectedMain?.variants || []).filter(Boolean),
    [selectedMain?.variants],
  )

  const pickerItems = useMemo(() => {
    if (!activePicker) return []
    if (activePicker === PICKER.ENTRY_INCLUDED) return entryProducts
    if (activePicker === PICKER.ENTRY_EXTRA) return entryProducts
    if (activePicker === PICKER.BEVERAGES) return beverageProducts
    const targetBucket = groupBuckets.find((bucket) => bucket.id === activePicker)
    return targetBucket?.items || []
  }, [activePicker, beverageProducts, entryProducts, groupBuckets])

  const pickerIsMainGroup = isMainGroupPicker(activePicker)
  const pickerIsSingleSelect = pickerIsMainGroup || activePicker === PICKER.ENTRY_INCLUDED
  const pickerIsMultiSelect = activePicker === PICKER.ENTRY_EXTRA || activePicker === PICKER.BEVERAGES

  const isPickerItemSelected = (itemId) => {
    if (pickerIsMainGroup) return productId === itemId
    if (activePicker === PICKER.ENTRY_INCLUDED) return entryId === itemId
    if (activePicker === PICKER.ENTRY_EXTRA) return selectedEntryExtras.includes(itemId)
    if (activePicker === PICKER.BEVERAGES) return selectedBeverages.includes(itemId)
    return false
  }

  const createQrMutation = useMutation({
    mutationFn: () => api.createQrOrder({ tableId: resolvedTableId }, qrToken),
    onSuccess: (result) => {
      setOrder(result)
      toast.success('Pedido QR iniciado. Ahora agrega los platos que deseas enviar.')
    },
    onError: (error) => toast.error(error.message),
  })

  const addQrItemsMutation = useMutation({
    mutationFn: (payload) => api.addQrItems(order.id, payload, qrToken),
    onSuccess: (result) => {
      setOrder(result)
      setQuantity(1)
      setEntryId('')
      setSelectedEntryExtras([])
      setSelectedBeverages([])
      setProductId('')
      setVariant('normal')
      setNotes('')
      setActivePicker(null)
      setPickerFocusId('')
      toast.success('Pedido enviado, esperando aprobacion del mesero.')
    },
    onError: (error) => toast.error(error.message),
  })

  const onToggleSet = (setter, id) => {
    setter((prev) => (prev.includes(id) ? prev.filter((candidate) => candidate !== id) : [...prev, id]))
  }

  const markImageFallback = (itemId) => {
    setImageFallbackById((prev) => {
      if (prev[itemId]) return prev
      return { ...prev, [itemId]: true }
    })
  }

  const selectGroup = (groupId) => {
    setSelectedGroupId(groupId)
    setActivePicker(groupId)
    setPickerFocusId('')
  }

  const selectMainDish = (item) => {
    const groupId = toMainGroup(item)
    setProductId(item.id)
    setSelectedGroupId(groupId)
    setVariant(item.variants?.[0] || 'normal')
    if (groupId === 'CEVICHES') {
      setEntryId('')
    }
    setActivePicker(null)
    setPickerFocusId('')
  }

  const openEntriesCategory = () => {
    if (!canPickEntry) {
      toast.info('Los ceviches no usan entrada incluida. Puedes agregar entradas como extra.')
      return
    }
    setActivePicker(PICKER.ENTRY_INCLUDED)
    setPickerFocusId('')
  }

  const openEntryExtrasPicker = () => {
    setActivePicker(PICKER.ENTRY_EXTRA)
    setPickerFocusId('')
  }

  const openBeveragesPicker = () => {
    setActivePicker(PICKER.BEVERAGES)
    setPickerFocusId('')
  }

  const onPickerItemClick = (item) => {
    if (!activePicker) return
    setPickerFocusId(item.id)
  }

  const onPickerAction = (item) => {
    if (!activePicker) return

    if (pickerIsMainGroup) {
      selectMainDish(item)
      return
    }

    if (activePicker === PICKER.ENTRY_INCLUDED) {
      if (!canPickEntry) {
        toast.info('Este plato no permite entrada incluida.')
        return
      }
      setEntryId(item.id)
      setActivePicker(null)
      setPickerFocusId('')
      return
    }

    if (activePicker === PICKER.ENTRY_EXTRA) {
      onToggleSet(setSelectedEntryExtras, item.id)
      return
    }

    if (activePicker === PICKER.BEVERAGES) {
      onToggleSet(setSelectedBeverages, item.id)
    }
  }

  const closePicker = () => {
    setActivePicker(null)
    setPickerFocusId('')
  }

  const submitItem = () => {
    if (!qrToken) return toast.error('Este codigo QR no incluye token de seguridad valido')
    if (qrAccessQuery.error) return toast.error(qrAccessQuery.error.message)
    if (!sessionOpen) return toast.error('La mesa no tiene sesion activa. Pide al mesero que abra la mesa primero.')
    if (!order) return toast.error('Primero crea tu pedido QR')
    if (!productId) return toast.error('Selecciona un plato')

    const notesParts = []
    if (selectedEntry) {
      notesParts.push(`Entrada incluida: ${normalizeName(selectedEntry.name)}`)
    }

    const detail = String(notes || '').trim()
    if (detail) {
      notesParts.push(`Detalle: ${detail}`)
    }

    const extras = mergeIdsWithQty([...selectedEntryExtras, ...selectedBeverages])

    addQrItemsMutation.mutate({
      items: [
        {
          productId,
          quantity,
          variant,
          notes: notesParts.join(' | '),
          serviceMode,
          extras,
        },
      ],
    })
  }

  return (
    <div className="qr-customer-page">
      <div className="qr-customer-shell">
        <header className="qr-simple-header">
          <h1 className="qr-simple-brand">{RESTAURANT_NAME}</h1>
        </header>

        <div className="qr-simple-notices">
          {qrTokenFromUrl && qrAccessQuery.isPending && (
            <p className="alert alert-info qr-alert-block">
              Validando codigo QR...
            </p>
          )}
          {!qrToken && (
            <p className="alert alert-warn qr-alert-block">
              QR invalido: falta token de seguridad.
            </p>
          )}
          {!!qrToken && qrAccessQuery.error && (
            <p className="alert alert-error qr-alert-block">
              {qrAccessQuery.error.message}
            </p>
          )}
          {!!qrToken && qrAccessQuery.data && !sessionOpen && (
            <p className="alert alert-warn qr-alert-block">
              Esta mesa aun no tiene sesion activa. Pide al mesero que la abra para continuar.
            </p>
          )}
        </div>

        <div className="qr-customer-layout">
          <section className="panel-soft qr-builder-panel">
            <div className="section-head qr-panel-head">
              <div>
                <p className="qr-panel-kicker">Paso 1</p>
                <h2 className="section-title">Explora la carta por categorias</h2>
                <p className="section-subtitle">Toca una familia de platos y luego elige el que mas se te antoje.</p>
              </div>
              <div className="qr-panel-pills">
                <span className="badge">Categorias: {groupBuckets.length + (entryProducts.length ? 1 : 0)}</span>
                <span className="badge">Extras: {selectedEntryExtrasData.length + selectedBeveragesData.length}</span>
              </div>
            </div>
            <div className="qr-category-grid">
              {!!entryProducts.length && (
                <button
                  className={`qr-category-card tone-entradas ${activePicker === PICKER.ENTRY_INCLUDED || Boolean(selectedEntry) ? 'active' : ''}`}
                  onClick={openEntriesCategory}
                  type="button"
                >
                  <span className="qr-category-icon">{renderCategoryIcon('ENTRADAS')}</span>
                  <strong>Entradas</strong>
                  <span>{selectedEntry ? normalizeName(selectedEntry.name) : 'Appetizers'}</span>
                  <small className="qr-category-meta">
                    {selectedEntry ? 'Entrada elegida' : `${entryProducts.length} opciones`}
                  </small>
                </button>
              )}
              {groupBuckets.map((bucket) => (
                <button
                  className={`qr-category-card tone-${GROUP_CONFIG[bucket.id]?.tone || 'menu'} ${activePicker === bucket.id || selectedMainGroupId === bucket.id ? 'active' : ''}`}
                  key={bucket.id}
                  onClick={() => selectGroup(bucket.id)}
                  type="button"
                >
                  <span className="qr-category-icon">{renderCategoryIcon(bucket.id)}</span>
                  <strong>{bucket.label}</strong>
                  <span>{GROUP_CONFIG[bucket.id]?.subLabel || `${bucket.items.length} opciones`}</span>
                  <small className="qr-category-meta">
                    {selectedMainGroupId === bucket.id && selectedMain
                      ? normalizeName(selectedMain.name)
                      : `${bucket.items.length} platos`}
                  </small>
                </button>
              ))}
            </div>
            {activeGroupConfig && (
              <p className="small muted qr-group-hint">{activeGroupConfig.hint}</p>
            )}

            {qrToken && qrAccessQuery.isLoading && <p className="alert alert-info">Cargando carta...</p>}
            {qrToken && qrAccessQuery.error && <p className="alert alert-error">{qrAccessQuery.error.message}</p>}

            <section className="qr-draft-card">
              <div className="section-head qr-panel-head qr-compact-head">
                <div>
                  <p className="qr-panel-kicker">Paso 2</p>
                  <h3 className="section-title qr-subtitle-tight">Tu combinacion</h3>
                </div>
                <span className="badge qr-total-badge">{formatMoney(draftSubtotal)}</span>
              </div>
              {selectedMain ? (
                <article className="qr-selected-showcase">
                  <div className="qr-selected-showcase-media">
                    {!imageFallbackById[selectedMain.id] && (
                      <img
                        alt={normalizeName(selectedMain.name)}
                        loading="lazy"
                        onError={() => markImageFallback(selectedMain.id)}
                        src={pickerImageUrl(selectedMain, selectedMainGroupId)}
                      />
                    )}
                    {imageFallbackById[selectedMain.id] && (
                      <div className="qr-dish-media-fallback">
                        <span>{normalizeName(selectedMain.name).slice(0, 1).toUpperCase() || 'P'}</span>
                      </div>
                    )}
                  </div>
                  <div className="qr-selected-showcase-copy">
                    <p className="qr-selected-showcase-kicker">
                      {GROUP_CONFIG[selectedMainGroupId]?.label || 'Plato principal'}
                    </p>
                    <h4 className="qr-selected-showcase-title">{normalizeName(selectedMain.name)}</h4>
                    <p className="qr-selected-showcase-price">{formatMoney(selectedMain.basePrice)}</p>
                  </div>
                </article>
              ) : (
                <p className="alert alert-info qr-alert-block">
                  Primero elige una categoria y selecciona el plato que quieres pedir.
                </p>
              )}

              <div className="qr-selection-grid">
                <article className="qr-choice-card">
                  <p className="qr-choice-card-label">Entrada</p>
                  <strong>{selectedEntry ? normalizeName(selectedEntry.name) : 'Sin elegir'}</strong>
                </article>
                <article className="qr-choice-card">
                  <p className="qr-choice-card-label">Extras</p>
                  <strong>{selectedEntryExtrasData.length} agregados</strong>
                </article>
                <article className="qr-choice-card">
                  <p className="qr-choice-card-label">Bebidas</p>
                  <strong>{selectedBeveragesData.length} seleccionadas</strong>
                </article>
              </div>

              {!canPickEntry && selectedMain && (
                <p className="small muted qr-hint-inline">Plato marino: sin entrada incluida, solo entradas extra.</p>
              )}

              <div className="qr-choice-actions">
                <button className="btn btn-soft" onClick={openEntriesCategory} type="button">
                  {selectedEntry ? 'Cambiar entrada' : 'Elegir entrada'}
                </button>
                <button className="btn btn-soft" onClick={openEntryExtrasPicker} type="button">
                  Entradas extra ({selectedEntryExtrasData.length})
                </button>
                <button className="btn btn-soft" onClick={openBeveragesPicker} type="button">
                  Bebidas ({selectedBeveragesData.length})
                </button>
              </div>

              {!!selectedEntry && (
                <div className="qr-suggest-row">
                  <span className="small muted">Si quieres seguir armando el pedido, combina con:</span>
                  <div className="inline-actions">
                    {recommendedGroupIds.map((groupId) => (
                      <button
                        className="btn btn-soft"
                        key={groupId}
                        onClick={() => selectGroup(groupId)}
                        type="button"
                      >
                        {GROUP_CONFIG[groupId]?.label || groupId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="qr-config-grid">
                <div>
                  <label className="form-label">Cantidad</label>
                  <div className="qr-stepper">
                    <button
                      className="qr-stepper-btn"
                      onClick={() => setQuantity((prev) => Math.max(1, Number(prev || 1) - 1))}
                      type="button"
                    >
                      -
                    </button>
                    <input
                      min={1}
                      onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                      type="number"
                      value={quantity}
                    />
                    <button
                      className="qr-stepper-btn"
                      onClick={() => setQuantity((prev) => Math.max(1, Number(prev || 1) + 1))}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="form-label">Servicio</label>
                  <div className="qr-toggle-row">
                    <button
                      className={`qr-toggle-chip ${serviceMode === 'DINE_IN' ? 'active' : ''}`}
                      onClick={() => setServiceMode('DINE_IN')}
                      type="button"
                    >
                      En mesa
                    </button>
                    <button
                      className={`qr-toggle-chip ${serviceMode === 'TAKEAWAY' ? 'active' : ''}`}
                      onClick={() => setServiceMode('TAKEAWAY')}
                      type="button"
                    >
                      Para llevar
                    </button>
                  </div>
                </div>

                <div>
                  <label className="form-label">Variante</label>
                  {selectedVariantOptions.length > 0 ? (
                    <select
                      onChange={(event) => setVariant(event.target.value)}
                      value={variant}
                    >
                      {selectedVariantOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      onChange={(event) => setVariant(event.target.value)}
                      placeholder="normal"
                      value={variant}
                    />
                  )}
                </div>
              </div>

              <div className="qr-note-block">
                <label className="form-label">Observaciones para cocina</label>
                <textarea
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ej: poco picante, sin cebolla"
                  rows={2}
                  value={notes}
                />
              </div>

              <div className="qr-total-row">
                <div>
                  <p className="qr-choice-card-label">Total estimado</p>
                  <strong className="qr-total-figure">{formatMoney(draftSubtotal)}</strong>
                </div>
                <p className="small muted qr-total-caption">Se enviara para aprobacion del mesero antes de cocina.</p>
              </div>

              <button
                className="btn btn-good qr-add-btn"
                disabled={!order || !productId || !qrToken || qrAccessQuery.isError || !sessionOpen || addQrItemsMutation.isPending}
                onClick={submitItem}
                type="button"
              >
                {addQrItemsMutation.isPending ? 'Agregando...' : 'Agregar al pedido QR'}
              </button>
            </section>
          </section>

          <section className="panel-soft qr-status-panel">
            <div className="section-head qr-panel-head qr-compact-head">
              <div>
                <p className="qr-panel-kicker">Seguimiento</p>
                <h2 className="section-title qr-subtitle-tight">Estado de tu pedido</h2>
              </div>
              {order && (
                <span className={`qr-status-chip tone-${statusTone(order.status)}`}>
                  {orderStatusLabel(order.status)}
                </span>
              )}
            </div>
            {!order && (
              <div className="qr-status-empty">
                <p className="qr-status-empty-title">Aun no hay pedido activo en esta mesa.</p>
                <p className="small muted">Inicia el pedido QR y luego agrega platos para que el mesero lo valide.</p>
                <button
                  className="btn btn-main qr-start-btn"
                  onClick={() => createQrMutation.mutate()}
                  type="button"
                  disabled={!qrToken || qrAccessQuery.isPending || qrAccessQuery.isError || !sessionOpen || createQrMutation.isPending || Boolean(order)}
                >
                  {createQrMutation.isPending ? 'Iniciando...' : 'Iniciar pedido QR'}
                </button>
              </div>
            )}
            {order && (
              <div className="page-stack qr-order-stack">
                <div className="qr-order-banner">
                  <div>
                    <p className="qr-choice-card-label">Estado actual</p>
                    <strong>{orderStatusLabel(order.status)}</strong>
                  </div>
                  <div>
                    <p className="qr-choice-card-label">Total parcial</p>
                    <strong>{formatMoney(order.totals.total)}</strong>
                  </div>
                </div>
                <div className="qr-order-list">
                  {(order.items || []).map((item) => (
                    <article className="card-mini" key={item.id}>
                      <p><strong>{normalizeName(item.productName)}</strong> x{item.quantity}</p>
                      <p className="small muted">{formatMoney(item.unitPrice)} por unidad</p>
                      {!!item.extras?.length && (
                        <p className="small muted">Extras: {item.extras.map((extra) => normalizeName(extra.name)).join(', ')}</p>
                      )}
                    </article>
                  ))}
                </div>
                <p className="alert alert-warn qr-alert-block">
                  Recuerda avisar al mesero para que apruebe el pedido y lo envie a cocina.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
      {activePicker && (
        <div className="qr-picker-overlay" onClick={closePicker}>
          <section className="qr-picker-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head qr-panel-head qr-compact-head">
              <div>
                <p className="qr-panel-kicker">Seleccion</p>
                <h3 className="section-title qr-subtitle-tight">{pickerTitle(activePicker)}</h3>
                <p className="section-subtitle">{pickerCaption(activePicker)}</p>
              </div>
              <button className="btn btn-soft" onClick={closePicker} type="button">Cerrar</button>
            </div>
            {pickerIsMainGroup && GROUP_CONFIG[activePicker]?.hint && (
              <p className="small muted qr-picker-hint">{GROUP_CONFIG[activePicker].hint}</p>
            )}
            {!pickerItems.length && (
              <p className="small muted qr-picker-hint">No hay opciones disponibles.</p>
            )}
            <div className="qr-picker-plate-list">
              {pickerItems.map((item, index) => {
                const selected = isPickerItemSelected(item.id)
                const focused = pickerFocusId === item.id
                const accent = focused || selected
                const hasFallback = Boolean(imageFallbackById[item.id])
                const imageSrc = pickerImageUrl(item, activePicker)
                const actionLabel = selected
                  ? (pickerIsSingleSelect ? 'Seleccionado' : 'Quitar')
                  : 'Anadir al pedido'

                return (
                  <article
                    className={`qr-picker-plate ${accent ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => onPickerItemClick(item)}
                  >
                    <div className="qr-picker-plate-media">
                      {!hasFallback && (
                        <img
                          alt={normalizeName(item.name)}
                          loading="lazy"
                          onError={() => markImageFallback(item.id)}
                          src={imageSrc}
                        />
                      )}
                      {hasFallback && (
                        <div className="qr-dish-media-fallback">
                          <span>{normalizeName(item.name).slice(0, 1).toUpperCase() || 'P'}</span>
                        </div>
                      )}
                    </div>
                    <div className="qr-picker-plate-copy">
                      <p className="qr-picker-plate-kicker">{pickerSectionLabel(activePicker)}</p>
                      <p className="qr-picker-plate-title">{normalizeName(item.name)}</p>
                      {focused && (
                        <button
                          className="btn btn-main qr-picker-plate-action"
                          disabled={selected && pickerIsSingleSelect}
                          onClick={(event) => {
                            event.stopPropagation()
                            onPickerAction(item)
                          }}
                          type="button"
                        >
                          {actionLabel}
                        </button>
                      )}
                      {!focused && selected && (
                        <span className="qr-picker-plate-tag">Agregado</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
            {pickerIsMultiSelect && (
              <div className="inline-actions" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                <button className="btn btn-main" onClick={closePicker} type="button">
                  Guardar y volver
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
