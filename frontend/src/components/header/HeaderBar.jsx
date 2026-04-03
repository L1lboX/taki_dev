import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded'
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded'
import WifiTetheringRoundedIcon from '@mui/icons-material/WifiTetheringRounded'
import {
  Avatar,
  Badge,
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useAppShellTheme } from './AppShellThemeContext'
import { useNotificationSound } from './useNotificationSound'
import { useSocketConnectionStatus } from './useSocketConnectionStatus'
import { useSocketNotificationBridge } from './useSocketNotificationBridge'

function getInitial(name) {
  const normalized = String(name || '').trim()
  if (!normalized) return 'U'
  return normalized.charAt(0).toUpperCase()
}

function formatRole(role) {
  const catalog = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Administrador',
    ACCOUNTANT: 'Contador',
    CASHIER: 'Cajero',
    COOK: 'Cocinero',
    WAITER: 'Mesero',
  }

  return catalog[role] || 'Usuario'
}

export default function HeaderBar() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  const { themeMode, toggleTheme } = useAppShellTheme()
  const { muted, toggleMuted, play } = useNotificationSound()
  const connection = useSocketConnectionStatus()

  useSocketNotificationBridge(play)

  const [anchorEl, setAnchorEl] = useState(null)

  const isSocketOnline = connection.connected && !connection.offline
  const connectionLabel = useMemo(() => {
    if (connection.offline) return 'Sin internet'
    if (connection.reconnecting) return 'Reconectando...'
    if (connection.connected) return 'Conectado en vivo'
    return 'Desconectado'
  }, [connection.connected, connection.offline, connection.reconnecting])

  const connectionToneClass = isSocketOnline ? 'connected' : 'disconnected parpadeo'
  const userPopoverOpen = Boolean(anchorEl)

  const handleOpenUserMenu = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleCloseUserMenu = () => {
    setAnchorEl(null)
  }

  const handleLogout = () => {
    handleCloseUserMenu()
    logout()
  }

  return (
    <header className="app-header-bar">
      <div className="header-bar-copy">
        <p className="header-kicker">Panel operativo</p>
        <p className="header-title">TAKI</p>
      </div>

      <Stack alignItems="center" className="header-actions" direction="row" spacing={1}>
        <Tooltip arrow title={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          <IconButton className="header-icon-btn" onClick={toggleTheme} size="small">
            {themeMode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Tooltip arrow title={muted ? 'Activar sonido de notificaciones' : 'Silenciar sonido de notificaciones'}>
          <IconButton className="header-icon-btn" onClick={toggleMuted} size="small">
            {muted ? <VolumeOffRoundedIcon fontSize="small" /> : <VolumeUpRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Tooltip arrow title={connectionLabel}>
          <IconButton className={`header-icon-btn header-connection-btn ${connectionToneClass}`} size="small">
            <WifiTetheringRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip arrow title="Perfil">
          <IconButton className="header-avatar-btn" onClick={handleOpenUserMenu} size="small">
            <Badge
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              color={isSocketOnline ? 'success' : 'error'}
              overlap="circular"
              variant="dot"
            >
              <Avatar className="header-avatar">{getInitial(user?.name)}</Avatar>
            </Badge>
          </IconButton>
        </Tooltip>
      </Stack>

      <Popover
        anchorEl={anchorEl}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={handleCloseUserMenu}
        open={userPopoverOpen}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box className="header-user-popover">
          <Stack spacing={1.5}>
            <div>
              <Typography className="header-user-name" variant="subtitle1">
                {user?.name || 'Usuario'}
              </Typography>
              <Typography className="header-user-role" variant="body2">
                {formatRole(user?.role)}
              </Typography>
            </div>

            <Typography className={`header-user-connection ${isSocketOnline ? 'ok' : 'fail'}`} variant="caption">
              {connectionLabel}
            </Typography>

            <Button onClick={handleLogout} size="small" startIcon={<LogoutRoundedIcon fontSize="small" />} variant="contained">
              Cerrar sesion
            </Button>
          </Stack>
        </Box>
      </Popover>
    </header>
  )
}
