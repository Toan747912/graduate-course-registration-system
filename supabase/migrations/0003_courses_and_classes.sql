-- 0003_courses_and_classes.sql
-- courses: reference data (no CRUD in MVP, see 02_Stakeholders_and_Scope.md out-of-scope list).
-- course_classes: belongs to exactly one registration_period (BUS-14).
-- Maps to BA docs: 03_Business_Rules.md BUS-10, BUS-11, BUS-14, BUS-15.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger courses_set_updated_at
  before update on public.courses
  for each row
  execute function public.set_updated_at();

create table public.course_classes (
  id uuid primary key default gen_random_uuid(),
  -- not null enforces BUS-14: a class must belong to exactly one existing registration period.
  registration_period_id uuid not null references public.registration_periods (id),
  course_id uuid not null references public.courses (id),
  class_code text not null,
  max_seats integer not null check (max_seats > 0),
  -- BUS-15: storage status is only ACTIVE/CANCELLED. "FULL"/"OPEN" is a derived display value.
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_classes_class_code_unique_per_period unique (registration_period_id, class_code),
  constraint course_classes_cancellation_reason_required check (
    (status = 'ACTIVE' and cancellation_reason is null)
    or (status = 'CANCELLED' and cancellation_reason is not null)
  )
);

comment on table public.course_classes is 'No "available seats" column: confirmed seat count is always derived from enrollments.status = CONFIRMED.';

create index course_classes_registration_period_idx on public.course_classes (registration_period_id);
create index course_classes_course_idx on public.course_classes (course_id);
create index course_classes_status_idx on public.course_classes (status);

create trigger course_classes_set_updated_at
  before update on public.course_classes
  for each row
  execute function public.set_updated_at();
