export const CATALOG_CATEGORIES = {
  ENTRADAS: 'ENTRADAS',
  MENU: 'MENU',
  PRINCIPALES: 'PRINCIPALES',
  A_LA_CARTA: 'A_LA_CARTA',
  CEVICHES: 'CEVICHES',
  BEBIDAS: 'BEBIDAS',
}

export const DEFAULT_CATEGORY_OPTIONS = [
  { id: CATALOG_CATEGORIES.ENTRADAS, name: 'Entradas', sortOrder: 1, active: true },
  { id: CATALOG_CATEGORIES.MENU, name: 'Menu', sortOrder: 2, active: true },
  { id: CATALOG_CATEGORIES.PRINCIPALES, name: 'Platos Principales', sortOrder: 3, active: true },
  { id: CATALOG_CATEGORIES.A_LA_CARTA, name: 'A la carta', sortOrder: 4, active: true },
  { id: CATALOG_CATEGORIES.CEVICHES, name: 'Ceviches y marinos', sortOrder: 5, active: true },
  { id: CATALOG_CATEGORIES.BEBIDAS, name: 'Bebidas', sortOrder: 6, active: true },
]

export function buildCategoryOptions(categories = []) {
  const byId = new Map(DEFAULT_CATEGORY_OPTIONS.map((item) => [item.id, item]))

  for (const category of categories) {
    if (!category?.id) continue
    byId.set(category.id, {
      id: category.id,
      name: category.name || category.id,
      sortOrder: category.sortOrder,
      active: category.active !== false,
    })
  }

  return Array.from(byId.values()).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99) || a.name.localeCompare(b.name))
}

export function categoryLabel(category, categories = []) {
  return buildCategoryOptions(categories).find((item) => item.id === category)?.name || category || '-'
}
