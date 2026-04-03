import { db } from './store.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const user = db.getUserByToken(token)
  if (!user) {
    return res.status(401).json({ error: 'Token invalido' })
  }

  req.user = user
  return next()
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tiene permisos para esta accion' })
    }

    return next()
  }
}

export function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

