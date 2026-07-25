-- 0002_semesters_and_registration_periods.sql
-- semesters + registration_periods (BUS-13: one period per semester max).
-- Maps to BA docs: 03_Business_Rules.md BUS-02, BUS-13.

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger semesters_set_updated_at
  before update on public.semesters
  for each row
  execute function public.set_updated_at();

create table public.registration_periods (
  id uuid primary key default gen_random_uuid(),
  -- unique enforces BUS-13: at most one registration period per semester.
  semester_id uuid not null unique references public.semesters (id),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  max_credits integer not null check (max_credits > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_periods_valid_window check (closes_at > opens_at)
);

comment on table public.registration_periods is 'One registration period per semester (BUS-13). Open/closed state is derived from opens_at/closes_at vs now().';

create index registration_periods_semester_idx on public.registration_periods (semester_id);

create trigger registration_periods_set_updated_at
  before update on public.registration_periods
  for each row
  execute function public.set_updated_at();
