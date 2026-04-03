import { PrismaClient } from '@prisma/client'

const backend = String(process.env.DATA_BACKEND || 'memory').trim().toLowerCase()
const STATE_ROW_ID = 'main'

let prisma = null
let enabled = false

export function getDataBackend() {
  return backend
}

export function isStatePersistenceEnabled() {
  return enabled
}

export async function initStatePersistence() {
  if (backend !== 'prisma') return false
  if (enabled) return true

  prisma = new PrismaClient()
  await prisma.$connect()
  enabled = true
  return true
}

export async function loadStateSnapshot() {
  if (!enabled || !prisma) return null
  const row = await prisma.runtimeState.findUnique({ where: { id: STATE_ROW_ID } })
  return row?.payload ?? null
}

export async function saveStateSnapshot(payload) {
  if (!enabled || !prisma) return

  await prisma.runtimeState.upsert({
    where: { id: STATE_ROW_ID },
    update: { payload },
    create: {
      id: STATE_ROW_ID,
      payload,
    },
  })
}

export async function closeStatePersistence() {
  if (!prisma) return
  await prisma.$disconnect()
  prisma = null
  enabled = false
}
