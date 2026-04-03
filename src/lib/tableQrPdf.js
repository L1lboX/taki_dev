import QRCode from 'qrcode'

function safeText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function fileStamp() {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${mi}`
}

export async function downloadTableQrBatchPdf(rows, options = {}) {
  const items = Array.isArray(rows) ? rows.filter((row) => row?.qrUrl) : []
  if (!items.length) {
    throw new Error('No hay mesas con QR para exportar')
  }

  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const columns = 3
  const cardWidth = 62
  const cardHeight = 88
  const gapX = 7
  const gapY = 8
  const marginX = 10
  const marginY = 14

  const title = safeText(options.title, 'QR Mesas')

  for (let index = 0; index < items.length; index += 1) {
    const row = items[index]
    const pageIndex = Math.floor(index / (columns * 3))
    const indexInPage = index % (columns * 3)
    const col = indexInPage % columns
    const line = Math.floor(indexInPage / columns)

    if (index > 0 && indexInPage === 0) {
      doc.addPage()
    }

    const startX = marginX + col * (cardWidth + gapX)
    const startY = marginY + line * (cardHeight + gapY)

    doc.setDrawColor(190, 190, 190)
    doc.setLineWidth(0.4)
    doc.roundedRect(startX, startY, cardWidth, cardHeight, 2, 2)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(title, startX + 4, startY + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Salon: ${safeText(row.salonName)}`, startX + 4, startY + 13)
    doc.text(`Mesa: ${safeText(row.number)}`, startX + 4, startY + 18)

    const qrDataUrl = await QRCode.toDataURL(row.qrUrl, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
    })

    doc.addImage(qrDataUrl, 'PNG', startX + 8, startY + 21, 46, 46)

    doc.setFontSize(7.5)
    doc.text(`ID: ${safeText(row.id)}`, startX + 4, startY + 71)

    const qrUrl = safeText(row.qrUrl)
    const lines = doc.splitTextToSize(qrUrl, cardWidth - 8)
    doc.text(lines, startX + 4, startY + 76)

    if (pageIndex === 0 && index === 0) {
      doc.setProperties({
        title: `${title} - Lote`,
      })
    }
  }

  doc.save(`qrs-mesas-${fileStamp()}.pdf`)
}
