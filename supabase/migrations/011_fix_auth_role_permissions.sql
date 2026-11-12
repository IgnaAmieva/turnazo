-- ============================================================
-- 011_fix_auth_role_permissions.sql
-- ============================================================

-- 1. Dar EXECUTE de auth_role() a authenticated (anon no la necesita)
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated;

-- 2. Revocar EXECUTE de handle_new_user() de roles de usuario
--    (es una función de trigger, no debe ser callable directamente)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- 3. Garantizar EXECUTE en RPCs públicas para anon y authenticated
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_by_token(text)
  TO anon, authenticated;

-- 4. Recrear las 8 policies que llaman auth_role() con TO authenticated
--    Así el motor de RLS las omite completamente para usuarios anon.

-- profiles
DROP POLICY IF EXISTS "profiles_superadmin_read" ON public.profiles;
CREATE POLICY "profiles_superadmin_read" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth_role() = 'superadmin');

-- venues
DROP POLICY IF EXISTS "venues_superadmin_all" ON public.venues;
CREATE POLICY "venues_superadmin_all" ON public.venues
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- courts
DROP POLICY IF EXISTS "courts_superadmin_all" ON public.courts;
CREATE POLICY "courts_superadmin_all" ON public.courts
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- bookings
DROP POLICY IF EXISTS "bookings_superadmin_all" ON public.bookings;
CREATE POLICY "bookings_superadmin_all" ON public.bookings
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- recurring_bookings
DROP POLICY IF EXISTS "recurring_superadmin_all" ON public.recurring_bookings;
CREATE POLICY "recurring_superadmin_all" ON public.recurring_bookings
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- mp_accounts
DROP POLICY IF EXISTS "mp_accounts_superadmin_all" ON public.mp_accounts;
CREATE POLICY "mp_accounts_superadmin_all" ON public.mp_accounts
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- payments
DROP POLICY IF EXISTS "payments_superadmin_all" ON public.payments;
CREATE POLICY "payments_superadmin_all" ON public.payments
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');

-- audit_log
DROP POLICY IF EXISTS "audit_log_superadmin_all" ON public.audit_log;
CREATE POLICY "audit_log_superadmin_all" ON public.audit_log
  FOR ALL TO authenticated
  USING (auth_role() = 'superadmin');
