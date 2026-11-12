-- ============================================================
-- 010_drop_profiles_insert_self.sql
-- ============================================================
-- Perfil creado únicamente por trigger handle_new_user; ningún
-- usuario autenticado debe poder insertar su propio perfil.
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

-- Permite a dueños registrar en audit_log acciones de su complejo
CREATE POLICY "audit_log_owner_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    AND profile_id = auth.uid()
  );
