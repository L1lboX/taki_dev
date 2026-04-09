import AddRoundedIcon from '@mui/icons-material/AddRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
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
          borderRadius: 5,
          border: `1px solid ${menuAdminPalette.line}`,
          overflow: 'hidden',
          background: `linear-gradient(180deg, #ffffff 0%, ${menuAdminPalette.soft} 100%)`,
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            px: { xs: 2, md: 3 },
            py: { xs: 2.5, md: 3 },
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'flex-start' }}
          >
            <Box sx={{ maxWidth: 760 }}>
              <Typography
                sx={{
                  mb: 0.75,
                  color: menuAdminPalette.accent,
                  fontSize: 12,
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
                  fontSize: { xs: '2rem', md: '2.5rem' },
                  lineHeight: 1,
                }}
              >
                {title}
              </Typography>
              <Typography
                sx={{
                  mt: 1,
                  color: menuAdminPalette.muted,
                  fontSize: { xs: 14, md: 15 },
                  lineHeight: 1.6,
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
                  minWidth: { md: 210 },
                  borderRadius: 999,
                  px: 2.25,
                  py: 1.15,
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
              gap: 1.5,
              gridTemplateColumns: {
                xs: 'repeat(1, minmax(0, 1fr))',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: `repeat(${Math.max(stats.length, 2)}, minmax(0, 1fr))`,
              },
            }}
          >
            {stats.map((stat) => (
              <Paper
                elevation={0}
                key={stat.label}
                sx={{
                  borderRadius: 3.5,
                  border: `1px solid ${menuAdminPalette.line}`,
                  px: 2,
                  py: 1.75,
                  backgroundColor: '#fff',
                }}
              >
                <Typography sx={{ color: menuAdminPalette.muted, fontSize: 13, fontWeight: 600 }}>
                  {stat.label}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.8,
                    color: menuAdminPalette.ink,
                    fontSize: { xs: 24, md: 28 },
                    fontWeight: 800,
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </Typography>
                {stat.meta ? (
                  <Typography sx={{ mt: 0.85, color: menuAdminPalette.muted, fontSize: 12.5 }}>
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
        borderRadius: 4,
        border: `1px solid ${menuAdminPalette.line}`,
        backgroundColor: '#fff',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 2.5 }, borderBottom: `1px solid ${menuAdminPalette.line}` }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={1.5}
        >
          <Box>
            <Typography sx={{ color: menuAdminPalette.ink, fontSize: 22, fontWeight: 800 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography sx={{ mt: 0.6, color: menuAdminPalette.muted, fontSize: 14.5 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {actions ? <Box sx={{ width: { xs: '100%', md: 'auto' } }}>{actions}</Box> : null}
        </Stack>
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
        borderRadius: 3.5,
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
          borderRadius: 4,
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
          sx={{ borderRadius: 999, px: 2, textTransform: 'none' }}
          variant="contained"
        >
          {loading ? 'Eliminando...' : 'Eliminar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
