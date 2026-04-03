import { db } from './store.js'

function extractQrToken(req) {
  const headerToken = req.headers['x-qr-token']
  const queryToken = typeof req.query?.qrToken === 'string' ? req.query.qrToken : null
  const token = typeof headerToken === 'string' ? headerToken : queryToken
  return String(token || '').trim()
}

export function issueQrToken(tableId) {
  const table = db.ensureTableQrToken(tableId)
  return {
    token: table.qrToken,
    tableId: table.id,
    persistent: true,
  }
}

export function verifyQrToken(token) {
  const normalized = String(token || '').trim()
  if (!normalized) return null

  const table = db.getTableByQrToken(normalized)
  if (!table) return null

  return {
    tableId: table.id,
    token: normalized,
  }
}

export function requireQrToken(req, res, next) {
  const token = extractQrToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Token QR requerido' })
  }

  const verified = verifyQrToken(token)
  if (!verified) {
    return res.status(401).json({ error: 'Token QR invalido' })
  }

  req.qr = verified
  return next()
}
