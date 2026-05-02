import { spawn } from 'node:child_process'
import net from 'node:net'
import { db } from './store.js'
import { emitEvent } from './realtime.js'

let timer = null
let processing = false

function padRight(value, width) {
  return String(value || '').slice(0, width).padEnd(width, ' ')
}

function lineWidthFor(settings) {
  return settings?.paperWidth === '58mm' ? 32 : 42
}

function wrapText(text, width) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }

    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function center(text, width) {
  const value = String(text || '').trim()
  if (value.length >= width) return value.slice(0, width)
  const left = Math.floor((width - value.length) / 2)
  return `${' '.repeat(left)}${value}`
}

function formatKitchenTicket(job, settings) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
  const width = lineWidthFor(settings)
  const separator = '-'.repeat(width)
  const ticketNumber = payload.displayNumber || String(payload.ticketId || job.ticketId || '').slice(0, 6)
  const tableLabel = payload.tableNumber ?? payload.tableLabel ?? String(payload.tableId || '').replace(/^t/i, '')
  const issuedAt = new Date(job.createdAt || Date.now()).toLocaleString('es-PE', { hour12: false })
  const lines = [
    center('TAKI COCINA', width),
    separator,
    `Comanda: ${ticketNumber}`,
    `Mesa: ${tableLabel || '-'}`,
    `Fecha: ${issuedAt}`,
    separator,
  ]

  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) {
    lines.push('Sin items')
  }

  for (const item of items) {
    const quantity = Number(item.quantity || 1)
    const name = item.productName || item.name || 'Producto'
    const prefix = `${quantity} x `
    const available = Math.max(8, width - prefix.length)
    const wrapped = wrapText(name, available)

    lines.push(`${prefix}${wrapped[0]}`)
    for (const extraLine of wrapped.slice(1)) {
      lines.push(`${padRight('', prefix.length)}${extraLine}`)
    }

    const notes = String(item.notes || '').trim()
    if (notes) {
      for (const noteLine of wrapText(`Nota: ${notes}`, width - 2)) {
        lines.push(`  ${noteLine}`)
      }
    }
  }

  lines.push(separator, '', '', '')
  return `${lines.join('\n')}\n`
}

function buildEscPosPayload(text) {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(text, 'latin1'),
    Buffer.from([0x1d, 0x56, 0x42, 0x00]),
  ])
}

function printToLanPrinter(text, settings) {
  return new Promise((resolve, reject) => {
    const host = String(settings.host || '').trim()
    const port = Number(settings.port || 9100)

    if (!host) {
      reject(new Error('Configura la IP de la impresora LAN'))
      return
    }

    const socket = net.createConnection({ host, port, timeout: 6000 }, () => {
      socket.end(buildEscPosPayload(text))
    })

    socket.on('close', resolve)
    socket.on('error', reject)
    socket.on('timeout', () => {
      socket.destroy(new Error('Tiempo agotado conectando con la impresora LAN'))
    })
  })
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''")
}

function printToWindowsUsbPrinter(text, settings) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('La impresion USB automatica solo esta configurada para Windows'))
      return
    }

    const printerName = String(settings.printerName || '').trim()
    const printerArg = printerName ? ` -Name '${escapePowerShellSingleQuoted(printerName)}'` : ''
    const script = `$ticket = @'
${text.replace(/\r/g, '')}
'@
$path = Join-Path $env:TEMP ('taki-ticket-' + [guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $path -Value $ticket -Encoding Default
Get-Content -LiteralPath $path | Out-Printer${printerArg}
Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue`
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `PowerShell termino con codigo ${code}`))
    })
  })
}

async function writePrinterJob(job) {
  const forceFail = process.env.PRINTER_FORCE_FAIL === 'true'
  if (forceFail && job.attempts < 3) {
    throw new Error('Simulated printer failure')
  }

  const settings = db.getRestaurantPrinterSettings()
  const text = formatKitchenTicket(job, settings)

  if (settings.connectionType === 'LAN') {
    await printToLanPrinter(text, settings)
    return
  }

  await printToWindowsUsbPrinter(text, settings)
}

async function processOneJob() {
  if (processing) return
  const job = db.getNextPrinterJob()
  if (!job) return

  processing = true
  db.markPrinterJobProcessing(job.id)

  try {
    await writePrinterJob(job)
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
  } finally {
    processing = false
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
  timer = setInterval(() => {
    void processOneJob()
  }, 750)
}

export function stopPrinterWorker() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
