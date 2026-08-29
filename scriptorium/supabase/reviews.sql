-- Reviews: reports + author bans — SPEC.3.md §10.
-- Idempotent; safe to re-run.

alter table public.profiles
  add column if not exists banned_at timestamptz;

create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  -- One report per person per review: reporting twice is not twice the signal.
  unique (review_id, reporter_id)
);

create index if not exists review_reports_review on public.review_reports (review_id);
create index if not exists reviews_status_created on public.reviews (status, created_at desc);
create index if not exists reviews_item on public.reviews (item_id, status);

alter table public.review_reports enable row level security;

-- A reporter may file their own report and see it. Nobody reads anyone else's;
-- the moderation queue runs service-role.
drop policy if exists "reports: insert own" on public.review_reports;
create policy "reports: insert own" on public.review_reports
  for insert with check ((select auth.uid()) = reporter_id);

drop policy if exists "reports: read own" on public.review_reports;
create policy "reports: read own" on public.review_reports
  for select using ((select auth.uid()) = reporter_id);
