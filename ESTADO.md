# Estado del proyecto — Turnazo

Última actualización: 2026-11-25 (rediseño: funciones en cle1, logo de hasta 10 MB, agenda nueva y carga de cancha por pasos en la rama `rediseno`; 022 a 025 aplicadas; 026 aplicada; 027 escrita, SIN APLICAR; S2 guardado sin push en `s2-captcha`)

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
- (2026-11-25: la grilla se reemplazó por la agenda nueva, ver "Agenda nueva" más abajo.) Grid columnas = canchas, filas = tiempo.
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

| 021 | `021_security_lockdown.sql` | Aplicada por el revisor (2026-11-19), después del deploy `dpl_EjtXUcyNHyUG3tBLDCRSoXmKBV7c` (commit `99891c5`). Fase 7 S1: grants mínimos para anon/authenticated columna por columna (se revoca todo, incluidos TRUNCATE/TRIGGER/REFERENCES, y los privilegios por defecto); FK compuesta `bookings(court_id, venue_id) → courts(id, venue_id)` (C1); el dueño ya no escribe en `bookings`: RPCs `panel_create_block`, `panel_cancel_booking` (pago online → `refund_pending` en la misma transacción), `panel_mark_paid` (no si se pagó todo online; con seña, amount_paid = price_total), `panel_mark_no_show` (con pago online solo después de empezado el turno) (M2); trigger `trg_venues_status`: solo superadmin/servidor cambia `venues.status` (A1); `create_booking` / `create_booking_hold` solo `service_role` (C2/A2); `_validate_booking_slot` rechaza turnos a más de 30 días (`too_far_ahead`). Se aplica **después** del deploy del código de S1 (el código viejo llama a `create_booking` con anon). Validada en PGlite reconstruyendo 001–020 con stubs de Supabase: 64/64 consultas de la app y ataques |

| 022 | (rama `s2-captcha`) | Aplicada por el revisor. Fase 7 S2 (límites de intentos para Turnstile). El código que la usa está solo en `s2-captcha`; se integra después del merge de `rediseno` |
| 023 | `023_court_features.sql` | Aplicada por el revisor (2026-11-24). Etiquetas de cancha: `surface` (CHECK con la lista), `covered`, `lit`, `has_locker_room`; grants por columna |
| 024 | `024_venue_logos.sql` | Aplicada por el revisor (2026-11-24), con dos cambios sobre la propuesta (el archivo ya es igual a lo aplicado): SELECT de storage solo para el dueño (`venue_logos_owner_select`, nadie lista el bucket) y `venues_logo_path_check` (logo_path en la carpeta `{id}/` y sin `..`). `venues.logo_path`, bucket público `venue-logos` (512 KB, PNG/JPEG/WebP), políticas de dueño. Sus políticas tenían un error (`name` se resolvía como `venues.name`): lo corrige la 025 |
| 025 | `025_venue_logos_policies_fix.sql` | Aplicada por el revisor (2026-11-25; pg_policies dice `storage.foldername(objects.name)`). Recrea las 4 políticas de `venue-logos` con `objects.name` |
| 026 | `026_panel_create_booking.sql` | Aplicada por el revisor (2026-11-25). `panel_create_booking(venue, court, start, end, nombre, celular)`: el dueño carga un turno desde la agenda ("+ Cargar turno" / "+ Nuevo turno"). Verifica el dueño, valida con `_validate_booking_slot` (igual que la reserva pública), deja `confirmed` / `unpaid` / `source = 'manual'` con el precio de la cancha; horario ocupado → `slot_taken`; sin outbox. EXECUTE solo authenticated |

**Escrita, SIN APLICAR:** `027_localities_geo_court_format_notes.sql`:
- `localities.lat` / `lng` NOT NULL (las 4 existentes con el centroide oficial de Georef) y grant de SELECT;
- `courts.format` (`futbol_5`, `futbol_6`, `futbol_7`, `futbol_9`, `futbol_11`, `futsal` o NULL) con CHECK y un trigger `enforce_court_format` que rechaza formato en canchas que no son de fútbol (`format_only_futbol`; también si se cambia el deporte de una cancha con formato: el panel tiene que mandar NULL);
- `courts.notes` (200 caracteres como máximo, CHECK);
- grants por columna (lectura anon/authenticated; escritura del dueño en format y notes). Nadie salvo el servidor escribe localities.

**Próxima migración:** `028_*.sql`

### Propuesta: localidades nuevas (falta decidir; NO implementado)
Cuando un dueño registra un complejo fuera de las localidades cargadas:
1. El dueño solo pone el pin (ya lo hace). La server action de crear/editar complejo recibe lat/lng, no una localidad elegida a mano. El cliente nunca crea localidades: no hay grants de escritura en `localities` para anon ni authenticated y no se agrega ninguna RPC para eso.
2. En el servidor, primero se busca una localidad existente cuyo centro esté a menos de ~6 km del pin. Esto hace falta porque Georef devuelve el **municipio**, y en Mendoza municipio = departamento: un complejo en La Consulta da "San Carlos" (verificado con la API). Sin este paso, La Consulta nunca se usaría.
3. Si no hay ninguna cerca: `GET https://apis.datos.gob.ar/georef/api/ubicacion?lat=…&lon=…` (sin clave, desde el servidor, timeout de 3 s). Se toma `municipio.nombre` (o `departamento.nombre` si viene vacío) y `provincia`. Si ya existe una localidad con ese slug, se usa; si no, se crea con el cliente de service role (`lib/supabase/admin.ts`) con nombre, slug y el centroide del municipio (`/georef/api/municipios?id=…&campos=centroide`). Se escribe en `audit_log` quién la originó.
4. Si Georef falla o el punto cae fuera de Argentina: se guarda el complejo en la localidad más cercana y el superadmin lo revisa al aprobarlo (el complejo entra `pending` igual).
5. Visibilidad: la localidad aparece en el inicio solo si tiene al menos un complejo aprobado. Lo hace la consulta del inicio (ya cuenta complejos aprobados). Si querés que también lo haga la base, sería una política RLS para anon en `localities` con `EXISTS (venue aprobado)`, en otra migración.

Ojo, dato a revisar: `padelmates` (aprobado, en Tunuyán) tiene el pin en Guaymallén (-32.8908, -68.8272, Georef lo confirma). Con el orden por cercanía va a quedar lejos de Tunuyán: el pin o la localidad están mal.

**Vault (ya configurado con la 020):** `refund_retry_url` = `https://turnazo-chi.vercel.app/api/mp/refund-retry`; `push_secret` es el mismo `PUSH_SEND_SECRET` de Vercel. Si cambia el dominio hay que actualizar `refund_retry_url` y `push_send_url`.
(`push_secret` ya existe; es el mismo `PUSH_SEND_SECRET` de Vercel.)

---

## Tests actuales

| Suite | Herramienta | Tests | Estado |
|-------|------------|-------|--------|
| Unitarios + integración | Vitest | 374 | 374 ✓ (2026-11-25, rama `rediseno`, con la 026 aplicada) |
| E2E | Playwright | 147 (incluye el setup de login) | 147 ✓ (2026-11-25, rama `rediseno`, con la 026 aplicada; --workers=1 en 4 tandas por archivo) |

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

Ramas (2026-11-24):
- `s2-captcha`: Fase 7 S2 (Turnstile + límites; la 022 ya está aplicada). **Sin push** hasta que el revisor cargue las claves de Turnstile en Vercel. Orden decidido: primero se mergea `rediseno` a `main`, después `s2-captcha`.
- `rediseno`: rediseño visual por etapas (D0–D2 visual, M1–M7 usabilidad), un commit por etapa. Se mergea a `main` solo con OK del revisor.

Rediseño D0 (paleta, fuente, modo claro/oscuro):
- Colores en un solo lugar: variables CSS en `src/app/globals.css` (claro en `:root`, oscuro en `[data-theme="dark"]` y en un bloque `prefers-color-scheme` para cuando no hay JS) expuestas a Tailwind con `@theme inline`: `bg`, `surface`, `surface-2`, `ink`, `ink-muted`, `line`, `brand`, `primary`/`on-primary`, `accent`/`on-accent`, `danger`(`-soft`), `warning`(`-soft`), `ring`. En oscuro `primary` es lima (el verde oscuro es el fondo). El lima va solo de fondo.
- `tests/unit/theme-contrast.test.ts` lee `globals.css` y exige AA (4.5:1) para cada par texto/fondo en los dos modos; además que el lima no sea color de texto.
- Modo: `src/lib/theme.ts` (`THEME_SCRIPT` inline en el `<head>`, sin parpadeo): automático sigue al celular; el botón `components/theme-toggle.tsx` (encabezado público) cicla Automático → Claro → Oscuro y guarda solo `turnazo-theme` en localStorage. Actualiza el color de la barra del celular. Tests: `tests/unit/theme.test.ts` (ejecuta el mismo script con un navegador simulado) y `tests/e2e/theme.spec.ts`.
- Fuente Outfit (500 texto, 800 títulos) con `next/font`.
- Desde D2 no queda ninguna pantalla forzada en claro.

Historias de turnos libres (panel; diseño en diseno/historias.png, fuera del repo):
- Agenda del complejo → "Compartir turnos libres" (/panel/complejos/{id}/historia): día (hoy + 6), deporte (si el club tiene varios) y estilo Pizarra / Invitación / Urgencia con la vista previa de los 3 (la misma imagen que se descarga). "Descargar" (Content-Disposition attachment) y "Compartir" (navigator.share con el archivo si el navegador puede; si no, avisa que use Descargar).
- Imagen: GET /panel/complejos/{id}/historia/imagen?fecha=&deporte=&estilo=[&descargar=1] → PNG 1080×1920 con next/og (ImageResponse), Outfit 500/800 (src/assets/fonts, OFL; outputFileTracingIncludes en next.config). Contenido: círculo con las iniciales del club (no hay logo todavía), nombre y localidad, DEPORTE en una pastilla grande, el día, hasta 6 horarios libres con precio (los mismos que ve el jugador: libres, con precio, sin los que ya empezaron), el link y la marca Turnazo. Cache-Control private, no-store.
- Solo el dueño: getStoryData (lib/stories.ts) verifica la sesión y venues.owner_id con el cliente del dueño; si no es el dueño, 404 (sin decir si el complejo existe). /panel/* sin sesión va al login (middleware).
- Link en la imagen: {host}/c/{primeros 8 del id}/{deporte} (src/app/c/[code]/[sport]/route.ts) redirige a la página del complejo; busca por rango de uuid entre los complejos aprobados y, si no hay exactamente uno, va al inicio.
- Tests: tests/e2e/historias.spec.ts (agenda → elegir → vistas previas → descarga PNG 1080×1920; sin sesión → login; complejo de otro dueño → 404; link corto) y tests/unit/stories.test.ts.

- Día de la imagen: la ruta responde `X-Historia-Fecha` con el día dibujado (hora de Mendoza). E2E: por defecto es hoy, al elegir otro día la vista previa, la descarga y la imagen usan ese día, y un día pasado vuelve a hoy; unit: "hoy" cerca de medianoche (02:30 UTC = 23:30 del día anterior en Mendoza). El "Martes 1" de las capturas anteriores era una imagen pedida a mano con ?fecha= de otro día, no un error.

Velocidad (2026-11-25):
- Causa: Supabase está en us-east-2 (Ohio) y las funciones de Vercel estaban en gru1 (San Pablo): cada consulta cruzaba el continente. `vercel.json`: `regions: ["cle1"]` (Cleveland). La mudanza de la base a São Paulo va con S7.
- Consultas en cadena juntadas: inicio (localidades, deportes y complejos en una tanda: `getLocalitiesAndSportsWithCounts`), complejo (deporte, complejo y canchas a la vez, con React cache: `generateMetadata` y la página no repiten), agenda (complejo, canchas y reservas a la vez).
- Medido desde Argentina (tiempo hasta el primer byte, mediana de 15 pedidos, deploy viejo y nuevo uno detrás del otro; agenda con la sesión del dueño de prueba):

  | Pantalla | Antes (gru1) | Después (cle1 + consultas juntas) |
  |---|---|---|
  | Inicio | 1132 ms | 572 ms |
  | Lista (/tunuyan/padel) | 642 ms | 506 ms |
  | Complejo | 798 ms | 485 ms |
  | Agenda | 1257 ms | 518 ms |

  Lo que queda es en buena parte el viaje Argentina ↔ Cleveland (antes ese tramo era corto y el largo era cada consulta). La lista hace todavía 3 pasos seguidos (localidad/deporte → complejos → disponibilidad), ahora de pocos ms cada uno.

Logo del club (024 y 025 aplicadas; hasta 10 MB desde 2026-11-25):
- Panel del complejo → "Logo del club" (`components/panel/venue-logo-section.tsx`): el logo actual o las iniciales, "Subir logo" / "Cambiar logo" y "Quitar logo" (44 px). Acepta hasta 10 MB (más se avisa antes de mandar).
- El servidor lo achica con sharp (`lib/venue-logo-shrink.ts`): 1024 px de lado como máximo (sin agrandar ni recortar), menos de 512 KB, MISMO formato (PNG con su transparencia, JPEG, WebP), orientación EXIF aplicada y sin metadatos. Si no entra, baja la calidad y después el lado en proporción.
- Vercel corta los pedidos de más de 4,5 MB: si el archivo pesa más de 4 MB, el navegador lo baja antes a 2048 px (o 1024) en el mismo formato; si no puede (un navegador que no sabe guardar WebP), avisa. `next.config`: `serverActions.bodySizeLimit` y `proxyClientMaxBodySize` en 11mb.
- Portada, panel e historias: el logo entero y como se subió, sin círculo que lo recorte ni fondo blanco (respeta la transparencia).
- `uploadVenueLogoAction` / `removeVenueLogoAction` (actions/panel.ts), con la sesión del dueño (las políticas de storage hacen cumplir la carpeta): verifica que el complejo sea suyo, tamaño ≤ 512 KB y el tipo REAL por los primeros bytes (`detectLogoType` en lib/venue-logo.ts: PNG, JPEG, WebP; la extensión y el Content-Type no cuentan). Sube a `{venue_id}/logo-{timestamp}.{ext}` (nombre nuevo cada vez: la URL pública cambia y nadie ve el viejo de caché), guarda logo_path, borra el anterior y escribe audit_log.
- Se muestra por la URL pública del bucket (no necesita política de lectura): portada del complejo (`components/club-logo.tsx`, círculo junto al nombre) y panel. Sin logo, iniciales en verde sobre lima.
- Historia: `getStoryData` baja el logo por su URL pública y lo pasa como data URI (vuelve a mirar los bytes; si falla, iniciales). next/og dibuja PNG y JPEG pero deja vacío el WebP: el WebP se convierte a PNG con `sharp` (agregado como dependencia directa; ya venía con Next, misma versión 0.35.5).
- Tests: `tests/unit/venue-logo.test.ts` (bytes), `tests/unit/venue-logo-shrink.test.ts` (PNG con alfa, JPEG, WebP, sin agrandar, EXIF, imagen rota), `tests/integration/venue-logos.test.ts` (A no sube, no pisa, no borra ni lista en la carpeta de B; no apunta logo_path a otra carpeta ni con `..`; la acción rechaza un SVG con nombre .png, más de 10 MB, sin archivo, una imagen rota y el complejo ajeno; A sube un PNG de 3 MB que se guarda achicado y sigue PNG con alfa, lo cambia y lo quita) y `tests/e2e/logo.spec.ts` (iniciales → logo en la portada y en la historia, PNG y WebP; archivo falso rechazado; aviso de 10 MB; el dueño sube un PNG transparente y una foto de más de 4 MB, se guardan achicados en su formato, se ven enteros, y lo quita).

Agenda nueva (2026-11-25; diseno/agenda-v2.png, pantallas 1 y 2; `components/panel/agenda-day.tsx`, reemplaza a la grilla):
- Días Hoy + 6 (y el elegido) y "Otra fecha". Resumen del día de todas las canchas: turnos, $ a cobrar (lo que falta de los confirmados) y libres.
- Pestañas por cancha con su cantidad de turnos y "Todas" (recordada en el dispositivo). En "Todas", en pantallas anchas, una columna por cancha lado a lado; en el celular, una lista con el nombre de la cancha.
- Lista en orden de hora: turnos (hora y fin, nombre, celular, pago en lima pagado/seña o ámbar sin pagar, WhatsApp de 44 px), bloqueos y libres punteados con "+ Cargar turno". Línea AHORA si el día es hoy. Los cancelados no se listan (su horario aparece libre).
- Barra fija abajo: "+ Nuevo turno" y "Compartir libres".
- Hoja del turno: "Cobrado $X" y "WhatsApp" grandes arriba; abajo "Marcar que no vino", "Cancelar turno" y "Bloquear este número" (estos dos piden confirmación). Hoja "Nuevo turno": turno de un jugador (cancha, horario libre, nombre, celular; necesita la 026) o bloquear horario (lo de antes).
- No se hizo "Mover a otro horario" ni "3er turno este mes" del diseño: no estaban en el pedido.
- Tests: `tests/e2e/agenda-v2.spec.ts` (nuevo) y agenda, audit, panel-movil y cancellation adaptados; `tests/integration/panel-create-booking.test.ts` (026).

Cargar cancha por pasos (2026-11-25; diseno/agenda-v2.png, pantalla 3):
- 1 Datos (`/canchas/nuevo`): nombre, deporte y duración con botones (la duración sigue a la del deporte hasta que se toca), superficie, Techada / Iluminada / Vestuario / Visible. "Siguiente: precios →".
- 2 Precios (`/canchas/{id}?paso=precios`): aviso lima "Cancha X cargada · Ya aparece en la app. Te faltan los precios.", el aviso de horarios sin precio ahí mismo (se va al guardar los que faltan), precios y horarios. 3 Listo (`?paso=listo`): "Cancha X lista" o lo que falta, y Ver la agenda / Cargar otra cancha.
- Aviso "Guardado" en todo el panel (`components/panel/saved-toast.tsx`, uno solo en el layout; `useSavedNotice` en cada formulario): datos del complejo, cancha, horarios, precios, cobro, cancelaciones, logo, desbloquear, Mercado Pago y las acciones de la agenda.
- Los editores de horarios y precios ahora se mandan con onSubmit: con `action=` React 19 hacía form.reset() y después de guardar todas las filas mostraban "Dom" (lo guardado estaba bien). Controles de 44 px.
- Tests: `tests/e2e/cancha.spec.ts`.

Inicio con "¿Dónde?" y complejos en la misma pantalla (2026-11-25; necesita la 027, aplicada):
- "¿Dónde?" es una sola barra desplegable (`components/where-bar.tsx`, select nativo de 48 px) con las localidades que tienen al menos un complejo aprobado ("Tunuyán · 3 complejos"). Las que no tienen no aparecen: `/la-consulta` abre el inicio con la primera que sí.
- Sin localidad en la URL: con permiso de ubicación YA dado, la más cercana (por el centro de la localidad, 027) y la lista ordenada por distancia ("· a 0,5 km"); sin permiso, la última que usó (localStorage) o la primera. "Usar mi ubicación" pide el permiso solo si el jugador lo toca. La posición no se guarda. Reemplaza a `OpenRememberedSearch`.
- Debajo, en la misma pantalla, los complejos del deporte (`components/venue-results.tsx`, el mismo de `/[localidad]/[deporte]`): "¿A qué hora querés jugar?" con Ahora · 18–20 · 20–22 · 22+ y "Otra hora…" (08 a 23; `?hora=19` = turnos que empiezan de 18:30 a 19:59, porque con la grilla de 90 min ningún turno empieza justo a las 19). Solo aparecen los complejos con lugar a esa hora, primero el que tiene MÁS turnos libres (`lib/rank-venues.ts`, para repartir), con "N turnos libres …" y hasta 4 horarios. El botón "Ver N complejos" ya no existe.
- Localidad desde el pin (propuesta aprobada, `lib/locality-resolver.ts`): el formulario del complejo ya no tiene selector de localidad. Al crear (o al mover el pin al editar), el servidor busca una localidad a menos de 6 km; si no hay, consulta Georef (`/ubicacion`, 3 s de timeout) y usa o crea el municipio con la clave de servicio (centroide de Georef), con `audit_log` (`entity = 'locality'`); si Georef falla, la más cercana con `locality_source = 'fallback'` en el audit del complejo, para que la revise el superadmin al aprobarlo.
- El mapa del complejo nuevo arranca SIN pin, y sin pin no se guarda ("Marcá en el mapa dónde está el complejo."). Antes el marcador arrancaba en el centro de Mendoza (-32.8908, -68.8272): es exactamente el pin de padelmates, que seguramente nunca lo movió. Sus datos no se tocaron (lo revisa Igna).
- Tests: `tests/unit/locality-resolver.test.ts`, `tests/unit/franjas.test.ts` (hora exacta y orden); E2E `inicio.spec.ts` (barra, orden, hora, ubicación), `panel.spec.ts` (sin pin), `public.spec`, `rediseno.spec`.

Fútbol: formato de la cancha (2026-11-25; 027):
- Panel: en la carga de cancha, si el deporte es fútbol aparece "Formato" con 6 botones (Fútbol 5, 6, 7, 9, 11, Futsal; radios de 44 px). Con pádel o tenis no se muestra y el servidor guarda `format = NULL` aunque el formulario lo mande (`formatForSport` en `actions/panel.ts`); así una cancha que pasa a pádel nunca choca con el trigger `enforce_court_format`.
- Inicio y lista, solo con fútbol: chips "Todos · 5 · 6 · 7 · 9 · 11 · Futsal" (`?formato=`, `components/format-chips.tsx`) que dejan solo las canchas de ese formato (`filterByFormat`, también para "Lo antes posible"); cambiar la hora conserva el formato.
- Tarjeta y portada: el formato va primero en las etiquetas ("Fútbol 5 · 1 cancha · turnos de 60 min"; en la portada sin repetir "Fútbol"), y en la pestaña de la cancha ("Cancha 1 · Fútbol 5").
- Hoy la única cancha de fútbol (futmates) no tiene formato: aparece con "Todos" y no con un formato hasta que el dueño lo elija.
- Tests: `tests/unit/court-format.test.ts`, `court-tags.test.ts`; `tests/integration/court-format.test.ts` (API: dueño, anon, CHECK, trigger, notes de 200; acciones: crear con formato, pasar a pádel → NULL); E2E `tests/e2e/formato.spec.ts` (crea y borra "E2E Formato F5" en el complejo de prueba).

Rediseño M4 (Mi turno):
- "Guardá este link" arriba de todo (borde primary): el link de Mi turno en un campo de solo lectura y "Copiar link" (44 px; sin permiso de portapapeles queda seleccionado para copiar a mano).
- Con el turno confirmado: "Compartir por WhatsApp" (wa.me/?text= con cancha, día, horario, dirección y "Cómo llegar"; SIN el link de Mi turno, porque con él se puede cancelar), "Agregar al calendario" (GET /turnos/{token}/calendario → turno.ics, RFC 5545, horas en UTC, Cache-Control private/no-store; 404 si el turno no existe o no está confirmado) y "Cómo llegar" (Google Maps con el pin del complejo; sin pin, nombre y dirección).
- lib/mi-turno.ts (reserva por token, link de Cómo llegar, origen del pedido) y lib/ics.ts (con test). El link se arma con el host del pedido, así sirve en local, en el Preview y en producción.
- E2E tests/e2e/mi-turno.spec.ts con fecha "viernes 14+ días" (antes "26+ días" podía caer a más de 30 y la base devolvía too_far_ahead).

Rediseño V2 (diseño aprobado "versión 2"; la imagen de referencia está en diseno/, fuera del repo):
- V2a · Inicio: deporte y lugar en una sola pantalla (?localidad=&deporte=; sin elección, la búsqueda recordada o la primera con complejos). Portada verde con líneas de cancha (SVG, clase `.cover` en globals.css: primary en claro, surface en oscuro, mismas variables), "Hola, Juan" + "No soy yo", "¿Jugamos hoy?" y "Lo antes posible · 18:00 · complejo →" (primer turno libre CON precio de hoy o, si no queda, de mañana), que abre el complejo con la hoja de ese turno (?cancha=&inicio=, la hoja limpia la URL). "¿Qué querés jugar?" con íconos de línea (components/sport-art.tsx), el elegido en primary, sin complejos "Pronto" sin link. "¿Dónde?": chips "Tunuyán · 3", sin complejos "· pronto". /[localidad] redirige al inicio con esa localidad; /[localidad]/[deporte] sigue igual. Se quitó "Seguir en…" (lo reemplaza la portada).
- lib/free-slots.ts: canchas de una localidad+deporte en UNA consulta; disponibilidad con get_court_availability una vez por cancha y fecha por request (React cache), tope MAX_COURTS = 24 canchas; solo hoy y, si hace falta, mañana.
- V2b · Lista de complejos: franjas de hoy Ahora · 18–20 · 20–22 · 22+ (?franja=, lib/franjas.ts con test). Cada complejo en tarjeta: mapa chiquito ESQUEMÁTICO en SVG (components/mini-map.tsx: calles dibujadas y pin con las variables del tema; sin tiles ni pedidos externos; la ubicación real queda en "Ir"/"Cómo llegar"), nombre, dirección, distancia solo si el jugador YA dio permiso de ubicación (nunca se pide; components/venue-distance.tsx), etiquetas con lo que existe ("2 canchas · turnos de 90 min") y los próximos 4 horarios libres con precio de la franja en chips lima (horarios distintos), que abren el complejo con la hoja de ese turno. Primero los que tienen lugar; "N complejos con lugar". El mapa grande (Leaflet + OSM, con su atribución) sale de arriba y se carga recién con "Ver todos en el mapa". La lista acepta ?_now= solo fuera de producción (igual que el complejo) para los tests.
- V2c · Complejo: portada verde (~200 px, clase .cover) con las líneas de cancha del deporte, flecha de volver de 44 px (en escritorio siguen las migas), nombre grande y "Pádel · 2 canchas". Tarjeta flotante con dirección, mapa chiquito esquemático (el mismo de V2b) y "Ir" (Google Maps con el pin real). Días en una fila deslizable (Hoy, Mar 25…, los 30 días reservables; el elegido se centra). Pestañas por cancha (?c=, links: funcionan sin JavaScript) y "Turnos de 90 min". Grilla de 4 columnas: libre en tarjeta neutra con precio, elegido en lima con borde primary, ocupado punteado y tachado, sin precio "Consultá". Tocar un turno lo ELIGE y aparece la barra fija "Hoy 19:00 · Cancha 1 · $10.000" + "Reservar", que abre la hoja de M2 (con datos recordados: turno → Reservar → Confirmar = 3 toques; antes 2). Sin JavaScript el turno sigue siendo un link a /reservar. Se quitó DateNavigator (lo reemplaza la fila de días).
- Etiquetas (023, APLICADA por el revisor el 2026-11-24): en el panel, el formulario de la cancha tiene "Superficie" (select con las 5 opciones o "Sin indicar") y tres interruptores (role=switch, 44 px): Techada, Iluminada, Vestuario; createCourtAction/updateCourtAction los guardan (zod valida la superficie). La lista y la portada del complejo muestran lo cargado ("Sintético · Techada · Iluminada", lib/court-tags.ts); si no hay nada, "2 canchas · turnos de 90 min". tests/integration/court-features.test.ts: el dueño edita sus canchas; no puede editar las de otro dueño (ni por la API ni por updateCourtAction); anon lee y no escribe; el CHECK rechaza superficies inventadas. E2E: tests/e2e/etiquetas.spec.ts (deja la cancha de prueba como estaba).
- Fila de días del complejo: el primero siempre es "Hoy" y nunca hay días pasados; una ?fecha= vieja abre hoy.
- Migración 023 (supabase/migrations/023_court_features.sql), aplicada por el revisor: courts.surface (CHECK sintetico/pasto/cemento/polvo_ladrillo/blindex o NULL), covered, lit, has_locker_room (boolean NOT NULL DEFAULT false); SELECT a anon y authenticated de esas columnas, INSERT/UPDATE a authenticated (el dueño edita la cancha con UPDATE directo + RLS courts_owner_all; no hay RPC panel_* de canchas). La app todavía no la usa.
- Editor de precios: "Agregar franja" propone el tramo abierto que falta cubrir (futmates: 22:00 a 00:00) o el horario de apertura de la cancha; ya no 08:00–22:00 fijo (defaultPriceRow en lib/price-coverage.ts, con test).
- Bug de futmates (22:00 y 23:00 sin precio): la cancha abre de 10:00 a 00:00 y el precio está cargado de 08:00 a 22:00 (la fila que propone el editor por defecto). No es un error de cálculo: falta la franja de precio. La base rechaza esas reservas (price_not_set). Arreglo: la grilla ya no ofrece como libre un turno sin precio ("Consultá al complejo", sin link), "Lo antes posible" y la lista los saltean, y el panel de la cancha avisa "Hay turnos sin precio: 22:00 a 00:00 · todos los días" (lib/price-coverage.ts + tests/unit/price-coverage.test.ts). Los datos de futmates no se tocaron: el dueño tiene que agregar la franja 22:00–00:00.

Pendientes de M3:
- Teléfono bloqueado (y todo error general): los datos vuelven a la línea recordada con "Cambiar" y "No soy yo"; con los campos abiertos, "No soy yo" va dentro de la misma tarjeta. Los errores sin reintento muestran "Cerrar" (44 px) donde iba Confirmar: en la hoja la cierra; en /reservar vuelve al complejo.
- Celular siempre "característica + espacio + número" (`formatArgentinePhone` en lib/phone.ts, con la lista de características de 3 dígitos; "11" de 2; el resto de 4): línea recordada, campos (al salir del campo) y Mi turno. Se recuerda ya formateado.
- Error de Mercado Pago → "Pagar en el lugar": `tests/integration/mp-pay-at-venue.test.ts` (complejo propio, MP simulado) confirma que el hold se libera antes de devolver el error y queda una sola reserva activa; dos toques → una reserva + slot_taken; si otro jugador toma el turno en el medio → slot_taken con "Ver otros horarios". Si no se pudo liberar el hold, la acción devuelve `mp_hold_not_released` ("el turno queda apartado a tu nombre 10 minutos") en vez de ofrecer "Pagar en el lugar". Propuesta de base (no aplicada): ver "Propuesta: create_booking que reemplaza el hold".
- M4 (Mi turno) hecho después, ver "Rediseño M4".

Rediseño M3 (errores con acción) y ajuste de datos recordados:
- Datos recordados (hoja y /reservar): una línea "Juan Pérez · 2622 123456" con "Cambiar" (44 px, despliega los campos) y "No soy yo". Sin datos recordados, los campos como antes. Nombre y celular son campos controlados: lo escrito no se borra cuando la reserva vuelve con error. Solo se recuerda un celular con 8+ dígitos y un nombre de 2+ letras (antes se guardaba un celular mal escrito).
- `src/lib/booking-errors.ts`: catálogo único código → mensaje corto + acción. `lib/booking-messages.ts` ahora sale de ahí (las server actions no cambiaron; devuelven los mensajes nuevos). Acciones: `other_times` (turno tomado / pasado / fuera de grilla → "Ver otros horarios" reemplaza a Confirmar; en la hoja cierra y recarga el día; en /reservar vuelve al complejo con la fecha), `field` (nombre / celular → se marca el campo con `aria-invalid`, mensaje debajo y foco), `none` (límite de 3 turnos, teléfono bloqueado, complejo/cancha no disponible, sin precio → solo el mensaje, sin botón), `wait` (pago en curso; rate limit de S2: "Esperá un minuto y probá de nuevo"), `pay_at_venue_or_retry` (Mercado Pago → "Pagar en el lugar" si el complejo lo permite —cambia la opción y reserva en un toque— y "Reintentar el pago"), `change_payment`, `retry` (genérico).
- La validación del servidor (zod) devolvía textos genéricos en inglés para nombre/celular: el formulario muestra los del catálogo.
- Al mergear S2: `ABUSE_MESSAGES.tooMany` debería usar `bookingError("too_many_attempts").message` (mientras tanto el catálogo reconoce el texto actual de S2 como alias).
- `tests/integration/booking-errors.test.ts`: lee de las migraciones la definición vigente de `create_booking`, `create_booking_hold` y `_validate_booking_slot` (más los códigos propios de la acción de pago) y exige que cada código tenga mensaje (≤ 110 caracteres) y acción; contra la base real, la server action devuelve errores del catálogo. Encontró `invalid_period`, que antes caía en el mensaje genérico.
- E2E: `errores.spec.ts` (celular inválido marca el campo y no se borra; teléfono bloqueado sin reintento) y `hoja.spec.ts` (turno tomado → "Ver otros horarios" recarga el día; error de MP → "Pagar en el lugar" reserva en un toque).
- Capturas: `13-hoja-recordada`, `14-error-tomado`, `15-error-celular`, `16-error-bloqueado` (claro/oscuro).

Rediseño M2 (reserva en la hoja del complejo):
- `src/components/booking-sheet.tsx`: tocar un turno libre abre una hoja (abajo en el celular, centrada en escritorio) con el mismo `BookingForm` y las MISMAS server actions que /reservar (online → `startPaymentAction` → Mercado Pago; en el lugar → `createBookingAction` → /turnos/…). Las server actions no cambiaron. Con datos recordados: turno → Confirmar = 2 toques.
- El turno sigue siendo un `<a href="/reservar?…">`: sin JavaScript (o Ctrl/Cmd + clic) se usa la página /reservar, que sigue igual.
- `BookingForm`: pie fijo abajo (`sticky`) con el error pegado al botón (`data-testid="reserva-error"`), en la hoja y en /reservar. Lugar reservado para Turnstile: `<div data-captcha-slot>` (se completa al mergear `s2-captcha`; no se trajo código de esa rama).
- `src/lib/payment-options.ts`: `buildPaymentOptions` (sacado de /reservar, mismo cálculo) para la página y la hoja.
- Celular: las migas de pan se reemplazan por "← Volver" (44 px) al paso anterior lógico (`components/breadcrumbs.tsx`): localidad → inicio, complejos → localidad, complejo → complejos, reservar → complejo con su fecha, mi turno / pago → inicio. Escritorio: migas completas.
- Inicio: título "¿Dónde jugamos?"; el saludo usa solo el primer nombre.
- `tests/e2e/hoja.spec.ts`: 2 toques con datos recordados, Confirmar a la vista, lugar del captcha, error pegado al botón cuando el turno se ocupa con la hoja abierta, Cerrar/Escape, sin JS → /reservar, pago online desde la hoja con la cuenta MP falsa (error de MP; se restaura el cobro), "← Volver" y migas en escritorio.
- Capturas: `11-hoja` y `12-hoja-error` (claro/oscuro).

Rediseño M1 (recordar al jugador, 44 px en el flujo público):
- `src/lib/player-memory.ts`: localStorage `turnazo-jugador` con SOLO nombre, celular, última localidad y último deporte (`sanitizePlayerMemory` descarta cualquier otro campo, slugs raros y textos largos). Nunca el email ni nada del pago. `tests/unit/player-memory.test.ts`.
- Nombre y celular se guardan al enviar el formulario de reserva; la próxima reserva viene precargada con "Reservás como Juan · No soy yo". Localidad y deporte se guardan al mirar la lista de complejos o un complejo.
- Inicio: tarjeta "Hola, Juan" + "Seguir en Tunuyán · Pádel" + "No soy yo". "No soy yo" (44 px, en el inicio y al reservar) borra todo lo recordado.
- 44 px en todo el flujo público: migas de pan, "Cómo llegar", links de texto ("Volver al inicio", "Buscar otro turno"…), casilla "Entiendo que no hay devolución" y los botones de zoom del mapa. `tests/e2e/tactil.spec.ts` recorre inicio → localidad → complejos → complejo → reservar → mi turno y las pantallas de error, y falla con la lista de lo que mida menos de 44 × 44.
- `tests/e2e/recordar.spec.ts`: "Seguir en…", reserva real en el complejo de prueba (borrada al final) que guarda solo los 4 campos (sin email aunque se haya escrito), precarga, "No soy yo" en reservar y en el inicio, y un valor manipulado en localStorage que se ignora.
- Capturas 390 px claro/oscuro: `9-inicio-seguir`, `10-reservar-recordado`, `2-complejo` (con el "Ocupado" nuevo).

Rediseño D2 (panel del dueño, login y registro):
- Todo el panel, login y registro con los colores por función (modo oscuro completo). El botón "Conectar Mercado Pago" pasó de `#009ee3` (3.1:1 con blanco) a `#0072a8` (5.3:1).
- Menú: barra lateral en escritorio; en el celular, barra arriba con "Menú" / "Cerrar menú" que despliega los links (44 px), el tema, notificaciones y cerrar sesión. La agenda usa todo el ancho (antes la barra lateral fija dejaba ~140 px). Dentro de la agenda de un complejo el ítem activo es "Agenda".
- `/panel` entra directo a la agenda (antes a Complejos).
- Agenda: "← Anterior", "Siguiente →", "Hoy" (si no es hoy) y selector de fecha, todos de 44 px. Columnas con encabezado de 44 px y botón "+" de 44 px. Turnos confirmados en lima; pendientes en warning; textos de 11–14 px (antes 9–10 px).
- Acciones de un turno: tocar la tarjeta abre una hoja (abajo en el celular, centrada en escritorio; `role="dialog"`, Escape o tocar afuera la cierra) con botones de ancho completo y 44 px: WhatsApp, Marcar pagado, Marcar ausente, Cancelar turno (con el aviso de devolución), Bloquear teléfono, Cerrar. Mismos textos que antes (los E2E existentes no cambiaron).
- Bloqueo manual: campos y botón de 44 px.
- Ajustes del revisor (2026-11-24):
  - Celular (< 640 px): pestañas por cancha, una columna a la vez a todo el ancho; la elegida queda en localStorage (`turnazo-agenda-cancha:<venue>`, solo el id de la cancha). Escritorio: grilla completa.
  - Color por pago: confirmado con pago total o seña = lima; sin pagar = tarjeta neutra (surface + borde line) con etiqueta "Sin pagar $X" en warning. Pendiente de pago online (`hold`) sigue en warning.
  - Íconos de línea SVG inline (estilo lucide; `lucide-react` no está instalado y no se sumó) en lugar de emojis: WhatsApp, Marcar pagado, Marcar ausente, Cancelar, Bloquear, Cerrar, "+" de bloqueo y candado de los bloqueos.
  - "Cancelar turno" y "Bloquear teléfono" siempre piden confirmación ("Confirmar cancelación" / "Confirmar bloqueo" o "Volver"); antes solo pedía confirmar la cancelación con pago online. `audit.spec.ts` suma ese clic.
  - `agenda.spec.ts`: el chequeo genérico de "cancha" busca solo elementos visibles (las pestañas del celular están ocultas en escritorio).
  - "Ocupado" (decisión del revisor): sin fondo, borde punteado `line`, hora tachada en ink-muted; se distingue del libre en los dos modos. E2E en `rediseno.spec.ts`.
- `tests/e2e/panel-movil.spec.ts` (390 px): entrada a la agenda, menú cerrado/abierto, ítem activo, "Hoy" y selector de fecha, hoja de acciones con 44 px y dentro de la pantalla. Reserva propia "E2E Rediseño Panel" (sábado 9+ días) que se borra al final.
- Capturas 390 px claro/oscuro: agenda, menú abierto y acciones de un turno (reservas "Captura D2", borradas).

Rediseño D1 (pantallas públicas):
- Inicio, localidad, complejos, complejo, reservar, pago, mi turno y cancelación usan solo los colores por función: en oscuro cambia todo el contenido, no solo el encabezado. Turnos libres en tarjeta neutra (surface, borde line, hora en ink 800, precio en ink-muted, 44 px o más; ajuste del revisor: en lima quedaba "una pared amarilla"). El lima queda para el turno elegido, "Confirmado" y los botones principales; éxito con lima de fondo; errores en `danger`; pendiente en `warning`. "Cancelar turno" pasó a botón con contorno rojo (se lee en los dos modos).
- Días: los botones "Ayer"/"Manana" (que en realidad iban al día anterior/siguiente) pasan a ‹ › de 44 px con `aria-label` "Día anterior"/"Día siguiente".
- `/turnos/[token]` ya no muestra el estado interno en inglés (`hold`, `expired`…): "Esperando el pago", "Vencido", "Jugado". La fecha se ve "Martes, 8 de diciembre" (antes `capitalize` ponía "De Diciembre").
- `/pago` confirmado: tarjeta neutra con tilde en lima (antes el botón quedaba lima sobre lima en oscuro).
- Inicio: las localidades sin complejos dicen "Próximamente", en ink-muted sin opacidad (pasa AA) y no son tocables (`aria-disabled`).
- `tests/e2e/rediseno.spec.ts`: mide en el navegador el contraste real de esas tarjetas y de los turnos libres en los dos modos, que los turnos no sean lima y que midan 44 px o más.
- Capturas en celular (390 px, claro y oscuro) tomadas con una spec temporal contra el complejo de prueba; la reserva "Captura D1" se borró.
- Preview: comparte la base de producción; reservar ahí crea reservas reales.

Fase 7 S1 (seguridad) — CERRADO (2026-11-19):
- Con la 021 aplicada: Vitest 227/227 y Playwright 65/65; la base quedó igual que antes de correr (3 complejos, 3 usuarios, 14 reservas, 0 teléfonos bloqueados).
- Choque entre tests encontrado al cerrar: el cron de reintento de devoluciones (`/api/mp/refund-retry`) barre **todos** los pagos `refund_failed` de la base. `cancellation.test.ts` exigía `attempted: 1` y, corriendo en paralelo con `webhook.test.ts` (que deja un pago propio en `refund_failed`), el cron tomó los dos. Arreglo: el test comprueba solo su propio pago (llamadas al reembolso con su orden, estado de su fila, `failed: 0`), no los totales del cron.
- **Este choque es otro motivo para S7 (base de tests separada de producción):** hoy los tests corren contra la misma base que producción, así que un test puede tocar los pagos de otro test, y en el futuro los de clientes reales (el cron que dispara un test reintentaría devoluciones reales con el `refundMpOrder` simulado de ese test).
- `tests/integration/security-s1.test.ts` — 18 tests: cada ataque del informe S1 (C1, C2, A1, A2, M2) intentado con la anon key, con un dueño ajeno y con service_role; todos tienen que fallar. Requieren la 021. Fixture propio (dos dueños, dos complejos); `afterAll` borra por dueño, así también limpia lo que un ataque llegue a crear.
- La contraseña del dueño de prueba ya no está en el repo: `E2E_OWNER_PASSWORD` en `.env.local` (rotada el 2026-11-19; la vieja quedó en el historial de git y ya no sirve). Los E2E preparan y limpian datos con `SUPABASE_SERVICE_ROLE_KEY` (helpers `serviceHeaders()`): desde la 021 el dueño no escribe `bookings` / `notification_outbox` ni lee `audit_log`.
- El selector de fechas público no avanza más de 30 días (hoy + 29), coherente con `too_far_ahead`.
- `security-s1.test.ts`: la limpieza da varias vueltas (el cron de devoluciones de otro archivo puede grabar un pago de sus reservas en el medio y la FK frena el borrado) y falla en voz alta si no puede borrar los complejos. Pasó una vez que quedaron 4 complejos "S1 …" y rompieron los conteos de `public.spec.ts`; se borraron.

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

## Pendiente S5: create_booking que reemplaza el hold (p_replace_hold_token)

Aprobada la idea, pero no ahora: va en S5, en una migración aparte (no en la 023).

Hoy "Pagar en el lugar" después de un error de Mercado Pago hace dos pasos: la acción de pago libera el hold (`status = 'expired'`) y después el formulario llama a `create_booking`. La restricción `no_overlap` (holds + confirmadas) impide dos reservas activas, pero entre los dos pasos el turno queda libre unos segundos y otro jugador podría tomarlo (el jugador lo ve: "Este turno ya fue reservado" + "Ver otros horarios").

Para que sea atómico cambiaría `create_booking` (migración nueva, misma firma más un parámetro opcional):

- `p_replace_hold_token text DEFAULT NULL`.
- Si viene, en la misma transacción y antes del INSERT: `UPDATE bookings SET status = 'expired' WHERE cancel_token = p_replace_hold_token AND status = 'hold' AND court_id = p_court_id AND period = tstzrange(p_start, p_end, '[)') AND customer_phone = v_val.norm_phone`. Solo libera un hold del mismo jugador, la misma cancha y el mismo horario; si no coincide, no toca nada.
- El resto igual. Si el INSERT falla, la transacción se revierte y el hold sigue a su nombre (no pierde el turno).
- La acción de pago tendría que dejar de liberar el hold en los errores de MP y devolver su `cancel_token` (solo al cliente que lo creó) para pasarlo a `create_booking`; la orden de MP, si llegó a crearse, se cancela como en `cancelHoldAction`.
- Grants: los mismos (solo service_role).

## Antes del merge de `rediseno` a `main` (lista, 2026-11-24; NO mergeado)

Ramas y orden
- [x] `d27ec19` (cierre de S1) pusheado a `main` (2026-11-24). `rediseno` sale de ese commit: el merge es directo.
- [x] Orden decidido: primero `rediseno` → `main` (juntos con el revisor), después `s2-captcha`. La 022 ya está aplicada; a S2 solo le faltan las claves de Turnstile (sitio + secreta), que carga el revisor en Vercel. Al integrarlo:
  - el captcha va en el lugar reservado del pie de la hoja y de /reservar (`data-captcha-slot`);
  - `ABUSE_MESSAGES.tooMany` tiene que salir del catálogo (`bookingError("too_many_attempts").message`); hoy el catálogo reconoce el texto viejo como alias.
- [ ] Merge sin squash, para conservar un commit por etapa.

Base de datos (es la misma para Preview y producción)
- [x] 023 (etiquetas de cancha) aplicada por el revisor; `main` no la usa, no rompe nada.
- [x] 024 (logo del club) aplicada.
- [x] 025 (corrige las políticas de la 024) aplicada (2026-11-25).
- [x] 026 (`panel_create_booking`, cargar turnos desde la agenda) aplicada por el revisor (2026-11-25); suites en verde.
- [ ] **027 (localidades con centro, formato y aclaraciones de cancha) escrita, SIN APLICAR**. El inicio "¿Dónde?", los formatos de fútbol y las aclaraciones se escriben después de aplicarla.
- [ ] Pendiente S5 (`p_replace_hold_token`), migración aparte: no bloquea el merge.
- [ ] Datos: futmates no tiene precio de 22:00 a 00:00 (lo carga el dueño; el panel ya lo avisa). El "Complejo Padelero Tunuyán" de prueba está aprobado y se ve en producción (inicio, "Lo antes posible", lista): **queda visible por ahora; hay que ocultarlo antes de que entren dueños reales (va con S7, base de tests separada)**.
- [ ] Antes de mergear, verificar que no queden datos de prueba: 0 reservas "E2E*" / "Audit Test*", 0 teléfonos bloqueados, cancha de prueba sin etiquetas, cobro del complejo de prueba solo "en el lugar", complejo de prueba sin logo, bucket `venue-logos` vacío, 4 canchas (sin "E2E Cancha*"). Hoy hay 16 reservas: las 14 de antes más 2 que hizo Igna en el Preview el 2026-11-25 en el complejo de prueba (una cancelada y una confirmada a las 12:30). Además futmates tiene una cancha de pádel real desde el 2026-11-25 (por eso el inicio ya no muestra "1 complejo" de pádel).

Vercel
- [x] Los deploys de Preview de `rediseno` construyen (READY hasta `dd8cb07`, el de cle1).
- [x] Funciones en cle1 (`vercel.json`), medido en el Preview (tabla en "Velocidad").
- [ ] Probar en el Preview subir un logo de más de 4,5 MB (el navegador lo achica antes) y uno WebP.
- [ ] Probar a mano en el Preview la imagen de la historia (`/panel/complejos/{id}/historia/imagen`): en Vercel lee las fuentes con fs (`outputFileTracingIncludes`) y, con un logo WebP, usa `sharp`. En local anda; en Vercel falta confirmarlo.
- [ ] Variables: el rediseño no agrega ninguna. Producción ya tiene `NEXT_PUBLIC_APP_URL` y las `MP_*`. En Preview falta `NEXT_PUBLIC_APP_URL` (el pago online no funciona ahí; no se agrega a Preview por decisión anterior).
- [ ] Los links de Mi turno, el .ics y la historia usan el host del pedido: en producción salen con el dominio final.

Cambios de comportamiento a tener presentes
- [ ] Reservar desde el complejo ahora son 3 toques con datos recordados (turno → Reservar → Confirmar).
- [ ] `/[localidad]` redirige al inicio con la localidad; los links viejos a `/tunuyan/padel` y a los complejos siguen andando.
- [ ] "Seguir en…" ya no existe (lo reemplaza la portada del inicio, que abre la búsqueda recordada).
- [ ] Turnos sin precio ya no se ofrecen como libres ("Consultá").
- [ ] `?_now=` solo funciona fuera de producción (NODE_ENV): confirmado en el código.

Calidad
- [x] `pnpm test` (374) y `pnpm test:e2e --workers=1` (147, en 4 tandas) en verde con la 026 aplicada (2026-11-25). Repetir si entra algo más antes del merge.
- [ ] Lint: quedan 3 errores viejos de `react-hooks/set-state-in-effect` (payment-status-panel, botón de push, guía de PWA), anteriores al rediseño. `next build` no corre lint, así que no bloquean el deploy.
- [x] CLAUDE.md actualizado (Next 16, conteo de tests, migraciones hasta la 025 aplicadas, regla de migraciones).
