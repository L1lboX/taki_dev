import { CATALOG_CATEGORIES } from './catalog.js'
import { PRICE, ROLES } from './constants.js'

const todayIso = new Date().toISOString().slice(0, 10)

export const seedUsers = [
  { id: 'u1', username: 'superadmin', password: '123456', role: ROLES.SUPER_ADMIN, name: 'Super Admin', active: true },
  { id: 'u2', username: 'admin', password: '123456', role: ROLES.ADMIN, name: 'Administrador', active: true },
  { id: 'u3', username: 'cocinero', password: '123456', role: ROLES.COOK, name: 'Cocinero', active: true },
  { id: 'u4', username: 'mesero', password: '123456', role: ROLES.WAITER, name: 'Mesero', active: true },
  { id: 'u5', username: 'cajero', password: '123456', role: ROLES.CASHIER, name: 'Cajero', active: true },
  { id: 'u6', username: 'contador', password: '123456', role: ROLES.ACCOUNTANT, name: 'Contador', active: true },
]

export const seedSalons = [
  // Intencionalmente vacio: los salones se crean desde el modulo admin.
]

export const seedTables = [
  // Intencionalmente vacio: las mesas se crean desde el modulo admin.
]

export const seedCatalogItems = [
  {
    id: 'm1',
    name: 'Asado con pure',
    category: CATALOG_CATEGORIES.MENU,
    type: 'MENU',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: true,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?peruvian%20meal',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm2',
    name: 'Tallarines rojos',
    category: CATALOG_CATEGORIES.MENU,
    type: 'MENU',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: true,
    variants: ['normal', 'combinado con arroz con pollo'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?peruvian%20pasta',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm3',
    name: 'Arroz con pollo',
    category: CATALOG_CATEGORIES.MENU,
    type: 'MENU',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: true,
    variants: ['normal', 'combinado con tallarines rojos'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?arroz%20con%20pollo',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm4',
    name: 'Olluquito con carne',
    category: CATALOG_CATEGORIES.MENU,
    type: 'MENU',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: true,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?stew%20beef',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm5',
    name: 'Pollo a la plancha',
    category: CATALOG_CATEGORIES.PRINCIPALES,
    type: 'PRINCIPALES',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: false,
    variants: ['con papas fritas', 'con menestra'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?grilled%20chicken%20plate',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm6',
    name: 'Lomo saltado',
    category: CATALOG_CATEGORIES.A_LA_CARTA,
    type: 'A_LA_CARTA_MENU',
    basePrice: 12,
    isMenu: false,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?lomo%20saltado',
    active: true,
    days: [todayIso],
  },
  {
    id: 'm7',
    name: 'Arroz con mariscos',
    category: CATALOG_CATEGORIES.CEVICHES,
    type: 'MARINO_MENU',
    basePrice: PRICE.DEFAULT_MENU,
    isMenu: false,
    variants: ['normal', 'duo', 'trio'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?seafood%20rice',
    active: true,
    days: [todayIso],
  },
  {
    id: 'a1',
    name: 'Entrada extra: tortita con ceviche',
    category: CATALOG_CATEGORIES.ENTRADAS,
    type: 'ADDON',
    basePrice: PRICE.EXTRA_ENTRY,
    isMenu: false,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?peruvian%20appetizer',
    active: true,
    days: [todayIso],
  },
  {
    id: 'a2',
    name: 'Entrada extra: papa a la huancaina',
    category: CATALOG_CATEGORIES.ENTRADAS,
    type: 'ADDON',
    basePrice: PRICE.EXTRA_ENTRY,
    isMenu: false,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?papa%20a%20la%20huancaina',
    active: true,
    days: [todayIso],
  },
  {
    id: 'a3',
    name: 'Jarra de refresco',
    category: CATALOG_CATEGORIES.BEBIDAS,
    type: 'BEVERAGE',
    basePrice: 5,
    isMenu: false,
    variants: ['normal'],
    imageUrl: 'https://source.unsplash.com/featured/400x400/?juice%20pitcher',
    active: true,
    days: [todayIso],
  },
]

export const seedInventory = seedCatalogItems.map((item) => ({
  id: `inv-${item.id}`,
  productId: item.id,
  productName: item.name,
  stock: 30,
  lowStockThreshold: 8,
}))
