-- Cabinet — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run
-- Then run supabase/seed.sql to populate the recipes.

-- ── Recipes ────────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id            bigint primary key,
  name          text    not null,
  tags          text[]  not null default '{}',
  glass         text,
  garnish       text,
  color         text,
  instructions  text,
  ingredients   jsonb   not null default '[]',  -- [{name, oz, displayAmt}]
  variant_of    integer references recipes(id),
  variant_name  text,
  -- visual override stored per recipe (null = use DRINK_VISUALS default)
  visual        jsonb,
  created_at    timestamptz default now()
);

-- ── Per-recipe user state ───────────────────────────────────────────────────────
-- One row per recipe; upserted whenever user toggles favourite etc.
create table if not exists recipe_state (
  recipe_id     integer primary key references recipes(id) on delete cascade,
  favorite      boolean not null default false,
  verified      boolean not null default false,
  want_to_try   boolean not null default false,
  notes         text    not null default '',
  updated_at    timestamptz default now()
);

-- ── Bar (selected mixers) ───────────────────────────────────────────────────────
create table if not exists bar_state (
  key           text primary key,   -- 'selected_mixers' | 'light_mode' | 'filter_mode' | 'sort_order'
  value         text  not null,
  updated_at    timestamptz default now()
);

-- ── Mixer catalogue ─────────────────────────────────────────────────────────────
create table if not exists mixers (
  name          text primary key,
  category      text not null
);

-- ── RLS: disable for single-user private project ────────────────────────────────
-- Your anon key is secret (.env, never committed). No auth needed.
alter table recipes      disable row level security;
alter table recipe_state disable row level security;
alter table bar_state    disable row level security;
alter table mixers       disable row level security;
