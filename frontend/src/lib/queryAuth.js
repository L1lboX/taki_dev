export function getAuthScope(user) {
  if (user?.id) {
    return `${user.id}:${user.role || 'UNKNOWN'}`
  }

  if (user?.role) {
    return `role:${user.role}`
  }

  return 'anonymous'
}

function normalizePrefix(prefix) {
  return Array.isArray(prefix) ? prefix : [prefix]
}

export function scopedQueryKey(prefix, user, ...parts) {
  return [...normalizePrefix(prefix), getAuthScope(user), ...parts]
}
