-- 0040_graduation_records.sql
-- Batch 5 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md, D.1). Immutable
-- one-row-per-student snapshot created exactly once by
-- staff_confirm_graduation (migration 0045). No UPDATE/DELETE RPC exists for
-- this table anywhere in the codebase -- that is the bulk of the "cannot be
-- changed" guarantee (see 0041 for the RLS half of the guarantee).

create table public.graduation_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id),
  confirmed_by uuid not null references public.profiles (id),
  confirmed_at timestamptz not null default now(),
  program_id uuid not null references public.programs (id),
  program_code text not null,
  program_name text not null,
  cohort_id uuid references public.cohorts (id),
  cohort_code text,
  required_credits_min numeric not null,
  elective_credits_min numeric not null,
  required_credits_earned numeric not null,
  elective_credits_earned numeric not null,
  thesis_id uuid not null references public.theses (id),
  thesis_code text not null,
  thesis_completed_at timestamptz not null,
  eligibility_rules_version text not null,
  created_at timestamptz not null default now(),
  constraint graduation_records_student_unique unique (student_id)
);

comment on table public.graduation_records is 'Batch 5 (BUS-65..81): immutable snapshot created exactly once per student by staff_confirm_graduation (0045). No RPC UPDATEs or DELETEs this table -- it is the historical source of truth for a graduation decision, independent of later changes to programs/progress/theses (D.2).';
comment on column public.graduation_records.eligibility_rules_version is 'Static identifier of the eligibility rule set applied at confirmation time (initially ''v1'', see design doc L.2). Not updated by any future migration automatically.';
comment on column public.graduation_records.thesis_completed_at is 'Snapshot of theses.completed_at (immutable, BUS-79) for the thesis chosen under BUS-80, NOT theses.updated_at.';

create index idx_graduation_records_program_id on public.graduation_records (program_id);
create index idx_graduation_records_confirmed_at on public.graduation_records (confirmed_at);
