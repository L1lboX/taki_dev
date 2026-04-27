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
  TABLE_GUEST_SOURCE,
  TABLE_GUEST_STATUS,
  TABLE_STATUS,
} from './constants.js'
import {
  CATALOG_CATEGORIES,
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

function normalizeLookupText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function includesSomeLookup(text, needles) {
  const normalized = normalizeLookupText(text)
  return needles.some((needle) => normalized.includes(normalizeLookupText(needle)))
}

function deriveMenuCatalogCategory(sectionName, categoryName) {
  if (
    includesSomeLookup(sectionName, ['entrada']) ||
    includesSomeLookup(categoryName, ['entrada', 'sopa', 'ensalada', 'causa'])
  ) {
    return CATALOG_CATEGORIES.ENTRADAS
  }

  if (includesSomeLookup(sectionName, ['bebida', 'bar']) || includesSomeLookup(categoryName, ['bebida', 'gaseosa', 'jugo'])) {
    return CATALOG_CATEGORIES.BEBIDAS
  }

  if (includesSomeLookup(sectionName, ['menu']) || includesSomeLookup(categoryName, ['menu'])) {
    return CATALOG_CATEGORIES.MENU
  }

  if (includesSomeLookup(sectionName, ['ceviche', 'marino']) || includesSomeLookup(categoryName, ['ceviche', 'marino', 'marisco'])) {
    return CATALOG_CATEGORIES.CEVICHES
  }

  if (includesSomeLookup(sectionName, ['carta']) || includesSomeLookup(categoryName, ['carta'])) {
    return CATALOG_CATEGORIES.A_LA_CARTA
  }

  return CATALOG_CATEGORIES.PRINCIPALES
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
    tableGuestSessions: [],
    tableGroups: [],
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
      qrBlocked: table?.qrBlocked === true,
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
    tableGuestSessions: state.tableGuestSessions,
    tableGroups: state.tableGroups,
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
    tableGuestSessions: clone(asArray(snapshot.tableGuestSessions)),
    tableGroups: clone(asArray(snapshot.tableGroups)),
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
    restaurant: normalizeRestaurantSettings(snapshot.restaurant),
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
    photoUrl: String(user.photoUrl || '').trim(),
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

function deriveGroupedCapacity(tableCount, fallbackCapacity = 4) {
  const count = Number(tableCount) || 1
  if (count <= 1) return Number(fallbackCapacity) || 4
  if (count === 2) return 6
  if (count === 3) return 10
  return Math.max(Number(fallbackCapacity) || 4, count * 4)
}

function getOpenTableSessionByIdRaw(sessionId) {
  return state.tableSessions.find((session) => session.id === sessionId && session.closedAt == null) || null
}

function getActiveTableGroupByTableIdRaw(tableId) {
  return (state.tableGroups || []).find((group) => group.active !== false && Array.isArray(group.tableIds) && group.tableIds.includes(tableId)) || null
}

function getGroupedTablesRaw(group) {
  if (!group || !Array.isArray(group.tableIds)) return []
  return group.tableIds
    .map((tableId) => state.tables.find((table) => table.id === tableId))
    .filter(Boolean)
}

function getOperationalContextByTableIdRaw(tableId) {
  const requestedTable = state.tables.find((table) => table.id === tableId) || null
  const group = getActiveTableGroupByTableIdRaw(tableId)
  const operationalTable = group
    ? state.tables.find((table) => table.id === group.mainTableId) || requestedTable
    : requestedTable

  return {
    requestedTable,
    group,
    operationalTable,
  }
}

function getActiveGuestSessionsByTableSessionIdRaw(tableSessionId) {
  return (state.tableGuestSessions || []).filter(
    (guestSession) => guestSession.tableSessionId === tableSessionId && guestSession.status === TABLE_GUEST_STATUS.ACTIVE && guestSession.closedAt == null,
  )
}

function getActiveQrGuestSessionsByTableSessionIdRaw(tableSessionId) {
  return getActiveGuestSessionsByTableSessionIdRaw(tableSessionId).filter(
    (guestSession) => guestSession.source === TABLE_GUEST_SOURCE.QR,
  )
}

function getManualReservedGuestCountRaw(session) {
  if (!session) return 0
  const activeQrGuests = getActiveQrGuestSessionsByTableSessionIdRaw(session.id)
  return Math.max(0, Number(session.guestsActive || 0) - activeQrGuests.length)
}

function findNextQrGuestNumber(session) {
  if (!session) return 1

  const qrGuests = getActiveQrGuestSessionsByTableSessionIdRaw(session.id)
  const used = new Set(qrGuests.map((guestSession) => Number(guestSession.guestNumber || 0)).filter((value) => value > 0))
  const manualReserved = getManualReservedGuestCountRaw(session)

  for (let guestNumber = manualReserved + 1; guestNumber <= 99; guestNumber += 1) {
    if (!used.has(guestNumber)) return guestNumber
  }

  return Math.max(manualReserved, ...Array.from(used.values(), (value) => Number(value) || 0)) + 1
}

function getEffectiveCapacityForTableRaw(table) {
  if (!table) return 0
  const group = getActiveTableGroupByTableIdRaw(table.id)
  if (!group) return Number(table.capacity || 0)
  return Number(group.effectiveCapacity || deriveGroupedCapacity(group.tableIds?.length, table.capacity))
}

function getActiveSessionByTableRecordRaw(table) {
  if (!table) return null
  const group = getActiveTableGroupByTableIdRaw(table.id)
  if (group?.activeTableSessionId) {
    return getOpenTableSessionByIdRaw(group.activeTableSessionId)
  }
  if (!table.activeSessionId) return null
  return getOpenTableSessionByIdRaw(table.activeSessionId)
}

function mapTableGroupMeta(group) {
  if (!group) return null
  const groupedTables = getGroupedTablesRaw(group)

  return {
    id: group.id,
    mainTableId: group.mainTableId,
    tableIds: [...group.tableIds],
    active: group.active !== false,
    effectiveCapacity: Number(group.effectiveCapacity || deriveGroupedCapacity(group.tableIds?.length, groupedTables[0]?.capacity)),
    activeTableSessionId: group.activeTableSessionId || null,
    tables: groupedTables.map((table) => ({
      id: table.id,
      number: table.number,
      salonId: table.salonId,
    })),
  }
}

function tablePublicMeta(table) {
  const salon = state.salons.find((row) => row.id === table.salonId) || null
  const group = getActiveTableGroupByTableIdRaw(table.id)
  const activeSession = getActiveSessionByTableRecordRaw(table)
  return {
    ...clone(table),
    salon,
    status: activeSession ? TABLE_STATUS.OCCUPIED : table.status,
    activeSessionId: activeSession?.id || null,
    activeSession,
    effectiveCapacity: getEffectiveCapacityForTableRaw(table),
    operationalTableId: group?.mainTableId || table.id,
    isGroupMain: !group || group.mainTableId === table.id,
    tableGroup: mapTableGroupMeta(group),
  }
}

function normalizeMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Number(amount.toFixed(2))
}

function defaultRestaurantPrinterSettings() {
  return {
    kitchenEnabled: true,
    autoPrintOnSend: true,
    connectionType: 'USB',
    printerName: '',
    host: '',
    port: '9100',
    paperWidth: '80mm',
    fallbackToPdf: false,
  }
}

function normalizeRestaurantPrinterSettings(rawValue) {
  const defaults = defaultRestaurantPrinterSettings()
  const raw = rawValue && typeof rawValue === 'object' ? rawValue : {}
  const next = {
    ...defaults,
    ...raw,
  }

  const rawConnectionType = String(next.connectionType || defaults.connectionType).trim().toUpperCase()
  const connectionType = rawConnectionType === 'LOCAL' || rawConnectionType === 'SYSTEM'
    ? 'USB'
    : rawConnectionType === 'NETWORK'
      ? 'LAN'
      : rawConnectionType
  const paperWidth = String(next.paperWidth || defaults.paperWidth).trim().toLowerCase()

  next.kitchenEnabled = next.kitchenEnabled !== false
  next.autoPrintOnSend = next.autoPrintOnSend !== false
  next.connectionType = ['USB', 'LAN'].includes(connectionType) ? connectionType : defaults.connectionType
  next.printerName = String(next.printerName || '').trim()
  next.host = String(next.host || '').trim()
  next.port = String(next.port || defaults.port).trim() || defaults.port
  next.paperWidth = ['58mm', '80mm'].includes(paperWidth) ? paperWidth : defaults.paperWidth
  next.fallbackToPdf = Boolean(next.fallbackToPdf)

  return next
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
    profileEmail: '',
    profileWebsite: '',
    profileDescription: '',
    printers: defaultRestaurantPrinterSettings(),
  }
}

function normalizeRestaurantSettings(rawValue) {
  const defaults = defaultRestaurantSettings()
  const raw = rawValue && typeof rawValue === 'object' ? rawValue : {}

  return {
    ...defaults,
    ...raw,
    name: String(raw.name || defaults.name).trim() || defaults.name,
    legalName: String(raw.legalName || '').trim(),
    taxId: String(raw.taxId || '').trim(),
    currency: String(raw.currency || defaults.currency).trim().toUpperCase() || defaults.currency,
    timezone: String(raw.timezone || defaults.timezone).trim() || defaults.timezone,
    address: String(raw.address || '').trim(),
    phone: String(raw.phone || '').trim(),
    logoUrl: String(raw.logoUrl || '').trim(),
    primaryColor: String(raw.primaryColor || defaults.primaryColor).trim() || defaults.primaryColor,
    profileEmail: String(raw.profileEmail || '').trim(),
    profileWebsite: String(raw.profileWebsite || '').trim(),
    profileDescription: String(raw.profileDescription || '').trim(),
    printers: normalizeRestaurantPrinterSettings(raw.printers),
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
  if (!Array.isArray(state.tableGuestSessions)) state.tableGuestSessions = []
  if (!Array.isArray(state.tableGroups)) state.tableGroups = []
  if (!Array.isArray(state.bills)) state.bills = []
  if (!Array.isArray(state.cashTransactions)) state.cashTransactions = []
  if (!Array.isArray(state.financeAccounts)) state.financeAccounts = defaultFinanceAccounts()
  if (!Array.isArray(state.financeTransactions)) state.financeTransactions = []
  if (!Array.isArray(state.cashClosures)) state.cashClosures = []
  state.restaurant = normalizeRestaurantSettings(state.restaurant)

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

function releaseTableSessionResources(session) {
  if (!session) return

  const table = state.tables.find((item) => item.id === session.tableId)
  if (table) {
    table.activeSessionId = null
    table.status = TABLE_STATUS.FREE
  }

  const group = getActiveTableGroupByTableIdRaw(session.tableId)
  if (group && group.activeTableSessionId === session.id) {
    group.activeTableSessionId = null
    group.updatedAt = nowIso()
    for (const groupedTable of getGroupedTablesRaw(group)) {
      groupedTable.status = TABLE_STATUS.FREE
      if (groupedTable.id === group.mainTableId) {
        groupedTable.activeSessionId = null
      }
    }
  }
}

function syncGuestSessionsAfterBills(tableSessionId) {
  if (!tableSessionId) return

  const session = asArray(state.tableSessions).find((item) => item.id === tableSessionId)
  if (!session) return

  const guestSessions = getActiveQrGuestSessionsByTableSessionIdRaw(tableSessionId)

  for (const guestSession of guestSessions) {
    const relatedBills = asArray(state.bills).filter(
      (bill) =>
        bill.tableSessionId === tableSessionId &&
        (bill.guestSessionId === guestSession.id || (!bill.guestSessionId && bill.guestNumber === guestSession.guestNumber)),
    )

    const hasOpenBill = relatedBills.some(
      (bill) => bill.status === BILL_STATUS.OPEN || bill.status === BILL_STATUS.PARTIALLY_PAID,
    )
    const hasAnyBill = relatedBills.length > 0

    if (hasAnyBill && !hasOpenBill) {
      for (const order of asArray(state.orders)) {
        if (order.guestSessionId === guestSession.id && order.status === ORDER_STATUS.DELIVERED) {
          order.status = ORDER_STATUS.CLOSED
          order.closedAt = order.closedAt || nowIso()
        }
      }
    }

    const hasOpenQrOrders = asArray(state.orders).some(
      (order) =>
        order.guestSessionId === guestSession.id &&
        order.status !== ORDER_STATUS.CLOSED &&
        order.status !== ORDER_STATUS.CANCELLED,
    )

    if (!hasOpenBill && !hasOpenQrOrders) {
      guestSession.status = TABLE_GUEST_STATUS.CLOSED
      guestSession.closedAt = guestSession.closedAt || nowIso()
      session.guestsActive = Math.max(0, Number(session.guestsActive || 0) - 1)
    }
  }
}

function syncOrdersAfterBills(tableSessionId) {
  if (!tableSessionId) return

  syncGuestSessionsAfterBills(tableSessionId)

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
    for (const guestSession of getActiveGuestSessionsByTableSessionIdRaw(tableSessionId)) {
      guestSession.status = TABLE_GUEST_STATUS.CLOSED
      guestSession.closedAt = guestSession.closedAt || nowIso()
    }
    releaseTableSessionResources(session)
  }
}

function mapMenuProductToCatalogItem(product) {
  const section = state.menuSections.find((item) => item.id === product.sectionId)
  const category = state.menuCategories.find((item) => item.id === product.categoryId)
  const sectionName = section?.name || 'Carta completa'
  const categoryName = category?.name || 'General'
  const catalogCategory = deriveMenuCatalogCategory(sectionName, categoryName)
  const flags = deriveCatalogFlags(catalogCategory)

  return {
    id: product.id,
    name: product.name,
    sectionId: product.sectionId,
    sectionName,
    category: catalogCategory,
    categoryName,
    type: flags.type,
    basePrice: normalizeMoney(product.price),
    isMenu: flags.isMenu,
    variants: asArray(product.options).map((option) => option.name).filter(Boolean),
    imageUrl: product.imageUrl || '',
    isPublic: product.isPublic !== false,
    active: product.isActive && product.status === 'AVAILABLE' && Number(product.quantity) > 0,
    days: [],
  }
}

function enrichCatalogItemWithMenuMeta(item) {
  const product = state.menuProducts.find((candidate) => candidate.id === item.id)
  if (!product) return item

  const section = state.menuSections.find((candidate) => candidate.id === product.sectionId)
  const category = state.menuCategories.find((candidate) => candidate.id === product.categoryId)
  const sectionName = section?.name || item.sectionName || 'Carta completa'
  const categoryName = category?.name || item.categoryName || 'General'
  const catalogCategory = deriveMenuCatalogCategory(sectionName, categoryName)
  const flags = deriveCatalogFlags(catalogCategory)

  return {
    ...item,
    sectionId: product.sectionId,
    sectionName,
    category: catalogCategory,
    categoryName,
    type: flags.type,
    isMenu: flags.isMenu,
    isPublic: product.isPublic !== false,
    active: product.isActive && product.status === 'AVAILABLE' && Number(product.quantity) > 0,
    isFeatured: product.isFeatured === true,
  }
}

function ensureFeaturedMenuProductAvailable(productId) {
  const featuredProduct = state.menuProducts.find((row) => row.id !== productId && row.isFeatured === true)
  if (featuredProduct) {
    throw new Error(`No se puede destacar este plato porque "${featuredProduct.name}" ya esta destacado. Desactivalo primero.`)
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

function removeCatalogFromMenuProduct(productId) {
  state.catalog = state.catalog.filter((item) => item.id !== productId)
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
    return clone(
      state.catalog
        .filter((item) => isCatalogAvailableOnDate(item, selectedDate))
        .map((item) => enrichCatalogItemWithMenuMeta(item)),
    )
  },

  getPublicCatalogMenus(date) {
    syncCatalogState()
    const selectedDate = date || dateOnly()
    return clone(
      state.catalog
        .map((item) => enrichCatalogItemWithMenuMeta(item))
        .filter((item) => item.isPublic !== false && isCatalogAvailableOnDate(item, selectedDate)),
    )
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
      .map((table) => tablePublicMeta(table))
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
    if (table.qrBlocked) return null

    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) return null

    return clone(table)
  },

  getActiveTableGroupByTableId(tableId) {
    const group = getActiveTableGroupByTableIdRaw(tableId)
    return group ? clone(mapTableGroupMeta(group)) : null
  },

  getEffectiveCapacityByTableId(tableId) {
    const table = this.getTableById(tableId)
    if (!table) return 0
    return getEffectiveCapacityForTableRaw(table)
  },

  getPublicQrContext(tableId, date) {
    const context = getOperationalContextByTableIdRaw(tableId)
    if (!context.requestedTable || !context.operationalTable) return null

    const salon = this.getSalonById(context.operationalTable.salonId)
    const activeSession = getActiveSessionByTableRecordRaw(context.operationalTable)
    const effectiveCapacity = getEffectiveCapacityForTableRaw(context.operationalTable)
    const occupiedGuests = Number(activeSession?.guestsActive || 0)

    return {
      restaurant: {
        name: state.restaurant?.name || defaultRestaurantSettings().name,
      },
      table: tablePublicMeta(context.requestedTable),
      operationalTable: tablePublicMeta(context.operationalTable),
      salon,
      sessionOpen: Boolean(activeSession),
      tableSessionId: activeSession?.id || null,
      effectiveCapacity,
      occupiedGuests,
      hasAvailableSeats: occupiedGuests < effectiveCapacity,
      groupedTables: context.group
        ? getGroupedTablesRaw(context.group).map((table) => ({
          id: table.id,
          number: table.number,
        }))
        : [],
      menu: {
        date: date || dateOnly(),
        items: this.getPublicCatalogMenus(date),
      },
    }
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
      qrBlocked: false,
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
        qrBlocked: false,
      }
      state.tables.push(table)
      return tablePublicMeta(table)
    })

    return created
  },

  updateTableRecord(tableId, payload) {
    const table = this.getTableById(tableId)
    if (!table) throw new Error('Mesa no existe')
    const tableGroup = getActiveTableGroupByTableIdRaw(table.id)

    const patch = payload || {}
    const nextSalonId = patch.salonId != null ? String(patch.salonId) : table.salonId
    const nextNumber = patch.number != null ? Number(patch.number) : table.number
    const nextCapacity = patch.capacity != null ? Number(patch.capacity) : table.capacity
    const nextActive = patch.active != null ? Boolean(patch.active) : table.active
    const nextQrBlocked = patch.qrBlocked != null ? Boolean(patch.qrBlocked) : Boolean(table.qrBlocked)

    const targetSalon = this.getSalonById(nextSalonId)
    if (!targetSalon) throw new Error('Salon no existe')
    if (!targetSalon.active && nextActive) throw new Error('No se puede activar mesa en salon inactivo')
    if (!Number.isInteger(nextNumber) || nextNumber < 1) throw new Error('Numero de mesa invalido')
    if (!Number.isInteger(nextCapacity) || nextCapacity < 1) throw new Error('Aforo invalido')

    const duplicated = state.tables.find((row) => row.id !== table.id && row.salonId === nextSalonId && row.number === nextNumber)
    if (duplicated) throw new Error('Ya existe una mesa con ese numero en el salon')

    if (tableGroup && (patch.capacity != null || patch.active === false)) {
      throw new Error('No se puede cambiar aforo o desactivar una mesa que pertenece a una union activa')
    }

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
    table.qrBlocked = nextQrBlocked

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

  listTableGroups({ active } = {}) {
    ensureBusinessState()
    let rows = [...state.tableGroups]
    if (typeof active === 'boolean') {
      rows = rows.filter((group) => (group.active !== false) === active)
    }
    return clone(rows.map((group) => mapTableGroupMeta(group)))
  },

  getTableGroupById(groupId) {
    ensureBusinessState()
    const group = state.tableGroups.find((row) => row.id === groupId)
    return group ? clone(mapTableGroupMeta(group)) : null
  },

  createTableGroup({ mainTableId, tableIds }) {
    ensureBusinessState()
    const requestedIds = Array.from(new Set([String(mainTableId || '').trim(), ...asArray(tableIds).map((id) => String(id).trim())].filter(Boolean)))

    if (requestedIds.length < 2) throw new Error('Debes seleccionar al menos 2 mesas para unir')
    if (requestedIds.length > 3) throw new Error('Solo se permite unir hasta 3 mesas en esta fase')

    const tables = requestedIds.map((tableId) => this.getTableById(tableId))
    if (tables.some((table) => !table)) throw new Error('Una de las mesas seleccionadas no existe')
    if (tables.some((table) => !table.active)) throw new Error('No se puede unir una mesa inactiva')

    const salonId = tables[0].salonId
    if (tables.some((table) => table.salonId !== salonId)) {
      throw new Error('Solo puedes unir mesas del mismo salon')
    }

    for (const table of tables) {
      if (getActiveTableGroupByTableIdRaw(table.id)) {
        throw new Error('Una de las mesas ya pertenece a otra union activa')
      }
      if (getActiveSessionByTableRecordRaw(table)) {
        throw new Error('No puedes unir mesas que ya tienen sesion activa')
      }
    }

    const mainId = requestedIds.includes(mainTableId) ? mainTableId : requestedIds[0]
    const group = {
      id: randomUUID(),
      salonId,
      tableIds: requestedIds,
      mainTableId: mainId,
      effectiveCapacity: deriveGroupedCapacity(requestedIds.length, tables[0]?.capacity),
      activeTableSessionId: null,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }

    state.tableGroups.push(group)
    return clone(mapTableGroupMeta(group))
  },

  updateTableGroup(groupId, payload) {
    ensureBusinessState()
    const group = state.tableGroups.find((row) => row.id === groupId)
    if (!group) throw new Error('La union de mesas no existe')

    if (group.activeTableSessionId) {
      throw new Error('No puedes modificar una union con sesion activa')
    }

    const requestedIds = Array.from(new Set(asArray(payload?.tableIds).map((id) => String(id).trim()).filter(Boolean)))
    if (requestedIds.length < 2) throw new Error('La union debe conservar al menos 2 mesas')
    if (requestedIds.length > 3) throw new Error('Solo se permite unir hasta 3 mesas')

    const tables = requestedIds.map((tableId) => this.getTableById(tableId))
    if (tables.some((table) => !table)) throw new Error('Una de las mesas seleccionadas no existe')
    if (tables.some((table) => !table.active)) throw new Error('No se puede usar una mesa inactiva en la union')

    const salonId = tables[0].salonId
    if (tables.some((table) => table.salonId !== salonId)) {
      throw new Error('Solo puedes unir mesas del mismo salon')
    }

    for (const table of tables) {
      const currentGroup = getActiveTableGroupByTableIdRaw(table.id)
      if (currentGroup && currentGroup.id !== group.id) {
        throw new Error('Una de las mesas ya pertenece a otra union activa')
      }
    }

    const nextMainTableId = requestedIds.includes(payload?.mainTableId) ? payload.mainTableId : requestedIds[0]

    group.tableIds = requestedIds
    group.mainTableId = nextMainTableId
    group.salonId = salonId
    group.effectiveCapacity = deriveGroupedCapacity(requestedIds.length, tables[0]?.capacity)
    group.updatedAt = nowIso()

    return clone(mapTableGroupMeta(group))
  },

  deleteTableGroup(groupId) {
    ensureBusinessState()
    const groupIndex = state.tableGroups.findIndex((row) => row.id === groupId)
    if (groupIndex < 0) throw new Error('La union de mesas no existe')
    if (state.tableGroups[groupIndex].activeTableSessionId) {
      throw new Error('No puedes separar mesas con sesion activa')
    }

    const [removed] = state.tableGroups.splice(groupIndex, 1)
    return clone(mapTableGroupMeta(removed))
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
    return table ? getActiveSessionByTableRecordRaw(table) : null
  },

  openAutoQrTableSession(tableId) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const table = context.operationalTable
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')

    const activeSession = getActiveSessionByTableRecordRaw(table)
    if (activeSession) return clone(activeSession)

    const session = {
      id: randomUUID(),
      tableId: table.id,
      guestsActive: 0,
      createdByUserId: 'qr-client',
      createdAt: nowIso(),
      closedAt: null,
      orderIds: [],
    }

    state.tableSessions.push(session)
    table.status = TABLE_STATUS.OCCUPIED
    table.activeSessionId = session.id

    if (context.group) {
      context.group.activeTableSessionId = session.id
      context.group.updatedAt = nowIso()
      for (const groupedTable of getGroupedTablesRaw(context.group)) {
        groupedTable.status = TABLE_STATUS.OCCUPIED
      }
    }

    return clone(session)
  },

  openTableSession(tableId, guests, userId) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const table = context.operationalTable
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')
    if (getActiveSessionByTableRecordRaw(table)) throw new Error('La mesa ya tiene una sesion activa')
    const effectiveCapacity = getEffectiveCapacityForTableRaw(table)
    if (!Number.isInteger(guests) || guests < 1 || guests > effectiveCapacity) {
      throw new Error('Cantidad de comensales invalida para la capacidad de la mesa')
    }

    const session = {
      id: randomUUID(),
      tableId: table.id,
      guestsActive: guests,
      createdByUserId: userId,
      createdAt: nowIso(),
      closedAt: null,
      orderIds: [],
    }

    table.status = TABLE_STATUS.OCCUPIED
    table.activeSessionId = session.id
    state.tableSessions.push(session)

    if (context.group) {
      context.group.activeTableSessionId = session.id
      context.group.updatedAt = nowIso()
      for (const groupedTable of getGroupedTablesRaw(context.group)) {
        groupedTable.status = TABLE_STATUS.OCCUPIED
      }
    }

    return clone(session)
  },

  updateTableSessionGuests(tableId, guests) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const table = context.operationalTable
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const activeSession = this.getActiveSessionByTableId(tableId)
    if (!activeSession) throw new Error('La mesa no tiene sesion activa')
    const effectiveCapacity = getEffectiveCapacityForTableRaw(table)
    if (!Number.isInteger(guests) || guests < 1 || guests > effectiveCapacity) {
      throw new Error('Cantidad de comensales invalida para la capacidad de la mesa')
    }
    activeSession.guestsActive = guests
    return clone(activeSession)
  },

  listTableGuestSessions({ tableSessionId, tableId, status } = {}) {
    ensureBusinessState()
    let rows = [...state.tableGuestSessions]
    if (tableSessionId) rows = rows.filter((row) => row.tableSessionId === tableSessionId)
    if (tableId) rows = rows.filter((row) => row.tableId === tableId)
    if (status) rows = rows.filter((row) => row.status === status)
    rows.sort((a, b) => Number(a.guestNumber || 0) - Number(b.guestNumber || 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return clone(rows)
  },

  getTableGuestSessionById(guestSessionId) {
    return state.tableGuestSessions.find((row) => row.id === guestSessionId) || null
  },

  getTableGuestSessionByToken(guestToken) {
    const token = String(guestToken || '').trim()
    if (!token) return null
    return state.tableGuestSessions.find((row) => row.guestToken === token) || null
  },

  joinQrGuestSession(tableId, guestToken) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const requestedTable = context.requestedTable
    const operationalTable = context.operationalTable
    if (!requestedTable || !operationalTable) throw new Error('Mesa no existe')
    if (!requestedTable.active || !operationalTable.active) throw new Error('Mesa inactiva')

    const salon = this.getSalonById(operationalTable.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')

    let tableSession = getActiveSessionByTableRecordRaw(operationalTable)
    if (!tableSession) {
      tableSession = state.tableSessions.find((session) => session.id === this.openAutoQrTableSession(tableId).id) || null
    }

    const normalizedGuestToken = String(guestToken || '').trim()
    if (normalizedGuestToken) {
      const existing = this.getTableGuestSessionByToken(normalizedGuestToken)
      if (
        existing &&
        existing.tableId === operationalTable.id &&
        existing.tableSessionId === tableSession.id &&
        existing.status === TABLE_GUEST_STATUS.ACTIVE &&
        existing.closedAt == null
      ) {
        return {
          created: false,
          tableSession: clone(tableSession),
          guestSession: clone(existing),
          effectiveCapacity: getEffectiveCapacityForTableRaw(operationalTable),
          occupiedGuests: Number(tableSession.guestsActive || 0),
        }
      }
    }

    const effectiveCapacity = getEffectiveCapacityForTableRaw(operationalTable)
    if (Number(tableSession.guestsActive || 0) >= effectiveCapacity) {
      const error = new Error('La mesa alcanzo su capacidad actual. Pide al mozo unir mesas o registrar tu pedido desde POS.')
      error.status = 409
      throw error
    }

    const guestSession = {
      id: randomUUID(),
      tableSessionId: tableSession.id,
      tableId: operationalTable.id,
      guestNumber: findNextQrGuestNumber(tableSession),
      source: TABLE_GUEST_SOURCE.QR,
      status: TABLE_GUEST_STATUS.ACTIVE,
      guestToken: randomUUID(),
      createdAt: nowIso(),
      closedAt: null,
    }

    state.tableGuestSessions.push(guestSession)
    tableSession.guestsActive = Number(tableSession.guestsActive || 0) + 1

    return {
      created: true,
      tableSession: clone(tableSession),
      guestSession: clone(guestSession),
      effectiveCapacity,
      occupiedGuests: Number(tableSession.guestsActive || 0),
    }
  },

  getQrGuestContext(tableId, guestToken) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const requestedTable = context.requestedTable
    const operationalTable = context.operationalTable
    if (!requestedTable || !operationalTable) return null

    const tableSession = getActiveSessionByTableRecordRaw(operationalTable)
    const normalizedGuestToken = String(guestToken || '').trim()
    const guestSession = normalizedGuestToken ? this.getTableGuestSessionByToken(normalizedGuestToken) : null

    if (
      !tableSession ||
      !guestSession ||
      guestSession.tableId !== operationalTable.id ||
      guestSession.tableSessionId !== tableSession.id ||
      guestSession.status !== TABLE_GUEST_STATUS.ACTIVE ||
      guestSession.closedAt != null
    ) {
      return {
        tableSession: tableSession ? clone(tableSession) : null,
        guestSession: null,
        activeOrders: [],
      }
    }

    const activeOrders = state.orders
      .filter((order) => order.guestSessionId === guestSession.id)
      .filter((order) => order.status !== ORDER_STATUS.CLOSED && order.status !== ORDER_STATUS.CANCELLED)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((order) => clone(order))

    return {
      tableSession: clone(tableSession),
      guestSession: clone(guestSession),
      activeOrders,
    }
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
      countedDigitalAmount: null,
    }
    state.cashSessions.push(session)
    return clone(session)
  },

  closeCashSession(closedByUserId, countedCashAmount, countedDigitalAmount = 0) {
    const session = this.getOpenCashSession()
    if (!session) throw new Error('No existe una caja abierta')

    session.status = CASH_STATUS.CLOSED
    session.closedAt = nowIso()
    session.closedByUserId = closedByUserId
    session.countedCashAmount = Number(countedCashAmount) || 0
    session.countedDigitalAmount = Number(countedDigitalAmount) || 0

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

  getEditableQrOrderByGuestSession(guestSessionId) {
    if (!guestSessionId) return null
    return state.orders.find(
      (order) =>
        order.source === ORDER_SOURCE.QR &&
        order.guestSessionId === guestSessionId &&
        (order.status === ORDER_STATUS.PENDING_WAITER_APPROVAL || order.status === ORDER_STATUS.APPROVED),
    ) || null
  },

  createOrGetQrOrder(tableId, guestSessionId) {
    const existing = this.getEditableQrOrderByGuestSession(guestSessionId)
    if (existing) return clone(existing)
    return this.createOrder({
      tableId,
      source: ORDER_SOURCE.QR,
      createdByUserId: 'qr-client',
      guestSessionId,
    })
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

  createOrder({ tableId, source, createdByUserId, guestSessionId = null }) {
    const context = getOperationalContextByTableIdRaw(tableId)
    const table = context.operationalTable
    if (!table) throw new Error('Mesa no existe')
    if (!table.active) throw new Error('Mesa inactiva')
    const salon = this.getSalonById(table.salonId)
    if (!salon?.active) throw new Error('El salon de la mesa esta inactivo')
    const activeSession = this.getActiveSessionByTableId(tableId)
    if (!activeSession) {
      const error = new Error('La mesa no tiene sesion activa')
      error.status = 409
      throw error
    }

    let guestSession = null
    if (guestSessionId) {
      guestSession = this.getTableGuestSessionById(guestSessionId)
      if (!guestSession) throw new Error('La persona QR no existe')
      if (guestSession.tableSessionId !== activeSession.id || guestSession.tableId !== table.id) {
        const error = new Error('La persona QR no corresponde a la sesion activa de la mesa')
        error.status = 403
        throw error
      }
      if (guestSession.status !== TABLE_GUEST_STATUS.ACTIVE || guestSession.closedAt != null) {
        const error = new Error('La persona QR ya no esta activa')
        error.status = 409
        throw error
      }
    }

    const order = {
      id: randomUUID(),
      tableId: table.id,
      tableSessionId: activeSession.id,
      createdByUserId,
      source,
      status: source === ORDER_SOURCE.QR ? ORDER_STATUS.PENDING_WAITER_APPROVAL : ORDER_STATUS.DRAFT,
      createdAt: nowIso(),
      closedAt: null,
      approvedByUserId: null,
      guestSessionId: guestSession?.id || null,
      guestNumber: guestSession?.guestNumber || null,
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
    if (
      order.status === ORDER_STATUS.CLOSED ||
      order.status === ORDER_STATUS.CANCELLED ||
      order.status === ORDER_STATUS.SENT_TO_KITCHEN ||
      order.status === ORDER_STATUS.PREPARING ||
      order.status === ORDER_STATUS.READY ||
      order.status === ORDER_STATUS.DELIVERED
    ) {
      throw new Error('No se puede modificar un pedido que ya fue enviado o cerrado')
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
        guestNumber: order.guestNumber || payload.guestNumber || null,
        guestSessionId: order.guestSessionId || payload.guestSessionId || null,
        serviceMode: payload.serviceMode || SERVICE_MODE.DINE_IN,
        isMenu: Boolean(product.isMenu),
        includedEntry: null,
        extras: [],
      }

      if (payload.includedEntryProductId) {
        const includedEntryProduct = state.catalog.find((candidate) => candidate.id === payload.includedEntryProductId)
        if (!includedEntryProduct) {
          throw new Error(`Entrada incluida no encontrada: ${payload.includedEntryProductId}`)
        }
        item.includedEntry = {
          productId: includedEntryProduct.id,
          name: includedEntryProduct.name,
        }
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
        const includedEntryName = item.includedEntry?.name || parsedNotes.includedEntry || null
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
          includedEntry: includedEntryName,
          servingLines: buildServingLines(item, includedEntryName),
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
        includedEntry: item.includedEntry ? { ...item.includedEntry } : null,
        extras: item.extras.map((extra) => ({ name: extra.name, quantity: extra.quantity, unitPrice: extra.unitPrice })),
      })),
    }

    state.receipts.push(receipt)

    const tableSession = this.getTableSessionById(order.tableSessionId)
    if (tableSession) {
      syncOrdersAfterBills(tableSession.id)
    }

    for (const soldItem of order.items) {
      const inventory = state.inventory.find((row) => row.productId === soldItem.productId)
      if (inventory) {
        inventory.stock = Math.max(0, inventory.stock - soldItem.quantity)
      }

      if (soldItem.includedEntry?.productId) {
        const includedEntryInventory = state.inventory.find((row) => row.productId === soldItem.includedEntry.productId)
        if (includedEntryInventory) {
          includedEntryInventory.stock = Math.max(0, includedEntryInventory.stock - soldItem.quantity)
        }
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

db.getMyProfile = function getMyProfile(userId) {
  ensureBusinessState()
  const user = state.users.find((item) => item.id === userId)
  if (!user) throw new Error('Usuario no existe')
  return sanitizeUser(user)
}

db.updateMyProfile = function updateMyProfile(userId, payload) {
  ensureBusinessState()
  const user = state.users.find((item) => item.id === userId)
  if (!user) throw new Error('Usuario no existe')

  if (payload?.name != null) {
    const nextName = String(payload.name).trim()
    if (!nextName) throw new Error('Nombre invalido')
    user.name = nextName
  }

  if (payload?.photoUrl != null) {
    user.photoUrl = String(payload.photoUrl || '').trim()
  }

  const wantsPasswordChange = payload?.newPassword != null || payload?.currentPassword != null
  if (wantsPasswordChange) {
    const currentPassword = String(payload?.currentPassword || '').trim()
    const nextPassword = String(payload?.newPassword || '').trim()

    if (!currentPassword) throw new Error('Ingresa tu password actual')
    if (user.password !== currentPassword) throw new Error('El password actual no coincide')
    if (!nextPassword || nextPassword.length < 4) throw new Error('El nuevo password debe tener al menos 4 caracteres')

    user.password = nextPassword
  }

  user.updatedAt = nowIso()
  return sanitizeUser(user)
}

db.getRestaurantSettings = function getRestaurantSettings() {
  ensureBusinessState()
  return clone(state.restaurant)
}

db.getRestaurantPrinterSettings = function getRestaurantPrinterSettings() {
  ensureBusinessState()
  return clone(state.restaurant.printers)
}

db.updateRestaurantSettings = function updateRestaurantSettings(payload) {
  ensureBusinessState()

  const next = normalizeRestaurantSettings({
    ...state.restaurant,
    ...(payload || {}),
    printers: {
      ...(state.restaurant?.printers || defaultRestaurantPrinterSettings()),
      ...((payload?.printers && typeof payload.printers === 'object') ? payload.printers : {}),
    },
  })

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

db.deleteMenuSection = function deleteMenuSection(sectionId) {
  ensureBusinessState()
  const sectionIndex = state.menuSections.findIndex((row) => row.id === sectionId)
  if (sectionIndex < 0) throw new Error('Seccion no existe')

  const linkedCategories = state.menuCategories.filter((row) => row.sectionId === sectionId)
  if (linkedCategories.length) {
    throw new Error('No puedes eliminar una seccion con categorias asociadas')
  }

  const [deleted] = state.menuSections.splice(sectionIndex, 1)
  return clone(deleted)
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

db.deleteMenuCategory = function deleteMenuCategory(categoryId) {
  ensureBusinessState()
  const categoryIndex = state.menuCategories.findIndex((row) => row.id === categoryId)
  if (categoryIndex < 0) throw new Error('Categoria no existe')

  const linkedProducts = state.menuProducts.filter((row) => row.categoryId === categoryId)
  if (linkedProducts.length) {
    throw new Error('No puedes eliminar una categoria con productos asociados')
  }

  const [deleted] = state.menuCategories.splice(categoryIndex, 1)
  return clone(deleted)
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
  if (payload?.isFeatured === true) {
    ensureFeaturedMenuProductAvailable(null)
  }

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
    isFeatured: payload?.isFeatured === true,
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
  if (merged.isFeatured === true && product.isFeatured !== true) {
    ensureFeaturedMenuProductAvailable(product.id)
  }

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
    isFeatured: merged.isFeatured === true,
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

db.deleteMenuProduct = function deleteMenuProduct(productId) {
  ensureBusinessState()
  const productIndex = state.menuProducts.findIndex((row) => row.id === productId)
  if (productIndex < 0) throw new Error('Producto no existe')

  const [deleted] = state.menuProducts.splice(productIndex, 1)
  removeCatalogFromMenuProduct(productId)

  return clone(deleted)
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
      const guestSessionId = String(item.guestSessionId || order.guestSessionId || '').trim() || null
      const groupKey = guestSessionId
        ? 'guest:' + guestSessionId
        : String(order.tableSessionId) + ':' + String(guestNumber)

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          tableId: order.tableId,
          tableSessionId: order.tableSessionId,
          guestSessionId,
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
        (group.guestSessionId ? bill.guestSessionId === group.guestSessionId : bill.guestNumber === group.guestNumber) &&
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
      guestSessionId: group.guestSessionId,
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

db.closeCashRegister = function closeCashRegister(closedByUserId, countedCashAmount, countedDigitalAmount = 0) {
  ensureBusinessState()
  const cash = db.closeCashSession(closedByUserId, countedCashAmount, countedDigitalAmount)
  const summary = db.getCashSummaryBySessionId(cash.id)

  const cashDiscrepancy = normalizeMoney((Number(cash.openingAmount || 0) + Number(summary.cashTotal || 0)) - Number(cash.countedCashAmount || 0))
  const digitalDiscrepancy = normalizeMoney(Number(summary.transferTotal || 0) - Number(cash.countedDigitalAmount || 0))
  const discrepancy = normalizeMoney(cashDiscrepancy + digitalDiscrepancy)

  const closure = {
    id: randomUUID(),
    cashSessionId: cash.id,
    date: cash.date,
    summary,
    countedCashAmount: normalizeMoney(cash.countedCashAmount),
    countedDigitalAmount: normalizeMoney(cash.countedDigitalAmount),
    cashDiscrepancy,
    digitalDiscrepancy,
    discrepancy,
    pendingTransfer: {
      cashAmount: normalizeMoney(summary.cashTotal),
      digitalAmount: normalizeMoney(summary.transferTotal),
      status: 'PENDING',
    },
    createdAt: nowIso(),
  }

  state.cashClosures.push(closure)

  const salesTransactions = []
  const cashReference = `CAJA-${cash.id}-EFECTIVO`
  const digitalReference = `CAJA-${cash.id}-DIGITAL`
  const cashAccount = state.financeAccounts.find((row) => row.id === 'fa-cash-general' && row.active)
  const digitalAccount = state.financeAccounts.find((row) => row.id === 'fa-digital-wallet' && row.active)

  if (summary.cashTotal > 0 && cashAccount && !state.financeTransactions.some((tx) => tx.reference === cashReference)) {
    salesTransactions.push(this.createFinanceTransaction(
      {
        type: FINANCE_TRANSACTION_TYPE.INCOME,
        amount: summary.cashTotal,
        accountId: cashAccount.id,
        reference: cashReference,
        category: 'SALES_CASH',
        source: 'CASH_CLOSURE',
        note: `Ventas en efectivo del cierre de caja ${String(cash.id).slice(0, 8)}`,
      },
      closedByUserId,
    ))
  }

  if (summary.transferTotal > 0 && digitalAccount && !state.financeTransactions.some((tx) => tx.reference === digitalReference)) {
    salesTransactions.push(this.createFinanceTransaction(
      {
        type: FINANCE_TRANSACTION_TYPE.INCOME,
        amount: summary.transferTotal,
        accountId: digitalAccount.id,
        reference: digitalReference,
        category: 'SALES_DIGITAL',
        source: 'CASH_CLOSURE',
        note: `Ventas en billetera digital del cierre de caja ${String(cash.id).slice(0, 8)}`,
      },
      closedByUserId,
    ))
  }

  return {
    cash: clone(cash),
    summary: clone(summary),
    closure: clone(closure),
    financeTransactions: clone(salesTransactions),
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

db.getFinanceSummary = function getFinanceSummary({ date, month, timezone } = {}) {
  ensureBusinessState()
  const kpiTimeZone = resolveKpiTimeZone(timezone)
  const dateKey = normalizeDateKeyInput(date, kpiTimeZone)
  const monthKey = normalizeMonthKeyInput(month || dateKey.slice(0, 7), kpiTimeZone)
  const monthRange = buildMonthRange(monthKey)

  const todayOrders = this.getClosedOrdersByDateRange({
    from: dateKey,
    to: dateKey,
    timezone: kpiTimeZone,
  })
  const monthOrders = this.getClosedOrdersByDateRange({
    from: monthRange.from,
    to: monthRange.to,
    timezone: kpiTimeZone,
  })

  const todaySales = normalizeMoney(todayOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))
  const monthSales = normalizeMoney(monthOrders.reduce((sum, order) => sum + Number(order?.totals?.total || 0), 0))
  const monthSystemIncome = normalizeMoney(
    state.financeTransactions
      .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.INCOME && tx.source === 'CASH_CLOSURE')
      .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
  )
  const monthCashIncome = normalizeMoney(
    state.financeTransactions
      .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.INCOME && tx.category === 'SALES_CASH')
      .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
  )
  const monthDigitalIncome = normalizeMoney(
    state.financeTransactions
      .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.INCOME && tx.category === 'SALES_DIGITAL')
      .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
  )
  const monthManualIncome = normalizeMoney(
    state.financeTransactions
      .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.INCOME && tx.source !== 'CASH_CLOSURE')
      .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
  )
  const monthExpenses = normalizeMoney(
    state.financeTransactions
      .filter((tx) => tx.type === FINANCE_TRANSACTION_TYPE.EXPENSE)
      .filter((tx) => getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.monthKey === monthKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
  )
  const todayRegisteredSales = state.financeTransactions.filter(
    (tx) => tx.source === 'CASH_CLOSURE' && getDatePartsInTimeZone(tx.createdAt, kpiTimeZone)?.dateKey === dateKey,
  )

  return {
    date: dateKey,
    month: monthKey,
    todaySales,
    monthSales,
    monthSystemIncome,
    monthCashIncome,
    monthDigitalIncome,
    monthManualIncome,
    monthExpenses,
    projectedBalance: normalizeMoney(monthSystemIncome + monthManualIncome - monthExpenses),
    todayRegisteredSales: clone(todayRegisteredSales),
  }
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
    category: String(payload?.category || '').trim().toUpperCase(),
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
  'createTableGroup',
  'updateTableGroup',
  'deleteTableGroup',
  'ensureTableQrToken',
  'generatePendingTableQrs',
  'markTableQrsPrinted',
  'openTableSession',
  'openAutoQrTableSession',
  'updateTableSessionGuests',
  'joinQrGuestSession',
  'openCashSession',
  'closeCashSession',
  'updateOrderRecord',
  'deleteOrderRecord',
  'createOrder',
  'createOrGetQrOrder',
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
  'deleteMenuSection',
  'createMenuCategory',
  'updateMenuCategory',
  'deleteMenuCategory',
  'createMenuProduct',
  'updateMenuProduct',
  'deleteMenuProduct',
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


