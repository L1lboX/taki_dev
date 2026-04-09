import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
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
import { ConfirmDeleteDialog, MenuEmptyState, MenuPageShell, MenuPanel, menuAdminPalette } from '../components/menuAdmin/MenuAdminUi'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const INITIAL_FORM = {
  sectionId: '',
  name: '',
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

export default function MenuCategoriesPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const [search, setSearch] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)

  const sectionsQuery = useQuery({
    queryKey: scopedQueryKey('menu-sections', user, 'all'),
    queryFn: () => api.getMenuSections({}),
  })

  const categoriesQuery = useQuery({
    queryKey: scopedQueryKey('menu-categories', user, 'all'),
    queryFn: () => api.getMenuCategories({}),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuCategory,
    onSuccess: async () => {
      toast.success('Categoria creada')
      setDialogOpen(false)
      setForm(INITIAL_FORM)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ categoryId, body }) => api.updateMenuCategory(categoryId, body),
    onSuccess: async () => {
      toast.success('Categoria actualizada')
      setDialogOpen(false)
      setEditingCategory(null)
      setForm(INITIAL_FORM)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteMenuCategory,
    onSuccess: async () => {
      toast.success('Categoria eliminada')
      setDeleteTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ categoryId, body }) => api.updateMenuCategory(categoryId, body),
    onSuccess: async (_, variables) => {
      toast.success(variables.body.active ? 'Categoria activada' : 'Categoria desactivada')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const sections = sectionsQuery.data || []
  const rows = categoriesQuery.data || []
  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections])

  const filteredRows = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase()
    return rows.filter((row) => {
      const matchesSearch =
        !needle ||
        String(row.name || '').toLowerCase().includes(needle) ||
        String(row.description || '').toLowerCase().includes(needle) ||
        String(sectionById.get(row.sectionId)?.name || '').toLowerCase().includes(needle)
      const matchesSection = sectionFilter === 'all' ? true : row.sectionId === sectionFilter
      const matchesActive = activeFilter === 'all' ? true : String(row.active) === activeFilter
      return matchesSearch && matchesSection && matchesActive
    })
  }, [activeFilter, rows, search, sectionById, sectionFilter])

  const stats = useMemo(
    () => [
      { label: 'Total', value: rows.length, meta: 'Agrupaciones creadas en el menu' },
      { label: 'Activas', value: rows.filter((row) => row.active).length, meta: 'Disponibles para productos' },
      { label: 'Secciones en uso', value: new Set(rows.map((row) => row.sectionId)).size, meta: 'Cobertura del catalogo' },
    ],
    [rows],
  )

  function openCreateDialog() {
    setEditingCategory(null)
    setForm({
      ...INITIAL_FORM,
      sectionId: sections[0]?.id || '',
    })
    setDialogOpen(true)
  }

  function openEditDialog(category) {
    setEditingCategory(category)
    setForm({
      sectionId: category.sectionId || '',
      name: category.name || '',
      description: category.description || '',
      sortOrder: String(category.sortOrder || 1),
      active: String(category.active !== false),
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    if (createMutation.isPending || updateMutation.isPending) return
    setDialogOpen(false)
    setEditingCategory(null)
    setForm(INITIAL_FORM)
  }

  function submitForm(event) {
    event.preventDefault()
    const sectionId = String(form.sectionId || '').trim()
    const name = String(form.name || '').trim()

    if (!sectionId) {
      toast.error('Selecciona una seccion')
      return
    }
    if (!name) {
      toast.error('Ingresa el nombre de la categoria')
      return
    }

    const payload = {
      sectionId,
      name,
      description: String(form.description || '').trim() || undefined,
      sortOrder: Math.max(1, Number(form.sortOrder || 1)),
      active: form.active === 'true',
    }

    if (editingCategory) {
      updateMutation.mutate({ categoryId: editingCategory.id, body: payload })
      return
    }

    createMutation.mutate(payload)
  }

  function handleToggle(category) {
    toggleMutation.mutate({
      categoryId: category.id,
      body: { active: !category.active },
    })
  }

  return (
    <MenuPageShell
      actionLabel="Agregar categoria"
      onAction={openCreateDialog}
      stats={stats}
      subtitle="Agrupa productos por seccion sin mezclar formulario y listado en la misma superficie."
      title="Categorias"
    >
      <MenuPanel
        actions={
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} sx={{ width: '100%' }}>
            <TextField
              fullWidth
              label="Buscar"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Categoria, descripcion o seccion"
              size="small"
              value={search}
            />
            <TextField
              label="Seccion"
              onChange={(event) => setSectionFilter(event.target.value)}
              select
              size="small"
              sx={{ minWidth: { lg: 200 } }}
              value={sectionFilter}
            >
              <MenuItem value="all">Todas</MenuItem>
              {sections.map((section) => (
                <MenuItem key={section.id} value={section.id}>
                  {section.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Estado"
              onChange={(event) => setActiveFilter(event.target.value)}
              select
              size="small"
              sx={{ minWidth: { lg: 180 } }}
              value={activeFilter}
            >
              <MenuItem value="all">Todas</MenuItem>
              <MenuItem value="true">Activas</MenuItem>
              <MenuItem value="false">Inactivas</MenuItem>
            </TextField>
          </Stack>
        }
        subtitle="Cada categoria queda visible con su seccion, orden y estado operativo."
        title="Listado de categorias"
      >
        {sectionsQuery.isLoading || categoriesQuery.isLoading ? (
          <Typography sx={{ color: menuAdminPalette.muted }}>Cargando categorias...</Typography>
        ) : !filteredRows.length ? (
          <MenuEmptyState
            description="No encontramos categorias con esos filtros. Crea una nueva o cambia la seccion seleccionada."
            title="Sin categorias para mostrar"
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 940 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Categoria</TableCell>
                  <TableCell>Seccion</TableCell>
                  <TableCell>Orden</TableCell>
                  <TableCell>Descripcion</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Actualizada</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow hover key={row.id}>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography sx={{ color: menuAdminPalette.ink, fontSize: 15, fontWeight: 700 }}>
                          {row.name}
                        </Typography>
                        <Typography sx={{ color: menuAdminPalette.muted, fontSize: 12.5 }}>
                          ID: {row.id.slice(0, 8)}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{sectionById.get(row.sectionId)?.name || '-'}</TableCell>
                    <TableCell>{row.sortOrder || '-'}</TableCell>
                    <TableCell sx={{ color: menuAdminPalette.muted, maxWidth: 280 }}>
                      {row.description || 'Sin descripcion'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={row.active ? 'success' : 'default'}
                        label={row.active ? 'Activa' : 'Inactiva'}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          ...(row.active
                            ? { bgcolor: '#edf8f0', color: '#216a38' }
                            : { bgcolor: '#f3f4f6', color: '#64748b' }),
                        }}
                      />
                    </TableCell>
                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={1} useFlexGap flexWrap="wrap">
                        <Button onClick={() => openEditDialog(row)} size="small" startIcon={<EditRoundedIcon />} sx={{ textTransform: 'none' }}>
                          Editar
                        </Button>
                        <Button
                          onClick={() => handleToggle(row)}
                          size="small"
                          startIcon={row.active ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                          sx={{ textTransform: 'none' }}
                        >
                          {row.active ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          color="error"
                          onClick={() => setDeleteTarget(row)}
                          size="small"
                          startIcon={<DeleteOutlineRoundedIcon />}
                          sx={{ textTransform: 'none' }}
                        >
                          Eliminar
                        </Button>
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
            borderRadius: 4,
            border: `1px solid ${menuAdminPalette.line}`,
          },
        }}
      >
        <DialogTitle sx={{ color: menuAdminPalette.ink, fontWeight: 800 }}>
          {editingCategory ? 'Editar categoria' : 'Nueva categoria'}
        </DialogTitle>
        <Box component="form" onSubmit={submitForm}>
          <DialogContent sx={{ display: 'grid', gap: 2 }}>
            <TextField
              fullWidth
              label="Seccion"
              onChange={(event) => setForm((prev) => ({ ...prev, sectionId: event.target.value }))}
              select
              size="small"
              value={form.sectionId}
            >
              {sections.map((section) => (
                <MenuItem key={section.id} value={section.id}>
                  {section.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                autoFocus
                fullWidth
                label="Nombre"
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                size="small"
                value={form.name}
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
              sx={{ borderRadius: 999, px: 2.2, textTransform: 'none' }}
              type="submit"
              variant="contained"
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Guardando...'
                : editingCategory
                  ? 'Guardar cambios'
                  : 'Crear categoria'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDeleteDialog
        description={
          deleteTarget
            ? `Se eliminara la categoria "${deleteTarget.name}". Si todavia tiene productos asociados, el backend impedira el borrado para no dejar el menu inconsistente.`
            : ''
        }
        loading={deleteMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        open={Boolean(deleteTarget)}
        title="Eliminar categoria"
      />
    </MenuPageShell>
  )
}
