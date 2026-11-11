-- ============================================================
-- 002_rls.sql — Row Level Security
-- ============================================================

alter table localities          enable row level security;
alter table sports              enable row level security;
alter table profiles            enable row level security;
alter table venues              enable row level security;
alter table courts              enable row level security;
alter table court_hours         enable row level security;
alter table court_prices        enable row level security;
alter table bookings            enable row level security;
alter table recurring_bookings  enable row level security;
alter table mp_accounts         enable row level security;
alter table payments            enable row level security;
alter table webhook_events      enable row level security;
alter table push_subscriptions  enable row level security;
alter table notification_outbox enable row level security;
alter table blocked_phones      enable row level security;
alter table audit_log           enable row level security;

create or replace function auth_role()
returns user_role language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;

-- LOCALITIES
create policy "localities_public_read" on localities for select using (true);

-- SPORTS
create policy "sports_public_read" on sports for select using (true);

-- PROFILES
create policy "profiles_own_read"     on profiles for select using (id = auth.uid());
create policy "profiles_own_update"   on profiles for update using (id = auth.uid());
create policy "profiles_superadmin_read" on profiles for select using (auth_role() = 'superadmin');
create policy "profiles_insert_self"  on profiles for insert with check (id = auth.uid());

-- VENUES
create policy "venues_public_read"   on venues for select using (status = 'approved');
create policy "venues_owner_read"    on venues for select using (owner_id = auth.uid());
create policy "venues_owner_insert"  on venues for insert with check (owner_id = auth.uid());
create policy "venues_owner_update"  on venues for update using (owner_id = auth.uid());
create policy "venues_superadmin_all" on venues for all using (auth_role() = 'superadmin');

-- COURTS
create policy "courts_public_read" on courts for select using (
  active = true and exists (select 1 from venues v where v.id = courts.venue_id and v.status = 'approved')
);
create policy "courts_owner_all" on courts for all using (
  exists (select 1 from venues v where v.id = courts.venue_id and v.owner_id = auth.uid())
);
create policy "courts_superadmin_all" on courts for all using (auth_role() = 'superadmin');

-- COURT_HOURS
create policy "court_hours_public_read" on court_hours for select using (
  exists (select 1 from courts c join venues v on v.id = c.venue_id
    where c.id = court_hours.court_id and c.active = true and v.status = 'approved')
);
create policy "court_hours_owner_all" on court_hours for all using (
  exists (select 1 from courts c join venues v on v.id = c.venue_id
    where c.id = court_hours.court_id and v.owner_id = auth.uid())
);

-- COURT_PRICES
create policy "court_prices_public_read" on court_prices for select using (
  exists (select 1 from courts c join venues v on v.id = c.venue_id
    where c.id = court_prices.court_id and c.active = true and v.status = 'approved')
);
create policy "court_prices_owner_all" on court_prices for all using (
  exists (select 1 from courts c join venues v on v.id = c.venue_id
    where c.id = court_prices.court_id and v.owner_id = auth.uid())
);

-- BOOKINGS
create policy "bookings_owner_all" on bookings for all using (
  exists (select 1 from venues v where v.id = bookings.venue_id and v.owner_id = auth.uid())
);
create policy "bookings_superadmin_all" on bookings for all using (auth_role() = 'superadmin');

-- RECURRING_BOOKINGS
create policy "recurring_owner_all" on recurring_bookings for all using (
  exists (select 1 from courts c join venues v on v.id = c.venue_id
    where c.id = recurring_bookings.court_id and v.owner_id = auth.uid())
);
create policy "recurring_superadmin_all" on recurring_bookings for all using (auth_role() = 'superadmin');

-- MP_ACCOUNTS
create policy "mp_accounts_owner_all" on mp_accounts for all using (
  exists (select 1 from venues v where v.id = mp_accounts.venue_id and v.owner_id = auth.uid())
);
create policy "mp_accounts_superadmin_all" on mp_accounts for all using (auth_role() = 'superadmin');

-- PAYMENTS
create policy "payments_owner_read" on payments for select using (
  exists (select 1 from bookings b join venues v on v.id = b.venue_id
    where b.id = payments.booking_id and v.owner_id = auth.uid())
);
create policy "payments_superadmin_all" on payments for all using (auth_role() = 'superadmin');

-- PUSH_SUBSCRIPTIONS
create policy "push_subs_own_all" on push_subscriptions for all using (profile_id = auth.uid());

-- NOTIFICATION_OUTBOX
create policy "notif_outbox_owner_read" on notification_outbox for select using (
  exists (select 1 from venues v where v.id = notification_outbox.venue_id and v.owner_id = auth.uid())
);

-- BLOCKED_PHONES
create policy "blocked_phones_owner_all" on blocked_phones for all using (
  exists (select 1 from venues v where v.id = blocked_phones.venue_id and v.owner_id = auth.uid())
);

-- AUDIT_LOG
create policy "audit_log_owner_read" on audit_log for select using (
  venue_id in (select id from venues where owner_id = auth.uid())
);
create policy "audit_log_superadmin_all" on audit_log for all using (auth_role() = 'superadmin');

-- RPC pública: disponibilidad sin datos personales
create or replace function get_court_availability(
  p_court_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns table (period tstzrange)
language sql stable security definer as $$
  select b.period
  from bookings b
  where b.court_id = p_court_id
    and b.period && tstzrange(p_from, p_to)
    and b.status in ('hold', 'confirmed')
$$;
