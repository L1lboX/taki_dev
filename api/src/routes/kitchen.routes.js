import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { KITCHEN_TICKET_STATUS, ROLES } from '../constants.js'
import { emitEvent } from '../realtime.js'
import { db } from '../store.js'

const router = Router()

const updateStatusSchema = z.object({
  status: z.enum([
    KITCHEN_TICKET_STATUS.PENDING,
    KITCHEN_TICKET_STATUS.PREPARING,
    KITCHEN_TICKET_STATUS.READY,
    KITCHEN_TICKET_STATUS.DELIVERED,
  ]),
})

router.get(
  '/tickets',
  requireAuth,
  requireRoles(ROLES.COOK, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const tickets = db.listKitchenTickets()
    return res.json(tickets)
  }),
)

router.patch(
  '/tickets/:id/status',
  requireAuth,
  requireRoles(ROLES.COOK, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateStatusSchema.parse(req.body)
    const result = db.updateKitchenTicketStatus(req.params.id, payload.status)

    emitEvent('kitchen.ticket.updated', result.ticket)
    if (result.order) {
      emitEvent('order.updated', result.order)
    }

    return res.json(result)
  }),
)

router.get(
  '/incidents',
  requireAuth,
  requireRoles(ROLES.COOK, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    return res.json(db.getIncidents())
  }),
)

export default router

