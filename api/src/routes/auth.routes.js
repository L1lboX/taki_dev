import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute } from '../auth.js'
import { db } from '../store.js'

const router = Router()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
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

export default router

