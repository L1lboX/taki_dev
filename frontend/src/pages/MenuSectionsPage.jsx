import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import {
  ActionIconButton,
  ConfirmDeleteDialog,
  MenuDetailDialog,
  MenuEmptyState,
  MenuPageShell,
  MenuPanel,
  menuAdminPalette,
} from '../components/menuAdmin/MenuAdminUi'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const INITIAL_FORM = {
  name: '',
  code: '',
  description: '',
  sortOrder: '1',
  active: 'true',
}

function formatDate(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function MenuSectionsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)

  const sectionsQuery = useQuery({
    queryKey: scopedQueryKey('menu-sections', user, 'all'),
    queryFn: () => api.getMenuSections({}),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuSection,
    onSuccess: async () => {
      toast.success('Seccion creada')
      setDialogOpen(false)
      setForm(INITIAL_FORM)
      await queryClient.invalidateQueries({ queryKey: ['menu-sections'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ sectionId, body }) => api.updateMenuSection(sectionId, body),
    onSuccess: async () => {
      toast.success('Seccion actualizada')
      setDialogOpen(false)
      setEditingSection(null)
      setForm(INITIAL_FORM)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-sections'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteMenuSection,
    onSuccess: async () => {
      toast.success('Seccion eliminada')
      setDeleteTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-sections'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ sectionId, body }) => api.updateMenuSection(sectionId, body),
    onSuccess: async (_, variables) => {
      toast.success(variables.body.active ? 'Seccion activada' : 'Seccion desactivada')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-sections'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const rows = sectionsQuery.data || []

  const filteredRows = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase()
    return rows.filter((row) => {
      const matchesSearch =
        !needle ||
        String(row.name || '').toLowerCase().includes(needle) ||
        String(row.code || '').toLowerCase().includes(needle) ||
        String(row.description || '').toLowerCase().includes(needle)
      const matchesActive = activeFilter === 'all' ? true : String(row.active) === activeFilter
      return matchesSearch && matchesActive
    })
  }, [activeFilter, rows, search])

  const stats = useMemo(
    () => [
      { label: 'Total', value: rows.length, meta: 'Bloques del menu' },
      { label: 'Activas', value: rows.filter((row) => row.active).length, meta: 'Operativas ahora' },
      { label: 'Inactivas', value: rows.filter((row) => !row.active).length, meta: 'Ocultas temporalmente' },
    ],
    [rows],
  )

  function openCreateDialog() {
    setEditingSection(null)
    setForm(INITIAL_FORM)
    setDialogOpen(true)
  }

  function openEditDialog(section) {
    setEditingSection(section)
    setForm({
      name: section.name || '',
      code: section.code || '',
      description: section.description || '',
      sortOrder: String(section.sortOrder || 1),
      active: String(section.active !== false),
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    if (createMutation.isPending || updateMutation.isPending) return
    setDialogOpen(false)
    setEditingSection(null)
    setForm(INITIAL_FORM)
  }

  function submitForm(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    if (!name) {
      toast.error('Ingresa el nombre de la seccion')
      return
    }

    const payload = {
      name,
      code: String(form.code || '').trim() || undefined,
      description: String(form.description || '').trim() || undefined,
      sortOrder: Math.max(1, Number(form.sortOrder || 1)),
      active: form.active === 'true',
    }

    if (editingSection) {
      updateMutation.mutate({ sectionId: editingSection.id, body: payload })
      return
    }

    createMutation.mutate(payload)
  }

  function handleToggle(section) {
    toggleMutation.mutate({
      sectionId: section.id,
      body: { active: !section.active },
    })
  }

  return (
    <MenuPageShell
      actionLabel="Agregar seccion"
      onAction={openCreateDialog}
      stats={stats}
      subtitle="Organiza los grandes bloques del menu y mantenlos separados del formulario para trabajar mas limpio."
      title="Secciones"
    >
      <MenuPanel
        actions={
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} sx={{ width: '100%' }}>
            <TextField
              fullWidth
              label="Buscar"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, codigo o descripcion"
              size="small"
              value={search}
            />
            <TextField
              label="Estado"
              onChange={(event) => setActiveFilter(event.target.value)}
              select
              size="small"
              sx={{ minWidth: { sm: 180 } }}
              value={activeFilter}
            >
              <MenuItem value="all">Todas</MenuItem>
              <MenuItem value="true">Activas</MenuItem>
              <MenuItem value="false">Inactivas</MenuItem>
            </TextField>
          </Stack>
        }
        subtitle="Consulta, edita o desactiva secciones desde una sola tabla."
        title="Listado de secciones"
      >
        {sectionsQuery.isLoading ? (
          <Typography sx={{ color: menuAdminPalette.muted }}>Cargando secciones...</Typography>
        ) : !filteredRows.length ? (
          <MenuEmptyState
            description="Todavia no hay secciones que coincidan con los filtros actuales. Crea una nueva o ajusta la busqueda."
            title="Sin secciones para mostrar"
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 880 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Seccion</TableCell>
                  <TableCell>Codigo</TableCell>
                  <TableCell>Orden</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Actualizada</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow hover key={row.id}>
                    <TableCell>
                      <Typography sx={{ color: menuAdminPalette.ink, fontSize: 15, fontWeight: 700 }}>
                        {row.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.code || '-'}</TableCell>
                    <TableCell>{row.sortOrder || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        color={row.active ? 'success' : 'default'}
                        label={row.active ? 'Activa' : 'Inactiva'}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          ...(row.active
                            ? { bgcolor: menuAdminPalette.successSoft, color: '#216a38' }
                            : { bgcolor: '#f3f4f6', color: '#64748b' }),
                        }}
                      />
                    </TableCell>
                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={0.75}>
                        <ActionIconButton
                          color="info"
                          icon={<InfoOutlinedIcon fontSize="small" />}
                          onClick={() => setDetailTarget(row)}
                          title="Ver detalles"
                        />
                        <ActionIconButton
                          icon={<EditRoundedIcon fontSize="small" />}
                          onClick={() => openEditDialog(row)}
                          title="Editar"
                        />
                        <ActionIconButton
                          color={row.active ? 'warning' : 'success'}
                          icon={row.active ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                          onClick={() => handleToggle(row)}
                          title={row.active ? 'Desactivar' : 'Activar'}
                        />
                        <ActionIconButton
                          color="danger"
                          icon={<DeleteOutlineRoundedIcon fontSize="small" />}
                          onClick={() => setDeleteTarget(row)}
                          title="Eliminar"
                        />
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </MenuPanel>

      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={closeDialog}
        open={dialogOpen}
        PaperProps={{
          sx: {
            borderRadius: 3.5,
            border: `1px solid ${menuAdminPalette.line}`,
          },
        }}
      >
        <DialogTitle sx={{ color: menuAdminPalette.ink, fontWeight: 800 }}>
          {editingSection ? 'Editar seccion' : 'Nueva seccion'}
        </DialogTitle>
        <Box component="form" onSubmit={submitForm}>
          <DialogContent sx={{ display: 'grid', gap: 2 }}>
            <TextField
              autoFocus
              fullWidth
              label="Nombre"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              size="small"
              value={form.name}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="Codigo"
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="Ej: MENU_DIA"
                size="small"
                value={form.code}
              />
              <TextField
                fullWidth
                label="Orden"
                onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: event.target.value }))}
                size="small"
                type="number"
                value={form.sortOrder}
              />
            </Stack>
            <TextField
              fullWidth
              label="Descripcion"
              minRows={3}
              multiline
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              size="small"
              value={form.description}
            />
            <TextField
              fullWidth
              label="Estado"
              onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.value }))}
              select
              size="small"
              value={form.active}
            >
              <MenuItem value="true">Activa</MenuItem>
              <MenuItem value="false">Inactiva</MenuItem>
            </TextField>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
              Cancelar
            </Button>
            <Button
              disabled={createMutation.isPending || updateMutation.isPending}
              sx={{ borderRadius: 3, px: 2.2, textTransform: 'none' }}
              type="submit"
              variant="contained"
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Guardando...'
                : editingSection
                  ? 'Guardar cambios'
                  : 'Crear seccion'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDeleteDialog
        description={
          deleteTarget
            ? `Se eliminara la seccion "${deleteTarget.name}". Si todavia tiene categorias asociadas, el sistema la bloqueara para proteger la estructura del menu.`
            : ''
        }
        loading={deleteMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        open={Boolean(deleteTarget)}
        title="Eliminar seccion"
      />

      <MenuDetailDialog
        onClose={() => setDetailTarget(null)}
        open={Boolean(detailTarget)}
        subtitle="Detalle ampliado de la seccion seleccionada."
        title={detailTarget?.name || 'Detalle de seccion'}
      >
        {detailTarget ? (
          <Stack spacing={1.25}>
            <Typography sx={{ color: menuAdminPalette.muted, fontSize: 13.5 }}>
              Codigo: <strong style={{ color: menuAdminPalette.ink }}>{detailTarget.code || '-'}</strong>
            </Typography>
            <Typography sx={{ color: menuAdminPalette.muted, fontSize: 13.5 }}>
              Orden: <strong style={{ color: menuAdminPalette.ink }}>{detailTarget.sortOrder || '-'}</strong>
            </Typography>
            <Typography sx={{ color: menuAdminPalette.muted, fontSize: 13.5 }}>
              Estado: <strong style={{ color: menuAdminPalette.ink }}>{detailTarget.active ? 'Activa' : 'Inactiva'}</strong>
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                borderRadius: 2.5,
                border: `1px solid ${menuAdminPalette.line}`,
                p: 1.5,
                bgcolor: '#f8fafc',
              }}
            >
              <Typography sx={{ mb: 0.75, color: menuAdminPalette.ink, fontSize: 13.5, fontWeight: 700 }}>
                Descripcion
              </Typography>
              <Typography sx={{ color: menuAdminPalette.muted, fontSize: 14, lineHeight: 1.7 }}>
                {detailTarget.description || 'Sin descripcion registrada.'}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </MenuDetailDialog>
    </MenuPageShell>
  )
}
