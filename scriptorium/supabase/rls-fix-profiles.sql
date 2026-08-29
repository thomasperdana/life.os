-- SECURITY FIX (found by scripts/verify-rls.ts, 2026-08-29)
--
-- "profiles: update own" let a user UPDATE their own row with no column
-- restriction, so any signed-in user could set role='admin' with the public
-- anon key and take over the admin surface: uploads, moderation, bans.
--
-- RLS policies cannot restrict columns. Column-level GRANTs can, and are the
-- correct tool. A user may edit their display name and avatar; role and
-- banned_at are decided by an admin through the service role, never by the
-- account itself.

revoke update on public.profiles from authenticated, anon;
grant  update (display_name, avatar_url) on public.profiles to authenticated;

-- WITH CHECK also stops a user rewriting the row's id to point at someone else.
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update
  using       ((select auth.uid()) = id)
  with check  ((select auth.uid()) = id);
