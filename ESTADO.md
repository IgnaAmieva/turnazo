# Estado del proyecto — Turnazo

Última actualización: 2026-11-12

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

### Fase 4 — Panel de dueños (Bloques 1, 3 y 2)

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

**Próxima migración:** `014_...sql`

---

## Tests actuales

| Suite | Herramienta | Tests | Estado |
|-------|------------|-------|--------|
| Unitarios | Vitest | 65 | ✓ verde |
| E2E | Playwright | 28 | ✓ verde |

Archivos E2E:
- `public.spec.ts` — flujo público (booking + cancelación)
- `panel.spec.ts` — CRUD panel + audit_log de court_hours
- `agenda.spec.ts` — agenda day view, bloques manuales
- `audit.spec.ts` — 5 tests de audit_log (cancel, mark_paid, mark_no_show, block_phone, create_block)

---

## Pendiente / deuda conocida

- El campo `whatsapp_template` existe en el modelo pero no hay UI para editarlo desde el panel (el dueño no puede cargarlo aún).
- No hay página para desbloquear teléfonos desde el panel.
- No hay vista de historial de `audit_log` desde el panel.
- El registro de dueños crea el perfil pero no hay flujo de aprobación de venues desde un panel de superadmin.
- No hay notificaciones (email/WhatsApp) automáticas al cliente al confirmar o cancelar.

---

## Próximo paso — Fase 5

La Fase 5 no está definida aún. Opciones lógicas (a priorizar con el usuario):

**A) Panel de superadmin** — aprobar/rechazar venues, ver todas las reservas, gestionar dueños.

**B) Notificaciones** — email o WhatsApp automático al confirmar/cancelar (requiere Resend, Twilio o similar).

**C) Seña / pago parcial** — `deposit_required = true` en venues, flujo de seña con Mercado Pago.

**D) Mejoras de agenda** — vista semanal, exportar a calendario, reservas recurrentes.

**E) UI faltante en panel** — editor de `whatsapp_template`, lista de teléfonos bloqueados, historial de audit_log.

> Antes de empezar Fase 5: confirmar con el usuario qué bloque es el próximo y definir la spec completa antes de escribir código.
