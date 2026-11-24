-- ============================================================
-- 023_court_features.sql — Rediseño V2b: etiquetas de la cancha
-- ============================================================
-- Aplica DESPUÉS de 021_security_lockdown.sql (y de 022 si ya está).
-- Correr como postgres. NO aplicada: la revisa y la aplica el revisor.
--
-- Datos para las etiquetas de la lista de complejos y de la portada del
-- complejo ("Sintético · Techada · Iluminada · Vestuario"):
--   surface          superficie, o NULL si el dueño no la cargó
--   covered          techada
--   lit              iluminada
--   has_locker_room  tiene vestuario
--
-- Las canchas existentes quedan con surface NULL y los tres en false: no
-- muestran etiquetas hasta que el dueño las cargue.
--
-- Grants por columna, con el mismo patrón de la 021:
--   · anon y authenticated leen solo estas columnas nuevas (además de las que
--     ya tenían);
--   · el dueño (authenticated) las escribe por el mismo camino que ya usa
--     para la cancha: INSERT/UPDATE directo sobre courts (createCourtAction /
--     updateCourtAction), filtrado por la política RLS courts_owner_all. No
--     hay una RPC panel_* para canchas, así que no hay ninguna que extender.
-- ============================================================

ALTER TABLE public.courts
  ADD COLUMN IF NOT EXISTS surface         text,
  ADD COLUMN IF NOT EXISTS covered         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lit             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_locker_room boolean NOT NULL DEFAULT false;

ALTER TABLE public.courts
  DROP CONSTRAINT IF EXISTS courts_surface_check;
ALTER TABLE public.courts
  ADD CONSTRAINT courts_surface_check
  CHECK (surface IS NULL OR surface IN ('sintetico', 'pasto', 'cemento', 'polvo_ladrillo', 'blindex'));

-- Lectura pública (lista de complejos, página del complejo) y del panel
GRANT SELECT (surface, covered, lit, has_locker_room) ON public.courts TO anon, authenticated;

-- Escritura del dueño: mismo camino que name / slot_minutes / active
GRANT INSERT (surface, covered, lit, has_locker_room) ON public.courts TO authenticated;
GRANT UPDATE (surface, covered, lit, has_locker_room) ON public.courts TO authenticated;
