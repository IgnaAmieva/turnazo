-- 028_superadmin.sql — Panel de superadmin (rama superadmin)
--
-- Lo que ya existía y se reutiliza:
--   - public.auth_role() (SECURITY DEFINER, lee profiles.role de auth.uid()).
--   - Políticas *_superadmin_all en venues, courts, bookings, payments,
--     mp_accounts, audit_log y profiles_superadmin_read.
--   - trg_venues_status (021): solo superadmin o el servidor cambian
--     venues.status. Igual `authenticated` no tiene UPDATE(status): el cambio
--     de estado va SOLO por superadmin_set_venue_status (abajo), que corre como
--     dueño de la función (postgres) y por eso el trigger lo deja pasar.
--
-- Lo nuevo:
--   1. Estado 'rejected' (rechazado, con motivo) y columnas status_reason /
--      status_changed_at en venues (el dueño las ve en su panel).
--   2. is_superadmin(): para que el servidor verifique el rol (profiles no
--      tiene grants para authenticated desde la 021).
--   3. superadmin_venues(p_status): lista con dueño (mail de auth.users),
--      localidad, teléfono, alta, si conectó Mercado Pago y cantidad de canchas.
--   4. superadmin_summary(): complejos por estado, reservas de los últimos
--      7 días y dueños nuevos de los últimos 7 días.
--   5. superadmin_set_venue_status(): aprobar / rechazar (motivo obligatorio)
--      / suspender / reactivar, con transiciones válidas, fila en audit_log y
--      aviso por push al dueño (notification_outbox) al aprobar o rechazar,
--      todo en la misma transacción.
--   6. Lectura de horarios y precios de complejos no aprobados para el
--      superadmin (detalle del complejo pendiente).
--
-- Todas las funciones rechazan a quien no sea superadmin (errcode 42501,
-- mensaje 'forbidden'), aunque la llamen con la clave anon o la de un dueño.

-- ── 1. Estado rechazado ─────────────────────────────────────────────────
-- ADD VALUE no se puede usar en la misma transacción: abajo solo aparece
-- como texto dentro de funciones plpgsql (se resuelve al ejecutar).
ALTER TYPE public.venue_status ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS status_reason     text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- El dueño ve el motivo en su panel; nadie lo escribe directo (va por la función).
GRANT SELECT (status_reason, status_changed_at) ON public.venues TO authenticated;

-- ── 2. ¿Es superadmin? ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce((SELECT role = 'superadmin' FROM public.profiles WHERE id = auth.uid()), false)
$fn$;

REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;

-- ── 3. Lista de complejos ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.superadmin_venues(p_status text DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  name              text,
  status            text,
  status_reason     text,
  status_changed_at timestamptz,
  owner_id          uuid,
  owner_email       text,
  phone             text,
  locality_name     text,
  created_at        timestamptz,
  mp_connected      boolean,
  courts_count      integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'forbidden';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved', 'suspended', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_status';
  END IF;

  RETURN QUERY
  SELECT v.id, v.name, v.status::text, v.status_reason, v.status_changed_at,
         v.owner_id, u.email::text, v.phone, l.name, v.created_at,
         EXISTS (SELECT 1 FROM public.mp_accounts m WHERE m.venue_id = v.id),
         (SELECT count(*)::int FROM public.courts c WHERE c.venue_id = v.id)
  FROM public.venues v
  LEFT JOIN auth.users u       ON u.id = v.owner_id
  LEFT JOIN public.localities l ON l.id = v.locality_id
  WHERE p_status IS NULL OR v.status::text = p_status
  ORDER BY (v.status::text = 'pending') DESC, v.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION public.superadmin_venues(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_venues(text) TO authenticated;

-- ── 4. Resumen ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.superadmin_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_by_status jsonb;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'forbidden';
  END IF;

  SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) INTO v_by_status
  FROM (SELECT status::text s, count(*) n FROM public.venues GROUP BY 1) t;

  RETURN jsonb_build_object(
    'venues_by_status', v_by_status,
    -- Reservas creadas en los últimos 7 días (sin bloqueos ni holds sin pagar)
    'bookings_7d', (SELECT count(*) FROM public.bookings b
                    WHERE b.kind = 'booking' AND b.created_at >= now() - interval '7 days'
                      AND b.status::text NOT IN ('hold', 'expired')),
    'new_owners_7d', (SELECT count(*) FROM public.profiles p
                      WHERE p.role = 'owner' AND p.created_at >= now() - interval '7 days')
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.superadmin_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_summary() TO authenticated;

-- ── 5. Cambiar el estado ────────────────────────────────────────────────
-- p_action: 'approve' (desde pendiente, rechazado o suspendido),
--           'reject'  (desde pendiente; motivo obligatorio, 5 a 500 caracteres),
--           'suspend' (desde aprobado; motivo opcional),
--           'reactivate' (desde suspendido).
-- Devuelve {ok, old_status, new_status} o {error}.
CREATE OR REPLACE FUNCTION public.superadmin_set_venue_status(
  p_venue_id uuid,
  p_action   text,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_old    text;
  v_name   text;
  v_new    text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'forbidden';
  END IF;

  SELECT v.status::text, v.name INTO v_old, v_name
  FROM public.venues v WHERE v.id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'venue_not_found');
  END IF;

  v_new := CASE
    WHEN p_action = 'approve'    AND v_old IN ('pending', 'rejected', 'suspended') THEN 'approved'
    WHEN p_action = 'reject'     AND v_old = 'pending'   THEN 'rejected'
    WHEN p_action = 'suspend'    AND v_old = 'approved'  THEN 'suspended'
    WHEN p_action = 'reactivate' AND v_old = 'suspended' THEN 'approved'
  END;
  IF v_new IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_transition', 'old_status', v_old);
  END IF;

  IF p_action = 'reject' AND (v_reason IS NULL OR char_length(v_reason) < 5) THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('error', 'reason_too_long');
  END IF;

  UPDATE public.venues
     SET status            = v_new::public.venue_status,
         status_reason     = CASE WHEN v_new IN ('rejected', 'suspended') THEN v_reason END,
         status_changed_at = now()
   WHERE id = p_venue_id;

  INSERT INTO public.audit_log (profile_id, venue_id, entity, entity_id, action, old_data, new_data)
  VALUES (auth.uid(), p_venue_id, 'venue', p_venue_id, 'venue_' || p_action,
          jsonb_build_object('status', v_old),
          jsonb_build_object('status', v_new, 'reason', v_reason));

  -- Push al dueño al aprobar o rechazar (lo manda el envío de siempre)
  IF p_action IN ('approve', 'reject') THEN
    INSERT INTO public.notification_outbox (venue_id, type, payload)
    VALUES (p_venue_id, 'venue_' || CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
            jsonb_build_object('venue_name', v_name, 'reason', v_reason));
  END IF;

  RETURN jsonb_build_object('ok', true, 'old_status', v_old, 'new_status', v_new);
END;
$fn$;

REVOKE ALL ON FUNCTION public.superadmin_set_venue_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_set_venue_status(uuid, text, text) TO authenticated;

-- ── 6. Detalle: horarios y precios de cualquier complejo ────────────────
-- (court_hours_public_read / court_prices_public_read solo muestran aprobados)
DROP POLICY IF EXISTS court_hours_superadmin_read ON public.court_hours;
CREATE POLICY court_hours_superadmin_read ON public.court_hours
  FOR SELECT TO authenticated USING (public.auth_role() = 'superadmin');

DROP POLICY IF EXISTS court_prices_superadmin_read ON public.court_prices;
CREATE POLICY court_prices_superadmin_read ON public.court_prices
  FOR SELECT TO authenticated USING (public.auth_role() = 'superadmin');
