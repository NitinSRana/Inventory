-- Optional descriptive/contact fields, all nullable — no existing behaviour
-- changes, nothing to backfill.

alter table public.categories add column description text;
alter table public.categories add column icon text;

alter table public.organizations add column email text;
alter table public.organizations add column phone text;
alter table public.organizations add column vat_number text;
alter table public.organizations add column address text;
