export const CATALOG_CATEGORIES = {
  ENTRADAS: 'ENTRADAS',
  MENU: 'MENU',
  PRINCIPALES: 'PRINCIPALES',
  A_LA_CARTA: 'A_LA_CARTA',
  CEVICHES: 'CEVICHES',
  BEBIDAS: 'BEBIDAS',
}

export const VALID_CATALOG_CATEGORIES = new Set(Object.values(CATALOG_CATEGORIES))

export const DEFAULT_CATALOG_CATEGORY_ROWS = [
  { id: CATALOG_CATEGORIES.ENTRADAS, name: 'Entradas', sortOrder: 1, active: true },
  { id: CATALOG_CATEGORIES.MENU, name: 'Menu', sortOrder: 2, active: true },
  { id: CATALOG_CATEGORIES.PRINCIPALES, name: 'Platos Principales', sortOrder: 3, active: true },
  { id: CATALOG_CATEGORIES.A_LA_CARTA, name: 'A la carta', sortOrder: 4, active: true },
  { id: CATALOG_CATEGORIES.CEVICHES, name: 'Ceviches y marinos', sortOrder: 5, active: true },
  { id: CATALOG_CATEGORIES.BEBIDAS, name: 'Bebidas', sortOrder: 6, active: true },
]

function normalizeName(value, fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function slugifyCategoryId(value, fallback = 'CATEGORIA') {
  const text = normalizeName(value, fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return text || fallback
}

export function formatCategoryName(categoryId) {
  const text = normalizeName(categoryId)
  if (!text) return 'Categoria'

  return text
    .split('_')
    .map((part) => (part ? `${part.slice(0, 1)}${part.slice(1).toLowerCase()}` : ''))
    .join(' ')
    .trim()
}

function isCevicheName(name) {
  return /ceviche|marino|marisco|duo|trio/.test(name)
}

function isCartaName(name) {
  return /lomo|pobre|chuleta|bistec|parrilla/.test(name)
}

export function inferCatalogCategory(rawItem) {
  const type = String(rawItem?.type || '').toUpperCase()
  const name = normalizeName(rawItem?.name).toLowerCase()
  const candidate = String(rawItem?.category || '').toUpperCase()

  if (candidate) return slugifyCategoryId(candidate)
  if (type === 'ADDON') return CATALOG_CATEGORIES.ENTRADAS
  if (type === 'BEVERAGE') return CATALOG_CATEGORIES.BEBIDAS
  if (type === 'MENU') return CATALOG_CATEGORIES.MENU
  if (type === 'MARINO_MENU' || isCevicheName(name)) return CATALOG_CATEGORIES.CEVICHES
  if (type === 'A_LA_CARTA_MENU' && isCartaName(name)) return CATALOG_CATEGORIES.A_LA_CARTA
  if (type === 'A_LA_CARTA_MENU') return CATALOG_CATEGORIES.PRINCIPALES
  return CATALOG_CATEGORIES.PRINCIPALES
}

export function deriveCatalogFlags(category) {
  if (category === CATALOG_CATEGORIES.ENTRADAS) {
    return { type: 'ADDON', isMenu: false }
  }

  if (category === CATALOG_CATEGORIES.BEBIDAS) {
    return { type: 'BEVERAGE', isMenu: false }
  }

  if (category === CATALOG_CATEGORIES.MENU) {
    return { type: 'MENU', isMenu: true }
  }

  if (category === CATALOG_CATEGORIES.CEVICHES) {
    return { type: 'MARINO_MENU', isMenu: false }
  }

  if (category === CATALOG_CATEGORIES.A_LA_CARTA) {
    return { type: 'A_LA_CARTA_MENU', isMenu: false }
  }

  return { type: 'PRINCIPALES', isMenu: false }
}

export function normalizeVariants(rawVariants) {
  const source = Array.isArray(rawVariants) ? rawVariants : String(rawVariants || '').split(',')
  const values = source
    .map((item) => normalizeName(item))
    .filter(Boolean)

  if (values.length > 0) return values
  return ['normal']
}

export function normalizeCatalogCategory(rawCategory, fallbackIndex = 0) {
  const id = slugifyCategoryId(rawCategory?.id || rawCategory?.value || rawCategory, `CATEGORIA_${fallbackIndex + 1}`)
  const parsedSortOrder = Number(rawCategory?.sortOrder)

  return {
    id,
    name: normalizeName(rawCategory?.name || rawCategory?.label, formatCategoryName(id)),
    active: rawCategory?.active !== false,
    sortOrder: Number.isFinite(parsedSortOrder) ? Math.trunc(parsedSortOrder) : fallbackIndex + 1,
  }
}

export function normalizeCatalogCategories(rawCategories = [], rawCatalog = []) {
  const byId = new Map()

  for (const [index, category] of DEFAULT_CATALOG_CATEGORY_ROWS.entries()) {
    const normalized = normalizeCatalogCategory(category, index)
    byId.set(normalized.id, normalized)
  }

  for (const [index, category] of (Array.isArray(rawCategories) ? rawCategories : []).entries()) {
    const normalized = normalizeCatalogCategory(category, index + byId.size)
    const existing = byId.get(normalized.id)
    byId.set(normalized.id, existing ? { ...existing, ...normalized } : normalized)
  }

  for (const item of Array.isArray(rawCatalog) ? rawCatalog : []) {
    const id = inferCatalogCategory(item)
    if (byId.has(id)) continue
    byId.set(id, normalizeCatalogCategory({
      id,
      name: item?.categoryName || formatCategoryName(id),
      active: true,
      sortOrder: byId.size + 1,
    }, byId.size))
  }

  return Array.from(byId.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export function normalizeCatalogItem(rawItem, fallbackIndex = 0) {
  const category = inferCatalogCategory(rawItem)
  const flags = deriveCatalogFlags(category)
  const parsedPrice = Number(rawItem?.basePrice)
  const days = Array.isArray(rawItem?.days)
    ? rawItem.days.map((item) => normalizeName(item)).filter(Boolean)
    : []

  return {
    id: normalizeName(rawItem?.id, `prod-${fallbackIndex + 1}`),
    name: normalizeName(rawItem?.name, `Producto ${fallbackIndex + 1}`),
    category,
    type: normalizeName(rawItem?.type, flags.type),
    basePrice: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? Number(parsedPrice.toFixed(2)) : 0,
    isMenu: rawItem?.isMenu != null ? Boolean(rawItem.isMenu) : flags.isMenu,
    variants: normalizeVariants(rawItem?.variants),
    imageUrl: normalizeName(rawItem?.imageUrl),
    active: rawItem?.active !== false,
    days,
  }
}

export function isCatalogAvailableOnDate(item, selectedDate) {
  if (item.active === false) return false
  if (!selectedDate) return true
  if (!Array.isArray(item.days) || item.days.length === 0) return true
  return item.days.includes(selectedDate)
}

export function sortCatalogItems(items, categories = []) {
  const sortOrderByCategory = new Map(categories.map((category, index) => [category.id, category.sortOrder ?? index + 1]))
  return [...items].sort((a, b) => {
    const leftOrder = sortOrderByCategory.get(a.category) || 99
    const rightOrder = sortOrderByCategory.get(b.category) || 99
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.name.localeCompare(b.name)
  })
}

export function resolveCatalogCategory(categoryId, categories = []) {
  return categories.find((category) => category.id === categoryId) || null
}

export function categoryDisplayName(categoryId, categories = []) {
  return resolveCatalogCategory(categoryId, categories)?.name || formatCategoryName(categoryId)
}

export function syncInventoryRows(rawInventory = [], catalog = []) {
  const byProductId = new Map()

  for (const row of Array.isArray(rawInventory) ? rawInventory : []) {
    const productId = normalizeName(row?.productId)
    if (!productId) continue
    byProductId.set(productId, {
      id: normalizeName(row?.id, `inv-${productId}`),
      productId,
      productName: normalizeName(row?.productName, productId),
      stock: Math.max(0, Number(row?.stock) || 0),
      lowStockThreshold: Math.max(0, Number(row?.lowStockThreshold) || 8),
    })
  }

  for (const item of catalog) {
    const existing = byProductId.get(item.id)
    if (existing) {
      existing.productName = item.name
      continue
    }

    byProductId.set(item.id, {
      id: `inv-${item.id}`,
      productId: item.id,
      productName: item.name,
      stock: 30,
      lowStockThreshold: 8,
    })
  }

  return Array.from(byProductId.values()).sort((a, b) => a.productName.localeCompare(b.productName))
}
