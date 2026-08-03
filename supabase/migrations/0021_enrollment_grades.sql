-- 0021_enrollment_grades.sql
-- enrollment_grades: 1-1 final grade record per CONFIRMED enrollment.
-- Batch 3 (docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md, section D.1/I).
-- No attempt_no/course_id/student_id/program_id columns: all context is
-- derived via enrollment_id -> enrollments -> ... (see design doc D.2/D.3),
-- avoiding a second source of truth for data already reachable by join.

create table public.enrollment_grades (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments (id),
  final_score numeric(3, 1) not null check (final_score >= 0 and final_score <= 10),
  grade_status text not null default 'DRAFT' check (grade_status in ('DRAFT', 'PUBLISHED')),
  result_status text check (result_status in ('PASS', 'FAIL')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrollment_grades_result_status_matches_grade_status check (
    (grade_status = 'PUBLISHED' and result_status is not null and published_at is not null)
    or (grade_status = 'DRAFT' and result_status is null and published_at is null and published_by is null)
  )
);

comment on table public.enrollment_grades is 'One final_score (0-10, always present, no empty-draft rows) per CONFIRMED enrollment. DRAFT = staff has entered a score but not published it; PUBLISHED is one-way and locked (see enrollment_grades_block_update_when_published trigger below). No student_id/course_id/program_id columns: derive via enrollment_id (BUS-27..32).';

create index enrollment_grades_enrollment_idx on public.enrollment_grades (enrollment_id);

create trigger enrollment_grades_set_updated_at
  before update on public.enrollment_grades
  for each row
  execute function public.set_updated_at();

-- BUS-31: once PUBLISHED, the row is locked at the DB layer against every
-- UPDATE, including from a SECURITY DEFINER RPC or the service role bypassing
-- RLS. This is a second, independent layer of defense beyond "no RPC exposes
-- an update path for PUBLISHED rows" — there must be no back door at all.
create or replace function public.enrollment_grades_block_update_when_published()
returns trigger
language plpgsql
as $$
begin
  if old.grade_status = 'PUBLISHED' then
    raise exception 'Điểm đã công bố, không thể sửa.';
  end if;
  return new;
end;
$$;

create trigger enrollment_grades_block_update_when_published
  before update on public.enrollment_grades
  for each row
  execute function public.enrollment_grades_block_update_when_published();
