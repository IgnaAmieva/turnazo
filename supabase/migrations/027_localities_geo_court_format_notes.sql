-- ============================================================
-- 027_localities_geo_court_format_notes.sql
-- Inicio por cercanía, formato de fútbol y aclaraciones de la cancha
-- ============================================================
-- Aplica DESPUÉS de 026. Correr como postgres. NO aplicada: la revisa y la
-- aplica el revisor.
--
-- 1. localities.lat / lng: centro de la localidad, para elegir sola la más
--    cercana en el inicio y ordenar la lista por distancia. Las 4 existentes
--    se cargan con el centroide oficial de la API Georef
--    (apis.datos.gob.ar/georef/api/localidades, provincia Mendoza,
--    "Localidad simple"). Después quedan NOT NULL: toda localidad nueva se
--    crea con su centro (ver la propuesta de creación en ESTADO.md).
--
-- 2. courts.format: futbol_5 | futbol_6 | futbol_7 | futbol_9 | futbol_11 |
--    futsal, o NULL. Solo para canchas de fútbol: el CHECK valida los
--    valores y un trigger rechaza un formato en una cancha de pádel o tenis
--    (el deporte está en otra tabla, un CHECK no lo puede ver). Las canchas
--    existentes quedan con NULL (hoy hay una sola de fútbol, la de futmates):
--    el dueño la elige en el panel.
--
-- 3. courts.notes: aclaraciones libres del dueño ("piso de baldosa", "red
--    nueva"), 200 caracteres como máximo. Se muestran escapadas como texto.
--
-- Grants por columna, con el patrón de la 021/023:
--   · anon y authenticated leen las columnas nuevas;
--   · el dueño escribe format y notes por el mismo camino que el resto de la
--     cancha (INSERT/UPDATE directo filtrado por courts_owner_all);
--   · NADIE salvo postgres/service_role escribe en localities: no hay grants
--     de INSERT/UPDATE para anon ni authenticated (como hasta ahora).
-- ============================================================

-- ── 1. Centro de la localidad ─────────────────────────────────────────────
ALTER TABLE public.localities
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

UPDATE public.localities SET lat = -33.5812532, lng = -69.0153686 WHERE slug = 'tunuyan';
UPDATE public.localities SET lat = -33.7720666, lng = -69.0403915 WHERE slug = 'san-carlos';
UPDATE public.localities SET lat = -33.3728409, lng = -69.1475743 WHERE slug = 'tupungato';
UPDATE public.localities SET lat = -33.7338472, lng = -69.1198853 WHERE slug = 'la-consulta';

-- Si quedó alguna sin centro (otra localidad que no está en esta lista), la
-- migración se corta acá en vez de dejar un NOT NULL a medias.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.localities WHERE lat IS NULL OR lng IS NULL) THEN
    RAISE EXCEPTION 'Hay localidades sin lat/lng: cargarlas antes de seguir';
  END IF;
END $$;

ALTER TABLE public.localities
  ALTER COLUMN lat SET NOT NULL,
  ALTER COLUMN lng SET NOT NULL;

ALTER TABLE public.localities DROP CONSTRAINT IF EXISTS localities_lat_lng_check;
ALTER TABLE public.localities
  ADD CONSTRAINT localities_lat_lng_check
  CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);

GRANT SELECT (lat, lng) ON public.localities TO anon, authenticated;

-- ── 2. Formato de la cancha de fútbol ─────────────────────────────────────
ALTER TABLE public.courts
  ADD COLUMN IF NOT EXISTS format text;

ALTER TABLE public.courts DROP CONSTRAINT IF EXISTS courts_format_check;
ALTER TABLE public.courts
  ADD CONSTRAINT courts_format_check
  CHECK (format IS NULL OR format IN ('futbol_5', 'futbol_6', 'futbol_7', 'futbol_9', 'futbol_11', 'futsal'));

CREATE OR REPLACE FUNCTION public.enforce_court_format()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.format IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sports s WHERE s.id = NEW.sport_id AND s.slug = 'futbol'
  ) THEN
    RAISE EXCEPTION 'format_only_futbol' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_court_format() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS courts_enforce_format ON public.courts;
CREATE TRIGGER courts_enforce_format
  BEFORE INSERT OR UPDATE OF format, sport_id ON public.courts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_court_format();

-- ── 3. Aclaraciones de la cancha ──────────────────────────────────────────
ALTER TABLE public.courts
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.courts DROP CONSTRAINT IF EXISTS courts_notes_check;
ALTER TABLE public.courts
  ADD CONSTRAINT courts_notes_check
  CHECK (notes IS NULL OR char_length(notes) <= 200);

-- ── Grants de courts ──────────────────────────────────────────────────────
GRANT SELECT (format, notes) ON public.courts TO anon, authenticated;
GRANT INSERT (format, notes) ON public.courts TO authenticated;
GRANT UPDATE (format, notes) ON public.courts TO authenticated;
