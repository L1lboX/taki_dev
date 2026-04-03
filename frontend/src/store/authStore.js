import { create } from 'zustand'

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('taki_token'),
  user: (() => {
    const raw = localStorage.getItem('taki_user')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })(),

  login: ({ token, user }) => {
    localStorage.setItem('taki_token', token)
    localStorage.setItem('taki_user', JSON.stringify(user))
    set({ token, user })
  },

  logout: () => {
    localStorage.removeItem('taki_token')
    localStorage.removeItem('taki_user')
    set({ token: null, user: null })
  },
}))

