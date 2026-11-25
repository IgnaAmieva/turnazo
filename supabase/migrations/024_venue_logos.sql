-- ============================================================
-- 024_venue_logos.sql — Logo del club (historias y portada del complejo)
-- ============================================================
-- Aplica DESPUÉS de 023_court_features.sql. Correr como postgres.
-- APLICADA por el revisor. Este archivo es igual a lo aplicado.
--
-- ⚠ Las políticas de storage.objects de este archivo tienen un error: dentro
--   del EXISTS, "name" sin calificar se resuelve como venues.name (el nombre
--   del complejo), no como storage.objects.name (la ruta del archivo). Nadie
--   puede subir, pisar, leer ni borrar logos (tampoco el dueño). Lo corrige
--   025_venue_logos_policies_fix.sql.
--
-- 1. venues.logo_path: ruta del archivo DENTRO del bucket (no una URL),
--    ej. 'b2c3d4e5-0000-0000-0000-000000000001/logo-1732460000000.png'.
--    NULL = sin logo (la app muestra las iniciales del club en un círculo).
--    Grants por columna, con el patrón de la 021:
--      · anon y authenticated la leen;
--      · authenticated la actualiza (el dueño; la política RLS de venues
--        limita la fila a sus complejos).
--    venues_logo_path_check: la ruta tiene que estar en la carpeta del propio
--    complejo ('{id}/...') y no puede tener '..'.
--
-- 2. Bucket público 'venue-logos': 512 KB como máximo y solo PNG, JPEG o
--    WebP. Storage rechaza lo demás por el Content-Type declarado; además la
--    app valida en el servidor el tipo REAL del archivo (bytes iniciales:
--    PNG 89 50 4E 47, JPEG FF D8 FF, WebP RIFF....WEBP) antes de subirlo.
--    Los logos se muestran por la URL pública del bucket
--    (/storage/v1/object/public/...), que no necesita política de SELECT.
--
-- 3. Políticas en storage.objects para ese bucket, todas solo para
--    authenticated y solo si la primera carpeta de la ruta
--    ((storage.foldername(name))[1]) es el id de un venue cuyo
--    owner_id = auth.uid():
--      · SELECT (nadie puede listar el bucket; el dueño ve su carpeta, lo
--        que también cubre leer el objeto en un upsert);
--      · INSERT / UPDATE / DELETE.
-- ============================================================


-- ── 1. Columna ───────────────────────────────────────────────────────────

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS logo_path text;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_logo_path_check;
ALTER TABLE public.venues
  ADD CONSTRAINT venues_logo_path_check CHECK (
    logo_path IS NULL
    OR (logo_path LIKE id::text || '/%' AND logo_path NOT LIKE '%..%')
  );

GRANT SELECT (logo_path) ON public.venues TO anon, authenticated;
GRANT UPDATE (logo_path) ON public.venues TO authenticated;


-- ── 2. Bucket ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('venue-logos', 'venue-logos', true, 524288, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── 3. Políticas ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS venue_logos_public_read  ON storage.objects;
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
      WHERE v.id::text = (storage.foldername(name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY venue_logos_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'venue-logos'
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id::text = (storage.foldername(name))[1]
        AND v.owner_id = (SELECT auth.uid())
    )
  );
