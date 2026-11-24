-- ============================================================
-- 024_venue_logos.sql — Logo del club (historias y portada del complejo)
-- ============================================================
-- Aplica DESPUÉS de 023_court_features.sql. Correr como postgres.
-- NO aplicada: la revisa y la aplica el revisor.
--
-- 1. venues.logo_path: ruta del archivo DENTRO del bucket (no una URL),
--    ej. 'b2c3d4e5-0000-0000-0000-000000000001/logo.png'. NULL = sin logo
--    (la app muestra las iniciales del club en un círculo).
--    Grants por columna, con el patrón de la 021:
--      · anon y authenticated la leen;
--      · authenticated la actualiza (el dueño, por updateVenueAction; la
--        política RLS de venues limita la fila a sus complejos).
--
-- 2. Bucket público 'venue-logos': lectura pública (la web y la imagen de
--    la historia lo cargan por URL), 512 KB como máximo y solo PNG, JPEG o
--    WebP. Storage rechaza lo demás por el Content-Type declarado; además la
--    app valida en el servidor el tipo REAL del archivo (bytes iniciales:
--    PNG 89 50 4E 47, JPEG FF D8 FF, WebP RIFF....WEBP) antes de subirlo.
--
-- 3. Políticas en storage.objects para ese bucket:
--      · SELECT: cualquiera (bucket público);
--      · INSERT / UPDATE / DELETE: solo authenticated, y solo si la primera
--        carpeta de la ruta ((storage.foldername(name))[1]) es el id de un
--        venue cuyo owner_id = auth.uid(). Nadie puede subir, pisar ni
--        borrar el logo de otro complejo.
--    La comparación es por texto (v.id::text): un nombre de carpeta que no
--    sea un uuid simplemente no coincide con ningún venue (no da error).
-- ============================================================


-- ── 1. Columna ───────────────────────────────────────────────────────────

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS logo_path text;

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
DROP POLICY IF EXISTS venue_logos_owner_insert ON storage.objects;
DROP POLICY IF EXISTS venue_logos_owner_update ON storage.objects;
DROP POLICY IF EXISTS venue_logos_owner_delete ON storage.objects;

CREATE POLICY venue_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'venue-logos');

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
