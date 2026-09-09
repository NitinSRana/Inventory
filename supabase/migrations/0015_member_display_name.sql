-- Who did this.
--
-- Every screen that wants to attribute an action — a sale's operator, a stock
-- correction's author, the audit log — has a user id and nothing else, so the
-- team page renders the first eight characters of a UUID and calls it a person.
-- One nullable column fixes that everywhere at once.
--
-- Deliberately not the auth user's email: a shop with one shared till login and
-- three people on shift wants "Anna", not "shop@…". The owner types it.
--
-- No RLS changes: organization_members already has the policy and FORCE from
-- 0001_init.sql, and a new column on an existing table inherits both.

alter table organization_members add column display_name text;

comment on column organization_members.display_name is
  'What to call this person on screen. Null falls back to the user id.';
