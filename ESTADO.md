# Estado del proyecto — Turnazo

Última actualización: 2026-11-19 (Fase 7 S1: código desplegado, 021 pendiente de aplicar)

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
| 017 | `017_phase6_mp.sql` | Fase 6 MP: mp_accounts, payments (currency), webhook_events, bookings (mp_order_id, hold_expires_at, deposit_amount), get_court_availability v2, expire_stale_holds + pg_cron, _validate_booking_slot, create_booking v4, create_booking_hold |

| 018 | `018_payment_rules.sql` | Aplicada por el revisor (2026-11-15). `create_booking` devuelve `pay_at_venue_not_allowed` si `allow_pay_at_venue = false`; trigger `trg_venues_payment_rules` (BEFORE INSERT OR UPDATE OF columnas de cobro) que hace cumplir las reglas de cobro en la base; chequeo de que los complejos existentes cumplen |

| 019 | `019_confirm_order_payment.sql` | Aplicada por el revisor (2026-11-15). Función `confirm_order_payment(p_booking_id, p_mp_order_id, p_mp_payment_id, p_amount, p_raw)` SECURITY DEFINER, `search_path = ''`, EXECUTE solo para `service_role`. Los 9 tests "migración 019" pasaron sin tocarlos (8 de entrada; el 9.º, "si el reembolso falla…", codificaba el bug del arreglo 1 del Bloque 4 y pasó al aplicar ese arreglo) |
| 020 | `020_cancellation_refunds.sql` | Aplicada por el revisor (2026-11-16); secreto `refund_retry_url` creado en Vault apuntando a `https://turnazo-chi.vercel.app/api/mp/refund-retry`. Los 5 tests "migración 020" y los 2 E2E salteados pasaron sin tocarlos. `cancel_booking_by_token` v3 (cancelación con devolución según `cancel_limit_hours` / `refund_policy`, marca el pago `refund_pending`, outbox con `refund_due`), `get_booking_by_token` v2 (`refund_policy`, `refund_available`, `refund_status`), `refund_retry_cron()` + cron `turnazo-refund-retry` cada 30 min (lee `refund_retry_url` y `push_secret` de Vault). Probada con rollback (ver Bloque 5). Al aplicarla deben pasar a verde los 5 tests marcados "migración 020" en `tests/integration/cancellation.test.ts` y dejan de saltearse los 2 E2E de `cancellation.spec.ts` |

| 021 | `021_security_lockdown.sql` | **Aprobada por el revisor, pendiente de aplicar (2026-11-19).** Fase 7 S1: grants mínimos para anon/authenticated columna por columna (se revoca todo, incluidos TRUNCATE/TRIGGER/REFERENCES, y los privilegios por defecto); FK compuesta `bookings(court_id, venue_id) → courts(id, venue_id)` (C1); el dueño ya no escribe en `bookings`: RPCs `panel_create_block`, `panel_cancel_booking` (pago online → `refund_pending` en la misma transacción), `panel_mark_paid` (no si se pagó todo online; con seña, amount_paid = price_total), `panel_mark_no_show` (con pago online solo después de empezado el turno) (M2); trigger `trg_venues_status`: solo superadmin/servidor cambia `venues.status` (A1); `create_booking` / `create_booking_hold` solo `service_role` (C2/A2); `_validate_booking_slot` rechaza turnos a más de 30 días (`too_far_ahead`). Se aplica **después** del deploy del código de S1 (el código viejo llama a `create_booking` con anon). Validada en PGlite reconstruyendo 001–020 con stubs de Supabase: 64/64 consultas de la app y ataques |

**Próxima migración:** `022_*.sql`

**Vault (ya configurado con la 020):** `refund_retry_url` = `https://turnazo-chi.vercel.app/api/mp/refund-retry`; `push_secret` es el mismo `PUSH_SEND_SECRET` de Vercel. Si cambia el dominio hay que actualizar `refund_retry_url` y `push_send_url`.
(`push_secret` ya existe; es el mismo `PUSH_SEND_SECRET` de Vercel.)

---

## Tests actuales

| Suite | Herramienta | Tests | Estado |
|-------|------------|-------|--------|
| Unitarios + integración | Vitest | 207 | ✓ verde (2026-11-18, con 018–020 aplicadas) |
| E2E | Playwright | 65 (incluye el setup de login) | ✓ verde (2026-11-18) |

Ojo: la base es compartida con complejos reales creados desde el panel (`padelmates`, `futmates` en Tunuyán). `public.spec.ts` ya no asume "2 complejos" en la home ni un único "1 complejo" en `/tunuyan`: lee el conteo dentro del link de Tunuyán / de Pádel.

Archivos E2E:
- `public.spec.ts` — flujo público (booking + cancelación)
- `panel.spec.ts` — CRUD panel + audit_log de court_hours
- `agenda.spec.ts` — agenda day view, bloques manuales
- `audit.spec.ts` — 5 tests de audit_log (cancel, mark_paid, mark_no_show, block_phone, create_block)
- `settings.spec.ts` — 5 tests de WhatsApp template editor y teléfonos bloqueados
- `push.spec.ts` — 6 tests: 2 de auth guard (401), subscribe button, guía iPhone PWA
- `payment-settings.spec.ts` — 10 tests de configuración de cobro, sin MP y con una cuenta MP falsa (lee `SUPABASE_SERVICE_ROLE_KEY` de `.env.local` para crearla y borrarla); incluye la pantalla pública de reserva en modo "solo pago online" (ahora: ofrece solo "Pagar el total online")
- `cancellation.spec.ts` — 5 tests (Bloque 5): panel "Cancelaciones" (guarda plazo + política, persiste al recargar, rechaza fuera de rango), panel agenda: cancelar una reserva con pago online muestra "Se le devolverán $X al jugador", pide confirmar, cancela y deja la devolución en proceso (`refund_failed`, sin token de MP en local), y jugador con pago online (devolución total dentro del plazo → avisa el monto, cancela, devolución "en proceso"; política `none` → aviso, checkbox obligatorio, cancela sin devolver). Los 2 del jugador se saltean si la 020 no está aplicada. La limpieza busca las reservas `E2E Cancel*` por nombre (no por ids en memoria: si un test falla, Playwright reinicia el worker y vuelve a correr `beforeAll`), borra primero `payments` y `audit_log`, después reservas y outbox; restaura la política original.
- `payment-flow.spec.ts` — 8 tests del pago del jugador (Bloques 3 y 4): opciones según configuración, "pagar en el lugar" sigue usando `create_booking`, pago online con cuenta MP falsa → error claro y hold liberado, pantalla `/pago/[token]` (pendiente con cuenta regresiva → confirmada al cambiar la base; botón "Cancelar y elegir otro horario" → hold `expired` y vuelve a `/reservar` del mismo horario; vencida; cancelada; token inexistente). Nunca llama a Mercado Pago. Limpia bookings `E2E Pago*`, la cuenta MP falsa y restaura el cobro original.

Fase 7 S1 (seguridad):
- `tests/integration/security-s1.test.ts` — 18 tests: cada ataque del informe S1 (C1, C2, A1, A2, M2) intentado con la anon key, con un dueño ajeno y con service_role; todos tienen que fallar. Requieren la 021. Fixture propio (dos dueños, dos complejos); `afterAll` borra por dueño, así también limpia lo que un ataque llegue a crear.
- La contraseña del dueño de prueba ya no está en el repo: `E2E_OWNER_PASSWORD` en `.env.local` (rotada el 2026-11-19; la vieja quedó en el historial de git y ya no sirve). Los E2E preparan y limpian datos con `SUPABASE_SERVICE_ROLE_KEY` (helpers `serviceHeaders()`): desde la 021 el dueño no escribe `bookings` / `notification_outbox` ni lee `audit_log`.
- El selector de fechas público no avanza más de 30 días (hoy + 29), coherente con `too_far_ahead`.

Archivos Vitest nuevos (Bloques 3 y 4):
- `tests/unit/mp-orders.test.ts` — 14 tests del cliente de Orders con `fetch` simulado: `createMpOrder` (cuerpo exacto con `payer.email` / `first_name` / `last_name` e `items[].description` / `category_id`, headers, sin `marketplace_fee`, errores), `getMpOrder` / `isMpOrderPaid` / `mpOrderPaymentId`, `refundMpOrder` (409 `order_already_refunded` = éxito), `cancelMpOrder`.
- `tests/unit/mp-signature.test.ts` — 11 tests de la firma `x-signature`: manifiesto (minúsculas, partes ausentes), HMAC, firma válida, otra clave, manipulada, header ausente/malformado, ts viejo/futuro, sin `x-request-id`.
- `tests/integration/payment-flow.test.ts` — 16 tests de `startPaymentAction` (incluye: sin email válido no se crea ni el hold ni la orden), `getPaymentStatusAction` y `cancelHoldAction` contra la base real con `getMpToken`, `createMpOrder`, `cancelMpOrder` y `redirect` simulados (fixture propio, se borra en `afterAll`).
- `tests/integration/cancellation.test.ts` — 17 tests (Bloque 5): `cancelBookingAction` sin pago (igual que siempre), con pago online (`full` dentro del plazo → devuelve, idempotente; reembolso que falla → cancela igual, `refund_failed`, y `/api/mp/refund-retry` lo completa; `none` → sin devolución; fuera del plazo → sin devolución; turno empezado → no; pagado a mano → nada que devolver), `get_booking_by_token` v2, `cancelBookingPanelAction` del dueño (devuelve todo aunque la política sea `none` y esté fuera del plazo; reembolso que falla → `refund_failed` y el cron lo completa; sin pago online → como siempre; otro dueño → no autorizado), y `updateCancellationPolicyAction` (guarda + audit, valida, rechaza otro dueño y anon). 5 marcados "migración 020". Para probar el cron no se puede "envejecer" la fila de `payments` (el trigger `trg_payments_updated_at` pisa `updated_at` en cada UPDATE): el test adelanta 3 min el reloj de `Date` con `vi.useFakeTimers({ toFake: ["Date"] })`.
- `tests/integration/webhook.test.ts` — 20 tests de `POST /api/mp/webhook` y `reconcilePaymentAction` contra la base real con `getMpToken`, `getMpOrder`, `refundMpOrder` y `triggerPushSend` simulados (fixture propio; borra `payments`, `webhook_events`, `audit_log`, bookings y venue en `afterAll`). 11 pasan sin la migración (firma inválida/ausente/vieja/manipulada → 401 y nada más; monto, moneda o `external_reference` distintos → `mismatch` sin tocar nada; orden no pagada; body que miente; orden desconocida; `type` ≠ order; sin token / MP caído → 500). **9 marcados "migración 019"** (orden pagada → confirmada + `payments` + outbox + push; pago total → `paid`; evento repetido; misma orden con otro evento → `already_confirmed`; pago tarde con horario libre → confirma; pago tarde con horario tomado → reembolso; reserva cancelada → reembolso; reembolso fallido → 500 y reintento; reconciliación desde `/pago`).

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
- **Límite de holds por IP.** Hoy `create_booking_hold` limita a 1 hold activo por teléfono y complejo, pero el teléfono lo escribe el jugador: alguien con teléfonos inventados puede bloquear todos los turnos de un complejo durante 10 minutos cada vez. Falta un límite por IP (y/o por sesión) en la acción de pago o en la base.

---

## Fase 5: Push + PWA — CERRADA (ver arriba)

---

## Fase 6 — Mercado Pago — CERRADA (2026-11-18)

Definida en SPEC §7 y §14. Ver plan detallado en `docs/FASE6-PLAN.md`.

**Estado:** Bloques 1 a 6 terminados; migraciones 018, 019 y 020 aplicadas y verificadas; Vault configurado; desplegado en Vercel.

**Cómo se probó (con plata real, 2026-11-18):** complejo `futmates` conectado por OAuth a una cuenta real de MP.
1. Seña de $100 pagada con dinero en cuenta (orden `ORD01M7R2S6NDBQ5NRBKAT6YHZ0FE`) → reserva confirmada por reconciliación, pago registrado en `payments`, aviso al dueño enviado.
2. El dueño canceló la reserva desde la agenda → devolución de $100 hecha en MP, pago en `refunded`, aviso enviado.

**Qué aprendimos:**
- **El `ts` de `x-signature` viene en segundos**, no en milisegundos (ejemplo oficial `ts=1704908010`). Leerlo como ms hacía que todos los avisos se rechazaran con `stale_timestamp`.
- **El sandbox con una app real + usuarios de prueba no cobra.** El checkout rechaza sin crear ningún pago ("No pudimos procesar tu pago"). Tampoco sirve pedir credenciales de prueba por OAuth con `test_token: true`: MP responde "Test credentials are not supported, use test users with production credentials". Se probó con un `MP_OAUTH_TEST_MODE` que mandaba ese parámetro; se sacó el 2026-11-18 porque no servía. La prueba que valió fue con plata real y montos chicos.
- **`payer.email` es obligatorio** en las órdenes de Checkout Pro según la referencia de Orders; por eso el formulario pide "Tu email" cuando el pago es online.
- **Loguear el resultado de la reconciliación** (sin tokens): sin esa línea no había forma de saber si el polling de `/pago` corrió.

**Pendientes para lanzar:**
- [ ] Nombre y dominio definitivos
- [ ] Separar la base de pruebas de la de producción
- [ ] Vercel Pro
- [ ] Cobro de la suscripción mensual a los dueños ($50.000, 2 meses gratis)
- [ ] Panel de superadmin para aprobar complejos
- [ ] Términos y condiciones y política de privacidad
- [ ] Seguridad: límite de reservas por IP, Sentry, protección de contraseñas filtradas

**App de Mercado Pago:** creada (Checkout Pro, API de Orders, ambiente de prueba/sandbox).

**Migración 017:** aplicada en Supabase. No modificar — cambios futuros van en 018+.

**Variables de entorno necesarias (Vercel + .env.local):**

| Variable | Descripción |
|---|---|
| `MP_CLIENT_ID` | ID de la app MP |
| `MP_CLIENT_SECRET` | Secret de la app MP |
| `MP_STATE_SECRET` | Secret para firmar HMAC del state OAuth |
| `MP_REDIRECT_URI` | URL de callback OAuth (`/api/mp/oauth/callback`) |
| `MP_WEBHOOK_SECRET` | Secret para verificar firma HMAC de webhooks |
| `MP_TOKEN_ENCRYPTION_KEY` | 32 bytes hex — clave AES-256-GCM |
| `PLATFORM_FEE_PERCENT` | Ya no se usa: el modelo es cuota mensual, 0 % por reserva (no se manda `marketplace_fee`) |
| `NEXT_PUBLIC_APP_URL` | Base de las URLs de vuelta de Mercado Pago (`/pago/[token]`). Obligatoria para pagar online |

**Bloques del plan:**
1. OAuth por dueño (AES-256-GCM, HMAC state, disconnect check, column REVOKE) — ✅ completado
2. UI configuración de cobro (ya en schema) — ✅ aprobado
3. Flujo de pago jugador (create_booking_hold, startPaymentAction, /pago/[token]) — ✅ aprobado (con 3 arreglos aplicados, ver abajo)
4. Webhook (firma, idempotencia, confirmación, reembolso si no se puede confirmar, outbox, reconciliación desde /pago) — ✅ aprobado (con 2 arreglos aplicados, ver abajo)
5. Cancelaciones con devolución (política de cancelación, cron de reintentos, cancelación del dueño con devolución total) — ✅ implementado, 020 aplicada
6. Prueba real (webhook configurado en el panel de MP, `payer.email`, `expiration_time`, una devolución real) — ✅ hecha con plata real el 2026-11-18: pago, confirmación, cancelación del dueño y devolución

**Bloque 1 — OAuth (completado 2026-11-14):**
- Callback route: `/api/mp/oauth/callback`
- `src/lib/mp/crypto.ts` — AES-256-GCM encrypt/decrypt con `MP_TOKEN_ENCRYPTION_KEY`
- `src/lib/mp/state.ts` — HMAC-SHA256 state con `MP_STATE_SECRET` (TTL 5 min)
- `src/lib/mp/token.ts` — `getMpToken(venueId)` con auto-refresh si expira en <1h
- `src/app/api/mp/oauth/connect/route.ts` — genera state, redirige a MP auth
- `src/app/api/mp/oauth/callback/route.ts` — verifica state, intercambia code, cifra tokens, upsert mp_accounts (service role)
- `src/app/actions/mp.ts` — `disconnectMpAction` (verifica no haya pagos activos, borra mp_accounts, revoca token best-effort)
- `src/components/panel/mp-connect-section.tsx` — UI conectar/desconectar en página de edición del complejo
- `src/lib/supabase/panel-queries.ts` — `getMpConnectionStatus(venueId)`
- Tipos regenerados desde Supabase (columnas `access_token_enc`, `refresh_token_enc`, `mp_email`, nuevos enums)

**Arreglos post-revisión del Bloque 1 (2026-11-14):**
- `disconnectMpAction`: bloquea solo si hay una reserva confirmada y pagada cuyo período todavía no terminó (antes: heurística de 30 días por `created_at`).
- `disconnectMpAction`: primero resetea el cobro en `venues` (con chequeo de error) y recién después borra `mp_accounts`.
- `getMpToken`: si falla el guardado del token refrescado, loguea y devuelve `null`.

**Bloque 2 — Configuración de cobro (2026-11-14, pendiente de revisión):**
- `src/app/actions/panel.ts` — `updatePaymentSettingsAction`: seña fija o porcentaje, pago total, pago en el lugar. Escribe `audit_log` (`action: update_payment_settings`).
- `src/components/panel/payment-settings-section.tsx` — sección "Cobro de reservas" en la página de edición del complejo.
- Reglas validadas en el servidor: seña y pago total exigen Mercado Pago conectado; seña obligatoria fuerza `allow_pay_at_venue = false`; porcentaje entre 1 y 100; seña fija mayor a 0; tiene que quedar al menos una forma de pago activa.
- Sin migración. Fuera de este bloque: política de cancelación (`cancel_limit_hours`, `refund_policy`).

**Migración 018 — reglas de cobro en la base (escrita 2026-11-15, NO aplicada):**
- `create_booking`: con `allow_pay_at_venue = false` devuelve `pay_at_venue_not_allowed` sin crear nada (check después de `deposit_required`, antes del INSERT). Todo lo demás igual que 017.
- Trigger `trg_venues_payment_rules` → `enforce_venue_payment_rules()` (SECURITY DEFINER, `search_path = ''`, sin EXECUTE para anon/authenticated). `BEFORE INSERT OR UPDATE OF deposit_required, deposit_type, deposit_value, allow_full_payment, allow_pay_at_venue`; además salta si ninguna de esas columnas cambió. Reglas: seña/pago total exigen fila en `mp_accounts` (`mp_not_connected`); seña obligatoria fuerza `allow_pay_at_venue = false`; `percent` entre 1 y 100 (`deposit_percent_out_of_range`); `fixed` > 0 (`deposit_fixed_not_positive`); seña sin tipo (`deposit_type_required`); al menos una forma de pago (`no_payment_method`). Errores con ERRCODE `check_violation`, MESSAGE = código, DETAIL en español.
- `DO` final que falla si algún complejo existente no cumple (los 2 actuales cumplen).
- Probada el 2026-11-15 en una sola sentencia `DO` que termina en `RAISE EXCEPTION` (rollback total): 14 casos OK, verificado después que no quedó nada escrito.
- Código ya adaptado: `booking.ts` mapea `pay_at_venue_not_allowed` → "Este complejo solo acepta reservas pagando online."; `reservar/page.tsx` muestra ese aviso en lugar del formulario cuando `allow_pay_at_venue = false`; `mp.test.ts` crea la cuenta MP antes de activar seña en el fixture.
- Al aplicarla deben pasar a verde los 5 tests marcados "migración 018". → Aplicada el 2026-11-15: los 5 pasaron sin tocarlos.

**Bloque 3 — Pago del jugador (2026-11-15, pendiente de revisión):**

Verificación previa en la documentación oficial de Mercado Pago (API de Orders, Checkout Pro con redirección):
- `POST https://api.mercadopago.com/v1/orders` con `type: "online"` y `processing_mode: "manual"` (únicos valores para Checkout Pro) devuelve `201` con `id` y `checkout_url`; el jugador se redirige a `checkout_url`. **Orders sí soporta la redirección.**
- El token del vendedor (OAuth) va en `Authorization: Bearer`. `X-Idempotency-Key` es obligatorio.
- `expiration_time` es una duración ISO 8601 desde la creación (ej. `PT10M`). La guía de migración a Orders documenta mínimo 30 s; se manda `PT10M` para que venza junto con el hold.
- `marketplace_fee` es opcional: no se manda (0 % por reserva).
- **No existe `notification_url` por orden en Orders.** El webhook se configura en el panel de la app de MP: Integraciones → Webhooks → URL `https://<dominio>/api/mp/webhook`, tema "Order (Mercado Pago)". Hay que hacerlo antes de probar el Bloque 4 en sandbox.
- `config.online.{success_url,failure_url,pending_url,auto_return}` para las URLs de vuelta; `config.payment_method.not_allowed_types: ["ticket"]` para excluir Rapipago/Pago Fácil (no acreditan en 10 minutos).
- `payer.email`: la referencia actual (`/reference/online-payments/checkout-pro/create-order/post`, leída el 2026-11-16) lo marca **"Required for all Checkout Pro orders"**. Sin él la orden se crea igual (201) pero el checkout rechaza el pago ("No pudimos procesar tu pago"): fue lo que pasó en el primer intento en sandbox. Desde el 2026-11-16 se pide el email en el formulario cuando el pago es online y se manda como `payer.email` (ver Bloque 6).

Código:
- `src/lib/mp/orders.ts` — `createMpOrder()`: arma y envía la orden; devuelve `{ ok, orderId, checkoutUrl }` o `{ ok: false, status, code, message }`. Sin dependencia del SDK.
- `src/lib/booking-messages.ts` — mensajes en español de todos los códigos de `create_booking` / `create_booking_hold` y de la acción de pago (`hold_limit_reached`, `slot_taken`, `mp_not_connected`, `full_payment_not_allowed`, `deposit_not_configured`, `mp_token_unavailable`, `mp_order_failed`). `booking.ts` ahora importa de acá.
- `src/lib/payment-status.ts` — `getPaymentStatus(token)`: estado real de la reserva por `cancel_token` (service role, solo en servidor, solo devuelve estado): `confirmada` / `pendiente` (+ `expiresAt`, `amount`) / `vencida` (hold vencido aunque el cron no lo haya marcado, o `expired`) / `cancelada` / `no_encontrada`.
- `src/app/actions/payment.ts` — `startPaymentAction`: valida con zod → `create_booking_hold` (anon; el monto es `amount_to_pay` de la base, el form no puede mandarlo) → `getMpToken(venue)` → `createMpOrder` con `external_reference = booking_id`, `X-Idempotency-Key = booking_id`, `expiration_time = PT10M`, URL de vuelta `${NEXT_PUBLIC_APP_URL}/pago/${cancel_token}` → guarda `mp_order_id` (solo si sigue en hold) → `redirect(checkout_url)`. Si falla el token, la orden o el guardado del `mp_order_id`: el hold pasa a `expired` (libera el horario) y se muestra el mensaje correspondiente. Idempotencia: el doble toque lo corta la base (`hold_limit_reached` / `slot_taken`) antes de llegar a MP; el botón se deshabilita mientras envía. `getPaymentStatusAction(token)` para el polling.
- `reservar/page.tsx` + `booking-form.tsx` — radios "Pagar la seña online" / "Pagar el total online" / "Pagar en el lugar" según `deposit_required` / `allow_full_payment` / `allow_pay_at_venue` (montos orientativos calculados en la página; el real lo calcula la base). "En el lugar" sigue usando `create_booking`; las otras, `startPaymentAction`. Botón "Ir a pagar con Mercado Pago" / "Confirmar reserva". Desaparecieron los avisos "disponible próximamente". `getVenueWithCourts` ahora trae `deposit_type` y `deposit_value`.
- `src/app/(public)/pago/[token]/` — pantalla de vuelta. Ignora los parámetros de MP en la URL; lee el estado de la base al cargar y, mientras está pendiente, reconcilia con MP cada 15 s (ver Bloque 4). Pendiente: "Estamos confirmando tu pago" + cuenta regresiva (mm:ss hasta `hold_expires_at`) + monto + botón "Cancelar y elegir otro horario". Confirmada: link a `/turnos/[token]`. Vencida: "Se venció el tiempo para pagar" (si pagó, se le devuelve: lo hace el webhook).
- Sin migración. No se escribe en `payments` (exige `mp_payment_id`, que recién existe cuando MP procesa el pago: lo inserta `confirm_order_payment`).

**Arreglos post-revisión del Bloque 3 (2026-11-15):**
1. `/pago/[token]` pendiente: botón "Cancelar y elegir otro horario" → `cancelHoldAction(token)`: pasa el hold a `expired` solo si sigue en `hold` y el `cancel_token` coincide, cancela la orden en MP best-effort (`POST /v1/orders/{id}/cancel`; si ya se pagó, el webhook la reembolsa) y redirige a `/{localidad}/{deporte}/{venue}/reservar?cancha=&inicio=&fin=&fecha=` del mismo horario. Así el jugador que se arrepiente en MP no queda 10 minutos bloqueado por `hold_limit_reached`. Token inexistente → `/`. Reserva que no está en hold → no toca nada, solo redirige.
2. `payment.ts`: ante una respuesta inválida de `create_booking_hold` ya no se loguea `res` completo (traía `cancel_token`); se loguea solo `booking_id` y qué campo faltó.
3. Deuda anotada en Fase 8: límite de holds por IP (ver arriba).

Pendiente:
- Probar en sandbox real: `payer.email`, `expiration_time: PT10M`, `not_allowed_types: ["ticket"]`. En `.env.local` no hay variables `MP_*`, así que localmente todo corre con mocks.
- La agenda del panel no muestra holds (fuera de este bloque).

**Bloque 4 — Confirmación del pago por webhook (2026-11-15, pendiente de revisión):**

Verificación previa en la documentación oficial de Mercado Pago (Orders, notificaciones):
- **Firma del webhook:** header `x-signature: ts=<ms>,v1=<hex>`, header `x-request-id`, query `data.id` y `type`. Manifiesto `id:[data.id];request-id:[x-request-id];ts:[ts];` (data.id en minúsculas si es alfanumérico; las partes ausentes se omiten), HMAC-SHA256 con la clave secreta de la app (`MP_WEBHOOK_SECRET`) en hex, comparado con `v1`. MP recomienda tolerancia sobre `ts`. Hay que responder 200/201 en < 22 s; si no, reintenta cada 15 min.
- **Estado de la orden (`GET /v1/orders/{id}`):** pagada y acreditada = `status: "processed"` + `status_detail: "accredited"`. Otros: `created`, `processing`/`in_process`, `action_required`, `failed/*`, `canceled`, `refunded`, `processed/partially_refunded`. Trae `external_reference`, `total_amount`, `total_paid_amount`, `currency`, `transactions.payments[] { id, amount, paid_amount, status, status_detail }`.
- **Reembolso:** `POST /v1/orders/{id}/refund` con `X-Idempotency-Key`, body vacío = total; 201 `refunded`; 409 `order_already_refunded` / `idempotency_key_already_used` (se tratan como éxito) / `cannot_refund_order`.
- **Cancelar orden:** `POST /v1/orders/{id}/cancel` (solo `created` / `action_required`); 409 `order_already_canceled` / `cannot_cancel_order`.
- **El webhook se configura en el panel de la app de MP** (Integraciones → Webhooks → URL `https://<dominio>/api/mp/webhook`, tema "Order (Mercado Pago)"); la clave secreta que muestra ahí es `MP_WEBHOOK_SECRET`. Sin esto no llega ninguna notificación.

Migración 019 (`confirm_order_payment`, **NO aplicada**):
- En una sola transacción, con `SELECT ... FOR UPDATE` sobre la reserva: ya confirmada con ese pago → `{ ok, already_processed: true }`; `hold` o `expired` → `confirmed`, `payment_status` `paid` si `deposit_amount >= price_total` o `deposit_paid` si no, `amount_paid`, fila en `payments` (`approved`, `platform_fee` 0, `type` deposit/full), fila en `notification_outbox` `payment_received` (`online: true`); `exclusion_violation` → `slot_taken` sin tocar nada; `cancelled` → `booking_cancelled`; confirmada con otro pago → `already_paid`; pago ya en `payments` → `payment_already_recorded`; `order_mismatch`; `amount_mismatch`. EXECUTE solo `service_role`.
- Probada el 2026-11-15 en una sola sentencia `DO` que la crea, recorre 11 escenarios (los de arriba + permisos anon/authenticated/service_role) y termina en `RAISE EXCEPTION 'ROLLBACK_OK 1:ok … 11:ok'`. Verificado después que la función no existe en la base.
- `types.ts`: `confirm_order_payment` agregado a mano en `Functions` (regenerar tipos después de aplicar).

Código:
- `src/lib/mp/webhook-signature.ts` — `verifyMpSignature({ xSignature, xRequestId, dataId, secret })`: parsea `ts`/`v1`, arma el manifiesto, HMAC-SHA256, `timingSafeEqual` (comparación en tiempo constante), rechaza `|now − ts| > 5 min`. Devuelve `missing_header` / `malformed_header` / `stale_timestamp` / `bad_signature`.
- `src/lib/mp/orders.ts` — además de `createMpOrder`: `getMpOrder`, `isMpOrderPaid`, `mpOrderPaymentId`, `refundMpOrder`, `cancelMpOrder`. Un helper HTTP común que nunca loguea el token ni el body.
- `src/lib/mp/process-order.ts` — `processMpOrder(orderId, 'webhook' | 'reconcile')`, núcleo compartido: busca la reserva por `mp_order_id` → token del dueño de ESE complejo → `GET /v1/orders/{id}` (no se confía en el body del webhook) → si no está `processed/accredited` → `not_paid` → verifica `currency = ARS`, `external_reference = booking_id`, `total_paid_amount = deposit_amount` (si no: `mismatch`, no toca nada, queda logueado para revisar a mano) → `confirm_order_payment` (con la orden sin `client_token` ni `payer` como `raw`) → `confirmed` / `already_confirmed` (+ `triggerPushSend`). Si devuelve `slot_taken` / `booking_cancelled` / `already_paid`: `refundMpOrder` con `X-Idempotency-Key = refund-<payment_id>`, fila en `payments` con status `refunded` (o `refund_failed`) y `raw.reason`, fila en `audit_log` (`entity: payment`, `action: refund` / `refund_failed`, `profile_id` null). Solo loguea ids y códigos.
- `src/app/api/mp/webhook/route.ts` — `POST`: sin `MP_WEBHOOK_SECRET` → 500; firma inválida → **401 y nada más** (no lee la base ni registra el evento); `type ≠ order` → 200 ignorado; idempotencia con `webhook_events (provider 'mercadopago', event_id = body.id ?? x-request-id)`: evento ya `processed`/`refunded` → 200 `duplicate`; si no, lo inserta como `received` (payload mínimo: type, action, order_id, request_id) → `processMpOrder` → actualiza el evento (`processed` / `refunded` / `mismatch` / `ignored` / `failed`) → 200, o **500 si falló de nuestro lado o el reembolso** (para que MP reintente). `runtime = 'nodejs'`.
- `src/app/actions/payment.ts` — `reconcilePaymentAction(token)`: si la reserva del token sigue en `hold` con `mp_order_id`, llama a `processMpOrder(..., 'reconcile')` y devuelve el estado real. `/pago` la usa cada 15 s (no cada 3) mientras está pendiente; al llegar la cuenta regresiva a 00:00 consulta el estado una vez más sin esperar el tick.
- `src/lib/push.ts` — `payment_received` con `online: true` dice "X pagó $N por Mercado Pago" (el caso manual sigue igual).

**Bloque 4 — revisión (2026-11-15): aprobado con 2 arreglos, aplicados:**
1. **Devolución fallida que nunca se reintentaba.** Antes, si el reembolso fallaba quedaba `payments.status = 'refund_failed'` y el siguiente aviso de MP terminaba en `payment_already_recorded` → 200 → MP dejaba de reintentar. Ahora `process-order.ts`, al recibir `payment_already_recorded` con `recorded_status` `refund_failed` o `refund_pending`, vuelve a llamar a `refundMpOrder` con la **misma** clave de idempotencia `refund-<mp_payment_id>`; si sale → `refunded` (200), si vuelve a fallar → `refund_failed` (500, MP reintenta). Además hay un cron (ver Bloque 5) que cada 30 min reintenta los pagos en `refund_failed` / `refund_pending`. La lógica de reembolso quedó en un solo lugar: `src/lib/mp/refunds.ts` (`refundPayment`, `retryPendingRefunds`).
2. **Pago que no coincide (`mismatch`) quedaba olvidado.** Ahora `recordMismatch` inserta en `audit_log` (`entity: payment`, `action: payment_mismatch`, `new_data` con ids, montos y detalle, sin datos del pagador) y una fila `payment_mismatch` en `notification_outbox` → push al dueño: "Recibiste un pago que no coincide con la reserva de <nombre> del <fecha>. Revisalo y devolvelo desde Mercado Pago si corresponde." Sin duplicados: antes de insertar busca un `payment_mismatch` previo para la misma (reserva, orden).

Pendiente:
- Configurar la URL del webhook y copiar la clave secreta al entorno; probar un pago real en sandbox (incluye `payer.email`, `PT10M`, `not_allowed_types`).

---

**Bloque 6 — primer intento en sandbox (2026-11-16):**

Resultado de la prueba: la conexión OAuth funcionó (complejo `futmates`, venue `2d2bbf26-5d46-4f54-97de-3cdd8595ff3e`, vendedor de prueba, token vigente hasta 2027-05), las órdenes se crearon bien (`ORDTST01M7K5KEQECXTY8015WV118HS4` y `ORDTST01M7K5YBP2E1845QD73NHTRM58`, seña $1.000 de $10.000), pero el checkout de MP rechazó el pago con "No pudimos procesar tu pago", incluso con el comprador de prueba pagando con saldo en cuenta. En la base los dos holds quedaron `expired` sin fila en `payments` (nunca hubo pago), y a Vercel no llegó ningún webhook.

Diagnóstico pendiente del lado de MP: hay un script local (no versionado, en el scratchpad de la sesión: `mp-diag.ts`) que con `.env.local` lee el token del vendedor con `getMpToken`, hace `GET /v1/orders/{id}` de las dos órdenes e imprime solo `status`, `status_detail`, `total_amount` y, por pago, `status` / `status_detail` / `payment_method`. No se pudo correr porque `.env.local` no tiene `MP_TOKEN_ENCRYPTION_KEY` (el token está cifrado con la clave de Vercel). Hay que copiar esa variable a `.env.local` y correr `npx tsx --tsconfig tsconfig.json <ruta del script>`.

Causa más probable, según la referencia oficial de Orders / Checkout Pro leída el 2026-11-16: `payer.email` es **"Required for all Checkout Pro orders"**, y no se mandaba (el jugador no se registra y no se le pedía email). Cambios:
- `booking-form.tsx`: campo "Tu email" (`customer_email`, `type=email`, obligatorio) que aparece solo cuando la forma de pago es online ("Mercado Pago te manda ahí el comprobante del pago."). Con "Pagar en el lugar" no se pide nada nuevo.
- `payment.ts`: valida el email con zod (`z.email`, normalizado en minúsculas); sin email válido devuelve `fieldErrors.customer_email` antes de crear el hold.
- `orders.ts`: la orden lleva `payer: { email, first_name, last_name }` (nombre partido en la primera palabra / el resto) e `items[0]` con `description: "Reserva de cancha en Turnazo"` y `category_id: "services"` (opcionales, los usa el antifraude de MP).
- El email **no se guarda en la base** (no hay columna; harían falta una migración 021 `customer_email` en `bookings` y pedirla también al reservar sin pago, si se quiere). Solo viaja del formulario a la orden de MP.
- Para la prueba en sandbox, en "Tu email" conviene poner el email del **comprador de prueba** (`@testuser.com`).

Tres errores chicos de la misma prueba, arreglados:
- a. `/api/mp/oauth/callback`: el intercambio del `code` y el cifrado + guardado están en `try/catch`; cualquier excepción (fetch caído, respuesta incompleta, `MP_TOKEN_ENCRYPTION_KEY` ausente o malformada, falta de service key) redirige con `mp_error=exchange_failed` / `mp_error=save_failed` en lugar de un 500 crudo. Nunca se loguean los tokens.
- b. "Cobro de reservas": después de guardar, el formulario mostraba la seña destildada, "Porcentaje" y el monto vacío aunque lo guardado estuviera bien. Causa: React 19 hace `form.reset()` al terminar una acción pasada por `action=`, y los inputs controlados quedan en el DOM con sus valores por defecto. El form ahora se envía desde `onSubmit` con `startTransition(() => formAction(formData))`, sin reset. Reproducido primero con dos asserts nuevos en `payment-settings.spec.ts` (fallaban) y verificado después (pasan).
- c. `/registro`: el mensaje ya no dice "(Desarrollo: desactivá email confirmation en Supabase Auth settings.)"; queda "Revisá tu email para confirmar la cuenta."

**Bloque 6 — diagnóstico del sandbox (2026-11-17/18):**

Con las `MP_*` ya en `.env.local` corrió el diagnóstico sobre las tres órdenes de `futmates` (`ORDTST01M7MYEKMFA0ECMH8QZJFPW0H7` del 17/11, ya con `payer.email`, y las dos del 16/11): las tres `canceled` / `expired`, $1.000 ARS, **sin ningún pago**. El checkout rechazó antes de crear un intento de pago. El cuerpo de la orden está completo; `payer.email` no era la causa. El vendedor era usuario de prueba, pero la aplicación que creó la orden (`MP_CLIENT_ID`) es de la cuenta real.

Se intentó pedir credenciales de prueba por OAuth (`test_token: true`, detrás de una variable `MP_OAUTH_TEST_MODE`). MP lo rechazó: "Test credentials are not supported, use test users with production credentials". El código se sacó el 2026-11-18 (sin código muerto) y la prueba se hizo con plata real.

**Bloque 6 — primer pago real (2026-11-18):**

Pago real aprobado en MP: orden `ORD01M7R2S6NDBQ5NRBKAT6YHZ0FE`, $100 con dinero en cuenta, operación 190377045688, vendedor real `1056941618` conectado a `futmates`. La reserva `a160a375-…` no se confirmó y quedó `expired` a las 19:50 UTC. Diagnóstico con `mp-diag`: orden `processed` / `accredited`, `total_paid_amount` 100.00, un pago `processed` / `accredited` con `account_money`. `isMpOrderPaid` y las verificaciones de `processMpOrder` (moneda, monto, `external_reference`, id de pago) dan bien contra esa orden.

1. **Webhook:** los seis avisos de MP fueron rechazados con `stale_timestamp`. El `ts` de `x-signature` viene en **segundos** (ejemplo oficial `ts=1704908010`; los avisos reales también), y se comparaba como milisegundos. Ahora `ts < 1e12` se toma como segundos; la tolerancia sigue en 5 minutos y el manifiesto usa el `ts` tal como llega. Tests con el `ts` real en segundos; el test de integración del webhook firma en segundos por defecto.
2. **Reconciliación desde `/pago`:** el polling llama a `reconcilePaymentAction` cada 15 s y eso llama a `processMpOrder`; con la forma exacta de la orden real confirma (test nuevo). En los logs de Vercel no hay ninguna línea de reconciliación entre 19:40 y 19:51, pero tampoco podía haberla: no se logueaba nada cuando salía bien o daba "no pagada". No hay pruebas de que haya corrido después de las 19:40:37 con la reserva en `hold`. Cambios:
   - `reconcilePaymentAction` loguea `[pago] reconcile <booking> <orden> <outcome>` (sin tokens) en cada llamada.
   - También reconcilia con la reserva `expired`: `confirm_order_payment` (019) la confirma si el horario sigue libre, o devuelve la plata si no.
   - Al llegar la cuenta regresiva a cero, la pantalla llama a `reconcilePaymentAction` en lugar de solo leer la base.
3. Después del deploy se corre una vez `processMpOrder("ORD01M7R2S6NDBQ5NRBKAT6YHZ0FE", "reconcile")` para confirmar esa reserva por el camino normal.

---

**Bloque 5 — Cancelación del jugador con devolución (2026-11-15, pendiente de revisión):**

Reglas (se deciden en la base, `cancel_booking_by_token` v3, migración 020):
- Sin pago online (nada en `payments` con status `approved`, o `amount_paid = 0`; incluye "pagado" marcado a mano por el dueño): igual que siempre → solo hasta `cancel_limit_hours` antes, si no `too_late`.
- Con pago online: se puede cancelar hasta que empiece el turno (después `too_late`). Devolución solo si `now <= inicio − cancel_limit_hours` **y** `refund_policy = 'full'`; si no, cancela sin devolver.
- Si corresponde devolver, la función marca el pago `refund_pending` (`raw.reason = 'player_cancelled'`) en la misma transacción y devuelve `{ refund_due, refund_amount, mp_order_id, mp_payment_id, payment_type }`. Así, si el servidor se cae entre la cancelación y el reembolso, el cron lo completa igual.
- La fila `booking_cancelled` del outbox suma `amount_paid`, `refund_due`, `refund_amount` → el push al dueño dice "canceló su turno. Se le devuelven $N por Mercado Pago." / "canceló su turno sin devolución (había pagado $N)." / "canceló su turno".
- `get_booking_by_token` v2 suma `refund_policy`, `refund_available` (hay pago `approved` y `amount_paid > 0`) y `refund_status` (status del último pago).

Migración 020 (`020_cancellation_refunds.sql`, **NO aplicada**): las dos funciones de arriba + `refund_retry_cron()` (SECURITY DEFINER, lee `refund_retry_url` y `push_secret` de Vault, `net.http_post` con header `x-push-secret`) + `cron.schedule('turnazo-refund-retry', '*/30 * * * *')`. Probada el 2026-11-15 en una sola sentencia `DO` con rollback total: crea las funciones, inserta 8 reservas sobre el complejo de prueba (sin pago lejana / cercana, pagada con `full`, pagada con `none`, pagada fuera del plazo, pagada ya empezada, pagada a mano lejana / cercana), recorre 10 escenarios y termina en `RAISE EXCEPTION 'ROLLBACK_OK 1:ok … 10:ok'`. Verificado después: la política del complejo quedó `2/none`, 0 filas de prueba, `refund_retry_cron` no existe, `get_booking_by_token` sigue en v1 y `cron.job` sigue con solo `expire-holds` y `turnazo-push-send`. La parte del cron (Vault + pg_net) no se puede probar con rollback sin tocar `cron.job`; sigue el mismo patrón que `push_send_cron()` (migración 015).

Código:
- `src/lib/mp/refunds.ts` — `refundPayment(admin, { bookingId, venueId, orderId, paymentId, amount, paymentType, reason, source, markBookingRefunded })`: token del dueño → `refundMpOrder` con `X-Idempotency-Key = refund-<mp_payment_id>` → upsert en `payments` (`refunded` / `refund_failed`, `raw.refund_attempts`, `raw.refund_source`) → si salió y `markBookingRefunded`, `bookings.payment_status = 'refunded'` → `audit_log` (`refund` / `refund_failed`, `profile_id` null). `retryPendingRefunds(admin)`: toma hasta 20 pagos en `refund_failed` / `refund_pending` con `updated_at` de hace más de 2 min y los reintenta.
- `src/app/api/mp/refund-retry/route.ts` — `POST` protegido con `x-push-secret = PUSH_SEND_SECRET` (mismo secreto que el push); 401 si no coincide; devuelve `{ attempted, refunded, failed }`. Lo llama el cron `turnazo-refund-retry`.
- `src/app/actions/booking.ts` — `cancelBookingAction`: tras el RPC, si `refund_due`, llama a `refundPayment(..., reason 'player_cancelled', markBookingRefunded)`; devuelve `{ success, refund: 'refunded' | 'pending' | 'none', refundAmount }`. Si el reembolso falla, la reserva queda cancelada igual y el pago en `refund_failed` para el cron.
- `src/app/(public)/turnos/[token]/cancel-form.tsx` — antes de confirmar: con devolución → aviso verde "Si cancelás ahora, te devolvemos $X a tu medio de pago de Mercado Pago." y botón "Cancelar turno y pedir devolución"; sin devolución (política `none` o fuera del plazo) → aviso ámbar "Si cancelás ahora, NO se te devuelve lo que pagaste ($X)." con el motivo, checkbox obligatorio "Entiendo que no hay devolución." y botón "Cancelar turno sin devolución"; sin pago online → igual que antes. Turno pagado ya empezado → "No es posible cancelar: el turno ya empezó."
- `src/app/(public)/turnos/[token]/page.tsx` — muestra "Seña pagada / Pagado / Devuelto" y, en reservas canceladas, "Te devolvimos $X por Mercado Pago." / "La devolución de $X está en proceso." / "Lo que pagaste no se devolvió automáticamente. Consultá con el complejo."
- Panel: `src/components/panel/cancellation-policy-section.tsx` ("Cancelaciones": plazo en horas 0–168 + radio Devolución total / Sin devolución) y `updateCancellationPolicyAction` en `panel.ts` (auth, dueño del complejo, `audit_log` `update_cancellation_policy`). Va en `/panel/complejos/[id]` entre "Cobro" y los datos del complejo.
- `src/lib/push.ts` — textos nuevos de `booking_cancelled` y `payment_mismatch`.

En local no hay token de MP real (`MP_TOKEN_ENCRYPTION_KEY` ausente), así que toda devolución termina en `refund_failed` y la UI muestra "en proceso": es determinista y es lo que verifican los E2E.

**Bloque 5 — revisión (2026-11-16): 020 aplicada; caso extra, la cancelación del dueño:**
- Cuando el dueño cancela desde la agenda una reserva con pago online acreditado, se le devuelve **todo** al jugador, sin importar `cancel_limit_hours` ni `refund_policy` (cancela el complejo). `cancelBookingPanelAction` en `panel.ts`: busca el último pago `approved`, cancela solo si la reserva sigue `confirmed` (dos clicks no disparan dos devoluciones), marca el pago `refund_pending` (`raw.reason = 'owner_cancelled'`) y llama a la misma `refundPayment` idempotente con `markBookingRefunded`. Si falla, la reserva queda cancelada y el pago en `refund_failed` para el cron (`CANCEL_REFUND_REASONS` en `refunds.ts` cubre `player_cancelled` y `owner_cancelled`). `audit_log` `cancel` lleva `new_data { refund: refunded | pending | none, refund_amount }`; el outbox `booking_cancelled` lleva `cancelled_by: 'owner'` y el push dice "Cancelaste el turno de X. Se le devuelven $N por Mercado Pago." (+ "La devolución está en proceso." si falló).
- Agenda (`agenda-grid.tsx`): `AgendaBooking.online_paid` (suma de `payments` `approved`, el dueño los lee por RLS `payments_owner_read`). Si es > 0, "Cancelar turno" abre un aviso "Se le devolverán $X al jugador por Mercado Pago." con "Confirmar cancelación" / "Volver"; si no, cancela directo como siempre.
- Sin migración nueva.

Pendiente para los bloques siguientes:
- Probar en sandbox una devolución real (`POST /v1/orders/{id}/refund`) y el cron con un pago en `refund_failed`.
- Fase 8: límite de reintentos del cron (hoy reintenta para siempre cada 30 min); vista en el panel de los `payment_mismatch` y de los pagos `refund_failed`.

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
| `PUSH_SEND_SECRET` | Production (debe coincidir con Vault `push_secret`; también protege `/api/mp/refund-retry`) |
| `PLATFORM_FEE_PERCENT` | Production |
| `MP_CLIENT_ID` | Production — cargada el 2026-11-16 |
| `MP_CLIENT_SECRET` | Production — cargada |
| `MP_REDIRECT_URI` | Production = `https://turnazo-chi.vercel.app/api/mp/oauth/callback` — cargada |
| `MP_STATE_SECRET` | Production — cargada |
| `MP_TOKEN_ENCRYPTION_KEY` | Production (32 bytes hex) — cargada; con ella se conectó `futmates` en sandbox |
| `MP_WEBHOOK_SECRET` | Production — cargada |

Las seis `MP_*` están en Production desde el 2026-11-16 (verificado por la lista de variables de Vercel; los valores no se leen). En `.env.local` siguen sin estar: localmente todo corre con mocks, y para correr el script de diagnóstico de órdenes hay que copiar `MP_TOKEN_ENCRYPTION_KEY` (la misma de Vercel) a `.env.local`. `.env.example` quedó alineado con los nombres que lee el código.

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
