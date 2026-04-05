import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ORDER_SOURCE, ORDER_STATUS, ROLES, SPLIT_MODE } from '../constants.js'
import { enqueueKitchenPrint } from '../printer.js'
import { requireQrToken } from '../qrToken.js'
import { emitEvent } from '../realtime.js'
import { db } from '../store.js'

const router = Router()

const createOrderSchema = z.object({
  tableId: z.string().min(1),
  source: z.enum([ORDER_SOURCE.WAITER, ORDER_SOURCE.QR]).default(ORDER_SOURCE.WAITER),
})

const addItemsSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive().default(1),
      unitPrice: z.number().positive().optional(),
      variant: z.string().optional(),
      notes: z.string().optional(),
      guestNumber: z.number().int().positive().optional(),
      serviceMode: z.enum(['DINE_IN', 'TAKEAWAY']).optional(),
      extras: z
        .array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().int().positive().default(1),
            unitPrice: z.number().positive().optional(),
          }),
        )
        .optional(),
    }),
  ),
})

const payOrderSchema = z.object({
  splitMode: z.enum([SPLIT_MODE.TABLE_TOTAL, SPLIT_MODE.SPLIT]).default(SPLIT_MODE.TABLE_TOTAL),
  payments: z.array(
    z.object({
      method: z.enum(['CASH', 'TRANSFER']),
      amount: z.number().positive(),
    }),
  ),
})

const qrCreateSchema = z.object({
  tableId: z.string().min(1),
})

const qrItemsSchema = addItemsSchema

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scope: z.enum(['SOLD', 'ALL', 'ALL_WITH_CANCELLED']).default('SOLD'),
  search: z.string().trim().max(60).optional(),
})

const orderStatusValues = Object.values(ORDER_STATUS)

const updateHistoryOrderSchema = z
  .object({
    status: z.enum(orderStatusValues).optional(),
    tableId: z.string().min(1).optional(),
  })
  .refine((payload) => payload.status != null || payload.tableId != null, {
    message: 'Debe enviar al menos un campo para actualizar',
  })

function buildQrOrderNotificationPayload(order) {
  const table = db.getTableById(order.tableId)
  const salon = table ? db.getSalonById(table.salonId) : null

  return {
    orderId: order.id,
    tableId: order.tableId,
    tableNumber: table?.number ?? null,
    salonId: salon?.id ?? null,
    salonName: salon?.name ?? '',
    status: order.status,
  }
}

router.get(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    const status = req.query.status?.toString()
    const source = req.query.source?.toString()
    let rows = db.listOrders()

    if (status) rows = rows.filter((row) => row.status === status)
    if (source) rows = rows.filter((row) => row.source === source)

    return res.json(rows)
  }),
)

router.get(
  '/history',
  requireAuth,
  asyncRoute(async (req, res) => {
    const query = historyQuerySchema.parse(req.query)
    const needle = (query.search || '').toLowerCase()

    let rows = db.listOrders()

    if (query.scope === 'SOLD') {
      rows = rows.filter((row) => row.status === ORDER_STATUS.CLOSED)
    } else if (query.scope === 'ALL') {
      rows = rows.filter((row) => row.status !== ORDER_STATUS.CANCELLED)
    }

    if (query.date) {
      rows = rows.filter((row) => {
        const referenceDate = query.scope === 'SOLD'
          ? (row.closedAt || row.createdAt)
          : row.createdAt
        return referenceDate?.slice(0, 10) === query.date
      })
    }

    if (needle) {
      rows = rows.filter((row) => {
        const matchesTicket = row.id.toLowerCase().includes(needle)
        const matchesTable = row.tableId.toLowerCase().includes(needle)
        const matchesItems = (row.items || []).some((item) => String(item.productName || '').toLowerCase().includes(needle))
        return matchesTicket || matchesTable || matchesItems
      })
    }

    rows.sort((a, b) => {
      const aRef = query.scope === 'SOLD' ? (a.closedAt || a.createdAt) : a.createdAt
      const bRef = query.scope === 'SOLD' ? (b.closedAt || b.createdAt) : b.createdAt
      return new Date(bRef).getTime() - new Date(aRef).getTime()
    })

    const totalItems = rows.length
    const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize))
    const safePage = Math.min(query.page, totalPages)
    const start = (safePage - 1) * query.pageSize
    const items = rows.slice(start, start + query.pageSize)

    return res.json({
      items,
      page: safePage,
      pageSize: query.pageSize,
      totalItems,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
    })
  }),
)

router.post(
  '/qr',
  requireQrToken,
  asyncRoute(async (req, res) => {
    const payload = qrCreateSchema.parse(req.body)
    if (req.qr.tableId !== payload.tableId) {
      return res.status(403).json({ error: 'Token QR no corresponde a la mesa' })
    }

    const order = db.createOrder({
      tableId: payload.tableId,
      source: ORDER_SOURCE.QR,
      createdByUserId: 'qr-client',
    })

    emitEvent('order.updated', order)
    emitEvent('table.session.updated', { tableId: payload.tableId })

    return res.status(201).json(order)
  }),
)

router.post(
  '/qr/:id/items',
  requireQrToken,
  asyncRoute(async (req, res) => {
    const targetOrder = db.getOrderById(req.params.id)
    if (!targetOrder) throw new Error('Pedido no existe')
    if (targetOrder.source !== ORDER_SOURCE.QR) {
      throw new Error('Ruta QR solo permite pedidos de origen QR')
    }
    if (targetOrder.tableId !== req.qr.tableId) {
      return res.status(403).json({ error: 'Token QR no corresponde al pedido' })
    }

    const payload = qrItemsSchema.parse(req.body)
    const hadNoItems = (targetOrder.items || []).length === 0
    const order = db.addItemsToOrder(req.params.id, payload.items)
    emitEvent('order.updated', order)
    if (hadNoItems && (order.items || []).length > 0 && order.status === ORDER_STATUS.PENDING_WAITER_APPROVAL) {
      emitEvent('qr.new-order', buildQrOrderNotificationPayload(order))
    }
    return res.json(order)
  }),
)

router.post(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = createOrderSchema.parse(req.body)
    const order = db.createOrder({
      tableId: payload.tableId,
      source: payload.source,
      createdByUserId: req.user.id,
    })

    emitEvent('order.updated', order)
    emitEvent('table.session.updated', { tableId: payload.tableId })

    return res.status(201).json(order)
  }),
)

router.post(
  '/:id/items',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = addItemsSchema.parse(req.body)
    const order = db.addItemsToOrder(req.params.id, payload.items)

    emitEvent('order.updated', order)

    return res.json(order)
  }),
)

router.patch(
  '/:id/approve',
  requireAuth,
  asyncRoute(async (req, res) => {
    const order = db.approveQrOrder(req.params.id, req.user.id)
    emitEvent('order.updated', order)
    return res.json(order)
  }),
)

router.patch(
  '/:id/send-kitchen',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = db.sendOrderToKitchen(req.params.id)
    enqueueKitchenPrint(result.ticket)

    emitEvent('order.updated', result.order)
    emitEvent('kitchen.ticket.updated', result.ticket)

    return res.json(result)
  }),
)

router.post(
  '/:id/payments',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = payOrderSchema.parse(req.body)
    const result = db.registerPayment(req.params.id, payload.splitMode, payload.payments, req.user.id)

    emitEvent('order.updated', result.order)
    emitEvent('cash.session.updated', db.getOpenCashAndSummary())
    emitEvent('table.session.updated', { tableId: result.order.tableId })

    return res.status(201).json(result)
  }),
)

router.patch(
  '/:id/history',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateHistoryOrderSchema.parse(req.body)
    const previous = db.getOrderById(req.params.id)
    if (!previous) throw new Error('Pedido no existe')

    if (req.user.role === ROLES.ADMIN && payload.tableId != null) {
      throw new Error('Admin solo puede cambiar el estado del pedido')
    }

    const order = db.updateOrderRecord(req.params.id, payload, req.user.role)

    emitEvent('order.updated', order)
    emitEvent('cash.session.updated', db.getOpenCashAndSummary())
    emitEvent('table.session.updated', { tableId: previous.tableId })
    if (payload.tableId && payload.tableId !== previous.tableId) {
      emitEvent('table.session.updated', { tableId: payload.tableId })
    }

    return res.json(order)
  }),
)

router.delete(
  '/:id/history',
  requireAuth,
  requireRoles(ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const removed = db.deleteOrderRecord(req.params.id)

    emitEvent('order.updated', { id: removed.id, deleted: true })
    emitEvent('cash.session.updated', db.getOpenCashAndSummary())
    emitEvent('table.session.updated', { tableId: removed.tableId })

    return res.json({
      deleted: true,
      id: removed.id,
    })
  }),
)
export default router

