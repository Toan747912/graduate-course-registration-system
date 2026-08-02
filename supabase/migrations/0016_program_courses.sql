-- 0016_program_courses.sql
-- program_courses: many-to-many between programs and courses (a course may be
-- shared across programs), each pairing classified as REQUIRED or ELECTIVE
-- (BUS-18). No hard delete in MVP.
-- Maps to docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md section C.3, BUS-18.

create table public.program_courses (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id),
  course_id uuid not null references public.courses (id),
  -- BUS-18: a course has exactly one requirement type within a given program.
  requirement_type text not null check (requirement_type in ('REQUIRED', 'ELECTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_courses_unique_per_program unique (program_id, course_id)
);

comment on table public.program_courses is 'courses.credits (0003) remains the single source of truth for credit value; not duplicated here.';

create index program_courses_program_idx on public.program_courses (program_id);
create index program_courses_course_idx on public.program_courses (course_id);

create trigger program_courses_set_updated_at
  before update on public.program_courses
  for each row
  execute function public.set_updated_at();
