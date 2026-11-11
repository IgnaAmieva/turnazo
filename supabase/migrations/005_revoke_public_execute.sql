-- ============================================================
-- 005_revoke_public_execute.sql
-- Revoca EXECUTE de PUBLIC en funciones internas.
-- ============================================================

-- set_updated_at: solo la invocan triggers
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;
grant  execute on function public.set_updated_at() to postgres, service_role;

-- auth_role: función interna de RLS, no expuesta por REST
revoke execute on function public.auth_role() from public;
revoke execute on function public.auth_role() from anon;
revoke execute on function public.auth_role() from authenticated;
grant  execute on function public.auth_role() to postgres, service_role;

-- get_court_availability: API pública del calendario
-- Se revoca PUBLIC (muy amplio) y se otorga explícitamente a anon.
revoke execute on function public.get_court_availability(uuid, timestamptz, timestamptz) from public;
grant  execute on function public.get_court_availability(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
