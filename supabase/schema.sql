-- TraderKomak Supabase schema (free tier friendly — run once in the SQL Editor)
--
-- Phase 1: Google login + usernames (profiles table, RLS on).
-- Phase 2 (ready but unused): chart drawings + per-user UI settings sync.

-- ============ PROFILES ============
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 5 and 20),
  username_lower text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness for usernames
create unique index if not exists profiles_username_lower_key
  on public.profiles (username_lower);

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
  on public.profiles for select
  using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============ CHART DRAWINGS (phase 2) ============
create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument text not null,
  timeframe text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, instrument, timeframe)
);

alter table public.drawings enable row level security;

drop policy if exists "own drawings all" on public.drawings;
create policy "own drawings all"
  on public.drawings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============ USER SETTINGS (phase 2: watchlist, timeframes, indicators) ============
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "own settings all" on public.user_settings;
create policy "own settings all"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
