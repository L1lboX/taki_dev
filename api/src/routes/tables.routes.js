import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { requirePublicQrAccess } from '../qrToken.js'
import { db } from '../store.js'
import { emitEvent } from '../realtime.js'

const router = Router()

const openSessionSchema = z.object({
  guests: z.number().int().positive(),
})

const updateGuestsSchema = z.object({
  guests: z.number().int().positive(),
})

const createTableSchema = z.object({
  salonId: z.string().min(1),
  number: z.number().int().positive(),
  capacity: z.number().int().positive(),
})

const bulkCreateTablesSchema = z.object({
  salonId: z.string().min(1),
  startNumber: z.number().int().positive(),
  count: z.number().int().positive().max(200),
  capacity: z.number().int().positive(),
})

const updateTableSchema = z
  .object({
    salonId: z.string().min(1).optional(),
    number: z.number().int().positive().optional(),
    capacity: z.number().int().positive().optional(),
    active: z.boolean().optional(),
    qrBlocked: z.boolean().optional(),
  })
  .refine((payload) => payload.salonId != null || payload.number != null || payload.capacity != null || payload.active != null || payload.qrBlocked != null, {
    message: 'Debe enviar al menos un campo para actualizar',
  })

const markPrintedSchema = z.object({
  tableIds: z.array(z.string().min(1)).optional(),
})

function parseBooleanQuery(value) {
  if (value == null || value === '') return undefined
  const normalized = String(value).toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  const error = new Error('Filtro booleano invalido')
  error.status = 400
  throw error
}

function getQrPublicBaseUrl(req) {
  const fromEnv = String(process.env.QR_PUBLIC_BASE_URL || '').trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  if (process.env.NODE_ENV === 'production') {
    const error = new Error('Configuracion faltante: define QR_PUBLIC_BASE_URL para generar URLs QR publicas en produccion.')
    error.status = 500
    throw error
  }

  const allowedOrigin = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean)

  if (allowedOrigin && allowedOrigin !== '*') {
    return allowedOrigin.replace(/\/$/, '')
  }

  return `${req.protocol}://localhost:5173`
}

function mapTableWithSession(table) {
  return {
    ...table,
    salon: table.salon || db.getSalonById(table.salonId),
    activeSession: table.activeSessionId ? db.getTableSessionById(table.activeSessionId) : null,
  }
}

function mapTableQrResponse(table, baseUrl) {
  const token = table.qrToken ? encodeURIComponent(table.qrToken) : ''
  const qrUrl = token
    ? `${baseUrl}/qr/${encodeURIComponent(table.id)}?token=${token}`
    : null

  return {
    id: table.id,
    salonId: table.salonId,
    salonName: table.salon?.name || '',
    number: table.number,
    capacity: table.capacity,
    active: table.active,
    qrStatus: table.qrStatus,
    qrToken: table.qrToken,
    qrGeneratedAt: table.qrGeneratedAt,
    qrPrintedAt: table.qrPrintedAt,
    qrUrl,
  }
}

function mapPublicQrAccessResponse(table, menu) {
  return {
    tableId: table.id,
    number: table.number,
    salon: {
      id: table.salon.id,
      name: table.salon.name,
    },
    sessionOpen: Boolean(table.activeSessionId && db.getTableSessionById(table.activeSessionId)?.closedAt === null),
    menu,
  }
}

router.get(
  '/',
  requireAuth,
  asyncRoute(async (_req, res) => {
    const tables = db.getTables().map((table) => mapTableWithSession(table))
    return res.json(tables)
  }),
)

router.get(
  '/admin',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const active = parseBooleanQuery(req.query.active)
    const tables = db.listTablesAdmin({
      salonId: req.query.salonId?.toString(),
      active,
      status: req.query.status?.toString(),
      qrStatus: req.query.qrStatus?.toString(),
    })

    return res.json(tables.map((table) => mapTableWithSession(table)))
  }),
)

router.post(
  '/',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createTableSchema.parse(req.body)
    const table = db.createTable(payload)

    emitEvent('table.session.updated', {
      type: 'table.created',
      tableId: table.id,
    })

    return res.status(201).json(table)
  }),
)

router.post(
  '/bulk',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = bulkCreateTablesSchema.parse(req.body)
    const tables = db.createTablesBulk(payload)

    emitEvent('table.session.updated', {
      type: 'table.bulk.created',
      count: tables.length,
    })

    return res.status(201).json({
      created: tables,
      count: tables.length,
    })
  }),
)

router.patch(
  '/:id',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateTableSchema.parse(req.body)
    const table = db.updateTableRecord(req.params.id, payload)

    emitEvent('table.session.updated', {
      type: 'table.updated',
      tableId: table.id,
    })

    return res.json(table)
  }),
)

router.get(
  '/qr/public/:tableId',
  requirePublicQrAccess,
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const menu = {
      date: date || new Date().toISOString().slice(0, 10),
      items: db.getCatalogMenus(date),
    }

    return res.json(mapPublicQrAccessResponse(req.qrAccess.table, menu))
  }),
)

router.get(
  '/qr/pending',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const baseUrl = getQrPublicBaseUrl(req)
    const pending = db.listQrPendingTables().map((table) => mapTableQrResponse(table, baseUrl))
    const generated = db.listQrGeneratedTables().map((table) => mapTableQrResponse(table, baseUrl))

    return res.json({
      summary: db.getQrSummary(),
      pending,
      generated,
    })
  }),
)

router.post(
  '/qr/generate-pending',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const baseUrl = getQrPublicBaseUrl(req)
    const generated = db.generatePendingTableQrs().map((table) => mapTableQrResponse(table, baseUrl))

    emitEvent('table.session.updated', {
      type: 'table.qr.generated',
      count: generated.length,
    })

    return res.status(201).json({
      generated,
      summary: db.getQrSummary(),
    })
  }),
)

router.post(
  '/qr/mark-printed',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = markPrintedSchema.parse(req.body || {})
    const marked = db.markTableQrsPrinted(payload.tableIds)

    emitEvent('table.session.updated', {
      type: 'table.qr.printed',
      count: marked.length,
    })

    return res.json({
      marked: marked.length,
      ids: marked.map((table) => table.id),
      summary: db.getQrSummary(),
    })
  }),
)

router.post(
  '/:tableId/session',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = openSessionSchema.parse(req.body)
    const session = db.openTableSession(req.params.tableId, payload.guests, req.user.id)

    emitEvent('table.session.updated', {
      tableId: req.params.tableId,
      session,
    })

    return res.status(201).json(session)
  }),
)

router.patch(
  '/:tableId/session/guests',
  requireAuth,
  asyncRoute(async (req, res) => {
    const payload = updateGuestsSchema.parse(req.body)
    const session = db.updateTableSessionGuests(req.params.tableId, payload.guests)

    emitEvent('table.session.updated', {
      tableId: req.params.tableId,
      session,
    })

    return res.json(session)
  }),
)

export default router
