import { useEffect } from 'react'
import { getSocket } from '../../lib/socket'

const SOUND_EVENT_CHANNELS = ['order.updated', 'kitchen.ticket.updated', 'cash.session.updated', 'table.session.updated']

export function useSocketNotificationBridge(play) {
  useEffect(() => {
    if (typeof play !== 'function') return undefined

    const socket = getSocket()

    const handleIncomingEvent = () => {
      void play()
    }

    SOUND_EVENT_CHANNELS.forEach((eventName) => {
      socket.on(eventName, handleIncomingEvent)
    })

    return () => {
      SOUND_EVENT_CHANNELS.forEach((eventName) => {
        socket.off(eventName, handleIncomingEvent)
      })
    }
  }, [play])
}
