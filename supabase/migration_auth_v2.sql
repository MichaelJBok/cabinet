-- ============================================================
-- STAGE 1: Fixed migration — handles existing data
-- ============================================================

-- 1. Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- 2. Add user_id columns (nullable for now)
alter table public.recipe_state add column if not exists user_id uuid references auth.users(id);
alter table public.bar_state add column if not exists user_id uuid references auth.users(id);

-- 3. Delete orphaned rows with no user_id so constraints can be applied
--    (We'll reassign YOUR data in Stage 2 after you sign in)
delete from public.recipe_state where user_id is null;
delete from public.bar_state where user_id is null;

-- 4. Drop old primary keys and add composite ones
alter table public.recipe_state drop constraint if exists recipe_state_pkey;
alter table public.recipe_state add primary key (recipe_id, user_id);

alter table public.bar_state drop constraint if exists bar_state_pkey;
alter table public.bar_state add primary key (key, user_id);

-- ============================================================
-- RLS POLICIES
-- ============================================================

alter table public.profiles enable row level security;
drop policy if exists "Own profile" on public.profiles;
create policy "Own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Public access" on public.recipes;
create policy "Read recipes" on public.recipes
  for select using (true);
create policy "Authenticated write recipes" on public.recipes
  for insert with check (auth.uid() is not null);
create policy "Authenticated update recipes" on public.recipes
  for update using (auth.uid() is not null);
create policy "Authenticated delete recipes" on public.recipes
  for delete using (auth.uid() is not null);

drop policy if exists "Public access" on public.recipe_state;
create policy "Own recipe state" on public.recipe_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Public access" on public.bar_state;
create policy "Own bar state" on public.bar_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Public access" on public.mixers;
create policy "Read mixers" on public.mixers
  for select using (true);
create policy "Authenticated write mixers" on public.mixers
  for insert with check (auth.uid() is not null);

-- ============================================================
-- STAGE 2: Run AFTER you sign in for the first time
-- Replace 'YOUR-USER-ID-HERE' with your UUID from Auth > Users
-- This restores your bar and recipe state under your account
-- ============================================================

-- insert into public.profiles (id, display_name) 
--   values ('YOUR-USER-ID-HERE', 'Michael')
--   on conflict (id) do update set display_name = 'Michael';
