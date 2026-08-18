-- CardTrace catalog schema
-- Run this once in Supabase's SQL editor (Project > SQL Editor > New query).

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  franchise text not null check (franchise in ('pokemon', 'one-piece')),
  external_source text not null,              -- 'pokemontcg' | 'tcgapi'
  external_id text not null,                  -- the source API's own card/product id
  name text not null,
  set_name text not null,
  set_code text,
  number text,
  rarity text,
  variant_label text,                         -- e.g. 'V.1', 'V.2', 'Alt Art' — null for Pokemon
  image_url text,
  slug text not null unique,
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create table if not exists price_snapshots (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  price numeric not null,
  currency text not null default 'EUR',
  captured_at timestamptz not null default now()
);

create index if not exists price_snapshots_card_id_captured_at_idx
  on price_snapshots (card_id, captured_at desc);

create index if not exists cards_franchise_idx on cards (franchise);
