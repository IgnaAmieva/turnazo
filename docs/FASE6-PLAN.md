# Fase 6 — Integración Mercado Pago

Última actualización: 2026-11-13

---

## Contexto

Integración de pagos con Mercado Pago usando **Checkout Pro + API de Orders** (no Preferences).
Cada dueño conecta su propia cuenta MP vía OAuth; los cobros llegan a su cuenta.
La plataforma descuenta `marketplace_fee` automáticamente.

**App creada:** Checkout Pro, API de Orders, ambiente de prueba (sandbox).

**Variables de entorno requeridas:**

| Variable | Descripción |
|---|---|
| `MP_CLIENT_ID` | ID de la app MP |
| `MP_CLIENT_SECRET` | Secret de la app MP (también usado para firmar OAuth state) |
| `MP_REDIRECT_URI` | URL de callback OAuth (`/api/mp/callback`) |
| `MP_WEBHOOK_SECRET` | Secret para verificar firma HMAC de webhooks |
| `MP_TOKEN_ENCRYPTION_KEY` | 32 bytes hex — clave AES-256-GCM para cifrar tokens en DB |
| `PLATFORM_FEE_PERCENT` | Porcentaje de comisión de plataforma (ej. `0.05` = 5%) |

---

## Bloque 1 — OAuth por dueño

### Flujo de conexión

1. El dueño hace clic en "Conectar con Mercado Pago" en `/panel/complejos/[id]`.
2. El servidor genera `state = HMAC-SHA256({ userId, venueId, exp: now+5min }, MP_CLIENT_SECRET)`.
3. Redirige a `https://auth.mercadopago.com.ar/authorization?...&state=...`.
4. MP redirige a `MP_REDIRECT_URI` con `code` y `state`.
5. El servidor verifica la firma HMAC del state y el TTL de 5 min.
6. POST a `https://api.mercadopago.com/oauth/token` → `{ access_token, refresh_token, expires_in, user_id }`.
7. Cifrar `access_token` y `refresh_token` con AES-256-GCM (Node.js `crypto`, `MP_TOKEN_ENCRYPTION_KEY`).
8. UPSERT en `mp_accounts(venue_id, mp_user_id, mp_email, access_token_enc, refresh_token_enc, expires_at)`.

### Seguridad de tokens

- `access_token` y `refresh_token` se almacenan cifrados (AES-256-GCM) en `mp_accounts`.
- `REVOKE SELECT (access_token, refresh_token) ON mp_accounts FROM authenticated, anon` — el navegador nunca puede leer los tokens aunque tenga acceso a la fila.
- `service_role` bypasa tanto RLS como column ACL → el servidor puede descifrar los tokens.
- Función interna `getMpToken(venueId)`: lee de DB, descifra, verifica expiración, refresca si quedan < 1h.

### Desconexión

1. El dueño hace clic en "Desconectar".
2. El servidor verifica que no haya bookings con `payment_status IN ('hold', 'paid')` para ese venue.
   - Si los hay: devolver error "No podés desconectar con pagos activos".
3. DELETE en `mp_accounts` donde `venue_id = venueId`.
4. Revocar el token en MP (best effort, no bloquea si falla).

---

## Bloque 2 — Configuración de cobro

Ya en el schema (columnas de `venues`):
- `deposit_required` boolean
- `deposit_type` enum (`percent` | `fixed`)
- `deposit_value` numeric
- `allow_full_payment` boolean
- `allow_pay_at_venue` boolean
- `cancel_limit_hours` int
- `refund_policy` enum (`full` | `partial` | `none`)

Solo falta la UI en el panel (formulario de edición del complejo). No requiere migración.

---

## Bloque 3 — Flujo de pago (jugador)

### create_booking_hold (nuevo RPC)

```
INPUT: p_court_id, p_date, p_start_time, p_end_time, p_name, p_phone, p_payment_type ('deposit'|'full')
OUTPUT: booking_id, amount_to_pay, currency
```

1. Llama a `_validate_booking_slot()` (función interna compartida, ver Bloque 4).
2. Si hay error → retorna error.
3. Calcula `amount_to_pay` en DB:
   - `'full'` → `price_total`
   - `'deposit'` y `deposit_type = 'percent'` → `ROUND(price_total * deposit_value / 100)`
   - `'deposit'` y `deposit_type = 'fixed'` → `deposit_value`
4. INSERT en `bookings` con `booking_status = 'hold'`, `hold_expires_at = NOW() + INTERVAL '10 minutes'`, `deposit_amount = amount_to_pay`, `payment_status = 'pending'`.
5. Retorna `booking_id`, `amount_to_pay`, `currency = 'ARS'`.

### initiatePayment (Server Action)

1. Llama a `create_booking_hold`.
2. Llama a `getMpToken(venueId)`.
3. POST a `https://api.mercadopago.com/v1/orders` con `Authorization: Bearer {access_token}`:
   - `marketplace_fee = amount * PLATFORM_FEE_PERCENT`
   - `external_reference = booking_id`
   - `notification_url = MP_REDIRECT_URI_BASE/api/mp/webhook`
   - `back_urls.success/failure/pending`
4. INSERT en `payments(booking_id, mp_order_id, amount, type, status='pending', platform_fee, currency='ARS')`.
5. UPDATE `bookings SET mp_order_id = ...`.
6. Retorna `init_point` (URL de pago).
7. `redirect(init_point)`.

---

## Bloque 4 — Expiración de holds

### _validate_booking_slot() (función interna)

```sql
-- RETURNS TABLE(error_code text, price_total numeric, norm_name text, norm_phone text,
--               r_dow int, r_start_time time, r_start_min_eff int, r_prev_day bool,
--               r_deposit_required bool, r_allow_pay_venue bool, r_allow_full bool,
--               r_dep_type text, r_dep_value numeric)
-- REVOKE EXECUTE ON FUNCTION _validate_booking_slot FROM PUBLIC
```

Extrae toda la lógica de validación de `create_booking` v3 (200 líneas):
- Validación de cancha/complejo, horario del día, alineación de slot, exclusión GIST, límite de turnos, teléfono bloqueado.
- Devuelve columnas para que el llamador inserte el booking sin re-leer la DB.

### create_booking v4 (actualización del RPC existente)

- Llama a `_validate_booking_slot()` en lugar de duplicar la lógica.
- Corrige: `deposit_required` y `allow_pay_at_venue` deben leerse del complejo (ya en schema).
- Resultado: misma interfaz pública, mismo comportamiento.

### expire_stale_holds() + pg_cron

```sql
CREATE OR REPLACE FUNCTION expire_stale_holds()
RETURNS void AS $$
  UPDATE bookings
  SET booking_status = 'expired'
  WHERE booking_status = 'hold'
    AND hold_expires_at < NOW();
$$ LANGUAGE sql SECURITY DEFINER;
```

```sql
SELECT cron.schedule('expire-holds', '* * * * *', 'SELECT expire_stale_holds()');
```

(Idempotente: ON CONFLICT DO NOTHING en el schedule.)

### get_court_availability — filtro inline

Excluir holds vencidos sin esperar al cron:

```sql
-- En la query de get_court_availability:
AND NOT (kind = 'hold' AND hold_expires_at < NOW())
```

---

## Bloque 5 — Webhook

### Endpoint: POST /api/mp/webhook

1. **Verificar firma HMAC-SHA256** del header `x-signature` con `MP_WEBHOOK_SECRET`. Si falla → 401.
2. **Idempotencia**: `INSERT INTO webhook_events(provider, event_id, received_at, status, payload) ON CONFLICT DO NOTHING`. Si 0 rows afectadas → ya procesado → 200 OK.
3. **Consultar estado real** del order en MP API (`GET /v1/orders/{id}`). No confiar en el payload.
4. **Verificar monto y moneda**: `order.total_amount == payments.amount && order.currency == 'ARS'`. Si no coincide → marcar payment como `'disputed'` y alertar.
5. **Manejar los 4 casos**:

| Caso | Acción |
|---|---|
| `approved` + hold vigente + slot libre | UPDATE booking: `status='confirmed'`, `payment_status='paid'`; UPDATE payment: `status='approved'`; INSERT outbox (`booking_created`) |
| `approved` + hold vencido o slot tomado | UPDATE booking: `status='expired'`; reembolso automático via MP API; INSERT outbox (`booking_expired_refunded`) |
| `rejected` / `cancelled` | UPDATE payment: `status='rejected'`; UPDATE booking: `status='expired'`; no reembolso |
| `in_process` / `pending` | No hacer nada (esperar próximo webhook) |

6. Retornar 200 OK.

### Fallo de reembolso

Si el reembolso automático falla:
- UPDATE payment: `status='refund_failed'`
- INSERT audit_log: `action='refund_failed'`, `entity='payment'`
- El dueño ve el badge "Reembolso fallido" en la agenda y puede actuar manualmente.

---

## Bloque 6 — Cancelaciones y reembolsos

### Reglas (desde venues.cancel_limit_hours y venues.refund_policy)

```
Si now() < booking.start - cancel_limit_hours:
  → cancelación sin penalidad
  → reembolso según refund_policy:
      'full'    → reembolso 100%
      'partial' → reembolso del deposit, no de la seña
      'none'    → sin reembolso

Si now() >= booking.start - cancel_limit_hours:
  → cancelación tardía → sin reembolso (siempre)
```

### cancel_booking (actualización)

- Recibe `cancel_token` como siempre.
- Si `payment_status = 'paid'`:
  1. Calcular monto a reembolsar según reglas de arriba.
  2. POST a MP API (`/v1/orders/{mp_order_id}/refunds`).
  3. Si falla: UPDATE payment `status='refund_failed'`; retornar error al usuario con mensaje claro.
  4. Si ok: UPDATE payment `status='refunded'`; UPDATE booking `status='cancelled'`.
- Si `payment_status = 'pending'` o booking en `'hold'`: cancelar directamente, sin reembolso.

---

## Bloque 7 — Tests

### Unitarios / integración

- `getMpToken()`: mock de DB + crypto → verificar descifrado y refresh automático.
- `_validate_booking_slot()`: mismos casos que `create_booking` existente.
- `expire_stale_holds()`: insertar hold vencido, ejecutar función, verificar `status='expired'`.
- Webhook handler: mock de firma, mock de MP API query, los 4 casos.
- Cancelación con reembolso: mock de MP API refund, los 3 casos de `refund_policy`.

### E2E (sandbox MP)

- Solo test del redirect: jugador llega al slot → hace clic → llega a la URL de MP sandbox.
  No completar el pago en E2E (MP sandbox requiere login real).
- El resto se cubre con integration tests y mocks.

---

## Migración

`017_phase6_mp.sql` — BORRADOR, ver el archivo de migración.

No aplicar hasta tener el código de la app terminado y revisado.
