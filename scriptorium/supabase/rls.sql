-- Scriptorium — Row Level Security, SPEC.3.md §5.2 "fence two".
--
-- RLS is defence in depth. It stops a leaked anon key from exposing another
-- user's journals. It does NOT know what a subscription is — entitlement lives
-- in application code (§9.4) and must never be encoded here, or it will drift
-- from Stripe and nobody will notice.
--
-- Run AFTER `bun run db:migrate`.

-- ── Auto-create a profile row on signup ──────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Enable RLS everywhere in public ──────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.content_items    enable row level security;
alter table public.progress         enable row level security;
alter table public.bookmarks        enable row level security;
alter table public.journals         enable row level security;
alter table public.reviews          enable row level security;
alter table public.download_events  enable row level security;
alter table public.processed_events enable row level security;

-- processed_events and subscriptions get NO policies at all: service-role only.
-- Webhooks are the sole writer of subscriptions (§9.3 rule 1); the app reads
-- entitlement through the server-side db client, which uses DATABASE_URL and is
-- not subject to RLS.

-- ── profiles: read and update your own ───────────────────────────────────────
create policy "profiles: read own"   on public.profiles
  for select using ((select auth.uid()) = id);
-- Column-level grants, not just a policy: RLS cannot restrict WHICH columns an
-- update touches, and without this a user can set their own role='admin'.
revoke update on public.profiles from authenticated, anon;
grant  update (display_name, avatar_url) on public.profiles to authenticated;

create policy "profiles: update own" on public.profiles
  for update
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── content_items: anyone signed in may see PUBLISHED metadata ───────────────
-- Metadata is not the file. The bytes are gated by signed URLs (§7.3).
create policy "content: read published" on public.content_items
  for select to authenticated using (status = 'published');

-- ── progress / bookmarks / journals: strictly your own ───────────────────────
create policy "progress: own"  on public.progress
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "bookmarks: own" on public.bookmarks
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "journals: own"  on public.journals
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── reviews: published are public; your own is yours at any status (§10.2) ───
create policy "reviews: read published" on public.reviews
  for select using (status = 'published' or (select auth.uid()) = user_id);
create policy "reviews: insert own"     on public.reviews
  for insert with check ((select auth.uid()) = user_id);
create policy "reviews: update own"     on public.reviews
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── download_events: append-only abuse signal; nobody reads it but admin ─────
create policy "downloads: insert own" on public.download_events
  for insert with check ((select auth.uid()) = user_id);

-- ── Storage: private bucket, no anon policies. Signed URLs only (§7.1). ──────
insert into storage.buckets (id, name, public)
values ('content', 'content', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;
