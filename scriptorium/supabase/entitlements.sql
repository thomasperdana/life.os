-- One-time bundle ownership — the $197 Starter tier.
--
-- The unit of purchase is a STUDY, not a file: "10 PDF + corresponding MP3"
-- means a PDF and its matching MP3 together consume one of the ten. Items that
-- belong to the same study share a `pair_key`; an item with no pair_key is its
-- own unit.

alter table public.content_items
  add column if not exists pair_key text;

create index if not exists content_items_pair on public.content_items (pair_key);

-- A completed one-time payment, and how many units it granted.
create table if not exists public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  stripe_session_id   text unique,
  stripe_payment_intent text,
  price_id            text,
  slots               int not null,
  created_at          timestamptz not null default now()
);

-- Which unit a user has claimed against their purchased slots.
create table if not exists public.item_entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  unit_key    text not null,
  purchase_id uuid references public.purchases(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, unit_key)
);

create index if not exists purchases_user on public.purchases (user_id);
create index if not exists item_entitlements_user on public.item_entitlements (user_id);

alter table public.purchases         enable row level security;
alter table public.item_entitlements enable row level security;

-- Readable by the owner; written only by the server (webhook / claim route),
-- which uses DATABASE_URL and bypasses RLS. No insert policy on purpose:
-- a user must never be able to grant themselves a slot.
drop policy if exists "purchases: read own" on public.purchases;
create policy "purchases: read own" on public.purchases
  for select using ((select auth.uid()) = user_id);

drop policy if exists "entitlements: read own" on public.item_entitlements;
create policy "entitlements: read own" on public.item_entitlements
  for select using ((select auth.uid()) = user_id);

-- Backfill the demo content so the pairing concept has something to act on.
update public.content_items set pair_key = 'demo-study' where slug in ('demo-reader','demo-listen');
