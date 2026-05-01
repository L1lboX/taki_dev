import { emitEvent } from './realtime.js'
import { buildKitchenReadyNotificationPayload } from './orderNotifications.js'
import { db } from './store.js'

let timer = null

const AUTO_TICK_MS = Number(process.env.KITCHEN_AUTO_TICK_MS || 30000)
const AUTO_ENABLED = process.env.KITCHEN_AUTO_ENABLED !== 'false'

function runAutoKitchenProgress() {
  const changes = db.autoProgressKitchenTickets()
  for (const change of changes) {
    emitEvent('kitchen.ticket.updated', change.ticket)
    if (change.order) {
      emitEvent('order.updated', change.order)
      if (change.order.status === 'READY') {
        emitEvent('order.ready', buildKitchenReadyNotificationPayload(change.order))
      }
    }
  }
}

export function startKitchenAutoWorker() {
  if (!AUTO_ENABLED || timer) return
  timer = setInterval(runAutoKitchenProgress, AUTO_TICK_MS)
}

export function stopKitchenAutoWorker() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
