/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState } from 'react'
import { resolveShellMuiTheme } from './themes'

const APP_THEME_STORAGE_KEY = 'appTheme'
const VALID_MODES = new Set(['light', 'dark'])

function readStoredThemeMode() {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY)
    if (stored && VALID_MODES.has(stored)) {
      return stored
    }
  } catch {
    return 'light'
  }

  return 'light'
}

const AppShellThemeContext = createContext(null)

export function AppShellThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(readStoredThemeMode)

  const contextValue = useMemo(() => {
    const toggleTheme = () => {
      setThemeMode((prev) => {
        const next = prev === 'dark' ? 'light' : 'dark'
        try {
          localStorage.setItem(APP_THEME_STORAGE_KEY, next)
        } catch {
          // Ignore write failures (private mode, storage disabled, etc.)
        }
        return next
      })
    }

    return {
      themeMode,
      muiTheme: resolveShellMuiTheme(themeMode),
      toggleTheme,
    }
  }, [themeMode])

  return <AppShellThemeContext.Provider value={contextValue}>{children}</AppShellThemeContext.Provider>
}

export function useAppShellTheme() {
  const context = useContext(AppShellThemeContext)

  if (!context) {
    throw new Error('useAppShellTheme must be used inside AppShellThemeProvider')
  }

  return context
}
