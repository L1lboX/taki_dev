import { createTheme } from '@mui/material/styles'

export const PureLightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#B8422E' },
    secondary: { main: '#1A1C1E' },
    error: { main: '#c0392b' },
    background: {
      default: '#F7F5F2',
      paper: '#fffdf9',
    },
    text: {
      primary: '#1A1C1E',
      secondary: '#6C7278',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: 'Public Sans, sans-serif',
  },
})

export const NebulaFighterTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#d65b45' },
    secondary: { main: '#F7F5F2' },
    error: { main: '#ff7b72' },
    background: {
      default: '#111315',
      paper: '#1A1C1E',
    },
    text: {
      primary: '#F7F5F2',
      secondary: '#c4c7ca',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: 'Public Sans, sans-serif',
  },
})

export function resolveShellMuiTheme(mode) {
  return mode === 'dark' ? NebulaFighterTheme : PureLightTheme
}
