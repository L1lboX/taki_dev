const API_BASE_URL = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('taki_token')
}

function withQrToken(options = {}, qrToken) {
  if (!qrToken) return options
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-QR-Token': qrToken,
    },
  }
}

export async function apiRequest(path, options = {}) {
  const target = API_BASE_URL || window.location.origin

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${target}${path}`, {
      ...options,
      headers,
    })
  } catch {
    throw new Error(
      `No se pudo conectar al API (${target}). Ejecuta npm run api:dev o npm run dev para levantar el backend.`,
    )
  }

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    const message = payload?.error || `Request failed: ${response.status}`
    throw new Error(message)
  }

  return payload
}

export const api = {
  login: (body) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getSalons: ({ active } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/salons${query ? `?${query}` : ''}`)
  },
  createSalon: (body) => apiRequest('/salons', { method: 'POST', body: JSON.stringify(body) }),
  updateSalon: (salonId, body) => apiRequest(`/salons/${salonId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getMenus: (date) => apiRequest(`/catalog/menus?date=${encodeURIComponent(date)}`),
  getPublicMenus: (date) => apiRequest(`/catalog/public/menus?date=${encodeURIComponent(date)}`),
  getCatalogCategories: ({ active } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/catalog/admin/categories${query ? `?${query}` : ''}`)
  },
  createCatalogCategory: (body) => apiRequest('/catalog/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
  getCatalogItems: ({ active, category } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    if (category) params.set('category', category)
    const query = params.toString()
    return apiRequest(`/catalog/admin/items${query ? `?${query}` : ''}`)
  },
  createCatalogItem: (body) => apiRequest('/catalog/admin/items', { method: 'POST', body: JSON.stringify(body) }),
  updateCatalogItem: (itemId, body) => apiRequest(`/catalog/admin/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getPublicCatalogItems: () => apiRequest('/catalog/public/items'),
  getPublicCatalogCategories: () => apiRequest('/catalog/public/categories'),
  getTables: () => apiRequest('/tables'),
  getTablesAdmin: ({
    salonId,
    active,
    status,
    qrStatus,
  } = {}) => {
    const params = new URLSearchParams()
    if (salonId) params.set('salonId', salonId)
    if (typeof active === 'boolean') params.set('active', String(active))
    if (status) params.set('status', status)
    if (qrStatus) params.set('qrStatus', qrStatus)
    const query = params.toString()
    return apiRequest(`/tables/admin${query ? `?${query}` : ''}`)
  },
  createTable: (body) => apiRequest('/tables', { method: 'POST', body: JSON.stringify(body) }),
  createTablesBulk: (body) => apiRequest('/tables/bulk', { method: 'POST', body: JSON.stringify(body) }),
  updateTable: (tableId, body) => apiRequest(`/tables/${tableId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  resolveQrAccess: (tableId) => apiRequest(`/tables/qr/public/${encodeURIComponent(tableId)}`),
  getPendingQrs: () => apiRequest('/tables/qr/pending'),
  generatePendingQrs: () => apiRequest('/tables/qr/generate-pending', { method: 'POST', body: JSON.stringify({}) }),
  markPrintedQrs: (body = {}) => apiRequest('/tables/qr/mark-printed', { method: 'POST', body: JSON.stringify(body) }),
  openTableSession: (tableId, body) => apiRequest(`/tables/${tableId}/session`, { method: 'POST', body: JSON.stringify(body) }),
  updateSessionGuests: (tableId, body) => apiRequest(`/tables/${tableId}/session/guests`, { method: 'PATCH', body: JSON.stringify(body) }),
  listOrders: (query = '') => apiRequest(`/orders${query ? `?${query}` : ''}`),
  listOrderHistory: ({
    page = 1,
    pageSize = 10,
    date,
    scope = 'SOLD',
    search = '',
  } = {}) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    params.set('scope', scope)
    if (date) params.set('date', date)
    if (search) params.set('search', search)
    return apiRequest(`/orders/history?${params.toString()}`)
  },
  updateHistoryOrder: (orderId, body) => apiRequest(`/orders/${orderId}/history`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHistoryOrder: (orderId) => apiRequest(`/orders/${orderId}/history`, { method: 'DELETE' }),
  createOrder: (body) => apiRequest('/orders', { method: 'POST', body: JSON.stringify(body) }),
  createQrOrder: (body, qrToken) => apiRequest('/orders/qr', withQrToken({ method: 'POST', body: JSON.stringify(body) }, qrToken)),
  addItems: (orderId, body) => apiRequest(`/orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  addQrItems: (orderId, body, qrToken) =>
    apiRequest(`/orders/qr/${orderId}/items`, withQrToken({ method: 'POST', body: JSON.stringify(body) }, qrToken)),
  approveOrder: (orderId) => apiRequest(`/orders/${orderId}/approve`, { method: 'PATCH' }),
  sendKitchen: (orderId) => apiRequest(`/orders/${orderId}/send-kitchen`, { method: 'PATCH' }),
  payOrder: (orderId, body) => apiRequest(`/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify(body) }),
  listKitchenTickets: () => apiRequest('/kitchen/tickets'),
  updateKitchenStatus: (ticketId, body) => apiRequest(`/kitchen/tickets/${ticketId}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  listKitchenIncidents: () => apiRequest('/kitchen/incidents'),
  getCashCurrent: () => apiRequest('/cash/current'),
  openCash: (body) => apiRequest('/cash/open', { method: 'POST', body: JSON.stringify(body) }),
  closeCash: (body) => apiRequest('/cash/close', { method: 'POST', body: JSON.stringify(body) }),
  getKpiClientsSummary: ({ date, timezone } = {}) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (timezone) params.set('timezone', timezone)
    const query = params.toString()
    return apiRequest(`/kpis/cards/clients${query ? `?${query}` : ''}`)
  },
  getKpiMonthlyProfitSummary: ({ month, timezone } = {}) => {
    const params = new URLSearchParams()
    if (month) params.set('month', month)
    if (timezone) params.set('timezone', timezone)
    const query = params.toString()
    return apiRequest(`/kpis/cards/monthly-profit${query ? `?${query}` : ''}`)
  },
  getKpiIncomesSummary: ({ date, timezone } = {}) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (timezone) params.set('timezone', timezone)
    const query = params.toString()
    return apiRequest(`/kpis/cards/incomes${query ? `?${query}` : ''}`)
  },
  getKpiOrdersSummary: ({ date, timezone } = {}) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (timezone) params.set('timezone', timezone)
    const query = params.toString()
    return apiRequest(`/kpis/cards/orders${query ? `?${query}` : ''}`)
  },
  getKpiTopProducts: ({ month, limit = 10, timezone } = {}) => {
    const params = new URLSearchParams()
    if (month) params.set('month', month)
    if (timezone) params.set('timezone', timezone)
    params.set('limit', String(limit))
    const query = params.toString()
    return apiRequest(`/kpis/top-products${query ? `?${query}` : ''}`)
  },
  getKpiWaitersSummary: ({ period = 'WEEK', date, timezone } = {}) => {
    const params = new URLSearchParams()
    params.set('period', period)
    if (date) params.set('date', date)
    if (timezone) params.set('timezone', timezone)
    const query = params.toString()
    return apiRequest(`/kpis/waiters${query ? `?${query}` : ''}`)
  },
  getDailyKpi: (date) => apiRequest(`/kpis/daily?date=${encodeURIComponent(date)}`),
  getMonthlyKpi: (month) => apiRequest(`/kpis/monthly?month=${encodeURIComponent(month)}`),
  getTopDishes: (from, to) => apiRequest(`/kpis/top-dishes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=8`),
  getInventory: () => apiRequest('/inventory'),
  updateInventory: (productId, body) => apiRequest(`/inventory/${productId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getBills: ({ status, tableId, tableSessionId } = {}) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (tableId) params.set('tableId', tableId)
    if (tableSessionId) params.set('tableSessionId', tableSessionId)
    const query = params.toString()
    return apiRequest(`/bills${query ? `?${query}` : ''}`)
  },
  generateBills: (body = {}) => apiRequest('/bills/generate', { method: 'POST', body: JSON.stringify(body) }),
  getBillById: (billId) => apiRequest(`/bills/${billId}`),
  payBill: (billId, body) => apiRequest(`/bills/${billId}/payments`, { method: 'POST', body: JSON.stringify(body) }),

  getCashRegisterCurrent: () => apiRequest('/cash-register/current'),
  getCashRegisterTransactions: ({ cashSessionId } = {}) => {
    const params = new URLSearchParams()
    if (cashSessionId) params.set('cashSessionId', cashSessionId)
    const query = params.toString()
    return apiRequest(`/cash-register/transactions${query ? `?${query}` : ''}`)
  },
  openCashRegister: (body) => apiRequest('/cash-register/open', { method: 'POST', body: JSON.stringify(body) }),
  closeCashRegister: (body) => apiRequest('/cash-register/close', { method: 'POST', body: JSON.stringify(body) }),

  getFinanceAccounts: ({ active } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/finance/accounts${query ? `?${query}` : ''}`)
  },
  createFinanceAccount: (body) => apiRequest('/finance/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateFinanceAccount: (accountId, body) => apiRequest(`/finance/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getFinanceTransactions: ({ from, to, accountId, type } = {}) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (accountId) params.set('accountId', accountId)
    if (type) params.set('type', type)
    const query = params.toString()
    return apiRequest(`/finance/transactions${query ? `?${query}` : ''}`)
  },
  createFinanceTransaction: (body) => apiRequest('/finance/transactions', { method: 'POST', body: JSON.stringify(body) }),

  getMenuSections: ({ active } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/menu/sections${query ? `?${query}` : ''}`)
  },
  createMenuSection: (body) => apiRequest('/menu/sections', { method: 'POST', body: JSON.stringify(body) }),
  updateMenuSection: (sectionId, body) => apiRequest(`/menu/sections/${sectionId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getMenuCategories: ({ sectionId, active } = {}) => {
    const params = new URLSearchParams()
    if (sectionId) params.set('sectionId', sectionId)
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/menu/categories${query ? `?${query}` : ''}`)
  },
  createMenuCategory: (body) => apiRequest('/menu/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateMenuCategory: (categoryId, body) => apiRequest(`/menu/categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getMenuProducts: ({ sectionId, categoryId, active, status, isPublic } = {}) => {
    const params = new URLSearchParams()
    if (sectionId) params.set('sectionId', sectionId)
    if (categoryId) params.set('categoryId', categoryId)
    if (typeof active === 'boolean') params.set('active', String(active))
    if (status) params.set('status', status)
    if (typeof isPublic === 'boolean') params.set('isPublic', String(isPublic))
    const query = params.toString()
    return apiRequest(`/menu/products${query ? `?${query}` : ''}`)
  },
  createMenuProduct: (body) => apiRequest('/menu/products', { method: 'POST', body: JSON.stringify(body) }),
  updateMenuProduct: (productId, body) => apiRequest(`/menu/products/${productId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getCustomers: ({ active } = {}) => {
    const params = new URLSearchParams()
    if (typeof active === 'boolean') params.set('active', String(active))
    const query = params.toString()
    return apiRequest(`/customers${query ? `?${query}` : ''}`)
  },
  createCustomer: (body) => apiRequest('/customers', { method: 'POST', body: JSON.stringify(body) }),
  updateCustomer: (customerId, body) => apiRequest(`/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getAdminUsers: () => apiRequest('/admin/users'),
  createAdminUser: (body) => apiRequest('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminUser: (userId, body) => apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getRestaurantSettings: () => apiRequest('/admin/restaurant'),
  updateRestaurantSettings: (body) => apiRequest('/admin/restaurant', { method: 'PATCH', body: JSON.stringify(body) }),
}
