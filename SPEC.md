# SPEC — App de turnos de canchas del Valle de Uco

> Nombre provisorio: **Turnazo** (a confirmar). Usar una constante `APP_NAME` para poder cambiarlo en un solo lugar.

## 1. Qué es

Una app web instalable (PWA) donde cualquier persona ve las canchas de pádel, fútbol y tenis del Valle de Uco, mira qué horarios están libres y pide un turno sin registrarse. Cada dueño de complejo tiene un panel para gestionar sus canchas, turnos y cobros.

Objetivo de calidad: arquitectura de nivel senior, sin doble reserva posible, datos aislados por complejo y preparada para mucho tráfico simultáneo.

## 2. Roles

| Rol | Se registra | Qué hace |
|---|---|---|
| **Jugador** | No. Solo nombre y teléfono al pedir | Busca, ve disponibilidad, pide, paga y cancela turnos |
| **Dueño** | Sí (email y contraseña) | Carga su complejo, canchas, horarios, precios, política de seña; ve y gestiona turnos |
| **Superadmin** | Sí (cuenta única del creador) | Aprueba o suspende complejos, ve métricas y comisiones |

## 3. Stack

- **Frontend y backend:** Next.js (App Router) + TypeScript estricto + Tailwind. Server Actions / Route Handlers para toda escritura.
- **Base de datos:** Supabase (Postgres, Auth, Realtime, Row Level Security).
- **Hosting:** Vercel.
- **PWA:** manifest + service worker + Web Push (VAPID).
- **Pagos:** Mercado Pago en modo marketplace (OAuth por dueño + Checkout Pro + webhooks).
- **Mapa:** Leaflet + OpenStreetMap (gratis) y botón "Cómo llegar" que abre Google Maps con las coordenadas.
- **Validación:** Zod en todos los inputs, del lado del servidor.
- **Errores y monitoreo:** Sentry.
- **Zona horaria:** guardar todo en UTC (`timestamptz`), mostrar en `America/Argentina/Mendoza`.

Antes de implementar pagos, **leer la documentación vigente de Mercado Pago** (OAuth, Checkout Pro en marketplace, webhooks y reembolsos) y seguirla; no asumir nombres de parámetros de memoria.

## 4. Navegación del jugador

1. Elige **localidad**: Tunuyán, San Carlos, Tupungato, La Consulta.
2. Elige **deporte**: pádel, fútbol, tenis.
3. Ve la lista de **complejos** de esa combinación, con cantidad de canchas, dirección y mapa.
4. Entra a un complejo y ve sus **canchas**, cada una con su **calendario** del día (navegable por fecha): horarios libres y ocupados.
5. Toca un horario libre, carga **nombre y teléfono** y elige cómo pagar entre las opciones que habilitó el dueño.
6. Ve la pantalla de confirmación con el detalle, lo que pagó, lo que falta pagar en la cancha y un link para **cancelar**.

Las localidades y deportes son tablas, no valores fijos en el código, para poder sumar más sin tocar la app.

## 5. Modelo de datos

Todas las tablas con `id uuid`, `created_at`, `updated_at`. Migraciones versionadas en `supabase/migrations`.

- **localities**: `name`, `slug`.
- **sports**: `name`, `slug`, `default_slot_minutes`.
- **profiles**: usuario de Supabase Auth + `role` (`owner` | `superadmin`).
- **venues** (complejos): `owner_id`, `name`, `phone`, `address`, `lat`, `lng`, `locality_id`, `status` (`pending` | `approved` | `suspended`), `payment_alias`, `payment_link`, `whatsapp_template`, y la política de cobro:
  - `deposit_required` (bool)
  - `deposit_type` (`fixed` | `percent`) y `deposit_value`
  - `allow_full_payment` (bool)
  - `allow_pay_at_venue` (bool; solo válido si `deposit_required = false`)
  - `cancel_limit_hours` y `refund_policy` (`full` | `none`)
- **courts**: `venue_id`, `sport_id`, `name`, `slot_minutes`, `active`.
- **court_hours**: `court_id`, `weekday` (0–6), `open_time`, `close_time`. Permite varios tramos por día.
- **court_prices**: `court_id`, `weekday`, `from_time`, `to_time`, `price`. Para precio distinto de noche y fin de semana.
- **bookings**: una sola tabla para turnos y bloqueos.
  - `court_id`, `venue_id`, `period tstzrange`
  - `kind` (`booking` | `block`)
  - `source` (`app` | `manual`)
  - `status` (`hold` | `confirmed` | `cancelled` | `expired` | `completed` | `no_show`)
  - `customer_name`, `customer_phone`
  - `price_total`, `deposit_amount`, `amount_paid`
  - `payment_status` (`unpaid` | `deposit_paid` | `paid` | `refunded`)
  - `hold_expires_at`, `cancel_token` (aleatorio, único), `recurring_id`
- **recurring_bookings** (turnos fijos): `court_id`, `weekday`, `start_time`, `customer_name`, `customer_phone`, `active`.
- **mp_accounts**: `venue_id` (único), `mp_user_id`, `access_token` y `refresh_token` **cifrados**, `expires_at`.
- **payments**: `booking_id`, `mp_payment_id` (único), `mp_preference_id`, `amount`, `type` (`deposit` | `full`), `status`, `platform_fee`, `raw` (jsonb).
- **webhook_events**: `provider`, `event_id` (único), `processed_at`. Para no procesar dos veces el mismo aviso.
- **push_subscriptions**: `profile_id`, `endpoint` (único), claves.
- **notification_outbox**: `venue_id`, `type`, `payload`, `status`, `attempts`, `next_attempt_at`.
- **blocked_phones**: `venue_id`, `phone`.
- **audit_log**: quién hizo qué y cuándo en el panel.

### Regla anti doble reserva (obligatoria, a nivel base de datos)

```sql
create extension if not exists btree_gist;

alter table bookings add constraint no_overlap
  exclude using gist (court_id with =, period with &&)
  where (status in ('hold', 'confirmed'));
```

La app nunca decide sola si un horario está libre: intenta insertar y, si la base rechaza, muestra "ese horario se acaba de ocupar". Incluir un test de concurrencia que lance muchas reservas simultáneas al mismo horario y verifique que entra una sola.

Índices mínimos: `bookings (court_id, period)` gist, `bookings (venue_id, status)`, `bookings (hold_expires_at) where status = 'hold'`, `courts (venue_id)`, `venues (locality_id, status)`.

## 6. Reglas de negocio

### Pedir un turno

- **Sin seña** (`deposit_required = false`): el turno se crea directamente `confirmed`, `payment_status = unpaid`. Se paga en la cancha.
- **Con seña** (`deposit_required = true`): el turno se crea en `hold` con `hold_expires_at = ahora + 10 min` y se redirige a Mercado Pago. Solo pasa a `confirmed` cuando llega el aviso de pago aprobado. Sin pago, no hay turno.
- **Pago completo** (`allow_full_payment = true`): igual que con seña pero por el total; queda `payment_status = paid`.
- El monto de la seña **se descuenta del total**. Mostrar siempre "Pagaste $X — te falta pagar $Y en la cancha".
- El precio y la seña se calculan **en el servidor**; nunca confiar en montos que mande el navegador.
- No se pueden pedir horarios pasados ni fuera del horario cargado de la cancha.
- Si el teléfono está en `blocked_phones` de ese complejo, se rechaza el pedido.

### Vencimiento de la reserva temporal

- Un proceso programado (Supabase cron cada minuto) pasa a `expired` los `hold` vencidos.
- Si el pago llega después de vencido y el horario sigue libre, se confirma; si ya lo tomó otro, se **reembolsa automáticamente** y se registra.

### Cancelación

- El jugador cancela desde su link con `cancel_token`, hasta `cancel_limit_hours` antes del turno.
- Si había pagado, se aplica `refund_policy` del complejo.
- El dueño puede cancelar cualquier turno desde el panel.

### Bloqueos manuales

- El dueño marca un horario como ocupado (`kind = block`, `source = manual`), por ejemplo cuando se lo pidieron por fuera de la app. Puede cargar nombre y teléfono opcionales.
- También puede cargar **turnos fijos semanales**; un proceso genera los turnos de las próximas semanas.

## 7. Mercado Pago

- La cuenta del creador de la app es la **aplicación marketplace**. Cada dueño **conecta su propia cuenta** desde el panel con un botón (OAuth): inicia sesión en Mercado Pago, autoriza y vuelve.
- Los cobros se crean **con el token del dueño**, así la plata entra directo a su cuenta.
- La comisión de la plataforma es un valor configurable (`PLATFORM_FEE_PERCENT`), **por defecto 0**.
- Si el complejo no tiene cuenta conectada, no puede activar seña ni pago completo: queda en modo sin seña y se muestran su alias o link de pago como dato informativo.
- **Webhooks:** validar la firma, guardar el `event_id` en `webhook_events` y descartar repetidos, consultar el pago a la API de Mercado Pago antes de confirmar, y hacer todo dentro de una transacción.
- La pantalla de vuelta del pago **no confirma nada**: solo muestra el estado y espera (por Realtime o consulta) a que el webhook confirme.
- Renovar los tokens de los dueños antes de que venzan.

## 8. Panel del dueño

- **Registro y alta del complejo:** nombre, teléfono, dirección, ubicación en el mapa (pin arrastrable), localidad. Queda `pending` hasta que el superadmin aprueba.
- **Canchas:** alta, deporte, duración del turno, horarios por día, precios por franja.
- **Agenda:** vista por día con todas las canchas en columnas. Cada turno muestra nombre, teléfono y estado de pago: **pagado**, **señado** (con lo que falta cobrar) o **sin pagar**.
- **Acciones sobre un turno:** cancelar, marcar como pagado en cancha, marcar ausente, bloquear teléfono.
- **Botón de WhatsApp** en cada turno: abre `https://wa.me/<teléfono>?text=<mensaje>` con la plantilla del complejo ya completada (nombre, cancha, día, hora). El dueño solo toca enviar.
- **Cobros:** conectar o desconectar Mercado Pago, elegir sin seña o con seña, monto fijo o porcentaje, permitir pago completo, política de cancelación.
- **Estadísticas:** ocupación por cancha y franja, ingresos del mes, turnos cancelados y ausentes.

## 9. Notificaciones push (solo para el dueño)

- Eventos: turno nuevo, pago recibido, turno cancelado.
- Cada evento se escribe en `notification_outbox` dentro de la misma transacción; un proceso los envía con reintentos y espera creciente.
- En iPhone, las notificaciones solo funcionan si el dueño **instala la app en la pantalla de inicio**: mostrar una guía de instalación en el primer ingreso al panel.
- El jugador no recibe push; ve la confirmación en pantalla.

## 10. Seguridad

- **Row Level Security en todas las tablas.** Un dueño solo lee y modifica filas de sus complejos. El público solo lee complejos `approved`, canchas activas y disponibilidad.
- La disponibilidad pública se expone con una vista o función que devuelve **solo horarios ocupados, sin nombre ni teléfono**.
- Tokens de Mercado Pago cifrados y nunca enviados al navegador. Claves de servicio solo en el servidor.
- Límite de pedidos por IP y por teléfono para frenar abuso.
- `cancel_token` largo y aleatorio; nunca ids adivinables en links públicos.
- Registrar en `audit_log` las acciones del panel.

## 11. Rendimiento y escalabilidad

- Páginas públicas (localidades, deportes, complejos) cacheadas y revalidadas al cambiar datos.
- La disponibilidad se consulta por cancha y rango de fechas, con índices; se actualiza en vivo por Supabase Realtime.
- Toda operación que cambia un turno va en una transacción (funciones de Postgres llamadas por RPC).
- Procesos en segundo plano idempotentes: se pueden ejecutar dos veces sin romper nada.
- Pensado multi-tenant desde el día uno: sumar complejos, localidades o deportes no requiere cambios de código.

## 12. Horarios por defecto (editables por cada dueño)

| Deporte | Duración | Grilla sugerida |
|---|---|---|
| Pádel | 90 min | 8:00, 9:30, 11:00, 12:30, 14:00, 15:30, 17:00, 18:30, 20:00, 21:30, 23:00 |
| Fútbol | 60 min | En punto, de 14:00 a 00:00 |
| Tenis | 60 min (opción 90) | En punto, de 8:00 a 23:00 |

## 13. Calidad

- Tests unitarios de las reglas de negocio (cálculo de seña, cancelación, vencimiento).
- Test de concurrencia de doble reserva.
- Tests de extremo a extremo de los dos flujos principales: pedir sin seña y pedir con seña (Mercado Pago en modo prueba).
- Lint, chequeo de tipos y tests en cada push (GitHub Actions).
- Variables de entorno documentadas en `.env.example`. Entornos separados de prueba y producción.

## 14. Fases de construcción

Construir en este orden, dejando cada fase funcionando y testeada antes de pasar a la siguiente:

1. **Base:** proyecto, esquema completo, RLS, datos semilla (4 localidades, 3 deportes), test de doble reserva.
2. **Parte pública:** navegación localidad → deporte → complejo → cancha → calendario en vivo, mapa.
3. **Pedido sin seña y cancelación** por link.
4. **Panel del dueño:** registro, alta de complejo y canchas, agenda, bloqueos manuales, botón de WhatsApp.
5. **Push** al dueño e instalación como PWA.
6. **Mercado Pago:** conexión por OAuth, seña, pago completo, webhooks, reembolsos, vencimiento de reservas temporales.
7. **Superadmin, turnos fijos, estadísticas.**
8. **Endurecimiento:** límites de uso, Sentry, pruebas de carga, revisión de seguridad.

## 15. Fuera de la primera versión (dejar la arquitectura abierta)

- Verificación del teléfono por código (WhatsApp o SMS). Pendiente de decisión por costo; si se suma, solo para pedidos sin seña y una vez por teléfono.
- Envío automático de WhatsApp por la API oficial.
- Recordatorios al jugador.
- Otros medios de pago.

## 16. Decisiones pendientes del dueño del proyecto

- Nombre definitivo de la app y dominio.
- Si la plataforma cobra comisión y cuánto.
- Si se activa la verificación del teléfono.
