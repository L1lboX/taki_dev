import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button as MuiButton,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { downloadKitchenTicketPdf } from '../lib/kitchenTicketPdf'
import { scopedQueryKey } from '../lib/queryAuth'
import { getSocket } from '../lib/socket'
import { orderStatusLabel } from '../lib/statusLabels'
import { useAuthStore } from '../store/authStore'

const todayIso = new Date().toISOString().slice(0, 10)

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`
}

function normalizeLabel(label) {
  return String(label || '').replace(/^Entrada extra:\s*/i, '')
}

function mapOptions(items) {
  return items.map((item) => ({
    id: item.id,
    name: normalizeLabel(item.name),
    price: Number(item.basePrice || 0),
    variants: Array.isArray(item.variants) ? item.variants : ['normal'],
  }))
}

function createPersonDraft() {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mainId: '',
    entryId: '',
    kitchenNote: '',
    showExtras: false,
    extraEntryEnabled: false,
    beverageEnabled: false,
    extraEntryIds: [],
    beverageIds: [],
  }
}

function mergeIdsWithQty(ids) {
  const grouped = new Map()
  for (const id of ids) {
    if (!id) continue
    grouped.set(id, (grouped.get(id) || 0) + 1)
  }
  return Array.from(grouped.entries()).map(([productId, quantity]) => ({ productId, quantity }))
}

function subtotalOfPerson(person, mainMap, entryMap, beverageMap) {
  let subtotal = 0

  if (person.mainId) {
    subtotal += Number(mainMap.get(person.mainId)?.price || 0)
  }

  if (person.extraEntryEnabled) {
    for (const id of person.extraEntryIds || []) {
      subtotal += Number(entryMap.get(id)?.price || 0)
    }
  }

  if (person.beverageEnabled) {
    for (const id of person.beverageIds || []) {
      subtotal += Number(beverageMap.get(id)?.price || 0)
    }
  }

  return Number(subtotal.toFixed(2))
}

const ORDER_PENDING_STATUSES = new Set(['DRAFT', 'PENDING_WAITER_APPROVAL', 'APPROVED'])
const ORDER_IN_PROCESS_STATUSES = new Set(['SENT_TO_KITCHEN', 'PREPARING', 'READY'])
const ORDER_DELIVERED_STATUSES = new Set(['DELIVERED'])

function summarizeLiveOrders(orders) {
  const summary = {
    total: 0,
    pending: 0,
    inProcess: 0,
    delivered: 0,
  }

  for (const order of orders) {
    if (ORDER_PENDING_STATUSES.has(order.status)) summary.pending += 1
    else if (ORDER_IN_PROCESS_STATUSES.has(order.status)) summary.inProcess += 1
    else if (ORDER_DELIVERED_STATUSES.has(order.status)) summary.delivered += 1
  }

  summary.total = summary.pending + summary.inProcess + summary.delivered
  return summary
}

const ORDER_PANEL_COLORS = {
  ink: '#1d2740',
  muted: '#6d7893',
  line: 'rgba(153, 17, 43, 0.12)',
  lineStrong: 'rgba(153, 17, 43, 0.22)',
  paper: '#fffdf8',
  soft: '#f7f2e8',
  blush: '#f8ecef',
  primary: '#99112b',
  primarySoft: 'rgba(153, 17, 43, 0.08)',
  accent: '#ea8341',
  accentSoft: 'rgba(234, 131, 65, 0.16)',
  success: '#2f8f57',
  successSoft: 'rgba(47, 143, 87, 0.12)',
  info: '#4158d8',
  infoSoft: 'rgba(65, 88, 216, 0.10)',
}

export default function PosPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)

  const [selectedTableId, setSelectedTableId] = useState('')
  const [persons, setPersons] = useState([])
  const [orderViewMode, setOrderViewMode] = useState('TABLES')
  const [tableStateFilter, setTableStateFilter] = useState('ALL')
  const [salonFilter, setSalonFilter] = useState('ALL')
  const [isOrderDrawerOpen, setOrderDrawerOpen] = useState(false)
  const [isComposeMode, setComposeMode] = useState(false)
  const composeScrollRef = useRef(null)
  const personCardRefs = useRef({})
  const previousPersonCountRef = useRef(0)

  const tablesQuery = useQuery({
    queryKey: scopedQueryKey('tables', user),
    queryFn: api.getTables,
    refetchOnMount: 'always',
  })

  const menusQuery = useQuery({
    queryKey: scopedQueryKey('menus', user, todayIso),
    queryFn: () => api.getMenus(todayIso),
  })

  const ordersQuery = useQuery({
    queryKey: scopedQueryKey('orders', user),
    queryFn: () => api.listOrders(),
    refetchOnMount: 'always',
  })

  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data])

  const menuItems = useMemo(() => menusQuery.data?.items ?? [], [menusQuery.data])

  const mainOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type !== 'ADDON' && item.type !== 'BEVERAGE')),
    [menuItems],
  )

  const entryOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type === 'ADDON')),
    [menuItems],
  )

  const beverageOptions = useMemo(
    () => mapOptions(menuItems.filter((item) => item.type === 'BEVERAGE')),
    [menuItems],
  )

  const mainMap = useMemo(() => new Map(mainOptions.map((option) => [option.id, option])), [mainOptions])
  const entryMap = useMemo(() => new Map(entryOptions.map((option) => [option.id, option])), [entryOptions])
  const beverageMap = useMemo(() => new Map(beverageOptions.map((option) => [option.id, option])), [beverageOptions])

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [tables, selectedTableId],
  )

  const selectedOperationalTableId = selectedTable?.operationalTableId || selectedTable?.id || ''

  const selectedTableQrOrders = useMemo(() => {
    if (!selectedTable) return []
    return orders
      .filter((order) => order.tableId === selectedOperationalTableId && order.source === 'QR')
      .filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [orders, selectedOperationalTableId, selectedTable])

  const liveOrders = useMemo(
    () => orders.filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED'),
    [orders],
  )

  const selectedTableLiveOrders = useMemo(() => {
    if (!selectedTable) return []
    return liveOrders
      .filter((order) => order.tableId === selectedOperationalTableId && order.source !== 'QR')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [liveOrders, selectedOperationalTableId, selectedTable])

  const orderSummary = useMemo(() => summarizeLiveOrders(liveOrders), [liveOrders])

  const takeAwayOrders = useMemo(
    () =>
      liveOrders
        .filter((order) => {
          if (!order.tableId) return true
          const items = Array.isArray(order.items) ? order.items : []
          return items.some((item) => item.serviceMode === 'TAKEAWAY')
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [liveOrders],
  )

  const tableCards = useMemo(
    () =>
      tables.map((table) => {
        const operationalTableId = table.operationalTableId || table.id
        const tableOrders = liveOrders.filter((order) => order.tableId === operationalTableId)
        const pendingCount = tableOrders.filter((order) => ORDER_PENDING_STATUSES.has(order.status)).length
        const inProcessCount = tableOrders.filter((order) => ORDER_IN_PROCESS_STATUSES.has(order.status)).length
        const deliveredCount = tableOrders.filter((order) => ORDER_DELIVERED_STATUSES.has(order.status)).length

        let stateCode = 'AVAILABLE'
        if (inProcessCount > 0) stateCode = 'IN_PROCESS'
        else if (pendingCount > 0) stateCode = 'PENDING'
        else if (deliveredCount > 0) stateCode = 'DELIVERED'
        else if (table.status === 'OCCUPIED') stateCode = 'OCCUPIED'

        const stateMeta = {
          AVAILABLE: { label: 'Disponible', tone: 'available' },
          OCCUPIED: { label: 'Ocupada', tone: 'occupied' },
          PENDING: { label: 'Pendiente', tone: 'pending' },
          IN_PROCESS: { label: 'En proceso', tone: 'process' },
          DELIVERED: { label: 'Entregado', tone: 'delivered' },
        }[stateCode]

        return {
          table,
          guestCount: table.activeSession?.guestsActive || 0,
          salonId: table.salon?.id || table.salonId || 'NO_SALON',
          salonName: table.salon?.name || 'Salon sin nombre',
          salonSortOrder: Number(table.salon?.sortOrder || Number.MAX_SAFE_INTEGER),
          pendingCount,
          inProcessCount,
          deliveredCount,
          stateCode,
          stateMeta,
        }
      }),
    [tables, liveOrders],
  )

  const filteredTableCards = useMemo(
    () =>
      tableCards.filter((row) => {
        if (salonFilter !== 'ALL' && row.salonId !== salonFilter) return false
        if (tableStateFilter === 'ALL') return true
        if (tableStateFilter === 'AVAILABLE') return row.stateCode === 'AVAILABLE'
        if (tableStateFilter === 'OCCUPIED') return row.stateCode === 'OCCUPIED'
        if (tableStateFilter === 'PENDING') return row.stateCode === 'PENDING'
        if (tableStateFilter === 'IN_PROCESS') return row.stateCode === 'IN_PROCESS'
        if (tableStateFilter === 'DELIVERED') return row.stateCode === 'DELIVERED'
        return true
      }),
    [salonFilter, tableCards, tableStateFilter],
  )

  const salonFilters = useMemo(() => {
    const grouped = new Map()

    for (const row of tableCards) {
      const current = grouped.get(row.salonId) || {
        id: row.salonId,
        name: row.salonName,
        sortOrder: row.salonSortOrder,
        total: 0,
      }
      current.total += 1
      grouped.set(row.salonId, current)
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name)
    })
  }, [tableCards])

  const groupedTableCards = useMemo(() => {
    const grouped = new Map()

    for (const row of filteredTableCards) {
      if (!grouped.has(row.salonId)) {
        grouped.set(row.salonId, {
          salonId: row.salonId,
          salonName: row.salonName,
          salonSortOrder: row.salonSortOrder,
          rows: [],
        })
      }

      grouped.get(row.salonId).rows.push(row)
    }

    return Array.from(grouped.values())
      .sort((a, b) => {
        if (a.salonSortOrder !== b.salonSortOrder) return a.salonSortOrder - b.salonSortOrder
        return a.salonName.localeCompare(b.salonName)
      })
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => Number(a.table.number || 0) - Number(b.table.number || 0)),
      }))
  }, [filteredTableCards])

  const selectedTableCard = useMemo(
    () => tableCards.find((row) => row.table.id === selectedTableId) || null,
    [tableCards, selectedTableId],
  )

  const personSubtotals = useMemo(
    () => persons.map((person) => subtotalOfPerson(person, mainMap, entryMap, beverageMap)),
    [persons, mainMap, entryMap, beverageMap],
  )

  const totalAmount = useMemo(
    () => personSubtotals.reduce((sum, subtotal) => sum + subtotal, 0),
    [personSubtotals],
  )

  const openSessionMutation = useMutation({
    mutationFn: ({ tableId, guests }) => api.openTableSession(tableId, { guests }),
  })

  const updateGuestsMutation = useMutation({
    mutationFn: ({ tableId, guests }) => api.updateSessionGuests(tableId, { guests }),
  })

  const createOrderMutation = useMutation({
    mutationFn: ({ tableId }) => api.createOrder({ tableId, source: 'WAITER' }),
  })

  const addItemsMutation = useMutation({
    mutationFn: ({ orderId, payload }) => api.addItems(orderId, payload),
  })

  const sendKitchenMutation = useMutation({
    mutationFn: (orderId) => api.sendKitchen(orderId),
  })

  const sendKitchenBatchMutation = useMutation({
    mutationFn: (payload) => api.sendKitchenBatch(payload),
  })

  const approveQrOrderMutation = useMutation({
    mutationFn: (orderId) => api.approveOrder(orderId),
  })

  const isConfirming =
    openSessionMutation.isPending ||
    updateGuestsMutation.isPending ||
    createOrderMutation.isPending ||
    addItemsMutation.isPending ||
    sendKitchenMutation.isPending ||
    sendKitchenBatchMutation.isPending ||
    approveQrOrderMutation.isPending

  useEffect(() => {
    const socket = getSocket()

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    }

    socket.on('table.session.updated', refresh)
    socket.on('order.updated', refresh)
    socket.on('kitchen.ticket.updated', refresh)

    return () => {
      socket.off('table.session.updated', refresh)
      socket.off('order.updated', refresh)
      socket.off('kitchen.ticket.updated', refresh)
    }
  }, [queryClient])

  useEffect(() => {
    if (!isOrderDrawerOpen) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOrderDrawerOpen(false)
        setComposeMode(false)
        setSelectedTableId('')
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOrderDrawerOpen])

  useEffect(() => {
    if (!isComposeMode) {
      previousPersonCountRef.current = persons.length
      return
    }

    if (persons.length > previousPersonCountRef.current) {
      const lastPerson = persons[persons.length - 1]
      const target = lastPerson ? personCardRefs.current[lastPerson.id] : null

      if (target && typeof target.scrollIntoView === 'function') {
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      } else if (composeScrollRef.current) {
        requestAnimationFrame(() => {
          composeScrollRef.current.scrollTo({
            top: composeScrollRef.current.scrollHeight,
            behavior: 'smooth',
          })
        })
      }
    }

    previousPersonCountRef.current = persons.length
  }, [isComposeMode, persons])

  function selectTable(table) {
    setSelectedTableId(table.id)

    const initialPeople = Math.max(table.activeSession?.guestsActive || 1, 1)
    const draft = Array.from({ length: initialPeople }, () => createPersonDraft())
    setPersons(draft)
    setComposeMode(false)
    setOrderDrawerOpen(true)
  }

  function closeOrderDrawer() {
    setOrderDrawerOpen(false)
    setComposeMode(false)
    setSelectedTableId('')
  }

  function openComposerForTable() {
    if (!selectedTable) return
    setComposeMode(true)
  }

  function updatePerson(index, patch) {
    setPersons((prev) => prev.map((person, idx) => (idx === index ? { ...person, ...patch } : person)))
  }

  function toggleExtraType(index, type, enabled) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryEnabled: enabled,
            extraEntryIds: enabled ? (person.extraEntryIds.length ? person.extraEntryIds : [entryOptions[0]?.id || '']) : [],
          }
        }

        return {
          ...person,
          beverageEnabled: enabled,
          beverageIds: enabled ? (person.beverageIds.length ? person.beverageIds : [beverageOptions[0]?.id || '']) : [],
        }
      }),
    )
  }

  function addExtraRow(index, type) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryIds: [...person.extraEntryIds, entryOptions[0]?.id || ''],
          }
        }

        return {
          ...person,
          beverageIds: [...person.beverageIds, beverageOptions[0]?.id || ''],
        }
      }),
    )
  }

  function updateExtraRow(index, type, rowIndex, value) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          const next = [...person.extraEntryIds]
          next[rowIndex] = value
          return { ...person, extraEntryIds: next }
        }

        const next = [...person.beverageIds]
        next[rowIndex] = value
        return { ...person, beverageIds: next }
      }),
    )
  }

  function removeExtraRow(index, type, rowIndex) {
    setPersons((prev) =>
      prev.map((person, idx) => {
        if (idx !== index) return person

        if (type === 'entry') {
          return {
            ...person,
            extraEntryIds: person.extraEntryIds.filter((_, pos) => pos !== rowIndex),
          }
        }

        return {
          ...person,
          beverageIds: person.beverageIds.filter((_, pos) => pos !== rowIndex),
        }
      }),
    )
  }

  function addPerson() {
    if (!selectedTable) {
      toast.error('Selecciona una mesa primero')
      return
    }

    if (persons.length >= selectedTable.capacity) {
      toast.error(`Aforo maximo alcanzado (${selectedTable.capacity})`)
      return
    }

    setPersons((prev) => [...prev, createPersonDraft()])
  }

  async function ensureTableSession(guests) {
    if (!selectedTable) {
      throw new Error('Mesa no seleccionada')
    }

    if (selectedTable.activeSession) {
      if (selectedTable.activeSession.guestsActive !== guests) {
        await updateGuestsMutation.mutateAsync({ tableId: selectedOperationalTableId, guests })
      }
      return
    }

    await openSessionMutation.mutateAsync({ tableId: selectedOperationalTableId, guests })
  }

  function buildOrderItems() {
    if (!persons.length) {
      throw new Error('No hay personas en la mesa')
    }

    const generatedItems = persons.flatMap((person, index) => {
      const guestNumber = index + 1
      const extraEntryIds = person.extraEntryEnabled ? person.extraEntryIds.filter(Boolean) : []
      const beverageIds = person.beverageEnabled ? person.beverageIds.filter(Boolean) : []
      const extraIds = [...extraEntryIds, ...beverageIds]
      const hasExtras = extraIds.length > 0
      const customNote = String(person.kitchenNote || '').trim()

      if (person.mainId) {
        if (!person.entryId) {
          throw new Error(`Persona ${guestNumber}: selecciona entrada del menu`)
        }

        const main = mainMap.get(person.mainId)
        const entry = entryMap.get(person.entryId)
        const notesParts = [`Entrada incluida: ${entry?.name || 'N/A'}`]

        if (customNote) {
          notesParts.push(`Detalle: ${customNote}`)
        }

        return [{
          productId: person.mainId,
          quantity: 1,
          variant: main?.variants?.[0] || 'normal',
          guestNumber,
          serviceMode: 'DINE_IN',
          notes: notesParts.join(' | '),
          extras: mergeIdsWithQty(extraIds),
        }]
      }

      if (person.entryId && !person.mainId) {
        throw new Error(`Persona ${guestNumber}: la entrada incluida requiere plato principal`)
      }

      if (hasExtras) {
        return mergeIdsWithQty(extraIds).map((extraLine) => ({
          productId: extraLine.productId,
          quantity: extraLine.quantity,
          variant: 'normal',
          guestNumber,
          serviceMode: 'DINE_IN',
          notes: customNote ? `Detalle: ${customNote}` : '',
          extras: [],
        }))
      }

      if (customNote) {
        throw new Error(`Persona ${guestNumber}: agrega un plato o un extra para registrar el detalle`)
      }

      return []
    })

    if (!generatedItems.length) {
      throw new Error('No hay items nuevos para confirmar en la mesa')
    }

    return generatedItems
  }

  async function confirmOrder() {
    try {
      if (!selectedTable) {
        toast.error('Selecciona una mesa primero')
        return
      }

      const items = buildOrderItems()

      await ensureTableSession(persons.length)

      const order = await createOrderMutation.mutateAsync({ tableId: selectedTable.id })
      await addItemsMutation.mutateAsync({ orderId: order.id, payload: { items } })
      const kitchenResult = await sendKitchenMutation.mutateAsync(order.id)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ])

      setPersons((prev) => prev.map(() => createPersonDraft()))

      let pdfGenerated = false
      if (kitchenResult?.ticket) {
        try {
          await downloadKitchenTicketPdf(kitchenResult.ticket, { tableNumber: selectedTable.number })
          pdfGenerated = true
        } catch {
          pdfGenerated = false
        }
      }

      toast.success(
        pdfGenerated
          ? 'Pedido confirmado, enviado a cocina y comanda PDF generada'
          : 'Pedido confirmado y enviado a cocina',
      )
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function approveQrOrder(order) {
    try {
      await approveQrOrderMutation.mutateAsync(order.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
      ])
      toast.success(`Pedido QR aprobado: ${order.id.slice(0, 8)}`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function sendQrOrderToKitchen(order) {
    try {
      const result = await sendKitchenMutation.mutateAsync(order.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ])

      let pdfGenerated = false
      if (result?.ticket) {
        try {
          await downloadKitchenTicketPdf(result.ticket, { tableNumber: selectedTable?.number || '-' })
          pdfGenerated = true
        } catch {
          pdfGenerated = false
        }
      }

      toast.success(
        pdfGenerated
          ? `Pedido QR enviado a cocina: ${order.id.slice(0, 8)} (comanda PDF)`
          : `Pedido QR enviado a cocina: ${order.id.slice(0, 8)}`,
      )
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function sendApprovedQrOrdersMerged() {
    if (!selectedTableQrOrders.length) return
    const approvedOrders = selectedTableQrOrders.filter((order) => order.status === 'APPROVED')
    if (approvedOrders.length < 2) return

    try {
      const result = await sendKitchenBatchMutation.mutateAsync({
        orderIds: approvedOrders.map((order) => order.id),
        mergePrint: true,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ])

      if (result?.mergedTicket) {
        try {
          await downloadKitchenTicketPdf(result.mergedTicket, { tableNumber: selectedTable?.number || '-' })
        } catch {
          // dejamos continuar sin bloquear la operacion
        }
      }

      toast.success(`Se enviaron ${approvedOrders.length} pedidos QR en una sola comanda`)
    } catch (error) {
      toast.error(error.message || 'No se pudieron enviar las comandas juntas')
    }
  }

  function createTakeAwayOrder() {
    setOrderViewMode('TAKEAWAY')
    setOrderDrawerOpen(false)
    setComposeMode(false)
    setSelectedTableId('')
    toast.info('Flujo para llevar preparado en esta vista. Siguiente paso: registrar pedido rapido para takeaway.')
  }

  return (
    <div className="page-stack pos-orders-page">
      <section className="pos-orders-shell">
        <div className="section-head pos-orders-head">
          <div>
            <h2 className="section-title">Pedidos</h2>
            <p className="section-subtitle">Gestion de pedidos por mesa y para llevar</p>
          </div>
          <button className="btn btn-alt" onClick={createTakeAwayOrder} type="button">
            + Crear pedido para llevar
          </button>
        </div>

        <div className="pos-orders-kpis">
          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon total"><i className="fi fi-rr-receipt" /></span>
              <p>Total de pedidos</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.total}</p>
            <div className="pos-orders-kpi-track"><span className="pos-orders-kpi-fill total" style={{ width: '100%' }} /></div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon pending"><i className="fi fi-rr-hourglass-end" /></span>
              <p>Pendientes</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.pending}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill pending"
                style={{ width: `${orderSummary.total ? (orderSummary.pending / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon process"><i className="fi fi-rr-fire-flame-curved" /></span>
              <p>En proceso</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.inProcess}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill process"
                style={{ width: `${orderSummary.total ? (orderSummary.inProcess / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>

          <article className="pos-orders-kpi-card">
            <div className="pos-orders-kpi-head">
              <span className="pos-orders-kpi-icon delivered"><i className="fi fi-rr-check" /></span>
              <p>Entregados</p>
            </div>
            <p className="pos-orders-kpi-value">{orderSummary.delivered}</p>
            <div className="pos-orders-kpi-track">
              <span
                className="pos-orders-kpi-fill delivered"
                style={{ width: `${orderSummary.total ? (orderSummary.delivered / orderSummary.total) * 100 : 0}%` }}
              />
            </div>
          </article>
        </div>

        <div className="pos-orders-toolbar">
          <div className="pos-orders-view-tabs">
            <button
              className={`pos-orders-tab ${orderViewMode === 'TABLES' ? 'active' : ''}`}
              onClick={() => setOrderViewMode('TABLES')}
              type="button"
            >
              Mesas
            </button>
            <button
              className={`pos-orders-tab ${orderViewMode === 'TAKEAWAY' ? 'active' : ''}`}
              onClick={() => setOrderViewMode('TAKEAWAY')}
              type="button"
            >
              Para llevar <span className="badge">{takeAwayOrders.length}</span>
            </button>
          </div>

          {orderViewMode === 'TABLES' && (
            <select onChange={(event) => setTableStateFilter(event.target.value)} value={tableStateFilter}>
              <option value="ALL">Estado: Todos</option>
              <option value="AVAILABLE">Disponibles</option>
              <option value="OCCUPIED">Ocupadas</option>
              <option value="PENDING">Pendientes</option>
              <option value="IN_PROCESS">En proceso</option>
              <option value="DELIVERED">Entregadas</option>
            </select>
          )}
        </div>

        {orderViewMode === 'TABLES' && !!salonFilters.length && (
          <div className="pos-orders-salon-filters">
            <button
              className={`pos-orders-salon-chip ${salonFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setSalonFilter('ALL')}
              type="button"
            >
              Todos los salones <span className="badge">{tableCards.length}</span>
            </button>

            {salonFilters.map((salon) => (
              <button
                className={`pos-orders-salon-chip ${salonFilter === salon.id ? 'active' : ''}`}
                key={salon.id}
                onClick={() => setSalonFilter(salon.id)}
                type="button"
              >
                {salon.name} <span className="badge">{salon.total}</span>
              </button>
            ))}
          </div>
        )}

        {orderViewMode === 'TABLES' && (
          <div className="pos-orders-salon-groups">
            {groupedTableCards.map((group) => (
              <section className="pos-orders-salon-group" key={group.salonId}>
                <div className="pos-orders-salon-head">
                  <div>
                    <p className="pos-orders-salon-kicker">Salon</p>
                    <h3 className="pos-orders-salon-title">{group.salonName}</h3>
                  </div>
                  <span className="badge">{group.rows.length} mesa{group.rows.length === 1 ? '' : 's'}</span>
                </div>

                <div className="pos-orders-table-grid">
                  {group.rows.map((row) => (
                    <button
                      className={`pos-orders-table-card tone-${row.stateMeta.tone} ${selectedTableId === row.table.id ? 'active' : ''}`}
                      key={row.table.id}
                      onClick={() => selectTable(row.table)}
                      type="button"
                    >
                      <div className="pos-orders-table-head">
                        <p className="pos-orders-table-number">{String(row.table.number).padStart(2, '0')}</p>
                        <span className="pos-orders-table-guests"><i className="fi fi-rr-users" /> {row.guestCount}</span>
                      </div>

                      <p className="pos-orders-table-salon">{row.salonName}</p>

                      <div className="pos-orders-table-status">
                        <span className={`pos-orders-dot ${row.stateMeta.tone}`} />
                        <span>{row.stateMeta.label}</span>
                      </div>

                      <div className="pos-orders-table-counters">
                        <span className="counter pending"><i className="fi fi-rr-hourglass-end" /> {row.pendingCount}</span>
                        <span className="counter process"><i className="fi fi-rr-fire-flame-curved" /> {row.inProcessCount}</span>
                        <span className="counter delivered"><i className="fi fi-rr-check" /> {row.deliveredCount}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {!filteredTableCards.length && (
              <div className="alert alert-info">No hay mesas para el filtro seleccionado.</div>
            )}
          </div>
        )}

        {orderViewMode === 'TAKEAWAY' && (
          <div className="panel-soft">
            <div className="section-head">
              <h3 className="section-title" style={{ fontSize: 20 }}>Pedidos para llevar</h3>
              <span className="badge">{takeAwayOrders.length} activos</span>
            </div>

            {!takeAwayOrders.length && (
              <p className="small muted" style={{ marginTop: 10 }}>
                Aun no hay pedidos para llevar en curso.
              </p>
            )}

            {!!takeAwayOrders.length && (
              <div className="column-list" style={{ marginTop: 10 }}>
                {takeAwayOrders.map((order) => (
                  <article className="card-mini" key={order.id}>
                    <div className="section-head">
                      <div>
                        <p className="small"><strong>Pedido:</strong> {order.id.slice(0, 8)}</p>
                        <p className="small muted">Estado: {orderStatusLabel(order.status)}</p>
                      </div>
                      <strong>{formatMoney(order.totals?.total || 0)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {isOrderDrawerOpen && selectedTable && (
        <div className="pos-order-drawer-backdrop" onClick={closeOrderDrawer}>
          <section className="pos-order-drawer" onClick={(event) => event.stopPropagation()}>
            <header className="pos-order-drawer-head">
              <div>
                <h3 className="pos-order-drawer-title">Mesa {selectedTable.number}</h3>
                <p className={`pos-order-drawer-status ${selectedTableCard?.stateMeta?.tone || 'occupied'}`}>
                  <span className={`pos-orders-dot ${selectedTableCard?.stateMeta?.tone || 'occupied'}`} />
                  {selectedTableCard?.stateMeta?.label || 'Ocupada'}
                </p>
              </div>
              <button aria-label="Cerrar modal mesa" className="pos-order-drawer-close" onClick={closeOrderDrawer} type="button">
                <i className="fi fi-rr-cross-small" />
              </button>
            </header>

            {!isComposeMode && (
              <div className="pos-order-drawer-body">
                {!selectedTableLiveOrders.length && !selectedTableQrOrders.length && (
                  <p className="pos-order-drawer-empty-title">Sin pedidos</p>
                )}

                {!!selectedTableLiveOrders.length && (
                  <div className="column-list">
                    {selectedTableLiveOrders.map((order) => (
                      <article className="card-mini" key={order.id}>
                        <div className="section-head">
                          <div>
                            <p className="small"><strong>Pedido:</strong> {order.id.slice(0, 8)}</p>
                            <p className="small muted">Estado: {orderStatusLabel(order.status)}</p>
                          </div>
                          <strong>{formatMoney(order.totals?.total || 0)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <button className="btn btn-alt pos-order-drawer-add-btn" onClick={openComposerForTable} type="button">
                  + Anadir pedido
                </button>
              </div>
            )}

            {isComposeMode && (
              <div className="pos-order-drawer-body pos-order-drawer-body-compose" ref={composeScrollRef}>
                <div className="page-stack pos-compose-shell">
            <Paper
              elevation={0}
              sx={{
                borderRadius: '24px',
                border: `1px solid ${ORDER_PANEL_COLORS.line}`,
                background: ORDER_PANEL_COLORS.paper,
                p: { xs: 1.5, sm: 2 },
              }}
            >
              <Stack gap={1.5}>
                <Stack alignItems={{ xs: 'flex-start', sm: 'center' }} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Stack alignItems="center" direction="row" spacing={1}>
                      <Chip
                        label={`Mesa ${selectedTable.number}`}
                        size="small"
                        sx={{
                          bgcolor: ORDER_PANEL_COLORS.primary,
                          color: '#fff',
                          fontWeight: 700,
                          borderRadius: '999px',
                        }}
                      />
                      <Typography sx={{ color: ORDER_PANEL_COLORS.muted, fontSize: 15, fontWeight: 500 }}>
                        {persons.length} persona{persons.length === 1 ? '' : 's'} en la mesa
                      </Typography>
                    </Stack>
                    <Typography sx={{ mt: 1, color: ORDER_PANEL_COLORS.ink, fontSize: { xs: 22, sm: 28 }, fontWeight: 700, lineHeight: 1.05 }}>
                      Arma el pedido por persona con una vista mas clara.
                    </Typography>
                  </Box>

                  <MuiButton
                    onClick={() => setComposeMode(false)}
                    size="small"
                    sx={{
                      borderColor: ORDER_PANEL_COLORS.lineStrong,
                      color: ORDER_PANEL_COLORS.ink,
                      borderRadius: '14px',
                      px: 2,
                      py: 1,
                    }}
                    variant="outlined"
                  >
                    Volver
                  </MuiButton>
                </Stack>

                <Stack alignItems={{ xs: 'flex-start', md: 'center' }} direction={{ xs: 'column', md: 'row' }} flexWrap="wrap" gap={1}>
                  <Chip
                    label={`Aforo max. ${selectedTable.capacity} por mesa`}
                    size="small"
                    sx={{
                      bgcolor: ORDER_PANEL_COLORS.successSoft,
                      color: ORDER_PANEL_COLORS.success,
                      borderRadius: '999px',
                      fontWeight: 700,
                    }}
                  />
                  <Stack alignItems="center" direction="row" gap={1}>
                    <Typography sx={{ color: ORDER_PANEL_COLORS.muted, fontSize: 13, fontWeight: 700 }}>
                      Aforo
                    </Typography>
                    <div className="pos-pips">
                      {Array.from({ length: selectedTable.capacity }, (_, index) => (
                        <span className={`pos-pip ${index < persons.length ? 'on' : ''}`} key={`aforo-${selectedTable.id}-${index}`} />
                      ))}
                    </div>
                    <Typography sx={{ color: ORDER_PANEL_COLORS.muted, fontSize: 13, fontWeight: 700 }}>
                      {persons.length}/{selectedTable.capacity}
                    </Typography>
                  </Stack>
                </Stack>
              </Stack>
            </Paper>

            <Paper
              component="section"
              elevation={0}
              sx={{
                borderRadius: '24px',
                border: `1px solid ${ORDER_PANEL_COLORS.line}`,
                background: ORDER_PANEL_COLORS.paper,
                p: { xs: 1.5, sm: 2 },
              }}
            >
              <Stack alignItems={{ xs: 'flex-start', sm: 'center' }} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography sx={{ color: ORDER_PANEL_COLORS.ink, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
                    Pedidos QR en espera
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: ORDER_PANEL_COLORS.muted, fontSize: 14 }}>
                    Revisa primero los pedidos enviados por cliente antes de confirmar nuevos platos.
                  </Typography>
                </Box>
                <Chip
                  label={`Mesa ${selectedTable.number}: ${selectedTableQrOrders.length}`}
                  size="small"
                  sx={{
                    bgcolor: ORDER_PANEL_COLORS.soft,
                    color: ORDER_PANEL_COLORS.ink,
                    borderRadius: '999px',
                    fontWeight: 700,
                  }}
                />
              </Stack>

              {!selectedTableQrOrders.length && (
                <Typography sx={{ mt: 1.5, color: ORDER_PANEL_COLORS.muted, fontSize: 14 }}>
                  No hay pedidos QR pendientes para esta mesa.
                </Typography>
              )}

              {!!selectedTableQrOrders.length && (
                <Stack sx={{ mt: 1.5 }} spacing={1.25}>
                  {selectedTableQrOrders.filter((order) => order.status === 'APPROVED').length > 1 && (
                    <MuiButton
                      disabled={isConfirming}
                      onClick={sendApprovedQrOrdersMerged}
                      size="small"
                      sx={{
                        alignSelf: 'flex-start',
                        bgcolor: ORDER_PANEL_COLORS.info,
                        borderRadius: '12px',
                        px: 2,
                        '&:hover': { bgcolor: '#3048c2' },
                      }}
                      variant="contained"
                    >
                      Enviar juntas
                    </MuiButton>
                  )}
                  {selectedTableQrOrders.map((order) => (
                    <Paper
                      elevation={0}
                      key={order.id}
                      sx={{
                        borderRadius: '18px',
                        border: `1px solid ${ORDER_PANEL_COLORS.line}`,
                        background: '#fff',
                        p: 1.5,
                      }}
                    >
                      <Stack alignItems={{ xs: 'flex-start', md: 'center' }} direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.25}>
                        <Box>
                          <Typography sx={{ color: ORDER_PANEL_COLORS.ink, fontSize: 15, fontWeight: 700 }}>
                            Pedido {order.id.slice(0, 8)}{order.guestNumber ? ` · Persona ${order.guestNumber}` : ''}
                          </Typography>
                          <Typography sx={{ mt: 0.35, color: ORDER_PANEL_COLORS.muted, fontSize: 13 }}>
                            Estado: {orderStatusLabel(order.status)} - Items: {order.items?.length || 0}
                          </Typography>
                          <Typography sx={{ color: ORDER_PANEL_COLORS.muted, fontSize: 13 }}>
                            Total: {formatMoney(order.totals?.total || 0)}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          {order.status === 'PENDING_WAITER_APPROVAL' && (
                            <MuiButton
                              disabled={isConfirming}
                              onClick={() => approveQrOrder(order)}
                              size="small"
                              sx={{
                                bgcolor: ORDER_PANEL_COLORS.primary,
                                borderRadius: '12px',
                                px: 2,
                                '&:hover': { bgcolor: '#7f0d24' },
                              }}
                              variant="contained"
                            >
                              Aprobar
                            </MuiButton>
                          )}
                          {order.status === 'APPROVED' && (
                            <MuiButton
                              disabled={isConfirming}
                              onClick={() => sendQrOrderToKitchen(order)}
                              size="small"
                              sx={{
                                bgcolor: ORDER_PANEL_COLORS.success,
                                borderRadius: '12px',
                                px: 2,
                                '&:hover': { bgcolor: '#267245' },
                              }}
                              variant="contained"
                            >
                              Enviar a cocina
                            </MuiButton>
                          )}
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>

            {persons.map((person, index) => {
              const personNumber = index + 1
              const extraCount =
                (person.extraEntryEnabled ? person.extraEntryIds.filter(Boolean).length : 0) +
                (person.beverageEnabled ? person.beverageIds.filter(Boolean).length : 0)
              const subtotal = personSubtotals[index] || 0

              return (
                <Paper
                  elevation={0}
                  key={person.id}
                  ref={(node) => {
                    if (node) personCardRefs.current[person.id] = node
                    else delete personCardRefs.current[person.id]
                  }}
                  sx={{
                    borderRadius: '24px',
                    overflow: 'hidden',
                    border: `1px solid ${ORDER_PANEL_COLORS.line}`,
                    background: '#fff',
                  }}
                >
                  <Box
                    sx={{
                      px: { xs: 1.5, sm: 2 },
                      py: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      background: ORDER_PANEL_COLORS.soft,
                      borderBottom: `1px solid ${ORDER_PANEL_COLORS.line}`,
                    }}
                  >
                    <Stack alignItems="center" direction="row" spacing={1.25}>
                      <Box
                        sx={{
                          width: 42,
                          height: 42,
                          borderRadius: '14px',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: ORDER_PANEL_COLORS.successSoft,
                          color: ORDER_PANEL_COLORS.success,
                          fontWeight: 800,
                          fontSize: 15,
                        }}
                      >
                        P{personNumber}
                      </Box>
                      <Box>
                        <Typography sx={{ color: ORDER_PANEL_COLORS.ink, fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>
                          Persona {personNumber}
                        </Typography>
                        <Typography sx={{ mt: 0.35, color: ORDER_PANEL_COLORS.muted, fontSize: 13 }}>
                          {extraCount > 0 ? `${extraCount} extra(s) anadidos` : 'Sin extras'}
                        </Typography>
                      </Box>
                    </Stack>

                    <Chip
                      label={formatMoney(subtotal)}
                      size="small"
                      sx={{
                        bgcolor: ORDER_PANEL_COLORS.primarySoft,
                        color: ORDER_PANEL_COLORS.primary,
                        borderRadius: '999px',
                        fontWeight: 800,
                      }}
                    />
                  </Box>

                  <div className="person-body person-body-modern">
                    <div className="form-grid-2 person-main-grid person-main-grid-modern">
                      <TextField
                        fullWidth
                        label="Plato principal"
                        onChange={(event) => updatePerson(index, { mainId: event.target.value })}
                        select
                        size="small"
                        value={person.mainId}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: '14px',
                            bgcolor: '#fffaf2',
                          },
                        }}
                      >
                        <MenuItem value="">-- Seleccionar plato --</MenuItem>
                        {mainOptions.map((option) => (
                          <MenuItem key={option.id} value={option.id}>
                            {option.name} - {formatMoney(option.price)}
                          </MenuItem>
                        ))}
                      </TextField>

                      <TextField
                        fullWidth
                        label="Entrada incluida"
                        onChange={(event) => updatePerson(index, { entryId: event.target.value })}
                        select
                        size="small"
                        value={person.entryId}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: '14px',
                            bgcolor: '#fffaf2',
                          },
                        }}
                      >
                        <MenuItem value="">-- Seleccionar entrada --</MenuItem>
                        {entryOptions.map((option) => (
                          <MenuItem key={option.id} value={option.id}>
                            {option.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </div>

                    <TextField
                      fullWidth
                      label="Detalle"
                      onChange={(event) => updatePerson(index, { kitchenNote: event.target.value })}
                      placeholder="Ej: con menestra o sin ensalada"
                      size="small"
                      value={person.kitchenNote}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          borderRadius: '14px',
                          bgcolor: '#fff',
                        },
                      }}
                    />

                    <div className="person-extra-trigger-row">
                      <MuiButton
                        className={person.showExtras ? 'active' : ''}
                        onClick={() => updatePerson(index, { showExtras: !person.showExtras })}
                        size="small"
                        sx={{
                          borderRadius: '999px',
                          px: 2,
                          py: 1,
                          borderColor: person.showExtras ? ORDER_PANEL_COLORS.primary : ORDER_PANEL_COLORS.lineStrong,
                          color: person.showExtras ? ORDER_PANEL_COLORS.primary : ORDER_PANEL_COLORS.ink,
                          bgcolor: person.showExtras ? ORDER_PANEL_COLORS.primarySoft : '#fff',
                        }}
                        type="button"
                        variant="outlined"
                      >
                                {person.showExtras ? 'Cerrar extras' : 'Anadir extra'}
                        {extraCount > 0 && <span className="extra-count-badge">{extraCount}</span>}
                      </MuiButton>
                    </div>

                    {person.showExtras && (
                      <div className="extra-chooser">
                        <div className="chooser-title">Que desea agregar?</div>

                        <div className="chooser-options chooser-options-modern">
                          <FormControlLabel
                            control={(
                              <Switch
                                checked={person.extraEntryEnabled}
                                onChange={(event) => toggleExtraType(index, 'entry', event.target.checked)}
                              />
                            )}
                            label="Entrada extra"
                            sx={{
                              m: 0,
                              px: 1.25,
                              py: 0.5,
                              borderRadius: '14px',
                              border: `1px solid ${person.extraEntryEnabled ? ORDER_PANEL_COLORS.primary : ORDER_PANEL_COLORS.line}`,
                              bgcolor: person.extraEntryEnabled ? ORDER_PANEL_COLORS.primarySoft : '#fff',
                            }}
                          />

                          <FormControlLabel
                            control={(
                              <Switch
                                checked={person.beverageEnabled}
                                onChange={(event) => toggleExtraType(index, 'beverage', event.target.checked)}
                              />
                            )}
                            label="Bebida"
                            sx={{
                              m: 0,
                              px: 1.25,
                              py: 0.5,
                              borderRadius: '14px',
                              border: `1px solid ${person.beverageEnabled ? ORDER_PANEL_COLORS.info : ORDER_PANEL_COLORS.line}`,
                              bgcolor: person.beverageEnabled ? ORDER_PANEL_COLORS.infoSoft : '#fff',
                            }}
                          />
                        </div>

                        {person.extraEntryEnabled && (
                          <div className="chooser-list cl-en">
                            <p className="chooser-list-title">Entradas extra</p>

                            {(person.extraEntryIds.length ? person.extraEntryIds : ['']).map((value, rowIndex) => (
                              <div className="extra-item" key={`entry-extra-${person.id}-${rowIndex}`}>
                                <TextField
                                  fullWidth
                                  onChange={(event) => updateExtraRow(index, 'entry', rowIndex, event.target.value)}
                                  select
                                  size="small"
                                  value={value}
                                  sx={{
                                    '& .MuiOutlinedInput-root': {
                                      borderRadius: '14px',
                                      bgcolor: '#fff',
                                    },
                                  }}
                                >
                                  <MenuItem value="">Seleccionar entrada</MenuItem>
                                  {entryOptions.map((option) => (
                                    <MenuItem key={option.id} value={option.id}>
                                      {option.name} - {formatMoney(option.price)}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                <MuiButton
                                  color="inherit"
                                  onClick={() => removeExtraRow(index, 'entry', rowIndex)}
                                  size="small"
                                  sx={{
                                    minWidth: 'auto',
                                    px: 1.25,
                                    borderRadius: '12px',
                                    color: ORDER_PANEL_COLORS.primary,
                                  }}
                                  type="button"
                                >
                                  Quitar
                                </MuiButton>
                              </div>
                            ))}

                            <MuiButton className="btn-add-more add-more-en" onClick={() => addExtraRow(index, 'entry')} size="small" sx={{ mt: 0.25 }} type="button">
                              + Agregar otra entrada
                            </MuiButton>
                          </div>
                        )}

                        {person.beverageEnabled && (
                          <div className="chooser-list cl-beb">
                            <p className="chooser-list-title">Bebidas</p>

                            {(person.beverageIds.length ? person.beverageIds : ['']).map((value, rowIndex) => (
                              <div className="extra-item" key={`bev-extra-${person.id}-${rowIndex}`}>
                                <TextField
                                  fullWidth
                                  onChange={(event) => updateExtraRow(index, 'beverage', rowIndex, event.target.value)}
                                  select
                                  size="small"
                                  value={value}
                                  sx={{
                                    '& .MuiOutlinedInput-root': {
                                      borderRadius: '14px',
                                      bgcolor: '#fff',
                                    },
                                  }}
                                >
                                  <MenuItem value="">Seleccionar bebida</MenuItem>
                                  {beverageOptions.map((option) => (
                                    <MenuItem key={option.id} value={option.id}>
                                      {option.name} - {formatMoney(option.price)}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                <MuiButton
                                  color="inherit"
                                  onClick={() => removeExtraRow(index, 'beverage', rowIndex)}
                                  size="small"
                                  sx={{
                                    minWidth: 'auto',
                                    px: 1.25,
                                    borderRadius: '12px',
                                    color: ORDER_PANEL_COLORS.info,
                                  }}
                                  type="button"
                                >
                                  Quitar
                                </MuiButton>
                              </div>
                            ))}

                            <MuiButton className="btn-add-more add-more-beb" onClick={() => addExtraRow(index, 'beverage')} size="small" sx={{ mt: 0.25 }} type="button">
                              + Agregar otra bebida
                            </MuiButton>
                          </div>
                        )}
                      </div>
                    )}

                    <Stack direction="row" flexWrap="wrap" gap={0.85}>
                      {person.mainId && (
                        <Chip label={mainMap.get(person.mainId)?.name} size="small" sx={{ bgcolor: ORDER_PANEL_COLORS.successSoft, color: ORDER_PANEL_COLORS.success, fontWeight: 700 }} />
                      )}
                      {person.entryId && (
                        <Chip label={entryMap.get(person.entryId)?.name} size="small" sx={{ bgcolor: ORDER_PANEL_COLORS.accentSoft, color: ORDER_PANEL_COLORS.accent, fontWeight: 700 }} />
                      )}
                      {person.extraEntryEnabled &&
                        person.extraEntryIds.map((id, pos) => (
                          id ? <Chip key={`entry-chip-${person.id}-${pos}`} label={entryMap.get(id)?.name} size="small" sx={{ bgcolor: ORDER_PANEL_COLORS.primarySoft, color: ORDER_PANEL_COLORS.primary, fontWeight: 700 }} /> : null
                        ))}
                      {person.beverageEnabled &&
                        person.beverageIds.map((id, pos) => (
                          id ? <Chip key={`bev-chip-${person.id}-${pos}`} label={beverageMap.get(id)?.name} size="small" sx={{ bgcolor: ORDER_PANEL_COLORS.infoSoft, color: ORDER_PANEL_COLORS.info, fontWeight: 700 }} /> : null
                        ))}
                    </Stack>

                    <div className="person-subtotal-row">
                      <span>Subtotal estimado:</span>
                      <strong>{formatMoney(subtotal)}</strong>
                    </div>
                  </div>
                </Paper>
              )
            })}

            <MuiButton
              onClick={addPerson}
              sx={{
                alignSelf: 'stretch',
                minHeight: 50,
                borderRadius: '16px',
                bgcolor: ORDER_PANEL_COLORS.primary,
                color: '#fff',
                fontSize: 15,
                fontWeight: 700,
                '&:hover': { bgcolor: '#7f0d24' },
              }}
              type="button"
              variant="contained"
            >
              + Anadir persona a la mesa
            </MuiButton>

            <Paper
              component="section"
              elevation={0}
              sx={{
                borderRadius: '24px',
                border: `1px solid ${ORDER_PANEL_COLORS.line}`,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderBottom: `1px solid ${ORDER_PANEL_COLORS.line}`,
                  bgcolor: ORDER_PANEL_COLORS.soft,
                }}
              >
                <Typography sx={{ color: ORDER_PANEL_COLORS.ink, fontSize: 18, fontWeight: 700 }}>
                  Resumen del pedido
                </Typography>
              </Box>

              <Stack divider={<Divider flexItem sx={{ borderColor: ORDER_PANEL_COLORS.line }} />} spacing={0} sx={{ px: 2, py: 1.25 }}>
                {persons.map((person, index) => (
                  <Stack alignItems="center" direction="row" justifyContent="space-between" key={`summary-${person.id}`} sx={{ py: 0.9 }}>
                    <Typography sx={{ color: ORDER_PANEL_COLORS.muted, fontSize: 14, fontWeight: 600 }}>
                      Persona {index + 1}
                    </Typography>
                    <Typography sx={{ color: ORDER_PANEL_COLORS.ink, fontSize: 15, fontWeight: 700 }}>
                      {formatMoney(personSubtotals[index] || 0)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  px: 2,
                  py: 1.5,
                  bgcolor: ORDER_PANEL_COLORS.primarySoft,
                  borderTop: `1px solid ${ORDER_PANEL_COLORS.line}`,
                }}
              >
                <Typography sx={{ color: ORDER_PANEL_COLORS.primary, fontSize: 16, fontWeight: 800 }}>
                  Total
                </Typography>
                <Typography sx={{ color: ORDER_PANEL_COLORS.primary, fontSize: 24, fontWeight: 800 }}>
                  {formatMoney(totalAmount)}
                </Typography>
              </Box>

              <Box sx={{ p: 1.5 }}>
                <MuiButton
                  disabled={isConfirming}
                  fullWidth
                  onClick={confirmOrder}
                  sx={{
                    minHeight: 52,
                    borderRadius: '16px',
                    bgcolor: ORDER_PANEL_COLORS.success,
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 800,
                    '&:hover': { bgcolor: '#267245' },
                  }}
                  type="button"
                  variant="contained"
                >
                  {isConfirming ? 'Confirmando...' : 'Confirmar pedido'}
                </MuiButton>
              </Box>
            </Paper>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
