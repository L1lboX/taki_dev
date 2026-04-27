import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { emitEvent } from '../realtime.js'
import { db } from '../store.js'

const router = Router()

const openSchema = z.object({
  openingAmount: z.coerce.number().nonnegative().default(0),
})

const closeSchema = z.object({
  countedCashAmount: z.coerce.number().nonnegative().default(0),
  countedDigitalAmount: z.coerce.number().nonnegative().default(0),
})

router.get(
  '/current',
  requireAuth,
  requireRoles(ROLES.CASHIER, ROLES.SUPER_ADMIN),
  asyncRoute(async (_req, res) => {
    return res.json(db.getCurrentCashRegister())
  }),
)

router.get(
  '/transactions',
  requireAuth,
  requireRoles(ROLES.CASHIER, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const cashSessionId = req.query.cashSessionId?.toString() || undefined
    return res.json(db.listCashRegisterTransactions({ cashSessionId }))
  }),
)

router.post(
  '/open',
  requireAuth,
  requireRoles(ROLES.CASHIER, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = openSchema.parse(req.body)
    const result = db.openCashRegister(payload.openingAmount, req.user.id)
    emitEvent('cash.session.updated', db.getOpenCashAndSummary())
    return res.status(201).json(result)
  }),
)

router.post(
  '/close',
  requireAuth,
  requireRoles(ROLES.CASHIER, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = closeSchema.parse(req.body)
    const result = db.closeCashRegister(req.user.id, payload.countedCashAmount, payload.countedDigitalAmount)
    emitEvent('cash.session.updated', null)
    return res.status(201).json(result)
  }),
)

export default router
