# Turnazo — Guía para Claude

## Qué es el proyecto

Plataforma de reservas de canchas deportivas en Mendoza, Argentina.
Los usuarios finales reservan turnos desde la web pública sin registrarse.
Los dueños de complejos gestionan sus canchas, horarios, precios y agenda desde un panel privado.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 15 App Router (TypeScript) |
| Base de datos + Auth | Supabase (PostgreSQL + RLS + Auth) |
| ORM / cliente | `@supabase/ssr` (server components + actions) |
| Estilos | Tailwind CSS |
| Tests unitarios / integración | Vitest |
| Tests E2E | Playwright (Chromium headless) |
| Deploy | Vercel |

## Proyecto Supabase

**Project ID:** `mysomysshywixbaamuyw`
**URL:** `https://mysomysshywixbaamuyw.supabase.co`

La clave `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` están en `.env.local` (no versionado).

## Comandos

```bash
# Desarrollo (puerto 3001 para no colisionar con Playwright)
pnpm dev --port 3001

# Tests unitarios + integración (carga .env.local automáticamente)
pnpm test

# Tests E2E (requiere dev server corriendo en :3001)
pnpm test:e2e

# E2E con UI interactivo
pnpm test:e2e:ui

# Build de producción
pnpm build
```

## Estructura de directorios clave

```
src/
  app/
    (public)/           # Rutas públicas sin auth: home, localidad, deporte, venue, reservar, turnos
    login/              # Página de login
    registro/           # Registro de dueños
    panel/              # Panel privado de dueños (middleware protege /panel/*)
      agenda/           # Redirige al primer complejo del dueño
      complejos/        # Lista de complejos
      complejos/nuevo/  # Crear complejo
      complejos/[id]/   # Editar complejo
      complejos/[id]/canchas/
      complejos/[id]/canchas/nuevo/
      complejos/[id]/canchas/[cid]/
      complejos/[id]/agenda/  # Vista diaria de la agenda
    actions/
      booking.ts        # Server actions: create_booking (RPC), cancel_booking
      panel.ts          # Server actions del panel (CRUD + 10 acciones de agenda)
      auth.ts           # Login / logout
  lib/
    supabase/
      server.ts         # createClient() para server components y actions
      queries.ts        # Queries públicas (venues, courts, disponibilidad)
      panel-queries.ts  # Queries del panel (owner-scoped)
      types.ts          # Tipos generados de Supabase
    slots.ts            # Lógica de grilla de slots, todayInMendoza()
    phone.ts            # normalizeArgentinePhone(), buildWhatsAppUrl()
  components/
    panel/
      agenda-grid.tsx   # Grid diaria de la agenda (client component)
      court-hours-editor.tsx
      court-prices-editor.tsx
      venue-form.tsx
      court-form.tsx
    venue-pin-map.tsx   # Mapa Leaflet con marker draggable
    venue-pin-map-wrapper.tsx  # dynamic() SSR:false wrapper
  middleware.ts         # Protege /panel/* → redirige a /login si no autenticado

supabase/migrations/    # 001 a 013, aplicadas en Supabase Cloud
tests/
  unit/                 # Vitest: phone.test.ts, slots.test.ts
  integration/          # Vitest: public.test.ts, booking.test.ts, auth.test.ts, owner.test.ts
  concurrency/          # Vitest: double-booking.test.ts
  e2e/                  # Playwright: public.spec.ts, panel.spec.ts, agenda.spec.ts, audit.spec.ts
    helpers.ts          # Fixtures, helpers de API, createTestBooking, deleteTestBookings
```

## Convenciones

### Server actions
- Siempre `"use server"` al inicio del archivo.
- Las acciones del panel usan `createClient()` del SSR, verifican `auth.getUser()` antes de cualquier operación.
- Cada acción que modifica datos escribe una fila en `audit_log` con `profile_id`, `venue_id`, `entity`, `entity_id`, `action`, `new_data`. Si falla el insert de auditoría, la acción retorna el error (nunca silenciosa).
- El patrón de retorno es `PanelActionState = { error?, fieldErrors? } | null`.

### Base de datos
- Hora local: Mendoza (UTC-3, sin DST). Usar siempre `AT TIME ZONE 'America/Argentina/Mendoza'` en SQL o `+3h` al convertir a UTC en TypeScript.
- Los bookings usan columna `period` (tipo `tstzrange`) y `kind` (`booking` | `block`).
- Validación de slots: `(startMin - openMin) % slotMinutes === 0` donde los minutos son desde medianoche en hora local.
- Cruce de medianoche: si `close_time <= open_time`, entonces `closeMin += 24*60`.

### RLS
- `bookings_owner_all`: el dueño tiene ALL sobre bookings de su venue (incluye DELETE).
- `blocked_phones_owner_all`: ídem para blocked_phones.
- `audit_log_owner_insert`: el dueño puede insertar en audit_log para su venue.
- El anon solo puede llamar al RPC `create_booking` y `cancel_booking`.

### Teléfonos argentinos
- Normalización: strip no-dígitos → quitar prefijo 549/54 → quitar 0 inicial → quitar 15 móvil → prefijar "549".
- Tests en `tests/unit/phone.test.ts`.

### Tests E2E
- **Fixtures de prueba:** `VENUE_ID = b2c3d4e5-0000-0000-0000-000000000001`, `COURT_ID = c3d4e5f6-0000-0000-0000-000000000001`, dueño: `dueno@turnazo.test` / `TurnazoPrueba1!`.
- **Limpieza:** cada `afterAll` borra lo que creó usando `deleteTestBookings(request, [pattern])`. El conteo de filas en `bookings` debe ser idéntico antes y después de correr el set completo dos veces seguidas.
- **Slots de test:** `nextWeekday(3, 7)` = miércoles 7+ días (agenda), `nextWeekday(4, 21)` = jueves 21+ días (audit). Siempre alineados con la grilla de 90 min desde 08:00.

## Regla de trabajo

> **Fase por fase, con tests, sin dar nada por probado si no se cargó en un navegador real.**

- Antes de cerrar una fase: `pnpm test` (Vitest, 65 tests) + `pnpm test:e2e` (Playwright, 28 tests) deben pasar todos.
- No avanzar a la siguiente fase hasta tener verde en ambos.
- No crear helpers, abstracciones ni features que no pida la spec.
- Los cambios de esquema van en migraciones numeradas (`014_...sql`) aplicadas via Supabase MCP antes de escribir código que las usa.
