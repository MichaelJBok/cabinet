-- ============================================================
-- STAGE 1: Run this BEFORE deploying the new code
-- ============================================================

-- 1. Profiles table (display names, persisted per user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- 2. Add user_id to recipe_state
alter table public.recipe_state add column if not exists user_id uuid references auth.users(id);

-- 3. Add user_id to bar_state  
alter table public.bar_state add column if not exists user_id uuid references auth.users(id);

-- 4. Drop old primary key on recipe_state (was just recipe_id)
--    and replace with composite (recipe_id, user_id)
alter table public.recipe_state drop constraint if exists recipe_state_pkey;
alter table public.recipe_state add primary key (recipe_id, user_id);

-- 5. Drop old primary key on bar_state (was just key)
--    and replace with composite (key, user_id)  
alter table public.bar_state drop constraint if exists bar_state_pkey;
alter table public.bar_state add primary key (key, user_id);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- profiles: users can only read/write their own
alter table public.profiles enable row level security;
drop policy if exists "Own profile" on public.profiles;
create policy "Own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- recipes: everyone can read, authenticated users can insert/update/delete
drop policy if exists "Public access" on public.recipes;
create policy "Read recipes" on public.recipes
  for select using (true);
create policy "Authenticated write recipes" on public.recipes
  for insert with check (auth.uid() is not null);
create policy "Authenticated update recipes" on public.recipes
  for update using (auth.uid() is not null);
create policy "Authenticated delete recipes" on public.recipes
  for delete using (auth.uid() is not null);

-- recipe_state: per-user
drop policy if exists "Public access" on public.recipe_state;
create policy "Own recipe state" on public.recipe_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- bar_state: per-user
drop policy if exists "Public access" on public.bar_state;
create policy "Own bar state" on public.bar_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- mixers: public read, authenticated write
drop policy if exists "Public access" on public.mixers;
create policy "Read mixers" on public.mixers
  for select using (true);
create policy "Authenticated write mixers" on public.mixers
  for insert with check (auth.uid() is not null);

-- ============================================================
-- STAGE 2: Run AFTER you sign in for the first time
-- Replace 'YOUR-USER-ID-HERE' with your actual UUID from
-- Supabase Auth > Users table
-- ============================================================

-- update public.recipe_state set user_id = 'YOUR-USER-ID-HERE' where user_id is null;
-- update public.bar_state set user_id = 'YOUR-USER-ID-HERE' where user_id is null;
-- insert into public.profiles (id, display_name) values ('YOUR-USER-ID-HERE', 'Michael')
--   on conflict (id) do update set display_name = 'Michael';
