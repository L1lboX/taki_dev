import { useCallback, useEffect, useRef, useState } from 'react'

const SOUND_STORAGE_KEY = 'notificationSoundMuted'
const NOTIFICATION_SOUND_URL = '/static/sounds/bell-ding.wav'
const SOUND_COOLDOWN_MS = 2500

function readInitialMute() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function getAudioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

export function useNotificationSound() {
  const [muted, setMuted] = useState(readInitialMute)
  const htmlAudioRef = useRef(null)
  const audioContextRef = useRef(null)
  const lastPlayedRef = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(muted))
    } catch {
      // Ignore storage write failures.
    }
  }, [muted])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const audio = new Audio(NOTIFICATION_SOUND_URL)
    audio.preload = 'auto'
    htmlAudioRef.current = audio

    return () => {
      audio.pause()
      htmlAudioRef.current = null
    }
  }, [])

  const playFallbackBeep = useCallback(async () => {
    const AudioContextCtor = getAudioContextConstructor()
    if (!AudioContextCtor) return

    const context = audioContextRef.current || new AudioContextCtor()
    audioContextRef.current = context

    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch {
        return
      }
    }

    const now = context.currentTime
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)
    gain.connect(context.destination)

    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(800, now)
    oscillator.frequency.setValueAtTime(600, now + 0.18)
    oscillator.connect(gain)
    oscillator.start(now)
    oscillator.stop(now + 0.34)
  }, [])

  const play = useCallback(async () => {
    if (muted) return

    const now = Date.now()
    if (now - lastPlayedRef.current < SOUND_COOLDOWN_MS) return
    lastPlayedRef.current = now

    const htmlAudio = htmlAudioRef.current
    if (htmlAudio) {
      try {
        htmlAudio.currentTime = 0
        await htmlAudio.play()
        return
      } catch {
        // Fall through to Web Audio API fallback.
      }
    }

    await playFallbackBeep()
  }, [muted, playFallbackBeep])

  const toggleMuted = useCallback(() => {
    setMuted((prev) => !prev)
  }, [])

  return {
    muted,
    toggleMuted,
    play,
  }
}
