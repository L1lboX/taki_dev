import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const updateSchema = z.object({
  stock: z.number().nonnegative().optional(),
  lowStockThreshold: z.number().nonnegative().optional(),
})

router.get(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (_req, res) => {
    return res.json(db.getInventory())
  }),
)

router.patch(
  '/:productId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateSchema.parse(req.body)
    const row = db.updateInventory(req.params.productId, payload)
    return res.json(row)
  }),
)

export default router

