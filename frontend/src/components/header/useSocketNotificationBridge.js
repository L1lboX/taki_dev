import { useEffect } from 'react'
import { getSocket } from '../../lib/socket'

const SOUND_EVENT_CHANNELS = ['order.updated', 'kitchen.ticket.updated', 'cash.session.updated', 'table.session.updated']

export function useSocketNotificationBridge(play) {
  useEffect(() => {
    if (typeof play !== 'function') return undefined

    const socket = getSocket()

    const handleIncomingEvent = (payload, eventName) => {
      if (
        eventName === 'order.updated' &&
        payload?.source === 'QR' &&
        payload?.status === 'PENDING_WAITER_APPROVAL'
      ) {
        return
      }

      void play()
    }

    const listeners = SOUND_EVENT_CHANNELS.map((eventName) => {
      const listener = (payload) => handleIncomingEvent(payload, eventName)
      socket.on(eventName, listener)
      return [eventName, listener]
    })

    return () => {
      listeners.forEach(([eventName, listener]) => {
        if (listener) {
          socket.off(eventName, listener)
        }
      })
    }
  }, [play])
}
