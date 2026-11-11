-- ============================================================
-- 001_schema.sql — Turnazo: esquema completo
-- ============================================================

-- Extensiones
create extension if not exists "uuid-ossp";
create extension if not exists btree_gist;

-- ============================================================
-- LOCALITIES
-- ============================================================
create table localities (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SPORTS
-- ============================================================
create table sports (
  id                   uuid primary key default uuid_generate_v4(),
  name                 text not null,
  slug                 text not null unique,
  default_slot_minutes integer not null check (default_slot_minutes > 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ============================================================
-- PROFILES (extiende auth.users)
-- ============================================================
create type user_role as enum ('owner', 'superadmin');

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- VENUES (complejos)
-- ============================================================
create type venue_status as enum ('pending', 'approved', 'suspended');
create type deposit_type  as enum ('fixed', 'percent');
create type refund_policy as enum ('full', 'none');

create table venues (
  id                  uuid primary key default uuid_generate_v4(),
  owner_id            uuid not null references profiles(id),
  name                text not null,
  phone               text not null,
  address             text not null,
  lat                 double precision not null,
  lng                 double precision not null,
  locality_id         uuid not null references localities(id),
  status              venue_status not null default 'pending',
  payment_alias       text,
  payment_link        text,
  whatsapp_template   text,
  deposit_required    boolean not null default false,
  deposit_type        deposit_type,
  deposit_value       numeric(10,2),
  allow_full_payment  boolean not null default false,
  allow_pay_at_venue  boolean not null default true,
  cancel_limit_hours  integer not null default 2,
  refund_policy       refund_policy not null default 'none',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deposit_config_valid check (
    (deposit_required = false) or
    (deposit_type is not null and deposit_value is not null and deposit_value > 0)
  )
);

-- ============================================================
-- COURTS (canchas)
-- ============================================================
create table courts (
  id           uuid primary key default uuid_generate_v4(),
  venue_id     uuid not null references venues(id) on delete cascade,
  sport_id     uuid not null references sports(id),
  name         text not null,
  slot_minutes integer not null check (slot_minutes > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- COURT_HOURS
-- ============================================================
create table court_hours (
  id         uuid primary key default uuid_generate_v4(),
  court_id   uuid not null references courts(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  open_time  time not null,
  close_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_before_close check (open_time < close_time)
);

-- ============================================================
-- COURT_PRICES
-- ============================================================
create table court_prices (
  id         uuid primary key default uuid_generate_v4(),
  court_id   uuid not null references courts(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  from_time  time not null,
  to_time    time not null,
  price      numeric(10,2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint from_before_to check (from_time < to_time)
);

-- ============================================================
-- BOOKINGS
-- ============================================================
create type booking_kind   as enum ('booking', 'block');
create type booking_source as enum ('app', 'manual');
create type booking_status as enum ('hold', 'confirmed', 'cancelled', 'expired', 'completed', 'no_show');
create type payment_status as enum ('unpaid', 'deposit_paid', 'paid', 'refunded');

create table bookings (
  id               uuid primary key default uuid_generate_v4(),
  court_id         uuid not null references courts(id),
  venue_id         uuid not null references venues(id),
  period           tstzrange not null,
  kind             booking_kind   not null default 'booking',
  source           booking_source not null default 'app',
  status           booking_status not null default 'confirmed',
  customer_name    text,
  customer_phone   text,
  price_total      numeric(10,2),
  deposit_amount   numeric(10,2),
  amount_paid      numeric(10,2) not null default 0,
  payment_status   payment_status not null default 'unpaid',
  hold_expires_at  timestamptz,
  cancel_token     text unique,
  recurring_id     uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint no_overlap exclude using gist (
    court_id with =,
    period   with &&
  ) where (status in ('hold', 'confirmed'))
);

-- ============================================================
-- RECURRING_BOOKINGS
-- ============================================================
create table recurring_bookings (
  id              uuid primary key default uuid_generate_v4(),
  court_id        uuid not null references courts(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  start_time      time not null,
  customer_name   text not null,
  customer_phone  text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table bookings
  add constraint bookings_recurring_id_fkey
  foreign key (recurring_id) references recurring_bookings(id) on delete set null;

-- ============================================================
-- MP_ACCOUNTS
-- ============================================================
create table mp_accounts (
  id            uuid primary key default uuid_generate_v4(),
  venue_id      uuid not null unique references venues(id) on delete cascade,
  mp_user_id    text not null,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- PAYMENTS
-- ============================================================
create type payment_type as enum ('deposit', 'full');

create table payments (
  id               uuid primary key default uuid_generate_v4(),
  booking_id       uuid not null references bookings(id),
  mp_payment_id    text not null unique,
  mp_preference_id text,
  amount           numeric(10,2) not null,
  type             payment_type not null,
  status           text not null,
  platform_fee     numeric(10,2) not null default 0,
  raw              jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- WEBHOOK_EVENTS
-- ============================================================
create table webhook_events (
  id           uuid primary key default uuid_generate_v4(),
  provider     text not null,
  event_id     text not null,
  processed_at timestamptz not null default now(),
  constraint webhook_events_provider_event_id_key unique (provider, event_id)
);

-- ============================================================
-- PUSH_SUBSCRIPTIONS
-- ============================================================
create table push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICATION_OUTBOX
-- ============================================================
create type notification_status as enum ('pending', 'sent', 'failed');

create table notification_outbox (
  id              uuid primary key default uuid_generate_v4(),
  venue_id        uuid not null references venues(id) on delete cascade,
  type            text not null,
  payload         jsonb not null default '{}',
  status          notification_status not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- BLOCKED_PHONES
-- ============================================================
create table blocked_phones (
  id         uuid primary key default uuid_generate_v4(),
  venue_id   uuid not null references venues(id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now(),
  constraint blocked_phones_venue_phone_key unique (venue_id, phone)
);

-- ============================================================
-- AUDIT_LOG
-- ============================================================
create table audit_log (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid references profiles(id) on delete set null,
  venue_id    uuid references venues(id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index idx_bookings_court_period    on bookings using gist (court_id, period);
create index idx_bookings_venue_status    on bookings (venue_id, status);
create index idx_bookings_hold_expires    on bookings (hold_expires_at) where status = 'hold';
create index idx_courts_venue             on courts (venue_id);
create index idx_venues_locality_status   on venues (locality_id, status);
create index idx_bookings_cancel_token    on bookings (cancel_token) where cancel_token is not null;
create index idx_notification_outbox_pending on notification_outbox (next_attempt_at) where status = 'pending';

-- ============================================================
-- FUNCIÓN + TRIGGERS updated_at
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_localities_updated_at    before update on localities           for each row execute function set_updated_at();
create trigger trg_sports_updated_at        before update on sports               for each row execute function set_updated_at();
create trigger trg_profiles_updated_at      before update on profiles             for each row execute function set_updated_at();
create trigger trg_venues_updated_at        before update on venues               for each row execute function set_updated_at();
create trigger trg_courts_updated_at        before update on courts               for each row execute function set_updated_at();
create trigger trg_court_hours_updated_at   before update on court_hours          for each row execute function set_updated_at();
create trigger trg_court_prices_updated_at  before update on court_prices         for each row execute function set_updated_at();
create trigger trg_bookings_updated_at      before update on bookings             for each row execute function set_updated_at();
create trigger trg_recurring_updated_at     before update on recurring_bookings   for each row execute function set_updated_at();
create trigger trg_mp_accounts_updated_at   before update on mp_accounts          for each row execute function set_updated_at();
create trigger trg_payments_updated_at      before update on payments             for each row execute function set_updated_at();
create trigger trg_push_subs_updated_at     before update on push_subscriptions   for each row execute function set_updated_at();
create trigger trg_notif_outbox_updated_at  before update on notification_outbox  for each row execute function set_updated_at();
