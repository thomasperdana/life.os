-- Rate limiting store — SPEC.3.md §11.
-- Postgres-backed on purpose: an in-memory counter is per-instance, and
-- serverless runs many instances, so it would not actually limit anything.

create table if not exists public.rate_limits (
  bucket     text primary key,
  count      int not null default 0,
  window_start timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
-- No policies: service-role only. Clients never touch this table.

create or replace function public.rate_limit_hit(
  p_bucket text, p_limit int, p_window_seconds int
) returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_row public.rate_limits%rowtype;
begin
  insert into public.rate_limits (bucket, count, window_start)
  values (p_bucket, 0, v_now)
  on conflict (bucket) do nothing;

  select * into v_row from public.rate_limits where bucket = p_bucket for update;

  -- Fixed window: reset once the window has elapsed.
  if v_row.window_start + make_interval(secs => p_window_seconds) <= v_now then
    update public.rate_limits set count = 1, window_start = v_now where bucket = p_bucket;
    return query select true, p_limit - 1, v_now + make_interval(secs => p_window_seconds);
    return;
  end if;

  if v_row.count >= p_limit then
    return query select false, 0, v_row.window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  update public.rate_limits set count = v_row.count + 1 where bucket = p_bucket;
  return query select true, p_limit - v_row.count - 1,
                      v_row.window_start + make_interval(secs => p_window_seconds);
end;
$$;
