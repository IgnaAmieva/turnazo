-- ============================================================
-- 004_security_hardening.sql
-- Corrige los findings del security advisor de Supabase.
-- ============================================================

-- 1. set_updated_at — search_path fijo
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. auth_role — search_path fijo + revocar a anon y authenticated
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke execute on function public.auth_role() from anon;
revoke execute on function public.auth_role() from authenticated;

-- 3. get_court_availability — search_path fijo
--    anon conserva EXECUTE (intencional: API pública del calendario).
create or replace function public.get_court_availability(
  p_court_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns table (period tstzrange)
language sql
stable
security definer
set search_path = ''
as $$
  select b.period
  from public.bookings b
  where b.court_id = p_court_id
    and b.period && tstzrange(p_from, p_to)
    and b.status in ('hold', 'confirmed')
$$;

-- 4. btree_gist — mover de public a extensions
alter table public.bookings drop constraint no_overlap;
drop index public.idx_bookings_court_period;

drop extension btree_gist;
create extension btree_gist schema extensions;

create index idx_bookings_court_period
  on public.bookings using gist (court_id, period);

alter table public.bookings add constraint no_overlap
  exclude using gist (
    court_id with =,
    period   with &&
  ) where (status in ('hold', 'confirmed'));

-- 5. webhook_events — policy explícita de denegación
create policy "webhook_events_service_role_only"
  on public.webhook_events
  using (false);
