-- ============================================================
-- 025_venue_logos_policies_fix.sql — Corrige las políticas de la 024
-- ============================================================
-- Aplica DESPUÉS de 024_venue_logos.sql. Correr como postgres.
-- NO aplicada: la revisa y la aplica el revisor.
--
-- Error de la 024: en
--   EXISTS (SELECT 1 FROM public.venues v
--           WHERE v.id::text = (storage.foldername(name))[1] ...)
-- "name" sin calificar se resuelve contra la tabla más cercana, venues, que
-- también tiene una columna name. pg_policies lo muestra así:
--   storage.foldername(v.name)
-- Se compara el id del complejo con la carpeta del NOMBRE del complejo, que
-- nunca coincide: nadie puede subir, pisar, leer ni borrar logos (el dueño de
-- prueba recibe "new row violates row-level security policy" al subir a la
-- carpeta de su propio complejo).
--
-- Corrección: calificar la columna como objects.name. El resto queda igual
-- (mismos nombres, roles y condiciones; SELECT solo para el dueño, como lo
-- dejó el revisor).
--
-- Comprobado sin escribir (SELECT con la expresión corregida y rutas de
-- ejemplo): '{id del complejo de prueba}/logo-1.png' → true para su dueño;
-- '{otro uuid}/logo.png' y 'logo.png' → false.
-- ============================================================

DROP POLICY IF EXISTS venue_logos_owner_select ON storage.objects;
DROP POLICY IF EXISTS venue_logos_owner_insert ON storage.objects;
DROP POLICY IF EXISTS venue_logos_owner_update ON storage.objects;
DROP POLICY IF EXISTS venue_logos_owner_delete ON storage.objects;

CREATE POLICY venue_logos_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(objects.name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(objects.name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(objects.name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(objects.name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(objects.name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );
