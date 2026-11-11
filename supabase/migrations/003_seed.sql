-- ============================================================
-- 003_seed.sql — Datos iniciales
-- ============================================================

insert into localities (name, slug) values
  ('Tunuyán',     'tunuyan'),
  ('San Carlos',  'san-carlos'),
  ('Tupungato',   'tupungato'),
  ('La Consulta', 'la-consulta');

insert into sports (name, slug, default_slot_minutes) values
  ('Pádel',   'padel',   90),
  ('Fútbol',  'futbol',  60),
  ('Tenis',   'tenis',   60);
