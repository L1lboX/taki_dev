import { Router } from 'express'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

router.get(
  '/daily',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    return res.json(db.getDailyKpi(date))
  }),
)

router.get(
  '/monthly',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const month = req.query.month?.toString()
    return res.json(db.getMonthlyKpi(month))
  }),
)

router.get(
  '/top-dishes',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const from = req.query.from?.toString()
    const to = req.query.to?.toString()
    const limit = req.query.limit ? Number(req.query.limit) : undefined

    return res.json(
      db.getTopDishes({
        from,
        to,
        limit,
      }),
    )
  }),
)

router.get(
  '/cards/clients',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getKpiClientsSummary({ date, timezone }))
  }),
)

router.get(
  '/cards/monthly-profit',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const month = req.query.month?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getKpiMonthlyProfitSummary({ month, timezone }))
  }),
)

router.get(
  '/cards/incomes',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getKpiIncomesSummary({ date, timezone }))
  }),
)

router.get(
  '/cards/orders',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getKpiOrdersSummary({ date, timezone }))
  }),
)

router.get(
  '/top-products',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const month = req.query.month?.toString()
    const timezone = req.query.timezone?.toString()
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    return res.json(db.getKpiTopProducts({ month, limit, timezone }))
  }),
)

router.get(
  '/waiters',
  requireAuth,
  requireRoles(ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const period = req.query.period?.toString()
    const date = req.query.date?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getKpiWaitersSummary({ period, date, timezone }))
  }),
)

export default router

