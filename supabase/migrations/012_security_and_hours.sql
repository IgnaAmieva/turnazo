-- ============================================================
-- 012_security_and_hours.sql
-- 1. REVOKE EXECUTE de handle_new_user() a PUBLIC, anon, authenticated
--    La función sólo necesita ejecutarse como trigger (propietario del DB)
-- 2. DROP constraint open_before_close en court_hours
--    Permite horarios que cruzan medianoche (ej. pádel 08:00-00:30)
-- ============================================================

-- 1. Revocar EXECUTE de la función trigger al público
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- 2. Eliminar la restricción que impedía horarios que cruzan medianoche
ALTER TABLE public.court_hours
  DROP CONSTRAINT IF EXISTS open_before_close;
