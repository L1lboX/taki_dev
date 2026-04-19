import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'

const RESTAURANT_FALLBACK_NAME = 'TAKI'
const QR_SERVICE_MODE = 'DINE_IN'
const FILTER_KEYS = ['TODO', 'MENU', 'PRINCIPALES', 'CARTA', 'CEVICHES']
const FILTER_LABELS = {
  TODO: 'Todo',
  MENU: 'Menu',
  PRINCIPALES: 'Principales',
  CARTA: 'Carta',
  CEVICHES: 'Ceviches',
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function matchesSome(value, needles) {
  const normalized = normalizeText(value)
  return needles.some((needle) => normalized.includes(normalizeText(needle)))
}

function buildGuestStorageKey(tableId) {
  return `taki_qr_guest_state:${tableId}`
}

function readGuestState(tableId) {
  if (!tableId) return { tableSessionId: null, activeGuestToken: '', guests: [] }
  try {
    const raw = localStorage.getItem(buildGuestStorageKey(tableId))
    if (!raw) return { tableSessionId: null, activeGuestToken: '', guests: [] }
    const parsed = JSON.parse(raw)
    return {
      tableSessionId: parsed?.tableSessionId || null,
      activeGuestToken: parsed?.activeGuestToken || '',
      guests: Array.isArray(parsed?.guests) ? parsed.guests : [],
    }
  } catch {
    return { tableSessionId: null, activeGuestToken: '', guests: [] }
  }
}

function persistGuestState(tableId, nextState) {
  if (!tableId) return
  localStorage.setItem(buildGuestStorageKey(tableId), JSON.stringify(nextState))
}

function clearGuestState(tableId) {
  if (!tableId) return
  localStorage.removeItem(buildGuestStorageKey(tableId))
}

function initialsForProduct(name) {
  const clean = String(name || '').trim()
  return clean ? clean.slice(0, 1).toUpperCase() : 'P'
}

function formatMoney(value) {
  return `S/. ${Number(value || 0).toFixed(2)}`
}

function productImage(product) {
  return product?.imageUrl || ''
}

function createEmptySelection(product = null) {
  return {
    product,
    variant: product?.variants?.[0] || 'normal',
    entryId: '',
    extraIds: [],
    beverageIds: [],
  }
}

function productCardGroup(product) {
  if (matchesSome(product?.category, ['MENU']) || matchesSome(product?.categoryName, ['menu'])) return 'MENU'
  if (matchesSome(product?.category, ['CEVICHES']) || matchesSome(product?.categoryName, ['ceviche', 'marino'])) return 'CEVICHES'
  if (matchesSome(product?.category, ['A_LA_CARTA']) || matchesSome(product?.categoryName, ['carta'])) return 'CARTA'
  return 'PRINCIPALES'
}

function buildMenuCollections(items) {
  const activeItems = (Array.isArray(items) ? items : []).filter((item) => item.active !== false)
  const extras = activeItems.filter((item) => item.type === 'ADDON')
  const beverages = activeItems.filter((item) => item.type === 'BEVERAGE')
  const mains = activeItems.filter((item) => item.type !== 'ADDON' && item.type !== 'BEVERAGE')

  const platoDelDia = mains.filter(
    (item) =>
      matchesSome(item.sectionName, ['plato del dia', 'especial']) ||
      matchesSome(item.categoryName, ['plato del dia', 'especial']),
  )

  const menuDelDia = mains.filter(
    (item) =>
      matchesSome(item.sectionName, ['menu del dia', 'menu']) ||
      matchesSome(item.categoryName, ['menu']) ||
      matchesSome(item.category, ['MENU']),
  )

  const byFilter = {
    TODO: mains,
    MENU: mains.filter((item) => productCardGroup(item) === 'MENU'),
    PRINCIPALES: mains.filter((item) => productCardGroup(item) === 'PRINCIPALES'),
    CARTA: mains.filter((item) => productCardGroup(item) === 'CARTA'),
    CEVICHES: mains.filter((item) => productCardGroup(item) === 'CEVICHES'),
  }

  const featured = platoDelDia[0] || menuDelDia[0] || mains[0] || null

  return {
    featured,
    menuDelDia,
    byFilter,
    extras,
    beverages,
    mains,
  }
}

function totalOfOrders(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0)
}

function itemCountOfOrders(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => sum + Number(order?.items?.length || 0), 0)
}

export default function QrOrderPage() {
  const { tableId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const qrToken = String(searchParams.get('token') || '').trim()

  const [guestState, setGuestState] = useState(() => readGuestState(tableId))
  const [activeFilter, setActiveFilter] = useState('TODO')
  const [selection, setSelection] = useState(createEmptySelection())
  const [isProductModalOpen, setProductModalOpen] = useState(false)
  const [isGuestChoiceOpen, setGuestChoiceOpen] = useState(false)

  const accessQuery = useQuery({
    queryKey: ['qr-access', tableId, qrToken],
    queryFn: () => api.resolveQrAccess(tableId, qrToken),
    enabled: Boolean(tableId && qrToken),
    retry: false,
  })

  const meQuery = useQuery({
    queryKey: ['qr-me', tableId, qrToken, guestState.activeGuestToken],
    queryFn: () => api.getQrMe(tableId, qrToken, guestState.activeGuestToken),
    enabled: Boolean(tableId && qrToken && guestState.activeGuestToken),
    retry: false,
  })

  useEffect(() => {
    setGuestState(readGuestState(tableId))
  }, [tableId])

  useEffect(() => {
    const sessionId = accessQuery.data?.tableSessionId || null
    if (!tableId) return

    if (!sessionId && guestState.guests.length) {
      clearGuestState(tableId)
      setGuestState({ tableSessionId: null, activeGuestToken: '', guests: [] })
      return
    }

    if (sessionId && guestState.tableSessionId && guestState.tableSessionId !== sessionId) {
      clearGuestState(tableId)
      setGuestState({ tableSessionId: null, activeGuestToken: '', guests: [] })
    }
  }, [accessQuery.data?.tableSessionId, guestState.guests.length, guestState.tableSessionId, tableId])

  useEffect(() => {
    if (!tableId || !guestState.activeGuestToken || meQuery.isFetching) return
    if (!meQuery.data?.guestSession) {
      const nextGuests = guestState.guests.filter((guest) => guest.guestToken !== guestState.activeGuestToken)
      const activeGuestToken = nextGuests[0]?.guestToken || ''
      const nextState = {
        tableSessionId: accessQuery.data?.tableSessionId || null,
        activeGuestToken,
        guests: nextGuests,
      }
      persistGuestState(tableId, nextState)
      setGuestState(nextState)
    }
  }, [accessQuery.data?.tableSessionId, guestState.activeGuestToken, guestState.guests, meQuery.data?.guestSession, meQuery.isFetching, tableId])

  const joinMutation = useMutation({
    mutationFn: ({ reuseGuestToken }) => api.joinQrTable(tableId, qrToken, reuseGuestToken),
    onSuccess: (result) => {
      const nextGuests = guestState.guests.filter((guest) => guest.guestToken !== result.guestSession.guestToken)
      nextGuests.push({
        guestToken: result.guestSession.guestToken,
        guestNumber: result.guestSession.guestNumber,
        guestSessionId: result.guestSession.id,
      })
      nextGuests.sort((a, b) => Number(a.guestNumber || 0) - Number(b.guestNumber || 0))

      const nextState = {
        tableSessionId: result.tableSession?.id || result.context?.tableSessionId || guestState.tableSessionId || null,
        activeGuestToken: result.guestSession.guestToken,
        guests: nextGuests,
      }
      persistGuestState(tableId, nextState)
      setGuestState(nextState)
      accessQuery.refetch()
    },
  })

  const createOrderMutation = useMutation({
    mutationFn: ({ guestToken }) => api.createQrOrder({ tableId }, qrToken, guestToken),
  })

  const addItemsMutation = useMutation({
    mutationFn: ({ orderId, payload, guestToken }) => api.addQrItems(orderId, payload, qrToken, guestToken),
    onSuccess: async () => {
      await Promise.all([meQuery.refetch(), accessQuery.refetch()])
    },
  })

  const collections = useMemo(
    () => buildMenuCollections(accessQuery.data?.menu?.items || []),
    [accessQuery.data?.menu?.items],
  )

  const currentGuest = meQuery.data?.guestSession || null
  const currentOrders = meQuery.data?.activeOrders || []
  const currentTotal = useMemo(() => totalOfOrders(currentOrders), [currentOrders])
  const currentItems = useMemo(() => itemCountOfOrders(currentOrders), [currentOrders])

  const restaurantName = accessQuery.data?.restaurant?.name || RESTAURANT_FALLBACK_NAME
  const tableNumber = accessQuery.data?.table?.number || accessQuery.data?.operationalTable?.number || '-'
  const occupiedGuests = Number(accessQuery.data?.occupiedGuests || 0)
  const effectiveCapacity = Number(accessQuery.data?.effectiveCapacity || 0)
  const hasAvailableSeats = Boolean(accessQuery.data?.hasAvailableSeats)

  const filteredProducts = collections.byFilter[activeFilter] || []

  function openProductModal(product) {
    setSelection(createEmptySelection(product))
    setProductModalOpen(true)
  }

  function closeProductModal() {
    setProductModalOpen(false)
    setSelection(createEmptySelection())
    setGuestChoiceOpen(false)
  }

  async function ensureGuest(mode = 'current') {
    if (!tableId || !qrToken) {
      throw new Error('QR invalido: falta token de seguridad.')
    }

    if (mode === 'current' && currentGuest && guestState.activeGuestToken) {
      return {
        guestToken: guestState.activeGuestToken,
        guestSession: currentGuest,
      }
    }

    const result = await joinMutation.mutateAsync({
      reuseGuestToken: mode === 'current' ? guestState.activeGuestToken : '',
    })

    return {
      guestToken: result.guestSession.guestToken,
      guestSession: result.guestSession,
    }
  }

  function buildDraftPayload(product) {
    const extras = []
    if (selection.entryId) extras.push({ productId: selection.entryId, quantity: 1 })
    for (const extraId of selection.extraIds) extras.push({ productId: extraId, quantity: 1 })
    for (const beverageId of selection.beverageIds) extras.push({ productId: beverageId, quantity: 1 })

    return {
      items: [
        {
          productId: product.id,
          quantity: 1,
          variant: selection.variant || product?.variants?.[0] || 'normal',
          serviceMode: QR_SERVICE_MODE,
          extras,
        },
      ],
    }
  }

  async function submitSelection(mode = 'current') {
    const product = selection.product
    if (!product) return

    const guest = await ensureGuest(mode)
    const order = await createOrderMutation.mutateAsync({ guestToken: guest.guestToken })
    await addItemsMutation.mutateAsync({
      orderId: order.id,
      payload: buildDraftPayload(product),
      guestToken: guest.guestToken,
    })

    toast.success(
      mode === 'new'
        ? `Se agrego ${product.name} para la Persona ${guest.guestSession?.guestNumber || '?'}`
        : `${product.name} se anadio a tu pedido`,
    )
    closeProductModal()
  }

  async function handleAddToCart() {
    try {
      if (currentGuest && currentOrders.length > 0 && hasAvailableSeats) {
        setGuestChoiceOpen(true)
        return
      }
      await submitSelection('current')
    } catch (error) {
      toast.error(error.message || 'No se pudo agregar el plato al pedido')
    }
  }

  const isLoading = accessQuery.isLoading
  const accessError = accessQuery.error?.message || (!qrToken ? 'QR invalido: falta token de seguridad.' : '')

  return (
    <div className="qr-customer-page qr-customer-v2">
      <div className="qr-v2-shell">
        <header className="qr-v2-topbar">
          <div>
            <span className="qr-v2-brand-kicker">Carta QR</span>
            <h1 className="qr-v2-brand">{restaurantName}</h1>
          </div>
          <Chip
            label={`Mesa ${tableNumber}`}
            size="small"
            sx={{
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: '#fff7ef',
              fontWeight: 700,
            }}
          />
        </header>

        {isLoading && <div className="alert alert-info">Cargando carta QR...</div>}
        {!!accessError && !isLoading && <div className="alert alert-error">{accessError}</div>}

        {!isLoading && !accessError && (
          <>
            <section className="qr-v2-hero">
              <div className="qr-v2-hero-copy">
                <span className="qr-v2-kicker">Sabor casero, cada plato</span>
                <h2 className="qr-v2-hero-title">{collections.featured?.name || 'Carta del restaurante'}</h2>
                <div className="qr-v2-hero-meta">
                  <span>{collections.featured?.sectionName || 'Plato del dia'}</span>
                  <strong>{formatMoney(collections.featured?.basePrice || 0)}</strong>
                </div>
                <Button
                  className="qr-v2-order-btn"
                  onClick={() => collections.featured && openProductModal(collections.featured)}
                  variant="contained"
                >
                  Ordenar ahora
                </Button>
              </div>

              <div className="qr-v2-hero-media">
                {productImage(collections.featured) ? (
                  <img alt={collections.featured?.name || 'Plato destacado'} src={productImage(collections.featured)} />
                ) : (
                  <div className="qr-v2-hero-fallback">{initialsForProduct(collections.featured?.name)}</div>
                )}
              </div>
            </section>

            <section className="qr-v2-content">
              <div className="qr-v2-statusbar">
                <Chip label={`Ocupacion ${occupiedGuests}/${effectiveCapacity || '-'}`} size="small" />
                {currentGuest ? <Chip label={`Persona ${currentGuest.guestNumber}`} size="small" color="success" /> : <Chip label="Sin persona activa" size="small" />}
                <Chip label={`Items ${currentItems}`} size="small" />
                <Chip label={`Parcial ${formatMoney(currentTotal)}`} size="small" />
              </div>

              <section className="qr-v2-section">
                <div className="qr-v2-section-head">
                  <div>
                    <h3>Menu del dia</h3>
                    <p>Los platos que mas salen hoy y conviene pedir rapido.</p>
                  </div>
                </div>

                <div className="qr-v2-menu-strip">
                  {(collections.menuDelDia.length ? collections.menuDelDia : collections.mains.slice(0, 5)).map((product, index) => (
                    <button
                      className="qr-v2-menu-card"
                      key={product.id}
                      onClick={() => openProductModal(product)}
                      style={{ '--delay': `${index * 40}ms` }}
                      type="button"
                    >
                      <span className={`qr-v2-badge ${index === 0 ? 'special' : 'popular'}`}>{index === 0 ? 'Especial' : 'Popular'}</span>
                      <div className="qr-v2-menu-card-copy">
                        <strong>{product.name}</strong>
                        <span>{product.categoryName || product.sectionName || 'Carta'}</span>
                        <em>Ordenar</em>
                      </div>
                      <div className="qr-v2-thumb">
                        {productImage(product) ? (
                          <img alt={product.name} src={productImage(product)} />
                        ) : (
                          <span>{initialsForProduct(product.name)}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="qr-v2-section">
                <div className="qr-v2-section-head">
                  <div>
                    <h3>Carta completa</h3>
                    <p>Menu, principales, carta y ceviches segun lo que quieras comer hoy.</p>
                  </div>
                </div>

                <div className="qr-v2-filter-row">
                  {FILTER_KEYS.map((filterKey) => (
                    <button
                      className={`qr-v2-filter-pill ${activeFilter === filterKey ? 'active' : ''}`}
                      key={filterKey}
                      onClick={() => setActiveFilter(filterKey)}
                      type="button"
                    >
                      {FILTER_LABELS[filterKey]}
                    </button>
                  ))}
                </div>

                <div className="qr-v2-product-grid">
                  {filteredProducts.map((product) => (
                    <article className="qr-v2-product-card" key={product.id}>
                      <button className="qr-v2-product-media" onClick={() => openProductModal(product)} type="button">
                        {productImage(product) ? (
                          <img alt={product.name} src={productImage(product)} />
                        ) : (
                          <div className="qr-v2-product-fallback">{initialsForProduct(product.name)}</div>
                        )}
                      </button>

                      <div className="qr-v2-product-copy">
                        <span className="qr-v2-product-tag">{product.categoryName || product.sectionName || 'Carta'}</span>
                        <strong>{product.name}</strong>
                        <p>{formatMoney(product.basePrice)}</p>
                      </div>

                      <Button className="qr-v2-product-action" onClick={() => openProductModal(product)} variant="text">
                        Ordenar
                      </Button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="qr-v2-section qr-v2-person-section">
                <div className="qr-v2-section-head">
                  <div>
                    <h3>Tu pedido</h3>
                    <p>Tu celular conserva tu persona actual. Si quieres pedir para otro, tambien puedes abrir otra persona.</p>
                  </div>
                </div>

                {!!guestState.guests.length && (
                  <div className="qr-v2-person-switcher">
                    {guestState.guests.map((guest) => (
                      <button
                        className={`qr-v2-person-chip ${guest.guestToken === guestState.activeGuestToken ? 'active' : ''}`}
                        key={guest.guestToken}
                        onClick={() => {
                          const nextState = {
                            ...guestState,
                            activeGuestToken: guest.guestToken,
                          }
                          persistGuestState(tableId, nextState)
                          setGuestState(nextState)
                        }}
                        type="button"
                      >
                        Persona {guest.guestNumber}
                      </button>
                    ))}
                  </div>
                )}

                {!currentOrders.length && (
                  <div className="qr-v2-empty-state">
                    <p>Todavia no hay platos en tu persona activa. Elige un plato y lo enviamos para aprobacion del mozo.</p>
                  </div>
                )}

                {!!currentOrders.length && (
                  <div className="qr-v2-order-list">
                    {currentOrders.map((order) => (
                      <article className="qr-v2-order-card" key={order.id}>
                        <div className="qr-v2-order-head">
                          <div>
                            <strong>Pedido {order.id.slice(0, 8)}</strong>
                            <span>{order.status === 'PENDING_WAITER_APPROVAL' ? 'Esperando aprobacion del mozo' : 'Listo para seguir agregando platos'}</span>
                          </div>
                          <Chip label={formatMoney(order.totals?.total || 0)} size="small" />
                        </div>

                        <div className="qr-v2-order-lines">
                          {(order.items || []).map((item) => (
                            <div className="qr-v2-order-line" key={item.id}>
                              <div>
                                <strong>{item.productName}</strong>
                                <span>{item.variant || 'normal'}</span>
                              </div>
                              <em>{formatMoney(item.unitPrice)}</em>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </section>
          </>
        )}

        <Dialog
          fullWidth
          maxWidth="sm"
          onClose={closeProductModal}
          open={isProductModalOpen}
          PaperProps={{
            sx: {
              borderRadius: '18px',
              background: '#fff9f2',
            },
          }}
        >
          <DialogTitle sx={{ pb: 1 }}>
            <Stack direction="row" justifyContent="space-between" spacing={2}>
              <div>
                <Typography sx={{ fontSize: 24, fontWeight: 800 }}>
                  {selection.product?.name || 'Selecciona tu plato'}
                </Typography>
                <Typography sx={{ color: '#77574b', fontSize: 14 }}>
                  Acompana tu plato con una entrada, bebida o extra antes de enviarlo.
                </Typography>
              </div>
              <Chip label={formatMoney(selection.product?.basePrice || 0)} sx={{ fontWeight: 800 }} />
            </Stack>
          </DialogTitle>

          <DialogContent sx={{ pb: 3 }}>
            <Stack spacing={2.5}>
              <div className="qr-v2-modal-hero">
                <div className="qr-v2-modal-thumb">
                  {productImage(selection.product) ? (
                    <img alt={selection.product?.name || 'Plato'} src={productImage(selection.product)} />
                  ) : (
                    <Avatar sx={{ bgcolor: '#97232f', width: 64, height: 64 }}>{initialsForProduct(selection.product?.name)}</Avatar>
                  )}
                </div>

                <div>
                  <Typography sx={{ fontSize: 15, color: '#77574b' }}>{selection.product?.categoryName || selection.product?.sectionName || 'Carta'}</Typography>
                  {selection.product?.variants?.length > 0 && (
                    <TextField
                      fullWidth
                      label="Variante"
                      onChange={(event) => setSelection((prev) => ({ ...prev, variant: event.target.value }))}
                      select
                      size="small"
                      sx={{ mt: 1.5 }}
                      value={selection.variant}
                    >
                      {selection.product.variants.map((variant) => (
                        <MenuItem key={variant} value={variant}>
                          {variant}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </div>
              </div>

              <Divider />

              <div>
                <Typography sx={{ fontSize: 16, fontWeight: 800, mb: 1 }}>Acompana tu plato con una entrada</Typography>
                <div className="qr-v2-option-cloud">
                  <button
                    className={`qr-v2-option-pill ${selection.entryId === '' ? 'active' : ''}`}
                    onClick={() => setSelection((prev) => ({ ...prev, entryId: '' }))}
                    type="button"
                  >
                    Sin entrada
                  </button>
                  {collections.extras.map((entry) => (
                    <button
                      className={`qr-v2-option-pill ${selection.entryId === entry.id ? 'active' : ''}`}
                      key={entry.id}
                      onClick={() => setSelection((prev) => ({ ...prev, entryId: prev.entryId === entry.id ? '' : entry.id }))}
                      type="button"
                    >
                      {entry.name} · {formatMoney(entry.basePrice)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Typography sx={{ fontSize: 16, fontWeight: 800, mb: 1 }}>Extras y bebidas</Typography>
                <div className="qr-v2-option-cloud">
                  {collections.extras.map((extra) => (
                    <button
                      className={`qr-v2-option-pill ${selection.extraIds.includes(extra.id) ? 'active' : ''}`}
                      key={`extra-${extra.id}`}
                      onClick={() =>
                        setSelection((prev) => ({
                          ...prev,
                          extraIds: prev.extraIds.includes(extra.id)
                            ? prev.extraIds.filter((id) => id !== extra.id)
                            : [...prev.extraIds, extra.id],
                        }))
                      }
                      type="button"
                    >
                      {extra.name} · {formatMoney(extra.basePrice)}
                    </button>
                  ))}
                  {collections.beverages.map((beverage) => (
                    <button
                      className={`qr-v2-option-pill ${selection.beverageIds.includes(beverage.id) ? 'active' : ''}`}
                      key={`beverage-${beverage.id}`}
                      onClick={() =>
                        setSelection((prev) => ({
                          ...prev,
                          beverageIds: prev.beverageIds.includes(beverage.id)
                            ? prev.beverageIds.filter((id) => id !== beverage.id)
                            : [...prev.beverageIds, beverage.id],
                        }))
                      }
                      type="button"
                    >
                      {beverage.name} · {formatMoney(beverage.basePrice)}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                disabled={joinMutation.isPending || createOrderMutation.isPending || addItemsMutation.isPending}
                onClick={handleAddToCart}
                sx={{
                  borderRadius: '14px',
                  bgcolor: '#f4b400',
                  color: '#24150f',
                  fontWeight: 900,
                  py: 1.35,
                  '&:hover': {
                    bgcolor: '#e0a100',
                  },
                }}
                variant="contained"
              >
                {currentGuest ? 'Agregar al carrito' : 'Entrar y ordenar'}
              </Button>
            </Stack>
          </DialogContent>
        </Dialog>

        <Dialog
          fullWidth
          maxWidth="xs"
          onClose={() => setGuestChoiceOpen(false)}
          open={isGuestChoiceOpen}
          PaperProps={{
            sx: {
              borderRadius: '18px',
            },
          }}
        >
          <DialogTitle sx={{ fontWeight: 800 }}>Este plato es para quien?</DialogTitle>
          <DialogContent sx={{ pb: 3 }}>
            <Stack spacing={1.25}>
              <Typography sx={{ color: '#77574b', fontSize: 14 }}>
                Si ya tienes pedido en curso, podemos sumarlo a tu persona actual o abrir una nueva persona dentro de la mesa.
              </Typography>

              <Button
                onClick={async () => {
                  setGuestChoiceOpen(false)
                  try {
                    await submitSelection('current')
                  } catch (error) {
                    toast.error(error.message || 'No se pudo agregar el plato')
                  }
                }}
                sx={{ borderRadius: '14px', fontWeight: 800 }}
                variant="contained"
              >
                Anadir a mi pedido
              </Button>

              <Button
                disabled={!hasAvailableSeats && !guestState.guests.length}
                onClick={async () => {
                  setGuestChoiceOpen(false)
                  try {
                    await submitSelection('new')
                  } catch (error) {
                    toast.error(error.message || 'No se pudo abrir otra persona')
                  }
                }}
                sx={{ borderRadius: '14px', fontWeight: 800 }}
                variant="outlined"
              >
                Es para otra persona
              </Button>
            </Stack>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
