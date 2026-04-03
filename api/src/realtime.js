let ioRef = null

export function initRealtime(io) {
  ioRef = io
}

export function emitEvent(channel, payload) {
  if (!ioRef) return
  ioRef.emit(channel, payload)
}

