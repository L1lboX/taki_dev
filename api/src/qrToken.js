import { db } from './store.js'

const MIN_TABLE_ID_PREFIX_LENGTH = 16
const QR_PUBLIC_ERROR = 'QR invalido o no disponible'

export function extractQrToken(req) {
  const headerToken = req.headers['x-qr-token']
  const queryToken = typeof req.query?.token === 'string'
    ? req.query.token
    : typeof req.query?.qrToken === 'string'
      ? req.query.qrToken
      : null
  const token = typeof headerToken === 'string' ? headerToken : queryToken
  return String(token || '').trim()
}

function resolvePublicTable(rawTableId) {
  const tableId = String(rawTableId || '').trim()
  if (!tableId) return null

  const exact = db.getTableById(tableId)
  if (exact) return exact

  if (tableId.length < MIN_TABLE_ID_PREFIX_LENGTH) return null

  const matches = db
    .listTablesAdmin({ active: true })
    .filter((row) => row.id.startsWith(tableId))

  if (matches.length !== 1) return null
  return db.getTableById(matches[0].id) || matches[0]
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

export function resolvePublicQrAccess(rawTableId, token) {
  const verified = verifyQrToken(token)
  if (!verified) return null

  const requestedTable = resolvePublicTable(rawTableId)
  if (!requestedTable) return null
  if (verified.tableId !== requestedTable.id) return null

  const table = db.getTableById(verified.tableId)
  if (!table?.active) return null
  if (table.qrBlocked) return null

  const salon = db.getSalonById(table.salonId)
  if (!salon?.active) return null

  return {
    token: verified.token,
    table: {
      ...table,
      salon,
    },
  }
}

export function requireQrToken(req, res, next) {
  const token = extractQrToken(req)
  if (!token) {
    return res.status(403).json({ error: 'Token QR requerido' })
  }

  const verified = verifyQrToken(token)
  if (!verified) {
    return res.status(403).json({ error: 'Token QR invalido' })
  }

  req.qr = verified
  return next()
}

export function requirePublicQrAccess(req, res, next) {
  const token = extractQrToken(req)
  const access = resolvePublicQrAccess(req.params.tableId, token)

  if (!access) {
    return res.status(403).json({ error: QR_PUBLIC_ERROR })
  }

  req.qr = {
    tableId: access.table.id,
    token: access.token,
  }
  req.qrAccess = access
  return next()
}
