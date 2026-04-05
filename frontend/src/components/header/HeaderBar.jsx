import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded'
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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getSocket } from '../../lib/socket'
import { useAuthStore } from '../../store/authStore'
import { useAppShellTheme } from './AppShellThemeContext'
import { useNotificationSound } from './useNotificationSound'
import { useQrNotificationSound } from './useQrNotificationSound'
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

export default function HeaderBar({ isMobileMenuOpen = false, onToggleMobileMenu, showMobileMenuButton = false }) {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const queryClient = useQueryClient()

  const { themeMode, toggleTheme } = useAppShellTheme()
  const { muted, toggleMuted, play } = useNotificationSound()
  const {
    muted: qrNotificationMuted,
    toggleMuted: toggleQrNotificationMuted,
    play: playQrNotification,
  } = useQrNotificationSound()
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
  const canReceiveQrAlerts = ['WAITER', 'ADMIN', 'SUPER_ADMIN'].includes(String(user?.role || '').toUpperCase())

  useEffect(() => {
    if (!canReceiveQrAlerts) return undefined

    const socket = getSocket()
    const handleQrNewOrder = (payload) => {
      const tableLabel = payload?.tableNumber != null
        ? `Mesa ${payload.tableNumber}`
        : payload?.tableId
          ? `Mesa ${payload.tableId}`
          : 'Mesa'
      const salonLabel = String(payload?.salonName || '').trim()
      const detail = salonLabel ? `${tableLabel} · ${salonLabel}` : tableLabel

      toast.info('Nuevo pedido QR pendiente', {
        description: detail,
      })

      void playQrNotification()
    }

    socket.on('qr.new-order', handleQrNewOrder)

    return () => {
      socket.off('qr.new-order', handleQrNewOrder)
    }
  }, [canReceiveQrAlerts, playQrNotification])

  const handleOpenUserMenu = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleCloseUserMenu = () => {
    setAnchorEl(null)
  }

  const handleLogout = () => {
    handleCloseUserMenu()
    queryClient.clear()
    logout()
  }

  return (
    <header className="app-header-bar">
      <div className="header-bar-leading">
        {showMobileMenuButton && (
          <Tooltip arrow title={isMobileMenuOpen ? 'Cerrar menu' : 'Abrir menu'}>
            <IconButton className="header-icon-btn header-mobile-toggle" onClick={onToggleMobileMenu} size="small">
              {isMobileMenuOpen ? <CloseRoundedIcon fontSize="small" /> : <MenuRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}

        <div className="header-bar-copy">
          <p className="header-kicker">Panel operativo</p>
          <p className="header-title">TAKI</p>
        </div>
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

            {canReceiveQrAlerts && (
              <div className="header-user-toggle-card">
                <div>
                  <Typography className="header-user-toggle-title" variant="body2">
                    Sonido pedidos QR
                  </Typography>
                  <Typography className="header-user-toggle-copy" variant="caption">
                    Aviso especial cuando una mesa envia un pedido para aprobacion.
                  </Typography>
                </div>
                <Button
                  onClick={toggleQrNotificationMuted}
                  size="small"
                  startIcon={qrNotificationMuted ? <NotificationsOffRoundedIcon fontSize="small" /> : <NotificationsActiveRoundedIcon fontSize="small" />}
                  variant={qrNotificationMuted ? 'outlined' : 'contained'}
                >
                  {qrNotificationMuted ? 'Silenciado' : 'Activo'}
                </Button>
              </div>
            )}

            <Button onClick={handleLogout} size="small" startIcon={<LogoutRoundedIcon fontSize="small" />} variant="contained">
              Cerrar sesion
            </Button>
          </Stack>
        </Box>
      </Popover>
    </header>
  )
}

