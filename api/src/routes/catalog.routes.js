import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const categoryCreateSchema = z.object({
  name: z.string().trim().min(2),
})

const catalogCreateSchema = z.object({
  name: z.string().trim().min(2),
  category: z.string().trim().min(1),
  basePrice: z.coerce.number().nonnegative(),
  imageUrl: z.string().trim().optional().default(''),
  variants: z.array(z.string().trim().min(1)).optional().default(['normal']),
  active: z.boolean().optional().default(true),
})

const catalogUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  category: z.string().trim().min(1).optional(),
  basePrice: z.coerce.number().nonnegative().optional(),
  imageUrl: z.string().trim().optional(),
  variants: z.array(z.string().trim().min(1)).optional(),
  active: z.boolean().optional(),
})

function parseBoolean(value) {
  if (value == null || value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

router.get(
  '/admin/categories',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseBoolean(req.query.active?.toString())
    const categories = db.listCatalogCategories({ active })
    return res.json(categories)
  }),
)

router.post(
  '/admin/categories',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = categoryCreateSchema.parse(req.body)
    const category = db.createCatalogCategory(payload)
    return res.status(201).json(category)
  }),
)

router.get(
  '/admin/items',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseBoolean(req.query.active?.toString())
    const category = req.query.category?.toString() || undefined
    const items = db.listCatalogItems({ active, category })
    return res.json(items)
  }),
)

router.post(
  '/admin/items',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = catalogCreateSchema.parse(req.body)
    const item = db.createCatalogItem(payload)
    return res.status(201).json(item)
  }),
)

router.patch(
  '/admin/items/:itemId',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = catalogUpdateSchema.parse(req.body)
    const item = db.updateCatalogItem(req.params.itemId, payload)
    return res.json(item)
  }),
)

router.get(
  '/menus',
  requireAuth,
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const items = db.getCatalogMenus(date)
    return res.json({
      date: date || new Date().toISOString().slice(0, 10),
      items,
    })
  }),
)

router.get(
  '/public/categories',
  asyncRoute(async (_req, res) => {
    const categories = db.listCatalogCategories({ active: true })
    return res.json(categories)
  }),
)

router.get(
  '/public/items',
  asyncRoute(async (_req, res) => {
    const items = db.listCatalogItems({ active: true })
    return res.json(items)
  }),
)

router.get(
  '/public/menus',
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const items = db.getCatalogMenus(date)
    return res.json({
      date: date || new Date().toISOString().slice(0, 10),
      items,
    })
  }),
)

export default router
