-- 0001_profiles.sql
-- profiles: one row per auth.users, carries role and student_status.
-- Maps to BA docs: 02_Stakeholders_and_Scope.md (roles), 03_Business_Rules.md BUS-01.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('STUDENT', 'TRAINING_STAFF')),
  student_status text check (student_status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_student_status_required_for_students check (
    (role = 'STUDENT' and student_status is not null)
    or (role = 'TRAINING_STAFF' and student_status is null)
  )
);

comment on table public.profiles is 'One row per auth.users. role and student_status drive BUS-01 and access control.';

create index profiles_role_idx on public.profiles (role);

-- Keep updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-provision a default STUDENT/ACTIVE profile when a new auth user is created.
-- A backend seed script may later update role/status (e.g. for TRAINING_STAFF demo users).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
