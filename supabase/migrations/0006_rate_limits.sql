-- -----------------------------------------------------------------------------
-- Rate limiting.
--
-- The sign-in action calls signInWithOtp with whatever address is posted to it.
-- Unthrottled that is two attacks at once: flood a stranger's mailbox, and burn
-- the shop's mail quota so its own staff cannot sign in. Supabase's own limits
-- are per-project, so one abuser locks out every tenant.
--
-- Deliberately in the `app` schema, not `public`: this is infrastructure, it is
-- not tenant-scoped (sign-in happens before any organization is known), and
-- nothing should ever expose it over the data API.
-- -----------------------------------------------------------------------------

create table app.rate_limits (
  bucket      text        not null,
  occurred_at timestamptz not null default now()
);

create index rate_limits_bucket_time_idx on app.rate_limits (bucket, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Records an attempt and reports whether it is allowed, in one round trip.
--
-- Counting first and inserting second would let two simultaneous requests both
-- see a count under the limit. Insert-then-count cannot: whichever commits
-- second sees the other's row.
--
-- Returns true when the attempt is within the limit.
-- -----------------------------------------------------------------------------
create or replace function app.check_rate_limit(
  p_bucket text,
  p_limit  integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $fn$
declare
  v_count integer;
begin
  insert into app.rate_limits (bucket) values (p_bucket);

  select count(*) into v_count
  from app.rate_limits
  where bucket = p_bucket and occurred_at > now() - p_window;

  -- Opportunistic cleanup: roughly one call in fifty clears anything older than
  -- a day, so the table stays small without needing a scheduled job.
  if random() < 0.02 then
    delete from app.rate_limits where occurred_at < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$fn$;

revoke all on function app.check_rate_limit(text, integer, interval) from public;
grant execute on function app.check_rate_limit(text, integer, interval) to app_runtime;
grant usage on schema app to app_runtime;
