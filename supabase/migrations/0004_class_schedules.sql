-- 0004_class_schedules.sql
-- class_schedules: a course_class can have multiple weekly sessions (BUS-12).
-- Maps to BA docs: 03_Business_Rules.md BUS-12, BUS-04 (schedule conflict check).

create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  course_class_id uuid not null references public.course_classes (id) on delete cascade,
  -- 1 = Monday ... 7 = Sunday.
  day_of_week smallint not null check (day_of_week between 1 and 7),
  -- Discrete timetable slot code (e.g. session 1..10 of the day), not a free-form time range.
  session_slot smallint not null check (session_slot between 1 and 10),
  room text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedules_unique_slot_per_class unique (course_class_id, day_of_week, session_slot)
);

comment on table public.class_schedules is 'BUS-04 schedule conflict is evaluated on (day_of_week, session_slot) pairs; room is not a conflict factor (see 00_Project_Charter.md assumptions).';

create index class_schedules_course_class_idx on public.class_schedules (course_class_id);
create index class_schedules_day_slot_idx on public.class_schedules (day_of_week, session_slot);

create trigger class_schedules_set_updated_at
  before update on public.class_schedules
  for each row
  execute function public.set_updated_at();
