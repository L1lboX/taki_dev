import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { KITCHEN_TICKET_STATUS, ORDER_SOURCE, ORDER_STATUS, ROLES, SPLIT_MODE } from '../constants.js'
import { buildQrOrderNotificationPayload } from '../orderNotifications.js'
import { enqueueKitchenPrint } from '../printer.js'
import { extractQrGuestToken, requireQrToken } from '../qrToken.js'
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
      includedEntryProductId: z.string().min(1).optional(),
      guestSessionId: z.string().min(1).optional(),
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

const sendKitchenBatchSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
  mergePrint: z.boolean().default(false),
})

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

    const guestToken = extractQrGuestToken(req)
    if (!guestToken) {
      return res.status(403).json({ error: 'Sesion QR requerida' })
    }

    const me = db.getQrGuestContext(payload.tableId, guestToken)
    if (!me?.tableSession || !me?.guestSession) {
      return res.status(409).json({ error: 'Debes unirte a la mesa antes de pedir' })
    }

    const order = db.createOrGetQrOrder(payload.tableId, me.guestSession.id)

    emitEvent('order.updated', order)
    emitEvent('table.session.updated', { tableId: payload.tableId })

    return res.status(201).json(order)
  }),
)

router.post(
  '/qr/:id/items',
  requireQrToken,
  asyncRoute(async (req, res) => {
    const guestToken = extractQrGuestToken(req)
    if (!guestToken) {
      return res.status(403).json({ error: 'Sesion QR requerida' })
    }

    const targetOrder = db.getOrderById(req.params.id)
    if (!targetOrder) throw new Error('Pedido no existe')
    if (targetOrder.source !== ORDER_SOURCE.QR) {
      throw new Error('Ruta QR solo permite pedidos de origen QR')
    }
    if (targetOrder.tableId !== req.qr.tableId) {
      return res.status(403).json({ error: 'Token QR no corresponde al pedido' })
    }

    const me = db.getQrGuestContext(targetOrder.tableId, guestToken)
    if (!me?.guestSession) {
      return res.status(409).json({ error: 'Sesion QR no activa para esta mesa' })
    }
    if (targetOrder.guestSessionId !== me.guestSession.id) {
      return res.status(403).json({ error: 'La persona QR no puede modificar este pedido' })
    }

    const payload = qrItemsSchema.parse(req.body)
    const order = db.addItemsToOrder(req.params.id, payload.items)
    if ((order.items || []).length > 0 && order.status === ORDER_STATUS.PENDING_WAITER_APPROVAL) {
      emitEvent('qr.new-order', buildQrOrderNotificationPayload(order))
    }

    emitEvent('order.updated', order)
    return res.json(order)
  }),
)

router.patch(
  '/send-kitchen-batch',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = sendKitchenBatchSchema.parse(req.body)
    const uniqueIds = Array.from(new Set(payload.orderIds))
    const results = uniqueIds.map((orderId) => db.sendOrderToKitchen(orderId))
    let mergedPrintDispatch = null
    let ticketDispatches = []

    let mergedTicket = null
    if (payload.mergePrint) {
      const baseOrder = results[0]?.order
      mergedTicket = {
        id: `merge-${randomUUID()}`,
        tableId: baseOrder?.tableId || '',
        tableSessionId: baseOrder?.tableSessionId || null,
        createdAt: new Date().toISOString(),
        items: results.flatMap((result) =>
          (result.ticket?.items || []).map((item) => ({
            ...item,
            productName: `${result.order?.guestNumber ? `P${result.order.guestNumber} · ` : ''}${item.productName}`,
          })),
        ),
      }
      mergedPrintDispatch = enqueueKitchenPrint(mergedTicket)
    } else {
      ticketDispatches = results.map((result) => ({
        orderId: result.order.id,
        ticketId: result.ticket.id,
        ...enqueueKitchenPrint(result.ticket),
      }))
    }

    results.forEach((result) => {
      emitEvent('order.updated', result.order)
      emitEvent('kitchen.ticket.updated', result.ticket)
    })

    return res.json({
      orders: results.map((result) => result.order),
      tickets: results.map((result) => result.ticket),
      mergedTicket,
      mergedPrintDispatch,
      ticketDispatches,
    })
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
    const printDispatch = enqueueKitchenPrint(result.ticket)

    emitEvent('order.updated', result.order)
    emitEvent('kitchen.ticket.updated', result.ticket)

    return res.json({
      ...result,
      printDispatch,
    })
  }),
)

router.patch(
  '/:id/deliver',
  requireAuth,
  requireRoles(ROLES.WAITER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const order = db.getOrderById(req.params.id)
    if (!order) throw new Error('Pedido no existe')
    if (order.status !== ORDER_STATUS.READY) {
      throw new Error('Solo se puede entregar un pedido en estado LISTO')
    }

    let result
    if (order.kitchenTicketId) {
      result = db.updateKitchenTicketStatus(order.kitchenTicketId, KITCHEN_TICKET_STATUS.DELIVERED)
    } else {
      result = {
        ticket: null,
        order: db.updateOrderRecord(order.id, { status: ORDER_STATUS.DELIVERED }, ROLES.ADMIN),
      }
    }

    if (result.ticket) {
      emitEvent('kitchen.ticket.updated', result.ticket)
    }
    emitEvent('order.updated', result.order)
    emitEvent('table.session.updated', { tableId: result.order.tableId })

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

