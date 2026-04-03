import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const createSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  document: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  active: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  document: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  active: z.boolean().optional(),
})

function parseBoolean(raw) {
  if (raw == null || raw === '') return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

router.get(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseBoolean(req.query.active?.toString())
    return res.json(db.listCustomers({ active }))
  }),
)

router.post(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createSchema.parse(req.body)
    return res.status(201).json(db.createCustomer(payload))
  }),
)

router.patch(
  '/:customerId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateSchema.parse(req.body)
    return res.json(db.updateCustomer(req.params.customerId, payload))
  }),
)

export default router
