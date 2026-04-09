import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const sectionCreateSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().optional(),
  description: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
})

const sectionUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  code: z.string().trim().optional(),
  description: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
})

const categoryCreateSchema = z.object({
  sectionId: z.string().min(1),
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
})

const categoryUpdateSchema = z.object({
  sectionId: z.string().min(1).optional(),
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
})

const optionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  extraPrice: z.coerce.number().optional().default(0),
})

const productCreateSchema = z.object({
  sectionId: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().trim().min(2),
  productionAreaId: z.string().trim().optional(),
  price: z.coerce.number().nonnegative(),
  unitCost: z.coerce.number().nonnegative().optional().default(0),
  iva: z.coerce.number().nonnegative().optional().default(0),
  quantity: z.coerce.number().int().nonnegative().optional().default(0),
  status: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'OUT_OF_SEASON']).optional().default('AVAILABLE'),
  isActive: z.boolean().optional().default(true),
  isPublic: z.boolean().optional().default(true),
  imageUrl: z.string().trim().optional().default(''),
  options: z.array(optionSchema).optional().default([]),
})

const productUpdateSchema = z.object({
  sectionId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  name: z.string().trim().min(2).optional(),
  productionAreaId: z.string().trim().optional(),
  price: z.coerce.number().nonnegative().optional(),
  unitCost: z.coerce.number().nonnegative().optional(),
  iva: z.coerce.number().nonnegative().optional(),
  quantity: z.coerce.number().int().nonnegative().optional(),
  status: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'OUT_OF_SEASON']).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  imageUrl: z.string().trim().optional(),
  options: z.array(optionSchema).optional(),
})

function parseBoolean(raw) {
  if (raw == null || raw === '') return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

router.get(
  '/sections',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseBoolean(req.query.active?.toString())
    return res.json(db.listMenuSections({ active }))
  }),
)

router.post(
  '/sections',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = sectionCreateSchema.parse(req.body)
    return res.status(201).json(db.createMenuSection(payload))
  }),
)

router.patch(
  '/sections/:sectionId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = sectionUpdateSchema.parse(req.body)
    return res.json(db.updateMenuSection(req.params.sectionId, payload))
  }),
)

router.delete(
  '/sections/:sectionId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    return res.json(db.deleteMenuSection(req.params.sectionId))
  }),
)

router.get(
  '/categories',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const sectionId = req.query.sectionId?.toString() || undefined
    const active = parseBoolean(req.query.active?.toString())
    return res.json(db.listMenuCategories({ sectionId, active }))
  }),
)

router.post(
  '/categories',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = categoryCreateSchema.parse(req.body)
    return res.status(201).json(db.createMenuCategory(payload))
  }),
)

router.patch(
  '/categories/:categoryId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = categoryUpdateSchema.parse(req.body)
    return res.json(db.updateMenuCategory(req.params.categoryId, payload))
  }),
)

router.delete(
  '/categories/:categoryId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    return res.json(db.deleteMenuCategory(req.params.categoryId))
  }),
)

router.get(
  '/products',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const sectionId = req.query.sectionId?.toString() || undefined
    const categoryId = req.query.categoryId?.toString() || undefined
    const active = parseBoolean(req.query.active?.toString())
    const isPublic = parseBoolean(req.query.isPublic?.toString())
    const status = req.query.status?.toString() || undefined

    return res.json(db.listMenuProducts({ sectionId, categoryId, active, status, isPublic }))
  }),
)

router.post(
  '/products',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = productCreateSchema.parse(req.body)
    return res.status(201).json(db.createMenuProduct(payload))
  }),
)

router.patch(
  '/products/:productId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = productUpdateSchema.parse(req.body)
    return res.json(db.updateMenuProduct(req.params.productId, payload))
  }),
)

router.delete(
  '/products/:productId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    return res.json(db.deleteMenuProduct(req.params.productId))
  }),
)

export default router
