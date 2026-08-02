-- 0015_programs_and_cohorts.sql
-- programs: training-staff-managed catalog of graduate programs, with the
-- per-program academic thresholds (BUS-19, BUS-23).
-- cohorts: intake/khoa, belongs to exactly one program (BUS-17).
-- Maps to docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md sections C.1/C.2,
-- BUS-17, BUS-19. Batch 1 of the academic-management expansion.

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  required_credits_min integer not null check (required_credits_min > 0),
  elective_credits_min integer not null check (elective_credits_min >= 0),
  pass_score_min numeric(3, 1) not null check (pass_score_min >= 0 and pass_score_min <= 10),
  thesis_credits_min integer not null check (thesis_credits_min >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.programs is 'Training-staff-managed catalog of graduate programs. No hard delete in MVP: rows are read-only reference data once created (see docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md).';

create trigger programs_set_updated_at
  before update on public.programs
  for each row
  execute function public.set_updated_at();

create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  -- BUS-17: a cohort belongs to exactly one program.
  program_id uuid not null references public.programs (id),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cohorts_code_unique_per_program unique (program_id, code)
);

comment on table public.cohorts is 'Intake/khoa, always scoped to one program. No hard delete in MVP.';

create index cohorts_program_idx on public.cohorts (program_id);

create trigger cohorts_set_updated_at
  before update on public.cohorts
  for each row
  execute function public.set_updated_at();
