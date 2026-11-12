-- ============================================================
-- 013_audit_log_owner_insert.sql
-- Allow owners to INSERT into audit_log for their own venues.
-- (The table already has audit_log_owner_read for SELECT.)
-- ============================================================

CREATE POLICY "audit_log_owner_insert" ON public.audit_log
  FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND (
      venue_id IS NULL
      OR venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    )
  );
