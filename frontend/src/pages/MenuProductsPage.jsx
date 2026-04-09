import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import PublicOffRoundedIcon from '@mui/icons-material/PublicOffRounded'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  Avatar,
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
import { alpha } from '@mui/material/styles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { ConfirmDeleteDialog, MenuEmptyState, MenuPageShell, MenuPanel, menuAdminPalette } from '../components/menuAdmin/MenuAdminUi'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const PRODUCT_STATUS = ['AVAILABLE', 'OUT_OF_STOCK', 'OUT_OF_SEASON']

const STATUS_LABELS = {
  AVAILABLE: 'Disponible',
  OUT_OF_STOCK: 'Agotado',
  OUT_OF_SEASON: 'Fuera de temporada',
}

const INITIAL_FORM = {
  id: '',
  sectionId: '',
  categoryId: '',
  name: '',
  productionAreaId: 'COCINA',
  price: '0',
  unitCost: '0',
  iva: '0',
  quantity: '0',
  status: 'AVAILABLE',
  isActive: 'true',
  isPublic: 'true',
  imageUrl: '',
  optionsText: '',
}

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function normalizeInitial(value) {
  return String(value || 'P').slice(0, 1).toUpperCase()
}

function optionsToText(options = []) {
  return options
    .map((option) => {
      const name = String(option.name || '').trim()
      const extraPrice = Number(option.extraPrice || 0)
      if (!name) return ''
      return extraPrice > 0 ? `${name}:${extraPrice.toFixed(2)}` : name
    })
    .filter(Boolean)
    .join(', ')
}

function parseOptions(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [namePart, extraPricePart] = chunk.split(':')
      return {
        name: String(namePart || '').trim(),
        extraPrice: Number(extraPricePart || 0),
      }
    })
    .filter((option) => option.name)
}

export default function MenuProductsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const [filters, setFilters] = useState({
    search: '',
    sectionId: 'all',
    categoryId: 'all',
    active: 'all',
    status: 'all',
    isPublic: 'all',
  })
  const [dialogOpen, setDialogOpen] = useState(false)
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

  const productsQuery = useQuery({
    queryKey: scopedQueryKey('menu-products', user, 'all'),
    queryFn: () => api.getMenuProducts({}),
  })

  const createMutation = useMutation({
    mutationFn: api.createMenuProduct,
    onSuccess: async () => {
      toast.success('Producto creado')
      setDialogOpen(false)
      setForm(INITIAL_FORM)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ productId, body }) => api.updateMenuProduct(productId, body),
    onSuccess: async () => {
      toast.success('Producto actualizado')
      setDialogOpen(false)
      setForm(INITIAL_FORM)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteMenuProduct,
    onSuccess: async () => {
      toast.success('Producto eliminado')
      setDeleteTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ productId, body }) => api.updateMenuProduct(productId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-products'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const sections = sectionsQuery.data || []
  const categories = categoriesQuery.data || []
  const rows = productsQuery.data || []

  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections])
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])

  const filteredRows = useMemo(() => {
    const needle = String(filters.search || '').trim().toLowerCase()
    return rows.filter((row) => {
      const matchesSearch =
        !needle ||
        String(row.name || '').toLowerCase().includes(needle) ||
        String(row.productionAreaId || '').toLowerCase().includes(needle) ||
        String(row.categoryName || '').toLowerCase().includes(needle) ||
        String(row.sectionName || '').toLowerCase().includes(needle)
      const matchesSection = filters.sectionId === 'all' ? true : row.sectionId === filters.sectionId
      const matchesCategory = filters.categoryId === 'all' ? true : row.categoryId === filters.categoryId
      const matchesActive = filters.active === 'all' ? true : String(row.isActive) === filters.active
      const matchesStatus = filters.status === 'all' ? true : row.status === filters.status
      const matchesPublic = filters.isPublic === 'all' ? true : String(row.isPublic) === filters.isPublic
      return matchesSearch && matchesSection && matchesCategory && matchesActive && matchesStatus && matchesPublic
    })
  }, [filters, rows])

  const categoriesForFilter = useMemo(() => {
    if (filters.sectionId === 'all') return categories
    return categories.filter((category) => category.sectionId === filters.sectionId)
  }, [categories, filters.sectionId])

  const categoriesForForm = useMemo(() => {
    if (!form.sectionId) return categories
    return categories.filter((category) => category.sectionId === form.sectionId)
  }, [categories, form.sectionId])

  const stats = useMemo(
    () => [
      { label: 'Total', value: rows.length, meta: 'Productos registrados' },
      { label: 'Activos', value: rows.filter((row) => row.isActive !== false).length, meta: 'Disponibles para operar' },
      { label: 'Publicos QR', value: rows.filter((row) => row.isPublic !== false).length, meta: 'Visibles para cliente' },
      { label: 'Agotados', value: rows.filter((row) => row.status === 'OUT_OF_STOCK').length, meta: 'Necesitan reposicion' },
    ],
    [rows],
  )

  function resetForm() {
    const firstSectionId = sections[0]?.id || ''
    setForm({
      ...INITIAL_FORM,
      sectionId: firstSectionId,
      categoryId: categories.find((category) => category.sectionId === firstSectionId)?.id || '',
    })
  }

  function openCreateDialog() {
    resetForm()
    setDialogOpen(true)
  }

  function openEditDialog(product) {
    setForm({
      id: product.id,
      sectionId: product.sectionId || '',
      categoryId: product.categoryId || '',
      name: product.name || '',
      productionAreaId: product.productionAreaId || 'COCINA',
      price: String(Number(product.price || 0)),
      unitCost: String(Number(product.unitCost || 0)),
      iva: String(Number(product.iva || 0)),
      quantity: String(Number(product.quantity || 0)),
      status: product.status || 'AVAILABLE',
      isActive: String(product.isActive !== false),
      isPublic: String(product.isPublic !== false),
      imageUrl: product.imageUrl || '',
      optionsText: optionsToText(product.options || []),
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    if (createMutation.isPending || updateMutation.isPending) return
    setDialogOpen(false)
    setForm(INITIAL_FORM)
  }

  function handleSectionChange(nextSectionId) {
    const nextCategories = categories.filter((category) => category.sectionId === nextSectionId)
    setForm((prev) => ({
      ...prev,
      sectionId: nextSectionId,
      categoryId: nextCategories.some((category) => category.id === prev.categoryId) ? prev.categoryId : nextCategories[0]?.id || '',
    }))
  }

  function buildPayload() {
    const sectionId = String(form.sectionId || '').trim()
    const categoryId = String(form.categoryId || categoriesForForm[0]?.id || '').trim()
    const name = String(form.name || '').trim()
    const price = Number(form.price || 0)

    if (!sectionId) throw new Error('Selecciona una seccion')
    if (!categoryId) throw new Error('Selecciona una categoria')
    if (!name) throw new Error('Ingresa el nombre del producto')
    if (!Number.isFinite(price) || price < 0) throw new Error('Ingresa un precio valido')

    return {
      sectionId,
      categoryId,
      name,
      productionAreaId: String(form.productionAreaId || '').trim() || 'COCINA',
      price,
      unitCost: Number(form.unitCost || 0),
      iva: Number(form.iva || 0),
      quantity: Number(form.quantity || 0),
      status: form.status,
      isActive: form.isActive === 'true',
      isPublic: form.isPublic === 'true',
      imageUrl: String(form.imageUrl || '').trim(),
      options: parseOptions(form.optionsText),
    }
  }

  function submitForm(event) {
    event.preventDefault()
    let payload
    try {
      payload = buildPayload()
    } catch (error) {
      toast.error(error.message)
      return
    }

    if (form.id) {
      updateMutation.mutate({ productId: form.id, body: payload })
      return
    }

    createMutation.mutate(payload)
  }

  function handleToggleActive(product) {
    toggleMutation.mutate({ productId: product.id, body: { isActive: !product.isActive } })
  }

  function handleTogglePublic(product) {
    toggleMutation.mutate({ productId: product.id, body: { isPublic: !product.isPublic } })
  }

  return (
    <MenuPageShell
      actionLabel="Agregar producto"
      onAction={openCreateDialog}
      stats={stats}
      subtitle="Centraliza productos con filtros claros, acciones por fila y formularios en modal."
      title="Productos"
    >
      <MenuPanel
        actions={
          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              width: '100%',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, minmax(0, 1fr))',
                xl: 'minmax(220px, 1.4fr) repeat(5, minmax(150px, 0.75fr))',
              },
            }}
          >
            <TextField
              fullWidth
              label="Buscar"
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Producto, categoria o area"
              size="small"
              value={filters.search}
            />
            <TextField
              label="Seccion"
              onChange={(event) => {
                const nextSectionId = event.target.value
                const nextCategories = nextSectionId === 'all' ? categories : categories.filter((category) => category.sectionId === nextSectionId)
                setFilters((prev) => ({
                  ...prev,
                  sectionId: nextSectionId,
                  categoryId: nextCategories.some((category) => category.id === prev.categoryId) ? prev.categoryId : 'all',
                }))
              }}
              select
              size="small"
              value={filters.sectionId}
            >
              <MenuItem value="all">Todas</MenuItem>
              {sections.map((section) => (
                <MenuItem key={section.id} value={section.id}>{section.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Categoria"
              onChange={(event) => setFilters((prev) => ({ ...prev, categoryId: event.target.value }))}
              select
              size="small"
              value={filters.categoryId}
            >
              <MenuItem value="all">Todas</MenuItem>
              {categoriesForFilter.map((category) => (
                <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Estado"
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              select
              size="small"
              value={filters.status}
            >
              <MenuItem value="all">Todos</MenuItem>
              {PRODUCT_STATUS.map((status) => (
                <MenuItem key={status} value={status}>{STATUS_LABELS[status]}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Activo"
              onChange={(event) => setFilters((prev) => ({ ...prev, active: event.target.value }))}
              select
              size="small"
              value={filters.active}
            >
              <MenuItem value="all">Todos</MenuItem>
              <MenuItem value="true">Activos</MenuItem>
              <MenuItem value="false">Inactivos</MenuItem>
            </TextField>
            <TextField
              label="QR"
              onChange={(event) => setFilters((prev) => ({ ...prev, isPublic: event.target.value }))}
              select
              size="small"
              value={filters.isPublic}
            >
              <MenuItem value="all">Todos</MenuItem>
              <MenuItem value="true">Publicos</MenuItem>
              <MenuItem value="false">Privados</MenuItem>
            </TextField>
          </Box>
        }
        subtitle="El listado concentra precio, stock, estado y visibilidad publica del menu."
        title="Listado de productos"
      >
        {sectionsQuery.isLoading || categoriesQuery.isLoading || productsQuery.isLoading ? (
          <Typography sx={{ color: menuAdminPalette.muted }}>Cargando productos...</Typography>
        ) : !filteredRows.length ? (
          <MenuEmptyState
            description="No hay productos para los filtros elegidos. Ajusta la busqueda o agrega uno nuevo desde el boton superior."
            title="Sin productos para mostrar"
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 1180 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell>Seccion</TableCell>
                  <TableCell>Categoria</TableCell>
                  <TableCell>Precio</TableCell>
                  <TableCell>Stock</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>QR</TableCell>
                  <TableCell>Area</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow hover key={row.id}>
                    <TableCell>
                      <Stack alignItems="center" direction="row" spacing={1.5}>
                        {row.imageUrl ? (
                          <Avatar alt={row.name} src={row.imageUrl} sx={{ width: 52, height: 52 }} variant="rounded" />
                        ) : (
                          <Avatar
                            sx={{
                              width: 52,
                              height: 52,
                              bgcolor: alpha(menuAdminPalette.accent, 0.14),
                              color: menuAdminPalette.accent,
                              fontWeight: 800,
                            }}
                            variant="rounded"
                          >
                            {normalizeInitial(row.name)}
                          </Avatar>
                        )}
                        <Box>
                          <Typography sx={{ color: menuAdminPalette.ink, fontSize: 15, fontWeight: 700 }}>
                            {row.name}
                          </Typography>
                          <Typography sx={{ color: menuAdminPalette.muted, fontSize: 12.5 }}>
                            Costo {formatMoney(row.unitCost)} | IVA {Number(row.iva || 0)}%
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{row.sectionName || sectionById.get(row.sectionId)?.name || '-'}</TableCell>
                    <TableCell>{row.categoryName || categoryById.get(row.categoryId)?.name || '-'}</TableCell>
                    <TableCell>{formatMoney(row.price)}</TableCell>
                    <TableCell>{Number(row.quantity || 0)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        <Chip
                          label={STATUS_LABELS[row.status] || row.status}
                          size="small"
                          sx={{ bgcolor: alpha(menuAdminPalette.accent, 0.08), color: menuAdminPalette.accent, fontWeight: 700 }}
                        />
                        <Chip
                          label={row.isActive ? 'Activo' : 'Inactivo'}
                          size="small"
                          sx={{
                            bgcolor: row.isActive ? '#edf8f0' : '#f3f4f6',
                            color: row.isActive ? '#216a38' : '#64748b',
                            fontWeight: 700,
                          }}
                        />
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={row.isPublic ? 'Publico' : 'Privado'}
                        size="small"
                        sx={{
                          bgcolor: row.isPublic ? alpha(menuAdminPalette.accent, 0.1) : '#fff7ed',
                          color: row.isPublic ? menuAdminPalette.accent : '#9a5b16',
                          fontWeight: 700,
                        }}
                      />
                    </TableCell>
                    <TableCell>{row.productionAreaId || 'COCINA'}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={1} useFlexGap flexWrap="wrap">
                        <Button onClick={() => openEditDialog(row)} size="small" startIcon={<EditRoundedIcon />} sx={{ textTransform: 'none' }}>
                          Editar
                        </Button>
                        <Button
                          onClick={() => handleToggleActive(row)}
                          size="small"
                          startIcon={row.isActive ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                          sx={{ textTransform: 'none' }}
                        >
                          {row.isActive ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          onClick={() => handleTogglePublic(row)}
                          size="small"
                          startIcon={row.isPublic ? <PublicOffRoundedIcon /> : <PublicRoundedIcon />}
                          sx={{ textTransform: 'none' }}
                        >
                          {row.isPublic ? 'Privar QR' : 'Publicar QR'}
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
        maxWidth="md"
        onClose={closeDialog}
        open={dialogOpen}
        PaperProps={{ sx: { borderRadius: 4, border: `1px solid ${menuAdminPalette.line}` } }}
      >
        <DialogTitle sx={{ color: menuAdminPalette.ink, fontWeight: 800 }}>
          {form.id ? 'Editar producto' : 'Nuevo producto'}
        </DialogTitle>
        <Box component="form" onSubmit={submitForm}>
          <DialogContent sx={{ display: 'grid', gap: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="Seccion"
                onChange={(event) => handleSectionChange(event.target.value)}
                select
                size="small"
                value={form.sectionId}
              >
                {sections.map((section) => (
                  <MenuItem key={section.id} value={section.id}>{section.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                label="Categoria"
                onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}
                select
                size="small"
                value={form.categoryId}
              >
                {categoriesForForm.map((category) => (
                  <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>
                ))}
              </TextField>
            </Stack>

            <TextField
              autoFocus
              fullWidth
              label="Nombre del producto"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              size="small"
              value={form.name}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="Area de produccion"
                onChange={(event) => setForm((prev) => ({ ...prev, productionAreaId: event.target.value }))}
                placeholder="Ej: COCINA, BAR, PARRILLA"
                size="small"
                value={form.productionAreaId}
              />
              <TextField
                fullWidth
                label="Estado"
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                select
                size="small"
                value={form.status}
              >
                {PRODUCT_STATUS.map((status) => (
                  <MenuItem key={status} value={status}>{STATUS_LABELS[status]}</MenuItem>
                ))}
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="Precio de venta"
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                size="small"
                type="number"
                value={form.price}
              />
              <TextField
                fullWidth
                label="Costo unitario"
                onChange={(event) => setForm((prev) => ({ ...prev, unitCost: event.target.value }))}
                size="small"
                type="number"
                value={form.unitCost}
              />
              <TextField
                fullWidth
                label="Cantidad"
                onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                size="small"
                type="number"
                value={form.quantity}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="IVA (%)"
                onChange={(event) => setForm((prev) => ({ ...prev, iva: event.target.value }))}
                size="small"
                type="number"
                value={form.iva}
              />
              <TextField
                fullWidth
                label="Activo"
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value }))}
                select
                size="small"
                value={form.isActive}
              >
                <MenuItem value="true">Activo</MenuItem>
                <MenuItem value="false">Inactivo</MenuItem>
              </TextField>
              <TextField
                fullWidth
                label="Visible en QR"
                onChange={(event) => setForm((prev) => ({ ...prev, isPublic: event.target.value }))}
                select
                size="small"
                value={form.isPublic}
              >
                <MenuItem value="true">Publico</MenuItem>
                <MenuItem value="false">Privado</MenuItem>
              </TextField>
            </Stack>

            <TextField
              fullWidth
              label="Imagen referencial"
              onChange={(event) => setForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
              placeholder="https://..."
              size="small"
              value={form.imageUrl}
            />

            <TextField
              fullWidth
              helperText="Formato: Nombre:precio. Ejemplo: Queso extra:2.50, Sin cebolla, Arroz extra:3.00"
              label="Opciones o guarniciones"
              minRows={3}
              multiline
              onChange={(event) => setForm((prev) => ({ ...prev, optionsText: event.target.value }))}
              size="small"
              value={form.optionsText}
            />
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
                : form.id
                  ? 'Guardar cambios'
                  : 'Crear producto'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDeleteDialog
        description={
          deleteTarget
            ? `Se eliminara el producto "${deleteTarget.name}" del menu y del catalogo sincronizado que consume el POS y el QR.`
            : ''
        }
        loading={deleteMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        open={Boolean(deleteTarget)}
        title="Eliminar producto"
      />
    </MenuPageShell>
  )
}
