import { createTheme } from '@mui/material/styles'

export const PureLightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1b4332' },
    secondary: { main: '#2f4774' },
    error: { main: '#c0392b' },
    background: {
      default: '#f6f3ee',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a140f',
      secondary: '#6b5d50',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'DM Sans, sans-serif',
  },
})

export const NebulaFighterTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#95d5b2' },
    secondary: { main: '#9bb2df' },
    error: { main: '#ff7b72' },
    background: {
      default: '#0d1424',
      paper: '#18243c',
    },
    text: {
      primary: '#eef2ff',
      secondary: '#b2bfd6',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'DM Sans, sans-serif',
  },
})

export function resolveShellMuiTheme(mode) {
  return mode === 'dark' ? NebulaFighterTheme : PureLightTheme
}
