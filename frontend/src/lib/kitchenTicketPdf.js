function cleanName(name) {
  return String(name || '').replace(/^Entrada extra:\s*/i, '').trim()
}

function resolveTableLabel(tableId, tableNumber) {
  if (tableNumber != null && tableNumber !== '') return String(tableNumber)
  const raw = String(tableId || '')
  return raw.replace(/^t/i, '') || '-'
}

function writeWrapped(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth)
  for (const line of lines) {
    doc.text(line, x, y)
    y += lineHeight
  }
  return y
}

export async function downloadKitchenTicketPdf(ticket, options = {}) {
  if (!ticket?.id) {
    throw new Error('Ticket invalido para generar PDF')
  }

  const { jsPDF } = await import('jspdf')

  const pageWidth = 80
  const pageHeight = 220
  const margin = 4
  const contentWidth = pageWidth - margin * 2
  const lineHeight = 3.6

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, pageHeight],
  })

  let y = 6

  const ensureSpace = (lines = 1) => {
    if (y + lines * lineHeight > pageHeight - 6) {
      doc.addPage([pageWidth, pageHeight])
      y = 6
    }
  }

  const writeLine = (text, config = {}) => {
    const { size = 9, weight = 'normal', align = 'left', extraGap = 0 } = config
    doc.setFont('helvetica', weight)
    doc.setFontSize(size)

    const lines = doc.splitTextToSize(String(text || ''), contentWidth)
    ensureSpace(lines.length)

    const x = align === 'center' ? pageWidth / 2 : margin
    const textAlign = align === 'center' ? { align: 'center' } : undefined
    for (const line of lines) {
      doc.text(line, x, y, textAlign)
      y += lineHeight
    }
    y += extraGap
  }

  const tableLabel = resolveTableLabel(ticket.tableId, options.tableNumber ?? ticket.tableNumber ?? ticket.tableLabel)
  const issuedAt = new Date(ticket.createdAt || Date.now()).toLocaleString('es-PE', { hour12: false })
  const ticketNumber = Number(ticket.displayNumber || ticket.ticketNumber || 0)
  const ticketCode = ticketNumber > 0 ? String(ticketNumber) : ticket.id.slice(0, 6)

  writeLine('TAKI POS', { size: 12, weight: 'bold', align: 'center' })
  writeLine('Comanda cocina (PDF temporal)', { size: 8, align: 'center', extraGap: 1.5 })
  writeLine(`Comanda: ${ticketCode}`, { weight: 'bold' })
  writeLine(`Mesa: ${tableLabel}`)
  writeLine(`Fecha: ${issuedAt}`)
  writeLine('----------------------------------------', { size: 8 })

  const items = Array.isArray(ticket.items) ? ticket.items : []
  for (const item of items) {
    writeLine(`${Number(item.quantity || 0)}x ${cleanName(item.productName)}`, { weight: 'bold' })

    const servingLines = Array.isArray(item.servingLines) ? item.servingLines : []
    for (const servingLine of servingLines) {
      writeLine(
        `${Number(servingLine.quantity || 0)}x ${cleanName(servingLine.name)}`,
        { size: 8 },
      )
    }

    const detail = String(item.detail || '').trim()
    if (detail) {
      ensureSpace(1)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      y = writeWrapped(doc, `Detalle: ${detail}`, margin, y, contentWidth, lineHeight)
    }

    y += 1.2
    ensureSpace(1)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('----------------------------------------', margin, y)
    y += lineHeight
  }

  writeLine('Impresion automatica fisica: pendiente de configuracion', {
    size: 7,
    align: 'center',
    extraGap: 1,
  })
  writeLine('Gracias', { size: 8, align: 'center' })

  doc.save(`comanda-${ticketCode}.pdf`)
}
