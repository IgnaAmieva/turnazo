-- ============================================================
-- 029_venue_cover.sql — Foto de portada del complejo
-- ============================================================
-- Aplica DESPUÉS de 028_superadmin.sql. Correr como postgres.
-- ESCRITA, SIN APLICAR (la aplica el revisor).
--
-- venues.cover_path: ruta del archivo DENTRO del bucket 'venue-logos' (no una
-- URL), ej. 'b2c3d4e5-0000-0000-0000-000000000001/cover-1732460000000.jpg'.
-- NULL = sin foto (la página del complejo muestra la portada verde con líneas).
--
-- Igual que logo_path (024):
--   · CHECK: la ruta está en la carpeta del propio complejo ('{id}/...') y no
--     tiene '..'.
--   · Grants por columna (patrón de la 021): anon y authenticated la leen;
--     authenticated la actualiza (la política RLS de venues limita la fila a
--     los complejos del dueño).
--
-- Bucket: se reusa 'venue-logos' (público, 512 KB, PNG/JPEG/WebP). La app
-- achica la foto en el servidor (sharp, 1600 px como máximo) y la deja por
-- debajo de 500 KB, así que entra en el límite actual. Las políticas por
-- carpeta de la 025 ya dejan al dueño subir, pisar y borrar en '{venue_id}/'.
-- Nada que cambiar en storage.
-- ============================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS cover_path text;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_cover_path_check;
ALTER TABLE public.venues
  ADD CONSTRAINT venues_cover_path_check CHECK (
    cover_path IS NULL
    OR (cover_path LIKE id::text || '/%' AND cover_path NOT LIKE '%..%')
  );

GRANT SELECT (cover_path) ON public.venues TO anon, authenticated;
GRANT UPDATE (cover_path) ON public.venues TO authenticated;
