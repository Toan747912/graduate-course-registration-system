-- 0005_enrollments.sql
-- enrollments: current status per (student, course_class). No semester_id column
-- (derived via course_class -> registration_period -> semester) and no seat-count
-- column (confirmed seats are always derived by counting CONFIRMED rows).
-- Maps to BA docs: 03_Business_Rules.md BUS-05, BUS-06, BUS-08, BUS-09, BUS-11.

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id),
  course_class_id uuid not null references public.course_classes (id),
  status text not null check (
    status in ('CONFIRMED', 'REJECTED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_SCHOOL')
  ),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.enrollments is 'No semester_id: derive via course_class_id -> registration_period_id -> semester_id. No available-seats column: count status=CONFIRMED rows instead.';

create index enrollments_student_idx on public.enrollments (student_id);
create index enrollments_course_class_idx on public.enrollments (course_class_id);
create index enrollments_status_idx on public.enrollments (status);

-- Guards against a duplicate CONFIRMED row for the same student/class (defense in
-- depth; the cross-course/semester rule BUS-03 is enforced in register_for_class()
-- because it requires joining through course_classes to compare course_id).
create unique index enrollments_unique_confirmed_per_class
  on public.enrollments (student_id, course_class_id)
  where (status = 'CONFIRMED');

create trigger enrollments_set_updated_at
  before update on public.enrollments
  for each row
  execute function public.set_updated_at();
