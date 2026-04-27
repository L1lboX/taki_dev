import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth } from '../auth.js'
import { db } from '../store.js'

const router = Router()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  photoUrl: z.string().trim().optional(),
  currentPassword: z.string().trim().optional(),
  newPassword: z.string().trim().min(4).optional(),
})

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const payload = loginSchema.parse(req.body)
    const authResult = db.login(payload.username, payload.password)

    if (!authResult) {
      return res.status(401).json({ error: 'Credenciales invalidas' })
    }

    return res.json(authResult)
  }),
)

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    return res.json(db.getMyProfile(req.user.id))
  }),
)

router.patch(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = updateProfileSchema.parse(req.body)
    return res.json(db.updateMyProfile(req.user.id, payload))
  }),
)

export default router

