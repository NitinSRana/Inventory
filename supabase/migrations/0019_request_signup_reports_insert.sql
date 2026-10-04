-- -----------------------------------------------------------------------------
-- Tell the caller whether a request was actually queued.
--
-- The owner was emailed about every submission, including the ones the partial
-- unique index discarded as a duplicate of a still-pending request. They would
-- open the queue looking for that shop and find nothing there — which is how
-- "Access request: Store32" arrived for a row that was never written.
--
-- The applicant still learns nothing. This boolean never reaches the browser:
-- the form's answer is identical whether the address is new, already queued or
-- already approved, which is the guarantee submitRequest exists to keep. It
-- only decides whether the owner is worth interrupting.
--
-- Dropped rather than replaced because Postgres cannot change a function's
-- return type in place.
-- -----------------------------------------------------------------------------
drop function if exists app.request_signup(text, text, text, text);

create function app.request_signup(
  p_email   text,
  p_name    text,
  p_shop    text,
  p_country text
)
returns boolean
language sql
security definer
set search_path = app, pg_temp
as $fn$
  with inserted as (
    insert into app.signup_requests (email, contact_name, shop_name, country_code)
    values (lower(trim(p_email)), trim(p_name), trim(p_shop), upper(p_country))
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from inserted);
$fn$;

revoke all on function app.request_signup(text, text, text, text) from public;
grant execute on function app.request_signup(text, text, text, text) to app_runtime;
