# TAKI POS v1

Implementación funcional v1 para restaurante universitario con:

- POS post-servicio
- Gestión de salones, mesas y comensales activos
- Comandas y flujo de cocina Kanban
- Carta digital QR con aprobación obligatoria del mesero y flujo físico incremental de impresión
- Caja diaria (apertura/cierre) con efectivo + transferencias
- Boleta simplificada interna
- KPIs diarios/mensuales y top platos
- Inventario básico manual
- Realtime por Socket.IO
- Esquema Prisma para MySQL

## Stack

- Frontend: React + React Router + React Query + Zustand + Tailwind + PWA
- Backend: Node + Express + Socket.IO + Zod
- Data model: Prisma (`prisma/schema.prisma`) listo para MySQL
- Runtime: `memory` (demo) o `prisma` (snapshot persistente de estado)

## Estructura real

- Frontend desplegable: `frontend/`
- Backend API: `api/src/server.js`
- El frontend en produccion requiere `VITE_API_URL` apuntando al backend publicado

## Requisitos

- Node.js 20+
- npm 10+

## Variables de entorno

Copiar `.env.example` a `.env` si vas a trabajar con Prisma/MySQL:

```bash
DATABASE_URL="mysql://root:root@localhost:3306/taki_pos"
API_PORT=4000
DATA_BACKEND=prisma
ALLOWED_ORIGINS=http://localhost:5173
QR_PUBLIC_BASE_URL=http://localhost:5173
QR_RATE_LIMIT_WINDOW_MS=60000
QR_RATE_LIMIT_MAX=40
```

## Arranque

```bash
cd frontend
npm install
npm run dev
```

Servicios:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

También puedes correr por separado:

```bash
cd frontend
npm run api:dev
npm run web:dev
```

## Deploy

- Vercel debe construirse desde `frontend/`
- Define `VITE_API_URL` en Vercel con la URL publica de Render
- Render debe usar `DATA_BACKEND=prisma`, `DATABASE_URL` valida y `ALLOWED_ORIGINS` con el dominio Vercel y el dominio custom

## Usuarios demo

Contraseña para todos: `123456`

- `superadmin`
- `admin`
- `cocinero`
- `mesero`

## Rutas de frontend

- `/login`
- `/pos`
- `/kitchen`
- `/cash`
- `/kpis`
- `/inventory`
- `/table-management` (solo admin/superadmin)
- `/qr/t1?token=...` (el token QR ahora es obligatorio)

## Endpoints principales

- `POST /auth/login`
- `GET /catalog/menus?date=YYYY-MM-DD`
- `GET /catalog/public/menus?date=YYYY-MM-DD`
- `GET /salons`
- `POST /salons`
- `PATCH /salons/:id`
- `GET /tables`
- `GET /tables/admin`
- `POST /tables`
- `POST /tables/bulk`
- `PATCH /tables/:id`
- `GET /tables/qr/pending`
- `POST /tables/qr/generate-pending`
- `POST /tables/qr/mark-printed`
- `POST /tables/:tableId/session`
- `PATCH /tables/:tableId/session/guests`
- `POST /orders`
- `POST /orders/qr`
- `POST /orders/:id/items`
- `POST /orders/qr/:id/items`
- `PATCH /orders/:id/approve`
- `PATCH /orders/:id/send-kitchen`
- `PATCH /kitchen/tickets/:id/status`
- `POST /orders/:id/payments`
- `GET /cash/current`
- `POST /cash/open`
- `POST /cash/close`
- `GET /kpis/daily`
- `GET /kpis/monthly`
- `GET /kpis/top-dishes`
- `GET /inventory`
- `PATCH /inventory/:productId`

## Notas de implementación

- El envío de cocina crea ticket y cola de impresión automática.
- Si la impresora falla (simulación con `PRINTER_FORCE_FAIL=true`), se reintenta y registra incidente.
- Los pedidos QR nacen como `PENDING_WAITER_APPROVAL` y no pueden ir a cocina sin aprobación.
- El recargo para llevar se aplica en `S/1` por cada ítem de menú marcado como `TAKEAWAY`.
- CORS es por lista blanca (`ALLOWED_ORIGINS`) y QR tiene rate limit configurable.
- Los endpoints QR requieren header `X-QR-Token` o query `?token=`.
- El token QR es persistente por mesa y se gestiona desde el módulo admin (`/table-management`).
- Flujo de estado QR por mesa: `PENDING -> GENERATED -> PRINTED`.

## Prisma

Generar cliente:

```bash
npm run prisma:generate
```

Migraciones (si conectas MySQL):

```bash
npm run prisma:migrate
```

Modo runtime con persistencia Prisma:

```bash
npm run api:dev
```

Modo demo en memoria (opcional):

```bash
DATA_BACKEND=memory npm run api:dev
```
