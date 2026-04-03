import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { BILL_STATUS, ROLES, SPLIT_MODE } from '../constants.js'
import { emitEvent } from '../realtime.js'
import { db } from '../store.js'

const router = Router()

const generateSchema = z.object({
  tableSessionId: z.string().optional(),
  tableId: z.string().optional(),
})

const paySchema = z.object({
  splitMode: z.enum([SPLIT_MODE.TABLE_TOTAL, SPLIT_MODE.SPLIT]).default(SPLIT_MODE.TABLE_TOTAL),
  payments: z.array(
    z.object({
      method: z.enum(['CASH', 'TRANSFER']),
      amount: z.coerce.number().positive(),
    }),
  ).min(1),
})

router.post(
  '/generate',
  requireAuth,
  requireRoles(ROLES.WAITER, ROLES.CASHIER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = generateSchema.parse(req.body || {})
    const rows = db.generateBills(payload)
    return res.status(201).json({ count: rows.length, items: rows })
  }),
)

router.get(
  '/',
  requireAuth,
  requireRoles(ROLES.WAITER, ROLES.CASHIER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const statusCandidate = req.query.status?.toString()
    const status = Object.values(BILL_STATUS).includes(statusCandidate) ? statusCandidate : undefined
    const tableId = req.query.tableId?.toString() || undefined
    const tableSessionId = req.query.tableSessionId?.toString() || undefined

    return res.json(db.listBills({ status, tableId, tableSessionId }))
  }),
)

router.get(
  '/:billId',
  requireAuth,
  requireRoles(ROLES.WAITER, ROLES.CASHIER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const bill = db.getBillById(req.params.billId)
    if (!bill) return res.status(404).json({ error: 'Cuenta no existe' })
    return res.json(bill)
  }),
)

router.post(
  '/:billId/payments',
  requireAuth,
  requireRoles(ROLES.WAITER, ROLES.CASHIER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = paySchema.parse(req.body)
    const result = db.payBill(req.params.billId, payload, req.user.id)

    emitEvent('cash.session.updated', db.getOpenCashAndSummary())
    emitEvent('bill.updated', result.bill)
    emitEvent('table.session.updated', { tableId: result.bill.tableId })

    for (const orderId of result.bill.orderIds || []) {
      const order = db.getOrderById(orderId)
      if (order) emitEvent('order.updated', order)
    }

    return res.status(201).json(result)
  }),
)

export default router
