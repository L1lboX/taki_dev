import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const printerSchema = z.object({
  kitchenEnabled: z.boolean().optional(),
  autoPrintOnSend: z.boolean().optional(),
  connectionType: z.enum(['USB', 'LAN']).optional(),
  printerName: z.string().trim().optional(),
  host: z.string().trim().optional(),
  port: z.union([z.string().trim(), z.number()]).optional(),
  paperWidth: z.enum(['58mm', '80mm']).optional(),
  fallbackToPdf: z.boolean().optional(),
})

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
  profileEmail: z.string().trim().optional(),
  profileWebsite: z.string().trim().optional(),
  profileDescription: z.string().trim().optional(),
  printers: printerSchema.optional(),
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
