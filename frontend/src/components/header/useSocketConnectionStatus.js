import { useEffect, useState } from 'react'
import { getSocket } from '../../lib/socket'

function nowIso() {
  return new Date().toISOString()
}

function isNavigatorOnline() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function initialStatus() {
  const online = isNavigatorOnline()
  return {
    connected: false,
    reconnecting: false,
    offline: !online,
    lastChangeAt: null,
  }
}

export function useSocketConnectionStatus() {
  const [status, setStatus] = useState(initialStatus)

  useEffect(() => {
    const socket = getSocket()
    const manager = socket.io

    const setNext = (patch) => {
      setStatus((prev) => ({
        ...prev,
        ...patch,
        lastChangeAt: nowIso(),
      }))
    }

    const syncFromSources = () => {
      const online = isNavigatorOnline()
      const connected = Boolean(socket.connected) && online
      setNext({
        connected,
        reconnecting: !connected && online,
        offline: !online,
      })
    }

    const handleConnect = () => {
      const online = isNavigatorOnline()
      setNext({
        connected: online,
        reconnecting: false,
        offline: !online,
      })
    }

    const handleDisconnect = () => {
      const online = isNavigatorOnline()
      setNext({
        connected: false,
        reconnecting: online,
        offline: !online,
      })
    }

    const handleConnectError = () => {
      const online = isNavigatorOnline()
      setNext({
        connected: false,
        reconnecting: online,
        offline: !online,
      })
    }

    const handleReconnectAttempt = () => {
      const online = isNavigatorOnline()
      setNext({
        connected: false,
        reconnecting: online,
        offline: !online,
      })
    }

    const handleReconnect = () => {
      const online = isNavigatorOnline()
      setNext({
        connected: online,
        reconnecting: false,
        offline: !online,
      })
    }

    const handleOnline = () => syncFromSources()
    const handleOffline = () => {
      setNext({
        connected: false,
        reconnecting: false,
        offline: true,
      })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    manager?.on('reconnect_attempt', handleReconnectAttempt)
    manager?.on('reconnect', handleReconnect)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (!socket.connected) {
      socket.connect()
    }

    syncFromSources()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      manager?.off('reconnect_attempt', handleReconnectAttempt)
      manager?.off('reconnect', handleReconnect)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return status
}
