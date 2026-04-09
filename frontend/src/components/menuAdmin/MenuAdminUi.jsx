import AddRoundedIcon from '@mui/icons-material/AddRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

export const menuAdminPalette = {
  ink: '#183153',
  muted: '#64748b',
  line: 'rgba(24, 49, 83, 0.12)',
  soft: '#f5f8ff',
  accent: '#205db5',
  accentSoft: '#edf4ff',
  successSoft: '#edf8f0',
  dangerSoft: '#fff0ef',
}

export function MenuPageShell({
  title,
  subtitle,
  stats = [],
  actionLabel,
  onAction,
  children,
}) {
  return (
    <Box className="menu-admin-page" sx={{ display: 'grid', gap: 3 }}>
      <Paper
        elevation={0}
        sx={{
          borderRadius: 4,
          border: `1px solid ${menuAdminPalette.line}`,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            px: { xs: 2, md: 3 },
            py: { xs: 2, md: 2.5 },
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'flex-start' }}
          >
            <Box sx={{ maxWidth: 760 }}>
              <Typography
                sx={{
                  mb: 0.75,
                  color: menuAdminPalette.accent,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                Menu del restaurante
              </Typography>
              <Typography
                variant="h3"
                sx={{
                  color: menuAdminPalette.ink,
                  fontSize: { xs: '1.8rem', md: '2.2rem' },
                  lineHeight: 1.05,
                }}
              >
                {title}
              </Typography>
              <Typography
                sx={{
                  mt: 0.75,
                  color: menuAdminPalette.muted,
                  fontSize: { xs: 13.5, md: 14.5 },
                  lineHeight: 1.55,
                }}
              >
                {subtitle}
              </Typography>
            </Box>

            {!!actionLabel && (
              <Button
                color="primary"
                onClick={onAction}
                size="large"
                startIcon={<AddRoundedIcon />}
                sx={{
                  alignSelf: { xs: 'stretch', md: 'flex-start' },
                  minWidth: { md: 180 },
                  borderRadius: 3,
                  px: 2,
                  py: 1,
                  fontWeight: 700,
                  boxShadow: 'none',
                  textTransform: 'none',
                }}
                variant="contained"
              >
                {actionLabel}
              </Button>
            )}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                lg: `repeat(${Math.max(Math.min(stats.length, 4), 2)}, minmax(0, 1fr))`,
              },
            }}
          >
            {stats.map((stat) => (
              <Paper
                elevation={0}
                key={stat.label}
                sx={{
                  borderRadius: 3,
                  border: `1px solid ${menuAdminPalette.line}`,
                  px: 1.5,
                  py: 1.35,
                  backgroundColor: menuAdminPalette.soft,
                }}
              >
                <Typography sx={{ color: menuAdminPalette.muted, fontSize: 12, fontWeight: 700 }}>
                  {stat.label}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.55,
                    color: menuAdminPalette.ink,
                    fontSize: { xs: 22, md: 24 },
                    fontWeight: 800,
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </Typography>
                {stat.meta ? (
                  <Typography sx={{ mt: 0.55, color: menuAdminPalette.muted, fontSize: 11.5, lineHeight: 1.45 }}>
                    {stat.meta}
                  </Typography>
                ) : null}
              </Paper>
            ))}
          </Box>
        </Box>
      </Paper>

      {children}
    </Box>
  )
}

export function MenuPanel({ title, subtitle, actions, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3.5,
        border: `1px solid ${menuAdminPalette.line}`,
        backgroundColor: '#fff',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 1.75, md: 2 }, borderBottom: `1px solid ${menuAdminPalette.line}` }}>
        <Box>
          <Typography sx={{ color: menuAdminPalette.ink, fontSize: { xs: 18, md: 20 }, fontWeight: 800 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ mt: 0.35, color: menuAdminPalette.muted, fontSize: 13.5, lineHeight: 1.55 }}>
              {subtitle}
            </Typography>
          ) : null}
          {actions ? <Box sx={{ mt: 1.5 }}>{actions}</Box> : null}
        </Box>
      </Box>
      <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 2.5 } }}>{children}</Box>
    </Paper>
  )
}

export function MenuEmptyState({ title, description }) {
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        gap: 1.25,
        py: 6,
        px: 3,
        textAlign: 'center',
        borderRadius: 3,
        border: `1px dashed ${alpha(menuAdminPalette.ink, 0.16)}`,
        backgroundColor: alpha(menuAdminPalette.accent, 0.03),
      }}
    >
      <WarningAmberRoundedIcon sx={{ color: alpha(menuAdminPalette.ink, 0.42), fontSize: 34 }} />
      <Typography sx={{ color: menuAdminPalette.ink, fontSize: 18, fontWeight: 700 }}>{title}</Typography>
      <Typography sx={{ maxWidth: 520, color: menuAdminPalette.muted, fontSize: 14.5, lineHeight: 1.6 }}>
        {description}
      </Typography>
    </Box>
  )
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  onClose,
  onConfirm,
  loading = false,
}) {
  return (
    <Dialog
      fullWidth
      maxWidth="xs"
      onClose={loading ? undefined : onClose}
      open={open}
      PaperProps={{
        sx: {
          borderRadius: 3.5,
          border: `1px solid ${menuAdminPalette.line}`,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, color: menuAdminPalette.ink, fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: menuAdminPalette.muted, fontSize: 14.5, lineHeight: 1.7 }}>
          {description}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={loading} onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancelar
        </Button>
        <Button
          color="error"
          disabled={loading}
          onClick={onConfirm}
          sx={{ borderRadius: 3, px: 2, textTransform: 'none' }}
          variant="contained"
        >
          {loading ? 'Eliminando...' : 'Eliminar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function MenuDetailDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
}) {
  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      open={open}
      PaperProps={{
        sx: {
          borderRadius: 3.5,
          border: `1px solid ${menuAdminPalette.line}`,
        },
      }}
    >
      <DialogTitle sx={{ color: menuAdminPalette.ink, fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent>
        {subtitle ? (
          <Typography sx={{ mb: 2, color: menuAdminPalette.muted, fontSize: 14, lineHeight: 1.6 }}>
            {subtitle}
          </Typography>
        ) : null}
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 3, textTransform: 'none' }}>
          Cerrar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ActionIconButton({
  title,
  icon,
  onClick,
  color = 'default',
  disabled = false,
}) {
  const palette = {
    default: {
      fg: menuAdminPalette.ink,
      bg: '#fff',
      border: menuAdminPalette.line,
    },
    success: {
      fg: '#216a38',
      bg: menuAdminPalette.successSoft,
      border: alpha('#216a38', 0.15),
    },
    warning: {
      fg: '#9a5b16',
      bg: '#fff7ed',
      border: alpha('#9a5b16', 0.14),
    },
    danger: {
      fg: '#c2412d',
      bg: menuAdminPalette.dangerSoft,
      border: alpha('#c2412d', 0.16),
    },
    info: {
      fg: menuAdminPalette.accent,
      bg: menuAdminPalette.accentSoft,
      border: alpha(menuAdminPalette.accent, 0.12),
    },
  }[color]

  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          disabled={disabled}
          onClick={onClick}
          size="small"
          sx={{
            borderRadius: 2,
            width: 34,
            height: 34,
            color: palette.fg,
            bgcolor: palette.bg,
            border: `1px solid ${palette.border}`,
            '&:hover': {
              bgcolor: palette.bg,
              filter: 'brightness(0.98)',
            },
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
}
