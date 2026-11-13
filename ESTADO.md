# Estado del proyecto — Turnazo

Última actualización: 2026-11-13

---

## Fases terminadas

### Fase 1 — Base del proyecto
- Esquema completo (localities, sports, venues, courts, court_hours, court_prices, bookings, profiles, audit_log, blocked_phones).
- RLS baseline, seed de datos de prueba (Tunuyán/pádel, Complejo Padelero Tunuyán, 2 canchas).
- Migraciones 001–003 aplicadas.

### Fase 2 — Parte pública
- Home → localidad → deporte → venue (calendar de disponibilidad).
- Routing: `/(public)/[locality]/[sport]/[venue]/` con Server Components.
- Lógica de slots (`src/lib/slots.ts`): grilla de 90 min, `todayInMendoza()`.
- Migraciones 004–005 (security hardening, revoke public execute).

### Fase 3 — Reserva sin seña y cancelación por link
- RPC `create_booking` (v1 → v2 → v3): validación completa (slot, horario, duración, exclusión GIST, límite de turnos, teléfono bloqueado).
- RPC `cancel_booking`: verifica cancel_token, actualiza status.
- Página `/turnos/[token]`: muestra el turno y permite cancelar.
- Migraciones 006–008 aplicadas.

### Fase 4 — Panel de dueños (Bloques 1, 3 y 2 + deuda)

**Bloque 1 — Auth:**
- Login/logout (`src/app/actions/auth.ts`).
- Registro de dueños (`src/app/registro/`).
- Middleware: protege `/panel/*`, redirige a `/login` si no autenticado.
- Trigger `handle_new_user()` crea perfil en `profiles` al registrarse.
- Migraciones 009–011 aplicadas.

**Bloque 3 — CRUD de complejos y canchas:**
- Pages: `/panel/complejos/`, `/nuevo/`, `/[id]/`, `/[id]/canchas/`, `/[id]/canchas/nuevo/`, `/[id]/canchas/[cid]/`.
- Formularios: VenueForm (con mapa Leaflet), CourtForm, CourtHoursEditor, CourtPricesEditor.
- Server actions: `createVenueAction`, `updateVenueAction`, `createCourtAction`, `updateCourtAction`, `saveCourtHoursAction`, `saveCourtPricesAction` — cada una con audit_log.
- Horarios precargados por deporte: pádel 08:00–00:30, fútbol 14:00–00:00, tenis 08:00–23:00.
- Migración 012 aplicada (revoke handle_new_user, drop open_before_close).

**Bloque 2 — Agenda:**
- Vista diaria `/panel/complejos/[id]/agenda?fecha=YYYY-MM-DD`.
- Grid columnas = canchas, filas = tiempo. Rango calculado dinámicamente desde `court_hours` del día (maneja cruce de medianoche).
- Acciones: cancelar turno, marcar pagado, marcar ausente, bloquear teléfono, crear bloqueo manual.
- WhatsApp deep-link con template `{nombre}`, `{cancha}`, `{dia}`, `{hora}`, `{total}` desde `venues.whatsapp_template`.
- Filtro por deporte (solo si hay más de uno). Cancelados/ausentes en gris. Badge de estado de pago.
- Todas las acciones escriben en `audit_log` (10 acciones cubiertas en total).
- Migración 013 aplicada (audit_log INSERT policy para owners).

**Deuda de Fase 4 — cerrada:**
- Editor de WhatsApp template en la página de edición del complejo, con vista previa live de las variables (`{nombre}`, `{cancha}`, `{dia}`, `{hora}`, `{total}`). `whatsapp_template` se persiste en `venues` via `updateVenueAction` y `createVenueAction`.
- Página `/panel/complejos/[id]/bloqueados`: lista de teléfonos bloqueados con botón "Desbloquear" por fila. `unblockPhoneAction` elimina de `blocked_phones` y escribe en `audit_log` (action: `delete`, entity: `blocked_phone`).
- Link rápido "Teléfonos bloqueados" en la página de edición del complejo.
- `blockPhonePanelAction` ya escribía en `audit_log` (action: `create`, entity: `blocked_phone`) — confirmado por test `audit.spec.ts:159`.

---

## Migraciones aplicadas (en orden)

| # | Archivo | Descripción |
|---|---------|-------------|
| 001 | `001_schema.sql` | Esquema completo: todas las tablas, índices, constraints |
| 002 | `002_rls.sql` | RLS baseline para todas las tablas |
| 003 | `003_seed.sql` | Seed: localities, sports, venue de prueba, 2 canchas, dueño de prueba |
| 004 | `004_security_hardening.sql` | Hardening post-advisor (search_path, permisos) |
| 005 | `005_revoke_public_execute.sql` | Revoke EXECUTE en funciones internas a PUBLIC |
| 006 | `006_booking_functions.sql` | RPC `create_booking` v1, `cancel_booking`, `get_court_availability` |
| 007 | `007_create_booking_v2.sql` | `create_booking` v2: 5 correcciones (dow, slot alignment, etc.) |
| 008 | `008_create_booking_v3.sql` | `create_booking` v3: cruce de medianoche, `auth_role()` para RLS |
| 009 | `009_owner_trigger.sql` | Trigger `handle_new_user()` → crea perfil en `profiles` |
| 010 | `010_drop_profiles_insert_self.sql` | Drop policy `profiles_insert_self`, add `audit_log_owner_read` |
| 011 | `011_fix_auth_role_permissions.sql` | GRANT EXECUTE en `auth_role()` a anon + authenticated |
| 012 | `012_security_and_hours.sql` | Revoke handle_new_user a PUBLIC; drop constraint `open_before_close` |
| 013 | `013_audit_log_owner_insert.sql` | Policy `audit_log_owner_insert`: owners pueden INSERT en audit_log para su venue |
| 014 | `014_push_subscriptions.sql` | Tabla `push_subscriptions` + `notification_outbox` + cron `push_send_cron` |
| 015 | `015_push_hardening.sql` | REVOKE en push_send_cron, pg_net → extensions schema, Vault URL/secret, create_booking v5 (sin cancel_token en outbox payload) |
| 016 | `016_outbox_discard.sql` | Status `discarded` en notification_outbox; policy `notif_outbox_owner_delete` (solo para cleanup de tests) |

**Próxima migración:** `017_phase6_mp.sql` (borrador guardado, aún no aplicada)

---

## Tests actuales

| Suite | Herramienta | Tests | Estado |
|-------|------------|-------|--------|
| Unitarios | Vitest | 65 | ✓ verde |
| E2E | Playwright | 40 | ✓ verde |

Archivos E2E:
- `public.spec.ts` — flujo público (booking + cancelación)
- `panel.spec.ts` — CRUD panel + audit_log de court_hours
- `agenda.spec.ts` — agenda day view, bloques manuales
- `audit.spec.ts` — 5 tests de audit_log (cancel, mark_paid, mark_no_show, block_phone, create_block)
- `settings.spec.ts` — 5 tests de WhatsApp template editor y teléfonos bloqueados
- `push.spec.ts` — 6 tests: 2 de auth guard (401), subscribe button, guía iPhone PWA

---

## Fase 5 — Push al dueño + PWA instalable ✓

Definida en SPEC §9 y §14.

**Completado:**
- `notification_outbox` table + RLS (service role reads/updates, owner delete via migration 016).
- `push_subscriptions` table + RLS.
- Service worker `/public/sw.js`, Web App Manifest `/public/manifest.json`.
- `PushSubscribeButton` component en panel nav (usa `navigator.permissions.query` para compatibilidad con Playwright).
- `PwaInstallGuide` — banner para iOS Safari no-standalone (dismissible vía localStorage).
- `ServiceWorkerRegistrar` — registra `/sw.js` al montar el panel layout.
- Route handler `/api/push/send` + `src/lib/push.ts`: lógica de reintentos, descarte de rows >24h u orphan booking_id.
- `markPaidAction` inserta en `notification_outbox` (tipo `payment_received`) y dispara send.
- `create_booking` RPC v4→v5 inserta `booking_created` en outbox; `cancel_booking` inserta `booking_cancelled`.
- Playwright: `workers: 1`, `storageState` global (login 1 sola vez vía `setup/auth.setup.ts`).
- Cleanup E2E: `deleteTestOutboxRows` en afterAll de todos los spec files.
- Stale/orphan row discard antes de enviar.

**Deuda para Fase 8:**
- `notif_outbox_owner_delete` policy (migration 016) existe **solo para limpieza de tests E2E**. En producción la limpieza de outbox debe hacerse con service role key (desde la propia route handler o un cron), no con el token del owner. Reemplazar antes de lanzar.

---

## Fase 5: Push + PWA — CERRADA (ver arriba)

---

## Fase 6 — Mercado Pago (EN CURSO)

Definida en SPEC §7 y §14. Ver plan detallado en `docs/FASE6-PLAN.md`.

**Estado:** planificación completada, sin código escrito todavía.

**App de Mercado Pago:** creada (Checkout Pro, API de Orders, ambiente de prueba/sandbox).

**Migración 017:** borrador guardado en `supabase/migrations/017_phase6_mp.sql`.
⚠️ **NO APLICADA** — tiene correcciones pendientes antes de poder aplicarse.

**Variables de entorno pendientes de agregar (Vercel + .env.local):**

| Variable | Descripción |
|---|---|
| `MP_CLIENT_ID` | ID de la app MP |
| `MP_CLIENT_SECRET` | Secret de la app MP |
| `MP_REDIRECT_URI` | URL de callback OAuth |
| `MP_WEBHOOK_SECRET` | Secret para firmas HMAC de webhooks |
| `MP_TOKEN_ENCRYPTION_KEY` | 32 bytes hex — clave AES-256-GCM |
| `PLATFORM_FEE_PERCENT` | Porcentaje de comisión (ej. `0.05`) |

**Bloques del plan:**
1. OAuth por dueño (AES-256-GCM, HMAC state, disconnect check, column REVOKE) — ⬜ pendiente
2. UI configuración de cobro (ya en schema) — ⬜ pendiente
3. Flujo de pago jugador (create_booking_hold, initiatePayment) — ⬜ pendiente
4. Expiración de holds (pg_cron, expire_stale_holds, inline filter) — ⬜ pendiente
5. Webhook (firma, idempotencia, 4 casos, outbox) — ⬜ pendiente
6. Cancelaciones y reembolsos — ⬜ pendiente
7. Tests (sandbox, mocks, E2E redirect) — ⬜ pendiente

---

## Deploy en Vercel (pre-Fase 6)

### Región
- Supabase project: `sa-east-1` (São Paulo) — detectado por CF-RAY `-EZE`.
- Vercel functions: configurar región `gru1` (São Paulo) en `vercel.json` para minimizar latencia DB.

### Variables de entorno en Vercel

| Variable | Entornos |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production + Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Production (server only) |
| `NEXT_PUBLIC_APP_URL` | Production (URL final del deploy) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Production + Preview |
| `VAPID_PUBLIC_KEY` | Production (server only) |
| `VAPID_PRIVATE_KEY` | Production (server only) |
| `VAPID_SUBJECT` | Production (server only) |
| `PUSH_SEND_SECRET` | Production (debe coincidir con Vault `push_secret`) |
| `PLATFORM_FEE_PERCENT` | Production |

### Supabase Auth — URL Configuration
Agregar (no reemplazar) en Dashboard → Authentication → URL Configuration:
- Site URL: `https://<dominio-final>`
- Redirect URLs: `https://<dominio-final>/**`

### Vault — cron push (después del primer deploy)
```sql
SELECT vault.create_secret('https://<dominio-final>/api/push/send', 'push_send_url');
SELECT vault.create_secret('<mismo-valor-que-PUSH_SEND_SECRET>', 'push_secret');
```

### ⛔ Bloqueantes antes del primer dueño real

1. **Base compartida con tests** — el proyecto Supabase actual tiene datos de prueba
   (complejo, canchas, usuario `dueno@turnazo.test`, reservas de E2E). No es apta para
   producción real. Antes de onboardear el primer dueño: crear un segundo proyecto
   Supabase limpio para tests y dejar el actual solo para producción (sin seed ni fixtures).

2. **No correr E2E contra la URL publicada** — los tests crean y cancelan bookings reales,
   borran outbox rows y bloquean teléfonos. Solo correr `pnpm test:e2e` contra
   `localhost:3001`.
