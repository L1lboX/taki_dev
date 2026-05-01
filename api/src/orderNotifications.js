import { db } from './store.js'

function buildOrderItems(order) {
  return (order.items || []).map((item) => ({
    id: item.id,
    productName: item.productName,
    quantity: item.quantity,
    guestNumber: item.guestNumber ?? order.guestNumber ?? null,
    notes: item.notes || '',
  }))
}

export function buildQrOrderNotificationPayload(order) {
  if (!order) return null

  const table = db.getTableById(order.tableId)
  const salon = table ? db.getSalonById(table.salonId) : null

  return {
    orderId: order.id,
    tableId: order.tableId,
    tableNumber: table?.number ?? null,
    guestNumber: order.guestNumber ?? null,
    salonId: salon?.id ?? null,
    salonName: salon?.name ?? '',
    status: order.status,
    items: buildOrderItems(order),
  }
}

export function buildKitchenReadyNotificationPayload(order) {
  if (!order) return null

  const table = db.getTableById(order.tableId)
  const salon = table ? db.getSalonById(table.salonId) : null

  return {
    orderId: order.id,
    ticketId: order.kitchenTicketId || null,
    tableId: order.tableId,
    tableNumber: table?.number ?? null,
    guestNumber: order.guestNumber ?? null,
    salonId: salon?.id ?? null,
    salonName: salon?.name ?? '',
    status: order.status,
    items: buildOrderItems(order),
  }
}
