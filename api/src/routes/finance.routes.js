import { Router } from 'express'
import { z } from 'zod'
import { asyncRoute, requireAuth, requireRoles } from '../auth.js'
import { FINANCE_ACCOUNT_TYPE, FINANCE_TRANSACTION_TYPE, ROLES } from '../constants.js'
import { db } from '../store.js'

const router = Router()

const createAccountSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum([FINANCE_ACCOUNT_TYPE.CASH, FINANCE_ACCOUNT_TYPE.BANK, FINANCE_ACCOUNT_TYPE.DIGITAL]),
  balance: z.coerce.number().optional().default(0),
  description: z.string().trim().optional().default(''),
  active: z.boolean().optional().default(true),
})

const updateAccountSchema = z.object({
  name: z.string().trim().min(2).optional(),
  type: z.enum([FINANCE_ACCOUNT_TYPE.CASH, FINANCE_ACCOUNT_TYPE.BANK, FINANCE_ACCOUNT_TYPE.DIGITAL]).optional(),
  balance: z.coerce.number().optional(),
  description: z.string().trim().optional(),
  active: z.boolean().optional(),
})

const createTxSchema = z.object({
  type: z.enum([FINANCE_TRANSACTION_TYPE.INCOME, FINANCE_TRANSACTION_TYPE.EXPENSE, FINANCE_TRANSACTION_TYPE.TRANSFER]),
  amount: z.coerce.number().positive(),
  accountId: z.string().optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  note: z.string().trim().optional().default(''),
  reference: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default(''),
  source: z.string().trim().optional().default('MANUAL'),
})

const registerSalesSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().trim().min(1),
  note: z.string().trim().optional().default(''),
})

router.get(
  '/accounts',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const activeRaw = req.query.active?.toString()
    const active = activeRaw === 'true' ? true : activeRaw === 'false' ? false : undefined
    return res.json(db.listFinanceAccounts({ active }))
  }),
)

router.post(
  '/accounts',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createAccountSchema.parse(req.body)
    const account = db.createFinanceAccount(payload)
    return res.status(201).json(account)
  }),
)

router.patch(
  '/accounts/:accountId',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = updateAccountSchema.parse(req.body)
    const account = db.updateFinanceAccount(req.params.accountId, payload)
    return res.json(account)
  }),
)

router.get(
  '/transactions',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const from = req.query.from?.toString() || undefined
    const to = req.query.to?.toString() || undefined
    const accountId = req.query.accountId?.toString() || undefined
    const type = req.query.type?.toString() || undefined

    return res.json(db.listFinanceTransactions({ from, to, accountId, type }))
  }),
)

router.get(
  '/summary',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const date = req.query.date?.toString()
    const month = req.query.month?.toString()
    const timezone = req.query.timezone?.toString()
    return res.json(db.getFinanceSummary({ date, month, timezone }))
  }),
)

router.post(
  '/transactions',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = createTxSchema.parse(req.body)
    const tx = db.createFinanceTransaction(payload, req.user.id)
    return res.status(201).json(tx)
  }),
)

router.post(
  '/transactions/register-sales',
  requireAuth,
  requireRoles(ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN),
  asyncRoute(async (req, res) => {
    const payload = registerSalesSchema.parse(req.body)
    const tx = db.registerDailySalesFinanceTransaction(payload, req.user.id)
    return res.status(201).json(tx)
  }),
)

export default router
