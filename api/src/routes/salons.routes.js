import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { emitEvent } from '../realtime.js'
import { db } from '../store.js'

const router = Router()

const createSalonSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().positive().optional(),
})

const updateSalonSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().positive().optional(),
    active: z.boolean().optional(),
  })
  .refine((payload) => payload.name != null || payload.sortOrder != null || payload.active != null, {
    message: 'Debe enviar al menos un campo para actualizar',
  })

function parseActiveFilter(raw) {
  if (raw == null || raw === '') return undefined
  const normalized = String(raw).toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  const error = new Error('Filtro active invalido')
  error.status = 400
  throw error
}

router.get(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseActiveFilter(req.query.active)
    return res.json(db.listSalons({ active }))
  }),
)

router.post(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createSalonSchema.parse(req.body)
    const salon = db.createSalon(payload)

    emitEvent('table.session.updated', {
      type: 'salon.created',
      salonId: salon.id,
    })

    return res.status(201).json(salon)
  }),
)

router.patch(
  '/:id',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateSalonSchema.parse(req.body)
    const salon = db.updateSalon(req.params.id, payload)

    emitEvent('table.session.updated', {
      type: 'salon.updated',
      salonId: salon.id,
    })

    return res.json(salon)
  }),
)

export default router
