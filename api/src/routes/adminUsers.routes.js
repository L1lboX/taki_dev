import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const createSchema = z.object({
  username: z.string().trim().min(3),
  password: z.string().trim().min(4),
  name: z.string().trim().min(2),
  role: z.string().trim().min(2),
  active: z.boolean().optional(),
})

const updateSchema = z.object({
  username: z.string().trim().min(3).optional(),
  password: z.string().trim().min(4).optional(),
  name: z.string().trim().min(2).optional(),
  role: z.string().trim().min(2).optional(),
  active: z.boolean().optional(),
})

router.get(
  '/users',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (_req, res) => {
    return res.json(db.listUsersAdmin())
  }),
)

router.post(
  '/users',
  requireAuth,
  requireRoles(ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createSchema.parse(req.body)
    return res.status(201).json(db.createUserAdmin(payload))
  }),
)

router.patch(
  '/users/:userId',
  requireAuth,
  requireRoles(ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateSchema.parse(req.body)
    return res.json(db.updateUserAdmin(req.params.userId, payload))
  }),
)

export default router
