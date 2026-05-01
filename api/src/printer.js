import { db } from './store.js'
import { emitEvent } from './realtime.js'

let timer = null

function simulatePrinterWrite(job) {
  const forceFail = process.env.PRINTER_FORCE_FAIL === 'true'
  if (forceFail && job.attempts < 3) {
    throw new Error('Simulated printer failure')
  }
}

function processOneJob() {
  const job = db.getNextPrinterJob()
  if (!job) return

  db.markPrinterJobProcessing(job.id)

  try {
    simulatePrinterWrite(job)
    db.markPrinterJobDone(job.id)

    emitEvent('kitchen.ticket.updated', {
      ticketId: job.ticketId,
      printed: true,
      status: 'PRINTED',
    })
  } catch (error) {
    db.markPrinterJobFailed(job.id, error.message)

    emitEvent('kitchen.ticket.updated', {
      ticketId: job.ticketId,
      printed: false,
      status: 'PRINT_FAILED',
      message: error.message,
    })
  }
}

export function enqueueKitchenPrint(ticket) {
  const settings = db.getRestaurantPrinterSettings()

  if (!settings.kitchenEnabled || !settings.autoPrintOnSend) {
    return {
      queued: false,
      settings,
    }
  }

  db.createPrinterJob(ticket.id, {
    ticketId: ticket.id,
    displayNumber: ticket.displayNumber || ticket.ticketNumber || null,
    tableId: ticket.tableId,
    tableNumber: ticket.tableNumber ?? null,
    tableLabel: ticket.tableLabel || '',
    items: ticket.items,
  })

  return {
    queued: true,
    settings,
  }
}

export function startPrinterWorker() {
  if (timer) return
  timer = setInterval(processOneJob, 750)
}

export function stopPrinterWorker() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

