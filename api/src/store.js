import { randomUUID } from 'node:crypto'
import {
  BILL_STATUS,
  CASH_STATUS,
  KITCHEN_STATUS_TO_ORDER_STATUS,
  KITCHEN_TICKET_STATUS,
  ORDER_SOURCE,
  FINANCE_ACCOUNT_TYPE,
  FINANCE_TRANSACTION_TYPE,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PRICE,
  QR_STATUS,
  ROLES,
  SERVICE_MODE,
  SPLIT_MODE,
  TABLE_STATUS,
} from './constants.js'
import {
  categoryDisplayName,
  deriveCatalogFlags,
  isCatalogAvailableOnDate,
  normalizeCatalogCategories,
  normalizeCatalogCategory,
  normalizeCatalogItem,
  resolveCatalogCategory,
  sortCatalogItems,
  syncInventoryRows,
} from './catalog.js'
import { seedCatalogItems, seedInventory, seedSalons, seedTables, seedUsers } from './seed.js'
import {
  closeStatePersistence,
  getDataBackend,
  initStatePersistence,
  isStatePersistenceEnabled,
  loadStateSnapshot,
  saveStateSnapshot,
} from './statePersistence.js'

const clone = (value) => structuredClone(value)
const nowIso = () => new Date().toISOString()
const dateOnly = (iso = nowIso()) => iso.slice(0, 10)

const DEFAULT_KPI_TIMEZONE = 'America/Lima'
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MONTH_KEY_REGEX = /^\d{4}-\d{2}$/

function isValidTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function resolveKpiTimeZone(requestedTimeZone) {
  const candidate = String(
    requestedTimeZone || state?.restaurant?.timezone || DEFAULT_KPI_TIMEZONE,
  ).trim()

  if (candidate && isValidTimeZone(candidate)) {
    return candidate
  }

  return DEFAULT_KPI_TIMEZONE
}

function parseDateLike(value) {
  if (value == null) return new Date()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function getDatePartsInTimeZone(value, timeZone) {
  const date = parseDateLike(value)
  if (!date) return null

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) return null

  return {
    year,
    month,
    day,
    dateKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
  }
}

function normalizeDateKeyInput(inputDateKey, timeZone) {
  if (DATE_KEY_REGEX.test(String(inputDateKey || '').trim())) {
    return String(inputDateKey).trim()
  }

  return getDatePartsInTimeZone(nowIso(), timeZone)?.dateKey || dateOnly()
}

function normalizeMonthKeyInput(inputMonthKey, timeZone) {
  if (MONTH_KEY_REGEX.test(String(inputMonthKey || '').trim())) {
    return String(inputMonthKey).trim()
  }

  return getDatePartsInTimeZone(nowIso(), timeZone)?.monthKey || dateOnly().slice(0, 7)
}

function shiftDateKey(dateKey, deltaDays) {
  if (!DATE_KEY_REGEX.test(String(dateKey || '').trim())) return dateOnly()
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  utcDate.setUTCDate(utcDate.getUTCDate() + Number(deltaDays || 0))
  return utcDate.toISOString().slice(0, 10)
}

function buildMonthRange(monthKey) {
  if (!MONTH_KEY_REGEX.test(String(monthKey || '').trim())) {
    const fallbackMonth = dateOnly().slice(0, 7)
    return buildMonthRange(fallbackMonth)
  }

  const [year, month] = String(monthKey).split('-').map(Number)
  const from = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  const lastDayDate = new Date(Date.UTC(year, month, 0))
  const to = lastDayDate.toISOString().slice(0, 10)
  return { from, to }
}

function buildWeekRange(targetDateKey, timeZone = DEFAULT_KPI_TIMEZONE) {
  const safeDateKey = normalizeDateKeyInput(targetDateKey, timeZone)
  const [year, month, day] = safeDateKey.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  const mondayOffset = (utcDate.getUTCDay() + 6) % 7
  const monday = new Date(utcDate)
  monday.setUTCDate(monday.getUTCDate() - mondayOffset)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  }
}

function resolveOrderCategoryName(productId) {
  const fromCatalog = state.catalog.find((item) => item.id === productId)
  if (fromCatalog) {
    return fromCatalog.categoryName || categoryDisplayName(fromCatalog.category, state.catalogCategories) || '-'
  }

  const fromMenu = state.menuProducts.find((item) => item.id === productId)
  if (fromMenu) {
    const category = state.menuCategories.find((item) => item.id === fromMenu.categoryId)
    return category?.name || '-'
  }

  return '-'
}

function cleanKitchenName(name) {
  return String(name || '').replace(/^Entrada extra:\s*/i, '').trim()
}

function parseKitchenNotes(rawNotes) {
  const text = String(rawNotes || '')
  const parts = text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

  let includedEntry = ''
  let detail = ''
  const extraDetails = []

  for (const part of parts) {
    if (/^Entrada incluida:/i.test(part)) {
      includedEntry = part.replace(/^Entrada incluida:\s*/i, '').trim()
      continue
    }

    if (/^Detalle:/i.test(part)) {
      detail = part.replace(/^Detalle:\s*/i, '').trim()
      continue
    }

    extraDetails.push(part)
  }

  return { includedEntry, detail, extraDetails }
}

function buildServingLines(item, includedEntry) {
  const grouped = new Map()
  const addLine = (name, quantity) => {
    const cleanName = cleanKitchenName(name)
    if (!cleanName) return
    const qty = Number(quantity) || 0
    if (qty <= 0) return
    grouped.set(cleanName, (grouped.get(cleanName) || 0) + qty)
  }

  addLine(includedEntry, 1)
  for (const extra of item.extras || []) {
    addLine(extra.name, extra.quantity)
  }

  return Array.from(grouped.entries()).map(([name, quantity]) => ({ name, quantity }))
}

function normalizeCatalogRows(rawCatalog = [], categories = []) {
  return sortCatalogItems(
    asArray(rawCatalog).map((item, index) => {
      const normalized = normalizeCatalogItem(item, index)
      return {
        ...normalized,
        categoryName: categoryDisplayName(normalized.category, categories),
      }
    }),
    categories,
  )
}

function nextCatalogCategorySortOrder() {
  return state.catalogCategories.reduce((max, category) => Math.max(max, Number(category.sortOrder) || 0), 0) + 1
}

function syncCatalogState() {
  state.catalogCategories = normalizeCatalogCategories(state.catalogCategories, state.catalog)
  state.catalog = normalizeCatalogRows(state.catalog, state.catalogCategories)
  state.inventory = syncInventoryRows(state.inventory, state.catalog)
}

function ensureUniqueCatalogName(name, excludedId = null) {
  const needle = String(name || '').trim().toLowerCase()
  if (!needle) return

  const duplicated = state.catalog.find((item) => item.id !== excludedId && String(item.name || '').trim().toLowerCase() === needle)
  if (duplicated) {
    throw new Error('Ya existe un plato con ese nombre')
  }
}

function ensureUniqueCatalogCategoryName(name, excludedId = null) {
  const needle = String(name || '').trim().toLowerCase()
  if (!needle) return

  const duplicated = state.catalogCategories.find(
    (category) => category.id !== excludedId && String(category.name || '').trim().toLowerCase() === needle,
  )
  if (duplicated) {
    throw new Error('Ya existe una categoria con ese nombre')
  }
}

function createInitialState() {
  const catalogCategories = normalizeCatalogCategories([], seedCatalogItems)
  const catalog = normalizeCatalogRows(seedCatalogItems, catalogCategories)
  const inventory = syncInventoryRows(seedInventory, catalog)

  return {
    users: clone(seedUsers),
    sessionsByToken: new Map(),
    salons: clone(seedSalons),
    catalogCategories: clone(catalogCategories),
    catalog: clone(catalog),
    inventory: clone(inventory),
    tables: clone(seedTables),
    tableSessions: [],
    orders: [],
    kitchenTickets: [],
    cashSessions: [],
    payments: [],
    receipts: [],
    printerJobs: [],
    incidents: [],
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeSalons(rawSalons = []) {
  const mapped = asArray(rawSalons)
    .map((salon, index) => ({
      id: String(salon?.id || `s${index + 1}`),
      name: String(salon?.name || `Salon ${index + 1}`).trim() || `Salon ${index + 1}`,
      sortOrder: Number.isInteger(salon?.sortOrder) ? salon.sortOrder : index + 1,
      active: salon?.active !== false,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  if (mapped.length > 0) return mapped

  return clone(seedSalons)
}

function normalizeTables(rawTables = [], salons = []) {
  const defaultSalonId = salons[0]?.id || 's1'

  return asArray(rawTables).map((table, index) => {
    const salonIdCandidate = String(table?.salonId || '').trim()
    const hasSalon = salons.some((salon) => salon.id === salonIdCandidate)
    const parsedNumber = Number(table?.number)
    const fallbackNumber = index + 1
    const parsedCapacity = Number(table?.capacity)

    return {
      id: String(table?.id || `t${fallbackNumber}`),
      salonId: hasSalon ? salonIdCandidate : defaultSalonId,
      number: Number.isFinite(parsedNumber) && parsedNumber > 0 ? Math.trunc(parsedNumber) : fallbackNumber,
      capacity: Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? Math.trunc(parsedCapacity) : 4,
      status: table?.status === TABLE_STATUS.OCCUPIED ? TABLE_STATUS.OCCUPIED : TABLE_STATUS.FREE,
      active: table?.active !== false,
      activeSessionId: table?.activeSessionId || null,
      qrStatus: Object.values(QR_STATUS).includes(table?.qrStatus) ? table.qrStatus : QR_STATUS.PENDING,
      qrToken: table?.qrToken || null,
      qrGeneratedAt: table?.qrGeneratedAt || null,
      qrPrintedAt: table?.qrPrintedAt || null,
    }
  })
}

function buildSnapshot() {
  return {
    users: state.users,
    sessionsByToken: Array.from(state.sessionsByToken.entries()),
    salons: state.salons,
    catalogCategories: state.catalogCategories,
    catalog: state.catalog,
    inventory: state.inventory,
    tables: state.tables,
    tableSessions: state.tableSessions,
    orders: state.orders,
    kitchenTickets: state.kitchenTickets,
    cashSessions: state.cashSessions,
    payments: state.payments,
    receipts: state.receipts,
    printerJobs: state.printerJobs,
    incidents: state.incidents,
    customers: state.customers,
    menuSections: state.menuSections,
    menuCategories: state.menuCategories,
    menuProducts: state.menuProducts,
    bills: state.bills,
    cashTransactions: state.cashTransactions,
    financeAccounts: state.financeAccounts,
    financeTransactions: state.financeTransactions,
    cashClosures: state.cashClosures,
    restaurant: state.restaurant,
  }
}

function hydrateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return createInitialState()

  const sessionEntries = asArray(snapshot.sessionsByToken)
    .filter((entry) => Array.isArray(entry) && entry.length === 2)
    .map((entry) => [String(entry[0]), String(entry[1])])

  const salons = normalizeSalons(snapshot.salons)
  const tables = normalizeTables(snapshot.tables, salons)
  const catalogCategories = normalizeCatalogCategories(snapshot.catalogCategories, snapshot.catalog)
  const catalog = normalizeCatalogRows(snapshot.catalog, catalogCategories)
  const inventory = syncInventoryRows(snapshot.inventory, catalog)

  return {
    users: clone(asArray(snapshot.users)),
    sessionsByToken: new Map(sessionEntries),
    salons: clone(salons),
    catalogCategories: clone(catalogCategories),
    catalog: clone(catalog),
    inventory: clone(inventory),
    tables: clone(tables),
    tableSessions: clone(asArray(snapshot.tableSessions)),
    orders: clone(asArray(snapshot.orders)),
    kitchenTickets: clone(asArray(snapshot.kitchenTickets)),
    cashSessions: clone(asArray(snapshot.cashSessions)),
    payments: clone(asArray(snapshot.payments)),
    receipts: clone(asArray(snapshot.receipts)),
    printerJobs: clone(asArray(snapshot.printerJobs)),
    incidents: clone(asArray(snapshot.incidents)),
    customers: clone(asArray(snapshot.customers)),
    menuSections: clone(asArray(snapshot.menuSections)),
    menuCategories: clone(asArray(snapshot.menuCategories)),
    menuProducts: clone(asArray(snapshot.menuProducts)),
    bills: clone(asArray(snapshot.bills)),
    cashTransactions: clone(asArray(snapshot.cashTransactions)),
    financeAccounts: clone(asArray(snapshot.financeAccounts)),
    financeTransactions: clone(asArray(snapshot.financeTransactions)),
    cashClosures: clone(asArray(snapshot.cashClosures)),
    restaurant: clone(snapshot.restaurant || defaultRestaurantSettings()),
  }
}

let state = createInitialState()
ensureBusinessState()

const persistDebounceMs = Number(process.env.STATE_PERSIST_DEBOUNCE_MS || 400)
let persistTimer = null
let persistQueue = Promise.resolve()
let initialized = false

const sanitizeUser = (user) => {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    active: user.active !== false,
  }
}

function normalizeName(value, fallback) {
  const text = String(value || '').trim()
  return text || fallback
}

function nextSalonSortOrder() {
  return state.salons.reduce((max, salon) => Math.max(max, Number(salon.sortOrder) || 0), 0) + 1
}

function tablePublicMeta(table) {
  const salon = state.salons.find((row) => row.id === table.salonId) || null
  return {
    ...clone(table),
    salon,
  }
}

function normalizeMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Number(amount.toFixed(2))
}

function defaultRestaurantSettings() {
  return {
    name: 'TAKI RESTAURANT',
    legalName: '',
    taxId: '',
    currency: 'PEN',
    timezone: 'America/Lima',
    address: '',
    phone: '',
    logoUrl: '',
    primaryColor: '#1b4332',
  }
}

function defaultFinanceAccounts() {
  return [
    {
      id: 'fa-cash-general',
      name: 'Caja General',
      type: FINANCE_ACCOUNT_TYPE.CASH,
      balance: 0,
      active: true,
      description: 'Caja administrativa principal',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'fa-bank-main',
      name: 'Banco Principal',
      type: FINANCE_ACCOUNT_TYPE.BANK,
      balance: 0,
      active: true,
      description: 'Cuenta bancaria principal',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'fa-digital-wallet',
      name: 'Billetera Digital',
      type: FINANCE_ACCOUNT_TYPE.DIGITAL,
      balance: 0,
      active: true,
      description: 'Billetera/Plataforma digital',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ]
}

function ensureBusinessState() {
  if (!Array.isArray(state.customers)) state.customers = []
  if (!Array.isArray(state.menuSections)) state.menuSections = []
  if (!Array.isArray(state.menuCategories)) state.menuCategories = []
  if (!Array.isArray(state.menuProducts)) state.menuProducts = []
  if (!Array.isArray(state.bills)) state.bills = []
  if (!Array.isArray(state.cashTransactions)) state.cashTransactions = []
  if (!Array.isArray(state.financeAccounts)) state.financeAccounts = defaultFinanceAccounts()
  if (!Array.isArray(state.financeTransactions)) state.financeTransactions = []
  if (!Array.isArray(state.cashClosures)) state.cashClosures = []
  if (!state.restaurant || typeof state.restaurant !== 'object') state.restaurant = defaultRestaurantSettings()

  state.users = asArray(state.users).map((user) => ({
    ...user,
    active: user?.active !== false,
  }))

  state.financeAccounts = state.financeAccounts.map((account) => ({
    ...account,
    balance: normalizeMoney(account.balance),
    active: account.active !== false,
    updatedAt: account.updatedAt || nowIso(),
    createdAt: account.createdAt || nowIso(),
  }))
}

function moneyLineTotal(item) {
  const quantity = Number(item?.quantity || 0)
  const unitPrice = Number(item?.unitPrice || 0)
  const base = quantity * unitPrice
  const extras = asArray(item?.extras).reduce(
    (sum, extra) => sum + Number(extra?.quantity || 0) * Number(extra?.unitPrice || 0),
    0,
  )
  const takeawayFee = item?.isMenu && item?.serviceMode === SERVICE_MODE.TAKEAWAY ? quantity * PRICE.TAKEAWAY_FEE_PER_MENU : 0
  return normalizeMoney(base + extras + takeawayFee)
}

function computeBillTotals(bill) {
  const total = normalizeMoney(asArray(bill.lines).reduce((sum, line) => sum + Number(line.total || 0), 0))
  const paid = normalizeMoney(asArray(bill.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
  const due = normalizeMoney(Math.max(0, total - paid))

  bill.total = total
  bill.paidAmount = paid
  bill.dueAmount = due

  if (bill.status === BILL_STATUS.CANCELLED) return
  if (paid <= 0) {
    bill.status = BILL_STATUS.OPEN
    return
  }
  bill.status = due > 0 ? BILL_STATUS.PARTIALLY_PAID : BILL_STATUS.PAID
}

function isOrderBillable(order) {
  return order?.status === ORDER_STATUS.DELIVERED
}

function billLineKey(orderId, orderItemId) {
  return String(orderId) + ':' + String(orderItemId)
}

function billLabelForGuest(guestNumber) {
  return Number(guestNumber) > 0 ? 'Persona ' + Number(guestNumber) : 'Persona sin numero'
}

function collectExistingBillLineKeys() {
  const keys = new Set()
  for (const bill of asArray(state.bills)) {
    for (const line of asArray(bill.lines)) {
      keys.add(billLineKey(line.orderId, line.orderItemId))
    }
  }
  return keys
}

function syncOrdersAfterBills(tableSessionId) {
  if (!tableSessionId) return

  const sessionBills = asArray(state.bills).filter((bill) => bill.tableSessionId === tableSessionId)
  const hasOpen = sessionBills.some((bill) => bill.status === BILL_STATUS.OPEN || bill.status === BILL_STATUS.PARTIALLY_PAID)
  if (hasOpen) return

  for (const order of asArray(state.orders)) {
    if (order.tableSessionId === tableSessionId && order.status === ORDER_STATUS.DELIVERED) {
      order.status = ORDER_STATUS.CLOSED
      order.closedAt = order.closedAt || nowIso()
    }
  }

  const session = asArray(state.tableSessions).find((item) => item.id === tableSessionId)
  if (!session) return

  const hasPendingOrders = asArray(session.orderIds)
    .map((id) => state.orders.find((order) => order.id === id))
    .some((order) => order && order.status !== ORDER_STATUS.CLOSED && order.status !== ORDER_STATUS.CANCELLED)

  if (!hasPendingOrders) {
    session.closedAt = session.closedAt || nowIso()
    const table = state.tables.find((item) => item.id === session.tableId)
    if (table) {
      table.activeSessionId = null
      table.status = TABLE_STATUS.FREE
    }
  }
}

function mapMenuProductToCatalogItem(product) {
  const category = state.menuCategories.find((item) => item.id === product.categoryId)
  const categoryName = category?.name || 'General'

  return {
    id: product.id,
    name: product.name,
    category: product.categoryId,
    categoryName,
    type: deriveCatalogFlags(product.categoryId).type,
    basePrice: normalizeMoney(product.price),
    isMenu: true,
    variants: asArray(product.options).map((option) => option.name).filter(Boolean),
    imageUrl: product.imageUrl || '',
    active: product.isActive && product.status === 'AVAILABLE' && Number(product.quantity) > 0,
    days: [],
  }
}

function upsertCatalogFromMenuProduct(product) {
  const mapped = mapMenuProductToCatalogItem(product)
  const index = state.catalog.findIndex((item) => item.id === mapped.id)
  if (index >= 0) {
    state.catalog[index] = {
      ...state.catalog[index],
      ...mapped,
      variants: mapped.variants.length ? mapped.variants : ['normal'],
    }
  } else {
    state.catalog.push({
      ...mapped,
      variants: mapped.variants.length ? mapped.variants : ['normal'],
    })
  }
  syncCatalogState()
}

function enqueuePersist() {
  if (!isStatePersistenceEnabled()) return
  if (persistTimer) return

  persistTimer = setTimeout(() => {
    persistTimer = null
    const snapshot = buildSnapshot()
    persistQueue = persistQueue
      .then(() => saveStateSnapshot(snapshot))
      .catch((error) => {
        console.error('[state] no se pudo persistir el snapshot:', error)
      })
  }, persistDebounceMs)
}

async function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    try {
      await saveStateSnapshot(buildSnapshot())
    } catch (error) {
      console.error('[state] no se pudo persistir el snapshot final:', error)
    }
  }

  await persistQueue
}

export const db = {
  login(username, password) {
    const user = state.users.find(
      (candidate) => candidate.username === username && candidate.password === password && candidate.active !== false,
    )
    if (!user) return null

    const token = randomUUID()
    state.sessionsByToken.set(token, user.id)
    return { token, user: sanitizeUser(user) }
  },

  getUserByToken(token) {
    const userId = state.sessionsByToken.get(token)
    return sanitizeUser(state.users.find((user) => user.id === userId))
  },

  listCatalogCategories({ active } = {}) {
    syncCatalogState()

    let rows = [...state.catalogCategories]
    if (typeof active === 'boolean') {
      rows = rows.filter((category) => category.active === active)
    }

    return clone(rows)
  },

  createCatalogCategory(payload) {
    syncCatalogState()

    const name = String(payload?.name || '').trim()
    if (!name) throw new Error('Nombre de categoria requerido')

    const nextCategory = normalizeCatalogCategory({
      id: payload?.id || name,
      name,
      active: payload?.active !== false,
      sortOrder: nextCatalogCategorySortOrder(),
    }, state.catalogCategories.length)

    if (resolveCatalogCategory(nextCategory.id, state.catalogCategories)) {
      throw new Error('Ya existe una categoria con ese identificador')
    }

    ensureUniqueCatalogCategoryName(nextCategory.name)
    state.catalogCategories.push(nextCategory)
    syncCatalogState()
    return clone(state.catalogCategories.find((category) => category.id === nextCategory.id))
  },

  listCatalogItems({ active, category } = {}) {
    syncCatalogState()

    let rows = [...state.catalog]
    if (typeof active === 'boolean') {
      rows = rows.filter((item) => item.active === active)
    }
    if (category) {
      rows = rows.filter((item) => item.category === category)
    }

    return clone(rows)
  },

  getCatalogMenus(date) {
    syncCatalogState()
    const selectedDate = date || dateOnly()
    return clone(state.catalog.filter((item) => isCatalogAvailableOnDate(item, selectedDate)))
  },

  createCatalogItem(payload) {
    syncCatalogState()
    if (!resolveCatalogCategory(payload?.category, state.catalogCategories)) {
      throw new Error('La categoria seleccionada no existe')
    }

    const nextIndex = state.catalog.length
    const draft = normalizeCatalogItem({ id: randomUUID(), ...payload }, nextIndex)
    const flags = deriveCatalogFlags(draft.category)
    const nextItem = { ...draft, type: flags.type, isMenu: flags.isMenu }

    ensureUniqueCatalogName(nextItem.name)
    state.catalog.push(nextItem)
    syncCatalogState()

    return clone(state.catalog.find((item) => item.id === nextItem.id))
  },

  updateCatalogItem(itemId, payload) {
    syncCatalogState()
    const current = state.catalog.find((item) => item.id === itemId)
    if (!current) throw new Error('Plato no encontrado')

    const merged = normalizeCatalogItem({ ...current, ...payload, id: current.id }, state.catalog.indexOf(current))
    if (!resolveCatalogCategory(merged.category, state.catalogCategories)) {
      throw new Error('La categoria seleccionada no existe')
    }
    const flags = deriveCatalogFlags(merged.category)
    ensureUniqueCatalogName(merged.name, current.id)

    Object.assign(current, {
      ...merged,
      type: flags.type,
      isMenu: flags.isMenu,
    })

    syncCatalogState()
    return clone(current)
  },

  listSalons({ active } = {}) {
    let rows = [...state.salons]
    if (typeof active === 'boolean') {
      rows = rows.filter((row) => row.active === active)
    }

    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

    return rows.map((salon) => ({
      ...clone(salon),
      tablesCount: state.tables.filter((table) => table.salonId === salon.id).length,
      activeTablesCount: state.tables.filter((table) => table.salonId === salon.id && table.active).length,
    }))
  },

  getSalonById(salonId) {
    return state.salons.find((salon) => salon.id === salonId) || null
  },

  createSalon(payload) {
    const name = normalizeName(payload?.name, 'Salon')
    const existing = state.salons.find((salon) => salon.name.toLowerCase() === name.toLowerCase())
    if (existing) throw new Error('Ya existe un salon con ese nombre')

    const sortOrderRaw = Number(payload?.sortOrder)
    const desiredSortOrder = Number.isInteger(sortOrderRaw) && sortOrderRaw > 0
      ? sortOrderRaw
      : nextSalonSortOrder()

    const salon = {
      id: randomUUID(),
      name,
      sortOrder: desiredSortOrder,
      active: true,
    }

    state.salons.push(salon)
    state.salons.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    state.salons.forEach((row, index) => {
      row.sortOrder = index + 1
    })

    return clone(salon)
  },

  updateSalon(salonId, payload) {
    const salon = this.getSalonById(salonId)
    if (!salon) throw new Error('Salon no existe')

    if (payload?.name != null) {
      const nextName = normalizeName(payload.name, salon.name)
      const duplicated = state.salons.find((row) => row.id !== salon.id && row.name.toLowerCase() === nextName.toLowerCase())
      if (duplicated) throw new Error('Ya existe un salon con ese nombre')
      salon.name = nextName
    }

    if (payload?.sortOrder != null) {
      const nextSort = Number(payload.sortOrder)
      if (!Number.isInteger(nextSort) || nextSort < 1) {
        throw new Error('Orden de salon invalido')
      }
      salon.sortOrder = nextSort
    }

    if (payload?.active != null) {
      const nextActive = Boolean(payload.active)
      if (!nextActive) {
        const hasActiveTables = state.tables.some((table) => table.salonId === salon.id && table.active)
        if (hasActiveTables) {
          throw new Error('No se puede desactivar el salon con mesas activas')
        }
      }
      salon.active = nextActive
    }

    state.salons.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    state.salons.forEach((row, index) => {
      row.sortOrder = index + 1
    })

    return clone(salon)
  },

  getTables() {
    const salons = this.listSalons({ active: true })
    const salonOrder = new Map(salons.map((salon, index) => [salon.id, index]))

    return state.tables
      .filter((table) => {
        if (!table.active) return false
        const salon = this.getSalonById(table.salonId)
        return Boolean(salon?.active)
      })
      .sort((a, b) => {
        const aOrder = salonOrder.get(a.salonId) ?? Number.MAX_SAFE_INTEGER
        const bOrder = salonOrder.get(b.salonId) ?? Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) return aOrder - bOrder
        return a.number - b.number
      })
      .map((table) => clone(table))
  },

  listTablesAdmin({ salonId, active, status, qrStatus } = {}) {
    let rows = [...state.tables]

    if (salonId) rows = rows.filter((table) => table.salonId === salonId)
    if (typeof active === 'boolean') rows = rows.filter((table) => table.active === active)
    if (status) rows = rows.filter((table) => table.status === status)
    if (qrStatus) rows = rows.filter((table) => table.qrStatus === qrStatus)

    rows.sort((a, b) => {
      const salonA = this.getSalonById(a.salonId)
      const salonB = this.getSalonById(b.salonId)
      const orderA = salonA?.sortOrder ?? Number.MAX_SAFE_INTEGER
      const orderB = salonB?.sortOrder ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return a.number - b.number
    })

    return rows.map((table) => tablePublicMeta(table))
  },

  getTableById(tableId) {
    return state.tables.find((table) => table.id === tableId)
  },

  getTableByQrToken(qrToken) {
    const token = String(qrToken || '').trim()
    if (!token) return null

    const table = state.tables.find((row) => row.qrToken === token && row.active)
    if (!table) return null

    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) return null

    return clone(table)
  },

  ensureTableQrToken(tableId) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')

    if (!table.qrToken) {
      table.qrToken = randomUUID()
    }

    return clone(table)
  },

  createTable(payload) {
    const salonId = String(payload?.salonId || '').trim()
    const number = Number(payload?.number)
    const capacity = Number(payload?.capacity)

    const salon = this.getSalonById(salonId)
    if (!salon) throw new Error('Salon no existe')
    if (!salon.active) throw new Error('No se puede crear mesas en un salon inactivo')
    if (!Number.isInteger(number) || number < 1) throw new Error('Numero de mesa invalido')
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Aforo invalido')

    const duplicated = state.tables.find((row) => row.salonId === salonId && row.number === number)
    if (duplicated) throw new Error('Ya existe una mesa con ese numero en el salon')

    const table = {
      id: randomUUID(),
      salonId,
      number,
      capacity,
      status: TABLE_STATUS.FREE,
      active: true,
      activeSessionId: null,
      qrStatus: QR_STATUS.PENDING,
      qrToken: null,
      qrGeneratedAt: null,
      qrPrintedAt: null,
    }

    state.tables.push(table)
    return tablePublicMeta(table)
  },

  createTablesBulk(payload) {
    const salonId = String(payload?.salonId || '').trim()
    const startNumber = Number(payload?.startNumber)
    const count = Number(payload?.count)
    const capacity = Number(payload?.capacity)

    const salon = this.getSalonById(salonId)
    if (!salon) throw new Error('Salon no existe')
    if (!salon.active) throw new Error('No se puede crear mesas en un salon inactivo')
    if (!Number.isInteger(startNumber) || startNumber < 1) throw new Error('Numero inicial invalido')
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('Cantidad de mesas invalida')
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Aforo invalido')

    const numbers = Array.from({ length: count }, (_, index) => startNumber + index)

    const duplicates = numbers.filter((number) =>
      state.tables.some((table) => table.salonId === salonId && table.number === number),
    )

    if (duplicates.length > 0) {
      throw new Error(`Conflicto de numeracion en salon (${duplicates.slice(0, 6).join(', ')})`)
    }

    const created = numbers.map((number) => {
      const table = {
        id: randomUUID(),
        salonId,
        number,
        capacity,
        status: TABLE_STATUS.FREE,
        active: true,
        activeSessionId: null,
        qrStatus: QR_STATUS.PENDING,
        qrToken: null,
        qrGeneratedAt: null,
        qrPrintedAt: null,
      }
      state.tables.push(table)
      return tablePublicMeta(table)
    })

    return created
  },

  updateTableRecord(tableId, payload) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')

    const patch = payload || {}
    const nextSalonId = patch.salonId != null ? String(patch.salonId) : table.salonId
    const nextNumber = patch.number != null ? Number(patch.number) : table.number
    const nextCapacity = patch.capacity != null ? Number(patch.capacity) : table.capacity
    const nextActive = patch.active != null ? Boolean(patch.active) : table.active

    const targetSalon = this.getSalonById(nextSalonId)
    if (!targetSalon) throw new Error('Salon no existe')
    if (!targetSalon.active && nextActive) throw new Error('No se puede activar mesa en salon inactivo')
    if (!Number.isInteger(nextNumber) || nextNumber < 1) throw new Error('Numero de mesa invalido')
    if (!Number.isInteger(nextCapacity) || nextCapacity < 1) throw new Error('Aforo invalido')

    const duplicated = state.tables.find((row) => row.id !== table.id && row.salonId === nextSalonId && row.number === nextNumber)
    if (duplicated) throw new Error('Ya existe una mesa con ese numero en el salon')

    if (table.activeSessionId && !nextActive) {
      throw new Error('No se puede desactivar una mesa con sesion activa')
    }

    const activeSession = table.activeSessionId ? this.getTableSessionById(table.activeSessionId) : null
    if (activeSession && activeSession.guestsActive > nextCapacity) {
      throw new Error('El nuevo aforo es menor al numero de comensales activos')
    }

    const shouldSetPending =
      nextSalonId !== table.salonId ||
      nextNumber !== table.number ||
      nextActive !== table.active

    table.salonId = nextSalonId
    table.number = nextNumber
    table.capacity = nextCapacity
    table.active = nextActive

    if (!nextActive) {
      table.status = TABLE_STATUS.FREE
      table.activeSessionId = null
    }

    if (shouldSetPending) {
      table.qrStatus = QR_STATUS.PENDING
      table.qrGeneratedAt = null
      table.qrPrintedAt = null
    }

    return tablePublicMeta(table)
  },

  getQrSummary() {
    const activeRows = state.tables.filter((table) => {
      if (!table.active) return false
      const salon = this.getSalonById(table.salonId)
      return Boolean(salon?.active)
    })

    return {
      pending: activeRows.filter((table) => table.qrStatus === QR_STATUS.PENDING).length,
      generated: activeRows.filter((table) => table.qrStatus === QR_STATUS.GENERATED).length,
      printed: activeRows.filter((table) => table.qrStatus === QR_STATUS.PRINTED).length,
      total: activeRows.length,
    }
  },

  listQrPendingTables() {
    return state.tables
      .filter((table) => {
        if (!table.active) return false
        if (table.qrStatus !== QR_STATUS.PENDING) return false
        const salon = this.getSalonById(table.salonId)
        return Boolean(salon?.active)
      })
      .sort((a, b) => {
        const salonA = this.getSalonById(a.salonId)
        const salonB = this.getSalonById(b.salonId)
        const orderA = salonA?.sortOrder ?? Number.MAX_SAFE_INTEGER
        const orderB = salonB?.sortOrder ?? Number.MAX_SAFE_INTEGER
        if (orderA !== orderB) return orderA - orderB
        return a.number - b.number
      })
      .map((table) => tablePublicMeta(table))
  },

  listQrGeneratedTables() {
    return state.tables
      .filter((table) => {
        if (!table.active) return false
        if (table.qrStatus !== QR_STATUS.GENERATED) return false
        const salon = this.getSalonById(table.salonId)
        return Boolean(salon?.active)
      })
      .sort((a, b) => {
        const salonA = this.getSalonById(a.salonId)
        const salonB = this.getSalonById(b.salonId)
        const orderA = salonA?.sortOrder ?? Number.MAX_SAFE_INTEGER
        const orderB = salonB?.sortOrder ?? Number.MAX_SAFE_INTEGER
        if (orderA !== orderB) return orderA - orderB
        return a.number - b.number
      })
      .map((table) => tablePublicMeta(table))
  },

  generatePendingTableQrs() {
    const now = nowIso()
    const generated = []

    for (const table of state.tables) {
      if (!table.active) continue
      const salon = this.getSalonById(table.salonId)
      if (!salon?.active) continue
      if (table.qrStatus !== QR_STATUS.PENDING) continue

      if (!table.qrToken) {
        table.qrToken = randomUUID()
      }
      table.qrStatus = QR_STATUS.GENERATED
      table.qrGeneratedAt = now
      table.qrPrintedAt = null
      generated.push(tablePublicMeta(table))
    }

    return generated
  },

  markTableQrsPrinted(tableIds = []) {
    const idSet = new Set(asArray(tableIds).map((id) => String(id)))
    const markAllGenerated = idSet.size === 0
    const now = nowIso()
    const marked = []

    for (const table of state.tables) {
      if (!table.active) continue
      const salon = this.getSalonById(table.salonId)
      if (!salon?.active) continue
      if (table.qrStatus !== QR_STATUS.GENERATED) continue
      if (!markAllGenerated && !idSet.has(table.id)) continue

      table.qrStatus = QR_STATUS.PRINTED
      table.qrPrintedAt = now
      marked.push(tablePublicMeta(table))
    }

    return marked
  },

  getActiveSessionByTableId(tableId) {
    const table = this.getTableById(tableId)
    if (!table?.activeSessionId) return null
    return state.tableSessions.find((session) => session.id === table.activeSessionId && session.closedAt === null) || null
  },

  openTableSession(tableId, guests, userId) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')
    if (table.activeSessionId) throw new Error('La mesa ya tiene una sesion activa')
    if (!Number.isInteger(guests) || guests < 1 || guests > table.capacity) {
      throw new Error('Cantidad de comensales invalida para la capacidad de la mesa')
    }

    const session = {
      id: randomUUID(),
      tableId,
      guestsActive: guests,
      createdByUserId: userId,
      createdAt: nowIso(),
      closedAt: null,
      orderIds: [],
    }

    table.status = TABLE_STATUS.OCCUPIED
    table.activeSessionId = session.id
    state.tableSessions.push(session)

    return clone(session)
  },

  updateTableSessionGuests(tableId, guests) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const activeSession = this.getActiveSessionByTableId(tableId)
    if (!activeSession) throw new Error('La mesa no tiene sesion activa')
    if (!Number.isInteger(guests) || guests < 1 || guests > table.capacity) {
      throw new Error('Cantidad de comensales invalida para la capacidad de la mesa')
    }
    activeSession.guestsActive = guests
    return clone(activeSession)
  },

  getTableSessionById(sessionId) {
    return state.tableSessions.find((session) => session.id === sessionId)
  },

  getOpenCashSession() {
    return state.cashSessions.find((cash) => cash.status === CASH_STATUS.OPEN) || null
  },

  openCashSession(openingAmount, openedByUserId) {
    const current = this.getOpenCashSession()
    if (current) throw new Error('Ya existe una caja abierta')

    const session = {
      id: randomUUID(),
      date: dateOnly(),
      status: CASH_STATUS.OPEN,
      openedAt: nowIso(),
      openedByUserId,
      openingAmount: Number(openingAmount) || 0,
      closedAt: null,
      closedByUserId: null,
      countedCashAmount: null,
    }
    state.cashSessions.push(session)
    return clone(session)
  },

  closeCashSession(closedByUserId, countedCashAmount) {
    const session = this.getOpenCashSession()
    if (!session) throw new Error('No existe una caja abierta')

    session.status = CASH_STATUS.CLOSED
    session.closedAt = nowIso()
    session.closedByUserId = closedByUserId
    session.countedCashAmount = Number(countedCashAmount) || 0

    return clone(session)
  },

  listKitchenTickets() {
    return clone(state.kitchenTickets)
  },

  listOrders() {
    return clone(state.orders)
  },

  getOrderById(orderId) {
    return state.orders.find((order) => order.id === orderId)
  },

  updateOrderRecord(orderId, payload, actorRole) {
    const order = this.getOrderById(orderId)
    if (!order) throw new Error('Pedido no existe')

    const patch = payload || {}
    const keys = Object.keys(patch).filter((key) => patch[key] != null)
    if (!keys.length) throw new Error('Debe enviar campos para actualizar')

    if (actorRole !== ROLES.ADMIN && actorRole !== ROLES.SUPER_ADMIN) {
      throw new Error('No tiene permisos para actualizar este pedido')
    }

    if (actorRole === ROLES.ADMIN) {
      const adminAllowed = new Set(['status'])
      const invalidKey = keys.find((key) => !adminAllowed.has(key))
      if (invalidKey) {
        throw new Error('Admin solo puede cambiar el estado del pedido')
      }
    }

    if (patch.tableId != null) {
      const targetTable = this.getTableById(patch.tableId)
      if (!targetTable) throw new Error('Mesa no existe')
      if (!targetTable.active) throw new Error('Mesa inactiva')
      const targetSalon = this.getSalonById(targetTable.salonId)
      if (!targetSalon?.active) throw new Error('El salon de la mesa esta inactivo')
      order.tableId = patch.tableId
    }

    if (patch.status != null) {
      if (!Object.values(ORDER_STATUS).includes(patch.status)) {
        throw new Error('Estado de pedido invalido')
      }

      order.status = patch.status

      if (patch.status === ORDER_STATUS.CLOSED) {
        if (!order.closedAt) order.closedAt = nowIso()
      } else {
        order.closedAt = null
      }
    }

    this.recalculateOrderTotals(order)

    const ticket = order.kitchenTicketId
      ? state.kitchenTickets.find((candidate) => candidate.id === order.kitchenTicketId)
      : null
    if (ticket && patch.tableId != null) {
      ticket.tableId = patch.tableId
      ticket.updatedAt = nowIso()
    }

    return clone(order)
  },

  deleteOrderRecord(orderId) {
    const index = state.orders.findIndex((order) => order.id === orderId)
    if (index < 0) throw new Error('Pedido no existe')

    const [removedOrder] = state.orders.splice(index, 1)
    const relatedTicketIds = state.kitchenTickets
      .filter((ticket) => ticket.orderId === removedOrder.id)
      .map((ticket) => ticket.id)

    if (relatedTicketIds.length > 0) {
      state.kitchenTickets = state.kitchenTickets.filter((ticket) => ticket.orderId !== removedOrder.id)
      state.printerJobs = state.printerJobs.filter((job) => !relatedTicketIds.includes(job.ticketId))
      state.incidents = state.incidents.filter((incident) => !relatedTicketIds.includes(incident.ticketId))
    }

    state.payments = state.payments.filter((payment) => payment.orderId !== removedOrder.id)
    state.receipts = state.receipts.filter((receipt) => receipt.orderId !== removedOrder.id)

    const tableSession = this.getTableSessionById(removedOrder.tableSessionId)
    if (tableSession) {
      tableSession.orderIds = tableSession.orderIds.filter((id) => id !== removedOrder.id)
    }

    return clone(removedOrder)
  },

  recalculateOrderTotals(order) {
    let subtotal = 0
    let menuTakeawayCount = 0

    for (const item of order.items) {
      const base = item.unitPrice * item.quantity
      const extras = item.extras.reduce((sum, extra) => sum + extra.unitPrice * extra.quantity, 0)
      subtotal += base + extras

      if (item.isMenu && item.serviceMode === SERVICE_MODE.TAKEAWAY) {
        menuTakeawayCount += item.quantity
      }
    }

    const takeawayFee = menuTakeawayCount * PRICE.TAKEAWAY_FEE_PER_MENU
    const total = subtotal + takeawayFee

    order.totals = {
      subtotal: Number(subtotal.toFixed(2)),
      takeawayFee: Number(takeawayFee.toFixed(2)),
      total: Number(total.toFixed(2)),
    }
  },

  createOrder({ tableId, source, createdByUserId }) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')
    let activeSession = this.getActiveSessionByTableId(tableId)
    if (!activeSession && source === ORDER_SOURCE.QR) {
      this.openTableSession(tableId, 1, createdByUserId || 'qr-client')
      activeSession = this.getActiveSessionByTableId(tableId)
    }
    if (!activeSession) throw new Error('La mesa no tiene sesion activa')

    const order = {
      id: randomUUID(),
      tableId,
      tableSessionId: activeSession.id,
      createdByUserId,
      source,
      status: source === ORDER_SOURCE.QR ? ORDER_STATUS.PENDING_WAITER_APPROVAL : ORDER_STATUS.DRAFT,
      createdAt: nowIso(),
      closedAt: null,
      approvedByUserId: null,
      items: [],
      payments: [],
      splitMode: SPLIT_MODE.TABLE_TOTAL,
      totals: {
        subtotal: 0,
        takeawayFee: 0,
        total: 0,
      },
      kitchenTicketId: null,
    }

    state.orders.push(order)
    activeSession.orderIds.push(order.id)
    return clone(order)
  },

  addItemsToOrder(orderId, itemsPayload) {
    const order = this.getOrderById(orderId)
    if (!order) throw new Error('Pedido no existe')
    if (order.status === ORDER_STATUS.CLOSED || order.status === ORDER_STATUS.CANCELLED) {
      throw new Error('No se puede modificar un pedido cerrado o cancelado')
    }

    const items = Array.isArray(itemsPayload) ? itemsPayload : []
    if (!items.length) throw new Error('Debe enviar al menos un item')

    for (const payload of items) {
      const product = state.catalog.find((item) => item.id === payload.productId)
      if (!product) throw new Error(`Producto no encontrado: ${payload.productId}`)

      const quantity = Number(payload.quantity) || 1
      if (quantity < 1) throw new Error('Cantidad invalida')

      const item = {
        id: randomUUID(),
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: payload.unitPrice != null ? Number(payload.unitPrice) : Number(product.basePrice),
        variant: payload.variant || 'normal',
        notes: payload.notes || '',
        guestNumber: payload.guestNumber || null,
        serviceMode: payload.serviceMode || SERVICE_MODE.DINE_IN,
        isMenu: Boolean(product.isMenu),
        extras: [],
      }

      const extras = Array.isArray(payload.extras) ? payload.extras : []
      for (const extraPayload of extras) {
        const extraProduct = state.catalog.find((candidate) => candidate.id === extraPayload.productId)
        if (!extraProduct) throw new Error(`Extra no encontrado: ${extraPayload.productId}`)

        item.extras.push({
          id: randomUUID(),
          productId: extraProduct.id,
          name: extraProduct.name,
          unitPrice: extraPayload.unitPrice != null ? Number(extraPayload.unitPrice) : Number(extraProduct.basePrice),
          quantity: Number(extraPayload.quantity) || 1,
        })
      }

      order.items.push(item)
    }

    this.recalculateOrderTotals(order)
    return clone(order)
  },

  approveQrOrder(orderId, approvedByUserId) {
    const order = this.getOrderById(orderId)
    if (!order) throw new Error('Pedido no existe')
    if (order.source !== ORDER_SOURCE.QR) throw new Error('Solo los pedidos QR requieren aprobacion')
    if (order.status !== ORDER_STATUS.PENDING_WAITER_APPROVAL) throw new Error('El pedido QR ya fue aprobado o no es aprobable')

    order.status = ORDER_STATUS.APPROVED
    order.approvedByUserId = approvedByUserId
    return clone(order)
  },

  sendOrderToKitchen(orderId) {
    const order = this.getOrderById(orderId)
    if (!order) throw new Error('Pedido no existe')
    if (!order.items.length) throw new Error('No se puede enviar un pedido sin items')

    if (order.source === ORDER_SOURCE.QR && order.status === ORDER_STATUS.PENDING_WAITER_APPROVAL) {
      throw new Error('Pedido QR pendiente de aprobacion del mesero')
    }

    const ticket = {
      id: randomUUID(),
      orderId: order.id,
      tableId: order.tableId,
      tableSessionId: order.tableSessionId,
      status: KITCHEN_TICKET_STATUS.PENDING,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      printed: false,
      printAttempts: 0,
      items: order.items.map((item) => {
        const parsedNotes = parseKitchenNotes(item.notes)
        const detailText =
          parsedNotes.detail ||
          parsedNotes.extraDetails.join(' | ') ||
          (item.variant && item.variant !== 'normal' ? item.variant : '')

        return {
          productName: item.productName,
          quantity: item.quantity,
          variant: item.variant,
          notes: item.notes,
          detail: detailText,
          includedEntry: parsedNotes.includedEntry || null,
          servingLines: buildServingLines(item, parsedNotes.includedEntry),
          extras: item.extras.map((extra) => `${extra.name} x${extra.quantity}`),
        }
      }),
    }

    state.kitchenTickets.push(ticket)
    order.kitchenTicketId = ticket.id
    order.status = ORDER_STATUS.SENT_TO_KITCHEN

    return { order: clone(order), ticket: clone(ticket) }
  },

  updateKitchenTicketStatus(ticketId, newStatus) {
    const ticket = state.kitchenTickets.find((candidate) => candidate.id === ticketId)
    if (!ticket) throw new Error('Ticket de cocina no existe')
    ticket.status = newStatus
    ticket.updatedAt = nowIso()

    const order = this.getOrderById(ticket.orderId)
    if (order) {
      order.status = KITCHEN_STATUS_TO_ORDER_STATUS[newStatus] ?? order.status
    }

    return { ticket: clone(ticket), order: clone(order) }
  },

  autoProgressKitchenTickets(now = Date.now()) {
    const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now()
    const preparingAt = Number(process.env.KITCHEN_AUTO_PREPARING_MIN || 5)
    const readyAt = Number(process.env.KITCHEN_AUTO_READY_MIN || 12)
    const deliveredAt = Number(process.env.KITCHEN_AUTO_DELIVERED_MIN || 20)

    const preparingThreshold = Number.isFinite(preparingAt) && preparingAt >= 0 ? preparingAt : 5
    const readyThreshold = Number.isFinite(readyAt) && readyAt >= preparingThreshold ? readyAt : 12
    const deliveredThreshold = Number.isFinite(deliveredAt) && deliveredAt >= readyThreshold ? deliveredAt : 20

    const statusRank = {
      [KITCHEN_TICKET_STATUS.PENDING]: 0,
      [KITCHEN_TICKET_STATUS.PREPARING]: 1,
      [KITCHEN_TICKET_STATUS.READY]: 2,
      [KITCHEN_TICKET_STATUS.DELIVERED]: 3,
    }

    const changes = []

    for (const ticket of state.kitchenTickets) {
      const createdAtMs = new Date(ticket.createdAt).getTime()
      if (!Number.isFinite(createdAtMs)) continue

      const ageMinutes = (nowMs - createdAtMs) / 60000

      let targetStatus = KITCHEN_TICKET_STATUS.PENDING
      if (ageMinutes >= deliveredThreshold) {
        targetStatus = KITCHEN_TICKET_STATUS.DELIVERED
      } else if (ageMinutes >= readyThreshold) {
        targetStatus = KITCHEN_TICKET_STATUS.READY
      } else if (ageMinutes >= preparingThreshold) {
        targetStatus = KITCHEN_TICKET_STATUS.PREPARING
      }

      const currentRank = statusRank[ticket.status] ?? 0
      const targetRank = statusRank[targetStatus] ?? 0
      if (targetRank <= currentRank) continue

      const result = this.updateKitchenTicketStatus(ticket.id, targetStatus)
      changes.push(result)
    }

    return changes
  },

  registerPayment(orderId, splitMode, paymentsPayload, receivedByUserId) {
    const order = this.getOrderById(orderId)
    if (!order) throw new Error('Pedido no existe')
    if (!order.items.length) throw new Error('El pedido no tiene items')
    if (order.status !== ORDER_STATUS.DELIVERED) {
      throw new Error('Solo se puede cobrar un pedido en estado ENTREGADO')
    }

    const cashSession = this.getOpenCashSession()
    if (!cashSession) throw new Error('Debe abrir caja antes de cobrar')

    const payments = Array.isArray(paymentsPayload) ? paymentsPayload : []
    if (!payments.length) throw new Error('Debe enviar al menos un pago')

    const paidAmount = payments.reduce((sum, payment) => {
      const amount = Number(payment.amount)
      if (!(amount > 0)) throw new Error('Monto de pago invalido')
      if (!Object.values(PAYMENT_METHOD).includes(payment.method)) {
        throw new Error('Metodo de pago invalido')
      }
      return sum + amount
    }, 0)

    this.recalculateOrderTotals(order)

    if (paidAmount + 0.0001 < order.totals.total) {
      throw new Error('Monto pagado insuficiente')
    }

    const paymentRecord = {
      id: randomUUID(),
      orderId: order.id,
      cashSessionId: cashSession.id,
      splitMode: splitMode || SPLIT_MODE.TABLE_TOTAL,
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount),
      })),
      total: order.totals.total,
      paidAmount: Number(paidAmount.toFixed(2)),
      change: Number((paidAmount - order.totals.total).toFixed(2)),
      receivedByUserId,
      createdAt: nowIso(),
    }

    state.payments.push(paymentRecord)
    order.payments.push(paymentRecord.id)
    order.splitMode = splitMode || SPLIT_MODE.TABLE_TOTAL
    order.status = ORDER_STATUS.CLOSED
    order.closedAt = nowIso()

    const receipt = {
      id: randomUUID(),
      series: 'B001',
      number: String(state.receipts.length + 1).padStart(6, '0'),
      orderId: order.id,
      emittedAt: nowIso(),
      tableId: order.tableId,
      total: order.totals.total,
      splitMode: order.splitMode,
      lines: order.items.map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        extras: item.extras.map((extra) => ({ name: extra.name, quantity: extra.quantity, unitPrice: extra.unitPrice })),
      })),
    }

    state.receipts.push(receipt)

    const tableSession = this.getTableSessionById(order.tableSessionId)
    if (tableSession) {
      const openOrders = tableSession.orderIds
        .map((id) => this.getOrderById(id))
        .filter((candidate) => candidate && candidate.status !== ORDER_STATUS.CLOSED && candidate.status !== ORDER_STATUS.CANCELLED)
      if (openOrders.length === 0) {
        tableSession.closedAt = nowIso()
        const table = this.getTableById(tableSession.tableId)
        if (table) {
          table.activeSessionId = null
          table.status = TABLE_STATUS.FREE
        }
      }
    }

    for (const soldItem of order.items) {
      const inventory = state.inventory.find((row) => row.productId === soldItem.productId)
      if (inventory) {
        inventory.stock = Math.max(0, inventory.stock - soldItem.quantity)
      }

      for (const extra of soldItem.extras) {
        const extraInventory = state.inventory.find((row) => row.productId === extra.productId)
        if (extraInventory) {
          extraInventory.stock = Math.max(0, extraInventory.stock - extra.quantity)
        }
      }
    }

    return {
      order: clone(order),
      payment: clone(paymentRecord),
      receipt: clone(receipt),
    }
  },

  createPrinterJob(ticketId, payload) {
    const job = {
      id: randomUUID(),
      ticketId,
      payload,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    state.printerJobs.push(job)
    return job
  },

  getNextPrinterJob() {
    return state.printerJobs.find((job) => job.status === 'PENDING') || null
  },

  markPrinterJobProcessing(jobId) {
    const job = state.printerJobs.find((candidate) => candidate.id === jobId)
    if (!job) return
    job.status = 'PROCESSING'
    job.attempts += 1
    job.updatedAt = nowIso()
  },

  markPrinterJobDone(jobId) {
    const job = state.printerJobs.find((candidate) => candidate.id === jobId)
    if (!job) return
    job.status = 'DONE'
    job.updatedAt = nowIso()

    const ticket = state.kitchenTickets.find((candidate) => candidate.id === job.ticketId)
    if (ticket) {
      ticket.printed = true
      ticket.printAttempts += 1
      ticket.updatedAt = nowIso()
    }
  },

  markPrinterJobFailed(jobId, errorMessage) {
    const job = state.printerJobs.find((candidate) => candidate.id === jobId)
    if (!job) return
    job.status = job.attempts >= 3 ? 'FAILED' : 'PENDING'
    job.lastError = errorMessage
    job.updatedAt = nowIso()

    const ticket = state.kitchenTickets.find((candidate) => candidate.id === job.ticketId)
    if (ticket) {
      ticket.printAttempts += 1
      ticket.updatedAt = nowIso()
    }

    if (job.status === 'FAILED') {
      state.incidents.push({
        id: randomUUID(),
        kind: 'PRINTER_FAILURE',
        ticketId: job.ticketId,
        message: errorMessage,
        createdAt: nowIso(),
      })
    }
  },

  getCashSummaryBySessionId(cashSessionId) {
    ensureBusinessState()

    const paymentRecords = state.payments.filter((payment) => {
      if (payment.cashSessionId !== cashSessionId) return false
      const order = this.getOrderById(payment.orderId)
      return order?.status === ORDER_STATUS.CLOSED
    })

    const legacyTotal = paymentRecords.reduce((sum, payment) => sum + Number(payment.total || 0), 0)
    const legacyCashTotal = paymentRecords
      .flatMap((payment) => payment.payments)
      .filter((method) => method.method === PAYMENT_METHOD.CASH)
      .reduce((sum, method) => sum + Number(method.amount || 0), 0)
    const legacyTransferTotal = paymentRecords
      .flatMap((payment) => payment.payments)
      .filter((method) => method.method === PAYMENT_METHOD.TRANSFER)
      .reduce((sum, method) => sum + Number(method.amount || 0), 0)

    const registerLines = state.cashTransactions.filter((row) => row.cashSessionId === cashSessionId)
    const registerCashTotal = registerLines
      .filter((row) => row.method === PAYMENT_METHOD.CASH)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const registerTransferTotal = registerLines
      .filter((row) => row.method === PAYMENT_METHOD.TRANSFER)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)

    const cashTotal = normalizeMoney(legacyCashTotal + registerCashTotal)
    const transferTotal = normalizeMoney(legacyTransferTotal + registerTransferTotal)
    const total = normalizeMoney(legacyTotal + registerCashTotal + registerTransferTotal)

    return {
      total,
      cashTotal,
      transferTotal,
      paymentsCount: paymentRecords.length + registerLines.length,
      legacyPaymentsCount: paymentRecords.length,
      registerPaymentsCount: registerLines.length,
    }
  },

  getClosedOrdersByDateRange({ from, to, timezone }) {
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const fromDate = normalizeDateKeyInput(from, kpiTimeZone)
    const toDate = normalizeDateKeyInput(to || fromDate, kpiTimeZone)

    return state.orders.filter((order) => {
      if (order.status !== ORDER_STATUS.CLOSED || !order.closedAt) return false
      const parts = getDatePartsInTimeZone(order.closedAt, kpiTimeZone)
      if (!parts) return false
      return parts.dateKey >= fromDate && parts.dateKey <= toDate
    })
  },

  getKpiClientsSummary({ date, timezone } = {}) {
    ensureBusinessState()
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const targetDate = normalizeDateKeyInput(date, kpiTimeZone)

    const uniqueDocuments = new Set()
    for (const customer of state.customers) {
      const name = String(customer?.name || '').trim()
      const document = String(customer?.document || '').trim().toUpperCase()
      if (!name || !document) continue
      uniqueDocuments.add(document)
    }

    return {
      date: targetDate,
      totalUniqueClients: uniqueDocuments.size,
    }
  },

  getKpiMonthlyProfitSummary({ month, timezone } = {}) {
    ensureBusinessState()
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const monthKey = normalizeMonthKeyInput(month, kpiTimeZone)
    const monthRange = buildMonthRange(monthKey)

    const closedOrders = this.getClosedOrdersByDateRange({
      from: monthRange.from,
      to: monthRange.to,
      timezone: kpiTimeZone,
    })

    const grossSales = normalizeMoney(closedOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))
    const expenses = normalizeMoney(
      state.financeTransactions
        .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.EXPENSE)
        .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
    )

    return {
      month: monthKey,
      grossSales,
      expenses,
      netProfit: normalizeMoney(grossSales - expenses),
    }
  },

  getKpiIncomesSummary({ date, timezone } = {}) {
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const targetDate = normalizeDateKeyInput(date, kpiTimeZone)
    const yesterdayDate = shiftDateKey(targetDate, -1)

    const todayOrders = this.getClosedOrdersByDateRange({
      from: targetDate,
      to: targetDate,
      timezone: kpiTimeZone,
    })
    const yesterdayOrders = this.getClosedOrdersByDateRange({
      from: yesterdayDate,
      to: yesterdayDate,
      timezone: kpiTimeZone,
    })

    const totalToday = normalizeMoney(todayOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))
    const totalYesterday = normalizeMoney(yesterdayOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))

    return {
      date: targetDate,
      totalToday,
      totalYesterday,
      deltaVsYesterday: normalizeMoney(totalToday - totalYesterday),
    }
  },

  getKpiOrdersSummary({ date, timezone } = {}) {
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const targetDate = normalizeDateKeyInput(date, kpiTimeZone)
    const closedToday = this.getClosedOrdersByDateRange({
      from: targetDate,
      to: targetDate,
      timezone: kpiTimeZone,
    }).length

    const activeNow = state.orders.filter(
      (order) =>
        order.status !== ORDER_STATUS.CLOSED &&
        order.status !== ORDER_STATUS.DELIVERED &&
        order.status !== ORDER_STATUS.CANCELLED,
    ).length

    return {
      date: targetDate,
      closedToday,
      activeNow,
    }
  },

  getKpiTopProducts({ month, limit = 10, timezone } = {}) {
    ensureBusinessState()
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const monthKey = normalizeMonthKeyInput(month, kpiTimeZone)
    const monthRange = buildMonthRange(monthKey)
    const closedOrders = this.getClosedOrdersByDateRange({
      from: monthRange.from,
      to: monthRange.to,
      timezone: kpiTimeZone,
    })

    const grouped = new Map()
    for (const order of closedOrders) {
      for (const item of order.items || []) {
        const existing = grouped.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          categoryName: resolveOrderCategoryName(item.productId),
          quantitySold: 0,
          revenue: 0,
        }

        existing.quantitySold += Number(item.quantity || 0)
        existing.revenue += Number(item.unitPrice || 0) * Number(item.quantity || 0)
        grouped.set(item.productId, existing)
      }
    }

    const normalizedLimit = Number(limit) > 0 ? Math.trunc(Number(limit)) : 10

    return Array.from(grouped.values())
      .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
      .slice(0, normalizedLimit)
      .map((row) => ({
        ...row,
        revenue: normalizeMoney(row.revenue),
      }))
  },

  getKpiWaitersSummary({ period = 'WEEK', date, timezone } = {}) {
    ensureBusinessState()
    const kpiTimeZone = resolveKpiTimeZone(timezone)
    const targetDate = normalizeDateKeyInput(date, kpiTimeZone)
    const normalizedPeriod = String(period || 'WEEK').trim().toUpperCase()

    let from = targetDate
    let to = targetDate

    if (normalizedPeriod === 'MONTH') {
      const range = buildMonthRange(targetDate.slice(0, 7))
      from = range.from
      to = range.to
    } else if (normalizedPeriod === 'WEEK') {
      const range = buildWeekRange(targetDate, kpiTimeZone)
      from = range.from
      to = range.to
    }

    const closedOrders = this.getClosedOrdersByDateRange({
      from,
      to,
      timezone: kpiTimeZone,
    })

    const grouped = new Map()

    for (const order of closedOrders) {
      const assignedUserId =
        order.source === ORDER_SOURCE.QR ? order.approvedByUserId || 'UNASSIGNED' : order.createdByUserId || 'UNASSIGNED'
      const user = state.users.find((candidate) => candidate.id === assignedUserId)
      const row = grouped.get(assignedUserId) || {
        userId: assignedUserId,
        userName: user?.name || 'Sin asignar',
        role: user?.role || 'UNASSIGNED',
        amount: 0,
      }
      row.amount += Number(order?.totals?.total || 0)
      grouped.set(assignedUserId, row)
    }

    const totalSales = normalizeMoney(Array.from(grouped.values()).reduce((sum, row) => sum + row.amount, 0))

    const rows = Array.from(grouped.values())
      .map((row) => ({
        ...row,
        amount: normalizeMoney(row.amount),
        percentage: totalSales > 0 ? Number(((row.amount / totalSales) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    return {
      period: normalizedPeriod === 'TODAY' ? 'TODAY' : normalizedPeriod === 'MONTH' ? 'MONTH' : 'WEEK',
      from,
      to,
      totalSales,
      rows,
    }
  },

  getDailyKpi(date) {
    const dailyOrders = this.getClosedOrdersByDateRange({ from: date, to: date })

    let menusSold = 0
    let amount = 0

    for (const order of dailyOrders) {
      amount += Number(order?.totals?.total || 0)
      for (const item of order.items || []) {
        if (item.isMenu) menusSold += Number(item.quantity || 0)
      }
    }

    return {
      date: normalizeDateKeyInput(date, resolveKpiTimeZone()),
      menusSold,
      totalAmount: normalizeMoney(amount),
    }
  },

  getMonthlyKpi(month) {
    const monthKey = normalizeMonthKeyInput(month, resolveKpiTimeZone())
    const monthRange = buildMonthRange(monthKey)
    const monthlyOrders = this.getClosedOrdersByDateRange({
      from: monthRange.from,
      to: monthRange.to,
    })

    const totalAmount = normalizeMoney(monthlyOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))
    const menuCount = monthlyOrders.reduce(
      (sum, order) =>
        sum + (order.items || []).filter((item) => item.isMenu).reduce((inner, item) => inner + Number(item.quantity || 0), 0),
      0,
    )

    const monthlyMap = new Map()
    for (const order of state.orders.filter((candidate) => candidate.status === ORDER_STATUS.CLOSED && candidate.closedAt)) {
      const key = getDatePartsInTimeZone(order.closedAt, resolveKpiTimeZone())?.monthKey
      if (!key) continue
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + Number(order?.totals?.total || 0))
    }

    let bestMonth = null
    for (const [key, value] of monthlyMap.entries()) {
      if (!bestMonth || value > bestMonth.totalAmount) {
        bestMonth = { month: key, totalAmount: normalizeMoney(value) }
      }
    }

    return {
      month: monthKey,
      menusSold: menuCount,
      totalAmount,
      bestMonth,
    }
  },

  getTopDishes({ from, to, limit = 5 }) {
    const ranked = new Map()
    const startDate = DATE_KEY_REGEX.test(String(from || '').trim()) ? String(from).trim() : '0000-01-01'
    const endDate = DATE_KEY_REGEX.test(String(to || '').trim()) ? String(to).trim() : '9999-12-31'
    const kpiTimeZone = resolveKpiTimeZone()

    for (const order of state.orders) {
      if (order.status !== ORDER_STATUS.CLOSED || !order.closedAt) continue
      const orderDate = getDatePartsInTimeZone(order.closedAt, kpiTimeZone)?.dateKey
      if (!orderDate) continue
      if (orderDate < startDate || orderDate > endDate) continue

      for (const item of order.items || []) {
        const row = ranked.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          quantity: 0,
          amount: 0,
        }
        row.quantity += Number(item.quantity || 0)
        row.amount += Number(item.unitPrice || 0) * Number(item.quantity || 0)
        ranked.set(item.productId, row)
      }
    }

    return Array.from(ranked.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, Number(limit) || 5)
      .map((row) => ({
        ...row,
        amount: normalizeMoney(row.amount),
      }))
  },

  getInventory() {
    syncCatalogState()
    return clone(state.inventory)
  },

  updateInventory(productId, payload) {
    syncCatalogState()
    const row = state.inventory.find((item) => item.productId === productId)
    if (!row) throw new Error('Inventario no encontrado para ese producto')

    if (payload.stock != null) row.stock = Math.max(0, Number(payload.stock))
    if (payload.lowStockThreshold != null) row.lowStockThreshold = Math.max(0, Number(payload.lowStockThreshold))

    return clone(row)
  },

  getOpenOrdersBySource(source) {
    return state.orders.filter(
      (order) => order.source === source && order.status !== ORDER_STATUS.CLOSED && order.status !== ORDER_STATUS.CANCELLED,
    )
  },

  getOpenCashAndSummary() {
    const open = this.getOpenCashSession()
    if (!open) return null
    return {
      ...clone(open),
      summary: this.getCashSummaryBySessionId(open.id),
    }
  },

  getIncidents() {
    return clone(state.incidents)
  },
}

db.listUsersAdmin = function listUsersAdmin() {
  ensureBusinessState()
  return clone(state.users.map((user) => sanitizeUser(user)))
}

db.createUserAdmin = function createUserAdmin(payload) {
  ensureBusinessState()
  const username = String(payload?.username || '').trim().toLowerCase()
  const password = String(payload?.password || '').trim()
  const name = String(payload?.name || '').trim()
  const role = String(payload?.role || '').trim().toUpperCase()

  if (!username || username.length < 3) throw new Error('Username invalido')
  if (!password || password.length < 4) throw new Error('Password invalido')
  if (!name) throw new Error('Nombre requerido')
  if (!Object.values(ROLES).includes(role)) throw new Error('Rol invalido')

  const duplicated = state.users.find((user) => String(user.username || '').toLowerCase() === username)
  if (duplicated) throw new Error('Ya existe un usuario con ese username')

  const user = {
    id: randomUUID(),
    username,
    password,
    name,
    role,
    active: payload?.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.users.push(user)
  return sanitizeUser(user)
}

db.updateUserAdmin = function updateUserAdmin(userId, payload) {
  ensureBusinessState()
  const user = state.users.find((item) => item.id === userId)
  if (!user) throw new Error('Usuario no existe')

  if (payload?.username != null) {
    const nextUsername = String(payload.username).trim().toLowerCase()
    if (!nextUsername || nextUsername.length < 3) throw new Error('Username invalido')
    const duplicated = state.users.find((item) => item.id !== user.id && String(item.username || '').toLowerCase() === nextUsername)
    if (duplicated) throw new Error('Ya existe un usuario con ese username')
    user.username = nextUsername
  }

  if (payload?.password != null) {
    const nextPassword = String(payload.password).trim()
    if (!nextPassword || nextPassword.length < 4) throw new Error('Password invalido')
    user.password = nextPassword
  }

  if (payload?.name != null) {
    const nextName = String(payload.name).trim()
    if (!nextName) throw new Error('Nombre invalido')
    user.name = nextName
  }

  if (payload?.role != null) {
    const nextRole = String(payload.role).trim().toUpperCase()
    if (!Object.values(ROLES).includes(nextRole)) throw new Error('Rol invalido')
    user.role = nextRole
  }

  if (payload?.active != null) {
    user.active = Boolean(payload.active)
  }

  user.updatedAt = nowIso()
  return sanitizeUser(user)
}

db.getRestaurantSettings = function getRestaurantSettings() {
  ensureBusinessState()
  return clone(state.restaurant)
}

db.updateRestaurantSettings = function updateRestaurantSettings(payload) {
  ensureBusinessState()

  const next = {
    ...state.restaurant,
    ...(payload || {}),
  }

  next.name = String(next.name || '').trim() || state.restaurant.name
  next.currency = String(next.currency || '').trim().toUpperCase() || 'PEN'
  next.timezone = String(next.timezone || '').trim() || 'America/Lima'
  next.taxId = String(next.taxId || '').trim()
  next.legalName = String(next.legalName || '').trim()
  next.address = String(next.address || '').trim()
  next.phone = String(next.phone || '').trim()
  next.logoUrl = String(next.logoUrl || '').trim()
  next.primaryColor = String(next.primaryColor || '').trim() || '#1b4332'

  state.restaurant = next
  return clone(state.restaurant)
}

db.listCustomers = function listCustomers({ active } = {}) {
  ensureBusinessState()
  let rows = [...state.customers]
  if (typeof active === 'boolean') {
    rows = rows.filter((row) => row.active === active)
  }
  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return clone(rows)
}

db.createCustomer = function createCustomer(payload) {
  ensureBusinessState()
  const name = String(payload?.name || '').trim()
  if (!name) throw new Error('Nombre de cliente requerido')

  const customer = {
    id: randomUUID(),
    name,
    phone: String(payload?.phone || '').trim(),
    email: String(payload?.email || '').trim(),
    document: String(payload?.document || '').trim(),
    notes: String(payload?.notes || '').trim(),
    active: payload?.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.customers.push(customer)
  return clone(customer)
}

db.updateCustomer = function updateCustomer(customerId, payload) {
  ensureBusinessState()
  const customer = state.customers.find((row) => row.id === customerId)
  if (!customer) throw new Error('Cliente no existe')

  if (payload?.name != null) {
    const name = String(payload.name).trim()
    if (!name) throw new Error('Nombre de cliente invalido')
    customer.name = name
  }

  if (payload?.phone != null) customer.phone = String(payload.phone || '').trim()
  if (payload?.email != null) customer.email = String(payload.email || '').trim()
  if (payload?.document != null) customer.document = String(payload.document || '').trim()
  if (payload?.notes != null) customer.notes = String(payload.notes || '').trim()
  if (payload?.active != null) customer.active = Boolean(payload.active)

  customer.updatedAt = nowIso()
  return clone(customer)
}

db.listMenuSections = function listMenuSections({ active } = {}) {
  ensureBusinessState()
  let rows = [...state.menuSections]
  if (typeof active === 'boolean') rows = rows.filter((row) => row.active === active)
  rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || '')))
  return clone(rows)
}

db.createMenuSection = function createMenuSection(payload) {
  ensureBusinessState()
  const name = String(payload?.name || '').trim()
  if (!name) throw new Error('Nombre de seccion requerido')

  const duplicated = state.menuSections.find((row) => String(row.name || '').toLowerCase() === name.toLowerCase())
  if (duplicated) throw new Error('Ya existe una seccion con ese nombre')

  const section = {
    id: randomUUID(),
    name,
    code: String(payload?.code || name).trim().toUpperCase().replace(/\s+/g, '_'),
    description: String(payload?.description || '').trim(),
    sortOrder: Number(payload?.sortOrder) > 0 ? Math.trunc(Number(payload.sortOrder)) : state.menuSections.length + 1,
    active: payload?.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.menuSections.push(section)
  return clone(section)
}

db.updateMenuSection = function updateMenuSection(sectionId, payload) {
  ensureBusinessState()
  const section = state.menuSections.find((row) => row.id === sectionId)
  if (!section) throw new Error('Seccion no existe')

  if (payload?.name != null) {
    const nextName = String(payload.name).trim()
    if (!nextName) throw new Error('Nombre invalido')
    const duplicated = state.menuSections.find((row) => row.id !== section.id && String(row.name || '').toLowerCase() === nextName.toLowerCase())
    if (duplicated) throw new Error('Ya existe una seccion con ese nombre')
    section.name = nextName
  }

  if (payload?.code != null) section.code = String(payload.code || '').trim().toUpperCase().replace(/\s+/g, '_')
  if (payload?.description != null) section.description = String(payload.description || '').trim()
  if (payload?.sortOrder != null) section.sortOrder = Math.max(1, Math.trunc(Number(payload.sortOrder) || 1))
  if (payload?.active != null) section.active = Boolean(payload.active)

  section.updatedAt = nowIso()
  return clone(section)
}

db.listMenuCategories = function listMenuCategories({ sectionId, active } = {}) {
  ensureBusinessState()
  let rows = [...state.menuCategories]
  if (sectionId) rows = rows.filter((row) => row.sectionId === sectionId)
  if (typeof active === 'boolean') rows = rows.filter((row) => row.active === active)
  rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || '')))
  return clone(rows)
}

db.createMenuCategory = function createMenuCategory(payload) {
  ensureBusinessState()
  const name = String(payload?.name || '').trim()
  const sectionId = String(payload?.sectionId || '').trim()
  if (!name) throw new Error('Nombre de categoria requerido')
  if (!sectionId) throw new Error('Seccion requerida')

  const section = state.menuSections.find((row) => row.id === sectionId)
  if (!section) throw new Error('Seccion no existe')

  const duplicated = state.menuCategories.find(
    (row) => row.sectionId === sectionId && String(row.name || '').toLowerCase() === name.toLowerCase(),
  )
  if (duplicated) throw new Error('Ya existe una categoria con ese nombre en la seccion')

  const category = {
    id: randomUUID(),
    sectionId,
    name,
    description: String(payload?.description || '').trim(),
    sortOrder: Number(payload?.sortOrder) > 0 ? Math.trunc(Number(payload.sortOrder)) : state.menuCategories.length + 1,
    active: payload?.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.menuCategories.push(category)
  return clone(category)
}

db.updateMenuCategory = function updateMenuCategory(categoryId, payload) {
  ensureBusinessState()
  const category = state.menuCategories.find((row) => row.id === categoryId)
  if (!category) throw new Error('Categoria no existe')

  if (payload?.sectionId != null) {
    const sectionId = String(payload.sectionId || '').trim()
    if (!sectionId) throw new Error('Seccion invalida')
    const section = state.menuSections.find((row) => row.id === sectionId)
    if (!section) throw new Error('Seccion no existe')
    category.sectionId = sectionId
  }

  if (payload?.name != null) {
    const name = String(payload.name || '').trim()
    if (!name) throw new Error('Nombre invalido')
    const duplicated = state.menuCategories.find(
      (row) => row.id !== category.id && row.sectionId === category.sectionId && String(row.name || '').toLowerCase() === name.toLowerCase(),
    )
    if (duplicated) throw new Error('Ya existe una categoria con ese nombre en la seccion')
    category.name = name
  }

  if (payload?.description != null) category.description = String(payload.description || '').trim()
  if (payload?.sortOrder != null) category.sortOrder = Math.max(1, Math.trunc(Number(payload.sortOrder) || 1))
  if (payload?.active != null) category.active = Boolean(payload.active)

  category.updatedAt = nowIso()
  return clone(category)
}

db.listMenuProducts = function listMenuProducts({ sectionId, categoryId, active, status, isPublic } = {}) {
  ensureBusinessState()
  let rows = [...state.menuProducts]
  if (sectionId) rows = rows.filter((row) => row.sectionId === sectionId)
  if (categoryId) rows = rows.filter((row) => row.categoryId === categoryId)
  if (typeof active === 'boolean') rows = rows.filter((row) => row.isActive === active)
  if (status) rows = rows.filter((row) => row.status === status)
  if (typeof isPublic === 'boolean') rows = rows.filter((row) => row.isPublic === isPublic)

  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

  return clone(rows.map((product) => ({
    ...product,
    sectionName: state.menuSections.find((row) => row.id === product.sectionId)?.name || '-',
    categoryName: state.menuCategories.find((row) => row.id === product.categoryId)?.name || '-',
  })))
}

db.createMenuProduct = function createMenuProduct(payload) {
  ensureBusinessState()
  const name = String(payload?.name || '').trim()
  const sectionId = String(payload?.sectionId || '').trim()
  const categoryId = String(payload?.categoryId || '').trim()

  if (!name) throw new Error('Nombre de producto requerido')
  if (!sectionId) throw new Error('Seccion requerida')
  if (!categoryId) throw new Error('Categoria requerida')

  const section = state.menuSections.find((row) => row.id === sectionId)
  if (!section) throw new Error('Seccion no existe')
  const category = state.menuCategories.find((row) => row.id === categoryId)
  if (!category) throw new Error('Categoria no existe')
  if (category.sectionId !== sectionId) throw new Error('La categoria no pertenece a la seccion seleccionada')

  const duplicated = state.menuProducts.find((row) => String(row.name || '').toLowerCase() === name.toLowerCase())
  if (duplicated) throw new Error('Ya existe un producto con ese nombre')

  const product = {
    id: randomUUID(),
    sectionId,
    categoryId,
    name,
    productionAreaId: String(payload?.productionAreaId || '').trim() || 'COCINA',
    price: normalizeMoney(payload?.price),
    unitCost: normalizeMoney(payload?.unitCost),
    iva: normalizeMoney(payload?.iva),
    quantity: Math.max(0, Math.trunc(Number(payload?.quantity) || 0)),
    status: String(payload?.status || 'AVAILABLE').trim().toUpperCase(),
    isActive: payload?.isActive !== false,
    isPublic: payload?.isPublic !== false,
    imageUrl: String(payload?.imageUrl || '').trim(),
    options: asArray(payload?.options)
      .map((option, index) => ({
        id: String(option?.id || ('opt-' + (index + 1))),
        name: String(option?.name || '').trim(),
        extraPrice: normalizeMoney(option?.extraPrice),
      }))
      .filter((option) => option.name),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.menuProducts.push(product)
  upsertCatalogFromMenuProduct(product)

  return clone(product)
}

db.updateMenuProduct = function updateMenuProduct(productId, payload) {
  ensureBusinessState()
  const product = state.menuProducts.find((row) => row.id === productId)
  if (!product) throw new Error('Producto no existe')

  const merged = { ...product, ...(payload || {}) }

  merged.name = String(merged.name || '').trim()
  if (!merged.name) throw new Error('Nombre de producto requerido')

  const sectionId = String(merged.sectionId || '').trim()
  const categoryId = String(merged.categoryId || '').trim()

  const section = state.menuSections.find((row) => row.id === sectionId)
  if (!section) throw new Error('Seccion no existe')

  const category = state.menuCategories.find((row) => row.id === categoryId)
  if (!category) throw new Error('Categoria no existe')
  if (category.sectionId !== sectionId) throw new Error('La categoria no pertenece a la seccion seleccionada')

  const duplicated = state.menuProducts.find(
    (row) => row.id !== product.id && String(row.name || '').toLowerCase() === merged.name.toLowerCase(),
  )
  if (duplicated) throw new Error('Ya existe un producto con ese nombre')

  Object.assign(product, {
    sectionId,
    categoryId,
    name: merged.name,
    productionAreaId: String(merged.productionAreaId || '').trim() || 'COCINA',
    price: normalizeMoney(merged.price),
    unitCost: normalizeMoney(merged.unitCost),
    iva: normalizeMoney(merged.iva),
    quantity: Math.max(0, Math.trunc(Number(merged.quantity) || 0)),
    status: String(merged.status || 'AVAILABLE').trim().toUpperCase(),
    isActive: merged.isActive !== false,
    isPublic: merged.isPublic !== false,
    imageUrl: String(merged.imageUrl || '').trim(),
    options: asArray(merged.options)
      .map((option, index) => ({
        id: String(option?.id || ('opt-' + (index + 1))),
        name: String(option?.name || '').trim(),
        extraPrice: normalizeMoney(option?.extraPrice),
      }))
      .filter((option) => option.name),
    updatedAt: nowIso(),
  })

  upsertCatalogFromMenuProduct(product)
  return clone(product)
}

db.generateBills = function generateBills({ tableSessionId, tableId } = {}) {
  ensureBusinessState()

  const billedKeys = collectExistingBillLineKeys()
  const grouped = new Map()

  for (const order of state.orders) {
    if (!isOrderBillable(order)) continue
    if (tableSessionId && order.tableSessionId !== tableSessionId) continue
    if (tableId && order.tableId !== tableId) continue

    for (const item of asArray(order.items)) {
      const lineKey = billLineKey(order.id, item.id)
      if (billedKeys.has(lineKey)) continue

      const guestNumber = Number(item.guestNumber) > 0 ? Number(item.guestNumber) : 0
      const groupKey = String(order.tableSessionId) + ':' + String(guestNumber)

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          tableId: order.tableId,
          tableSessionId: order.tableSessionId,
          guestNumber,
          lines: [],
          orderIds: new Set(),
        })
      }

      const group = grouped.get(groupKey)
      group.orderIds.add(order.id)
      group.lines.push({
        id: randomUUID(),
        orderId: order.id,
        orderItemId: item.id,
        productName: item.productName,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        variant: item.variant || 'normal',
        notes: item.notes || '',
        extras: asArray(item.extras).map((extra) => ({
          name: extra.name,
          quantity: Number(extra.quantity || 0),
          unitPrice: Number(extra.unitPrice || 0),
        })),
        total: moneyLineTotal(item),
        createdAt: nowIso(),
      })
    }
  }

  const touched = []

  for (const group of grouped.values()) {
    if (!group.lines.length) continue

    const target = state.bills.find(
      (bill) =>
        bill.tableSessionId === group.tableSessionId &&
        bill.guestNumber === group.guestNumber &&
        (bill.status === BILL_STATUS.OPEN || bill.status === BILL_STATUS.PARTIALLY_PAID),
    )

    if (target) {
      target.lines.push(...group.lines)
      target.orderIds = Array.from(new Set([...(target.orderIds || []), ...Array.from(group.orderIds)]))
      target.updatedAt = nowIso()
      computeBillTotals(target)
      touched.push(clone(target))
      continue
    }

    const bill = {
      id: randomUUID(),
      tableId: group.tableId,
      tableSessionId: group.tableSessionId,
      guestNumber: group.guestNumber,
      label: billLabelForGuest(group.guestNumber),
      status: BILL_STATUS.OPEN,
      lines: group.lines,
      orderIds: Array.from(group.orderIds),
      payments: [],
      total: 0,
      paidAmount: 0,
      dueAmount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      cancelledAt: null,
    }

    computeBillTotals(bill)
    state.bills.push(bill)
    touched.push(clone(bill))
  }

  return clone(touched)
}

db.listBills = function listBills({ status, tableId, tableSessionId } = {}) {
  ensureBusinessState()
  let rows = [...state.bills]

  if (status) rows = rows.filter((bill) => bill.status === status)
  if (tableId) rows = rows.filter((bill) => bill.tableId === tableId)
  if (tableSessionId) rows = rows.filter((bill) => bill.tableSessionId === tableSessionId)

  rows.forEach((bill) => computeBillTotals(bill))

  rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return clone(rows.map((bill) => ({
    ...bill,
    table: state.tables.find((table) => table.id === bill.tableId) || null,
  })))
}

db.getBillById = function getBillById(billId) {
  ensureBusinessState()
  const bill = state.bills.find((row) => row.id === billId)
  if (!bill) return null
  computeBillTotals(bill)
  return clone(bill)
}

db.payBill = function payBill(billId, payload, receivedByUserId) {
  ensureBusinessState()
  const bill = state.bills.find((row) => row.id === billId)
  if (!bill) throw new Error('Cuenta no existe')

  if (bill.status === BILL_STATUS.CANCELLED || bill.status === BILL_STATUS.PAID) {
    throw new Error('La cuenta ya fue cerrada')
  }

  const payments = asArray(payload?.payments)
  if (!payments.length) throw new Error('Debe enviar al menos un pago')

  const cashSession = db.getOpenCashSession()
  if (!cashSession) throw new Error('Debe abrir caja antes de cobrar')

  for (const payment of payments) {
    const method = String(payment?.method || '').trim().toUpperCase()
    const amount = Number(payment?.amount)
    if (!Object.values(PAYMENT_METHOD).includes(method)) throw new Error('Metodo de pago invalido')
    if (!(amount > 0)) throw new Error('Monto de pago invalido')

    bill.payments.push({
      id: randomUUID(),
      method,
      amount: normalizeMoney(amount),
      splitMode: payload?.splitMode || SPLIT_MODE.TABLE_TOTAL,
      createdAt: nowIso(),
      receivedByUserId,
    })

    state.cashTransactions.push({
      id: randomUUID(),
      cashSessionId: cashSession.id,
      billId: bill.id,
      method,
      amount: normalizeMoney(amount),
      type: 'BILL_PAYMENT',
      note: 'Cobro de cuenta ' + String(bill.id).slice(0, 8),
      createdByUserId: receivedByUserId,
      createdAt: nowIso(),
    })
  }

  bill.updatedAt = nowIso()
  computeBillTotals(bill)

  if (bill.status === BILL_STATUS.PAID) {
    syncOrdersAfterBills(bill.tableSessionId)
  }

  return {
    bill: clone(bill),
    cashSession: clone(cashSession),
  }
}

db.getCurrentCashRegister = function getCurrentCashRegister() {
  ensureBusinessState()
  return db.getOpenCashAndSummary()
}

db.openCashRegister = function openCashRegister(openingAmount, openedByUserId) {
  ensureBusinessState()
  return db.openCashSession(openingAmount, openedByUserId)
}

db.closeCashRegister = function closeCashRegister(closedByUserId, countedCashAmount) {
  ensureBusinessState()
  const cash = db.closeCashSession(closedByUserId, countedCashAmount)
  const summary = db.getCashSummaryBySessionId(cash.id)

  const discrepancy = normalizeMoney((Number(cash.openingAmount || 0) + Number(summary.cashTotal || 0)) - Number(cash.countedCashAmount || 0))

  const closure = {
    id: randomUUID(),
    cashSessionId: cash.id,
    date: cash.date,
    summary,
    discrepancy,
    pendingTransfer: {
      cashAmount: normalizeMoney(summary.cashTotal),
      digitalAmount: normalizeMoney(summary.transferTotal),
      status: 'PENDING',
    },
    createdAt: nowIso(),
  }

  state.cashClosures.push(closure)

  return {
    cash: clone(cash),
    summary: clone(summary),
    closure: clone(closure),
  }
}

db.listCashRegisterTransactions = function listCashRegisterTransactions({ cashSessionId } = {}) {
  ensureBusinessState()
  let rows = [...state.cashTransactions]
  if (cashSessionId) rows = rows.filter((row) => row.cashSessionId === cashSessionId)
  rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return clone(rows)
}

db.listFinanceAccounts = function listFinanceAccounts({ active } = {}) {
  ensureBusinessState()
  let rows = [...state.financeAccounts]
  if (typeof active === 'boolean') rows = rows.filter((row) => row.active === active)
  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return clone(rows)
}

db.createFinanceAccount = function createFinanceAccount(payload) {
  ensureBusinessState()
  const name = String(payload?.name || '').trim()
  const type = String(payload?.type || '').trim().toUpperCase()

  if (!name) throw new Error('Nombre de cuenta requerido')
  if (!Object.values(FINANCE_ACCOUNT_TYPE).includes(type)) throw new Error('Tipo de cuenta invalido')

  const duplicated = state.financeAccounts.find((row) => String(row.name || '').toLowerCase() === name.toLowerCase())
  if (duplicated) throw new Error('Ya existe una cuenta con ese nombre')

  const account = {
    id: randomUUID(),
    name,
    type,
    balance: normalizeMoney(payload?.balance),
    active: payload?.active !== false,
    description: String(payload?.description || '').trim(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  state.financeAccounts.push(account)
  return clone(account)
}

db.updateFinanceAccount = function updateFinanceAccount(accountId, payload) {
  ensureBusinessState()
  const account = state.financeAccounts.find((row) => row.id === accountId)
  if (!account) throw new Error('Cuenta financiera no existe')

  if (payload?.name != null) {
    const name = String(payload.name || '').trim()
    if (!name) throw new Error('Nombre de cuenta invalido')
    const duplicated = state.financeAccounts.find((row) => row.id !== account.id && String(row.name || '').toLowerCase() === name.toLowerCase())
    if (duplicated) throw new Error('Ya existe una cuenta con ese nombre')
    account.name = name
  }

  if (payload?.type != null) {
    const type = String(payload.type || '').trim().toUpperCase()
    if (!Object.values(FINANCE_ACCOUNT_TYPE).includes(type)) throw new Error('Tipo de cuenta invalido')
    account.type = type
  }

  if (payload?.balance != null) account.balance = normalizeMoney(payload.balance)
  if (payload?.description != null) account.description = String(payload.description || '').trim()
  if (payload?.active != null) account.active = Boolean(payload.active)

  account.updatedAt = nowIso()
  return clone(account)
}

db.listFinanceTransactions = function listFinanceTransactions({ from, to, accountId, type } = {}) {
  ensureBusinessState()
  let rows = [...state.financeTransactions]

  if (from) rows = rows.filter((row) => String(row.createdAt || '').slice(0, 10) >= from)
  if (to) rows = rows.filter((row) => String(row.createdAt || '').slice(0, 10) <= to)
  if (type) rows = rows.filter((row) => row.type === type)
  if (accountId) {
    rows = rows.filter(
      (row) => row.accountId === accountId || row.fromAccountId === accountId || row.toAccountId === accountId,
    )
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return clone(rows)
}

db.createFinanceTransaction = function createFinanceTransaction(payload, createdByUserId) {
  ensureBusinessState()

  const type = String(payload?.type || '').trim().toUpperCase()
  const amount = normalizeMoney(payload?.amount)
  if (!Object.values(FINANCE_TRANSACTION_TYPE).includes(type)) throw new Error('Tipo de transaccion invalido')
  if (!(amount > 0)) throw new Error('Monto invalido')

  const transaction = {
    id: randomUUID(),
    type,
    amount,
    accountId: null,
    fromAccountId: null,
    toAccountId: null,
    note: String(payload?.note || '').trim(),
    reference: String(payload?.reference || '').trim(),
    source: String(payload?.source || 'MANUAL').trim().toUpperCase(),
    createdByUserId,
    createdAt: nowIso(),
  }

  if (type === FINANCE_TRANSACTION_TYPE.INCOME) {
    const accountId = String(payload?.accountId || '').trim()
    const account = state.financeAccounts.find((row) => row.id === accountId && row.active)
    if (!account) throw new Error('Cuenta financiera invalida')
    account.balance = normalizeMoney(account.balance + amount)
    account.updatedAt = nowIso()
    transaction.accountId = account.id
  } else if (type === FINANCE_TRANSACTION_TYPE.EXPENSE) {
    const accountId = String(payload?.accountId || '').trim()
    const account = state.financeAccounts.find((row) => row.id === accountId && row.active)
    if (!account) throw new Error('Cuenta financiera invalida')
    if (account.balance + 0.0001 < amount) throw new Error('Saldo insuficiente en la cuenta')
    account.balance = normalizeMoney(account.balance - amount)
    account.updatedAt = nowIso()
    transaction.accountId = account.id
  } else {
    const fromAccountId = String(payload?.fromAccountId || '').trim()
    const toAccountId = String(payload?.toAccountId || '').trim()
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      throw new Error('Transferencia invalida entre cuentas')
    }

    const fromAccount = state.financeAccounts.find((row) => row.id === fromAccountId && row.active)
    const toAccount = state.financeAccounts.find((row) => row.id === toAccountId && row.active)

    if (!fromAccount || !toAccount) throw new Error('Cuenta financiera invalida')
    if (fromAccount.balance + 0.0001 < amount) throw new Error('Saldo insuficiente en cuenta origen')

    fromAccount.balance = normalizeMoney(fromAccount.balance - amount)
    toAccount.balance = normalizeMoney(toAccount.balance + amount)
    fromAccount.updatedAt = nowIso()
    toAccount.updatedAt = nowIso()

    transaction.fromAccountId = fromAccount.id
    transaction.toAccountId = toAccount.id
  }

  state.financeTransactions.push(transaction)
  return clone(transaction)
}

const mutatingMethods = new Set([
  'login',
  'createSalon',
  'createCatalogCategory',
  'createCatalogItem',
  'updateCatalogItem',
  'updateSalon',
  'createTable',
  'createTablesBulk',
  'updateTableRecord',
  'ensureTableQrToken',
  'generatePendingTableQrs',
  'markTableQrsPrinted',
  'openTableSession',
  'updateTableSessionGuests',
  'openCashSession',
  'closeCashSession',
  'updateOrderRecord',
  'deleteOrderRecord',
  'createOrder',
  'addItemsToOrder',
  'approveQrOrder',
  'sendOrderToKitchen',
  'updateKitchenTicketStatus',
  'registerPayment',
  'createPrinterJob',
  'markPrinterJobProcessing',
  'markPrinterJobDone',
  'markPrinterJobFailed',
  'updateInventory',
  'createUserAdmin',
  'updateUserAdmin',
  'updateRestaurantSettings',
  'createCustomer',
  'updateCustomer',
  'createMenuSection',
  'updateMenuSection',
  'createMenuCategory',
  'updateMenuCategory',
  'createMenuProduct',
  'updateMenuProduct',
  'generateBills',
  'payBill',
  'openCashRegister',
  'closeCashRegister',
  'createFinanceAccount',
  'updateFinanceAccount',
  'createFinanceTransaction',
])

for (const methodName of mutatingMethods) {
  const originalMethod = db[methodName]
  if (typeof originalMethod !== 'function') continue

  db[methodName] = function wrappedMutatingMethod(...args) {
    const result = originalMethod.apply(this, args)
    enqueuePersist()
    return result
  }
}

db.init = async function init() {
  if (initialized) return
  initialized = true

  ensureBusinessState()

  const backend = getDataBackend()
  if (backend !== 'prisma') {
    console.log('[state] usando almacenamiento en memoria')
    return
  }

  await initStatePersistence()
  const snapshot = await loadStateSnapshot()
  if (snapshot) {
    state = hydrateFromSnapshot(snapshot)
    ensureBusinessState()
    console.log('[state] snapshot cargado desde Prisma')
  } else {
    await saveStateSnapshot(buildSnapshot())
    console.log('[state] snapshot inicial guardado en Prisma')
  }
}

db.flush = async function flush() {
  await flushPersist()
}

db.shutdown = async function shutdown() {
  await flushPersist()
  await closeStatePersistence()
}


