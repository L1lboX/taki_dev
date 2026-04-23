import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import http from 'node:http'
import helmet from 'helmet'
import { Server } from 'socket.io'
import { startKitchenAutoWorker, stopKitchenAutoWorker } from './kitchenAuto.js'
import { startPrinterWorker, stopPrinterWorker } from './printer.js'
import { initRealtime } from './realtime.js'
import authRoutes from './routes/auth.routes.js'
import billsRoutes from './routes/bills.routes.js'
import cashRegisterRoutes from './routes/cashRegister.routes.js'
import cashRoutes from './routes/cash.routes.js'
import catalogRoutes from './routes/catalog.routes.js'
import customersRoutes from './routes/customers.routes.js'
import financeRoutes from './routes/finance.routes.js'
import inventoryRoutes from './routes/inventory.routes.js'
import kitchenRoutes from './routes/kitchen.routes.js'
import kpisRoutes from './routes/kpis.routes.js'
import menuRoutes from './routes/menu.routes.js'
import ordersRoutes from './routes/orders.routes.js'
import adminUsersRoutes from './routes/adminUsers.routes.js'
import restaurantRoutes from './routes/restaurant.routes.js'
import salonsRoutes from './routes/salons.routes.js'
import tablesRoutes from './routes/tables.routes.js'
import { db } from './store.js'

const app = express()
const server = http.createServer(app)

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const allowAnyOrigin = allowedOrigins.includes('*')
const socketAllowedOrigins = allowAnyOrigin ? true : allowedOrigins
const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
const allowedHeaders = ['Content-Type', 'Authorization', 'X-QR-Token', 'X-QR-Guest-Token']

function corsOriginResolver(origin, callback) {
  if (allowAnyOrigin || !origin || allowedOrigins.includes(origin)) {
    callback(null, true)
    return
  }

  callback(new Error('Origen no permitido por CORS'))
}

const io = new Server(server, {
  cors: {
    origin: socketAllowedOrigins,
    methods: allowedMethods,
    allowedHeaders,
  },
})

initRealtime(io)

app.disable('x-powered-by')
app.use(helmet())
app.use(
  cors({
    origin: corsOriginResolver,
    methods: allowedMethods,
    allowedHeaders,
  }),
)
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  return res.json({ status: 'ok', now: new Date().toISOString() })
})

const qrRateLimitWindowMs = Number(process.env.QR_RATE_LIMIT_WINDOW_MS || 60000)
const qrRateLimitMax = Number(process.env.QR_RATE_LIMIT_MAX || 40)
const qrLimiter = rateLimit({
  windowMs: Number.isFinite(qrRateLimitWindowMs) && qrRateLimitWindowMs > 0 ? qrRateLimitWindowMs : 60000,
  max: Number.isFinite(qrRateLimitMax) && qrRateLimitMax > 0 ? qrRateLimitMax : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes QR. Intenta nuevamente en unos segundos.',
  },
})

app.use('/auth', authRoutes)
app.use('/catalog', catalogRoutes)
app.use('/menu', menuRoutes)
app.use('/salons', salonsRoutes)
app.use('/customers', customersRoutes)
app.use('/admin', adminUsersRoutes)
app.use('/admin', restaurantRoutes)
app.use('/tables', tablesRoutes)
app.use('/orders/qr', qrLimiter)
app.use('/bills', billsRoutes)
app.use('/orders', ordersRoutes)
app.use('/kitchen', kitchenRoutes)
app.use('/cash', cashRoutes)
app.use('/cash-register', cashRegisterRoutes)
app.use('/finance', financeRoutes)
app.use('/kpis', kpisRoutes)
app.use('/inventory', inventoryRoutes)

app.use((error, _req, res, _next) => {
  void _next

  if (error?.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validacion fallida',
      details: error.issues,
    })
  }

  if (error?.message === 'Origen no permitido por CORS') {
    return res.status(403).json({ error: 'Origen no permitido por CORS' })
  }

  const status = Number(error?.statusCode || error?.status || 500)
  const message = error instanceof Error ? error.message : 'Error inesperado'

  if (status >= 500) {
    console.error('[api] error no controlado:', error)
  }

  return res.status(status).json({ error: message })
})

io.on('connection', (socket) => {
  socket.emit('connected', { id: socket.id, at: new Date().toISOString() })
})

const PORT = Number(process.env.API_PORT || 4000)

async function startServer() {
  await db.init()
  startPrinterWorker()
  startKitchenAutoWorker()

  await new Promise((resolve) => {
    server.listen(PORT, resolve)
  })

  console.log(`POS API running on http://localhost:${PORT}`)
}

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[api] recibi ${signal}. iniciando cierre controlado...`)

  stopPrinterWorker()
  stopKitchenAutoWorker()

  await new Promise((resolve) => {
    server.close(() => resolve())
  })

  await db.shutdown()
  process.exit(0)
}

void startServer().catch((error) => {
  console.error('[api] no se pudo iniciar el servidor:', error)
  process.exit(1)
})

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
