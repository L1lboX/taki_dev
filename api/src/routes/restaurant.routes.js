import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  legalName: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  logoUrl: z.string().trim().optional(),
  primaryColor: z.string().trim().optional(),
})

router.get(
  '/restaurant',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (_req, res) => {
    return res.json(db.getRestaurantSettings())
  }),
)

router.patch(
  '/restaurant',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateSchema.parse(req.body)
    return res.json(db.updateRestaurantSettings(payload))
  }),
)

export default router
