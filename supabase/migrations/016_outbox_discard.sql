-- ============================================================
-- 016_outbox_discard.sql
--
-- 1. Agrega 'discarded' al enum notification_status.
--    Los avisos que apuntan a una reserva inexistente o tienen más
--    de 24 horas se marcan con este estado (lib/push.ts).
-- 2. Agrega política DELETE para dueños en notification_outbox.
--    Permite a los tests e2e limpiar los avisos del venue fixture.
-- ============================================================

-- 1. Nuevo valor del enum
ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'discarded';

-- 2. DELETE policy para dueños
CREATE POLICY "notif_outbox_owner_delete" ON public.notification_outbox
  FOR DELETE
  USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );
