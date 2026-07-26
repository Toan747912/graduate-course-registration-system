-- 0014_harden_handle_new_auth_user_search_path.sql
-- Hardens public.handle_new_auth_user() (defined in 0001_profiles.sql) to match
-- the search_path convention used everywhere else in the project (0007, 0008,
-- 0009, 0010, 0011, 0012, 0013: `set search_path = pg_catalog, public`).
--
-- The original definition used `set search_path = public` only. That is not
-- unsafe by itself here (the function body already schema-qualifies
-- public.profiles and calls no bare/unqualified functions or operators), but
-- pinning pg_catalog explicitly first is the project's established
-- SECURITY DEFINER hardening baseline: it removes any reliance on
-- pg_catalog's implicit, unqualified presence at the front of the search
-- path and makes the function immune to a future public-schema object
-- shadowing a catalog name.
--
-- No behavior change: same trigger, same function body, same insert, same
-- on conflict (id) do nothing, same grants (this function is never granted
-- direct EXECUTE to any client role - it only ever runs as the AFTER INSERT
-- trigger owner via on_auth_user_created on auth.users). CREATE OR REPLACE
-- keeps the function's OID stable, so the existing trigger binding on
-- auth.users is untouched and requires no re-creation.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name, role, student_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'STUDENT',
    'ACTIVE'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Auto-provisions a default STUDENT/ACTIVE profile on auth.users insert. search_path hardened to pg_catalog, public (0014); no behavior change.';
