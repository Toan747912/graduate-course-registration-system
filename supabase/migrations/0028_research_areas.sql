-- 0028_research_areas.sql
-- research_areas: training-staff-managed catalog of thesis research areas
-- (BUS-61..63). No hard delete: deactivate via is_active = false. Students
-- may only pick an ACTIVE area when creating/editing a PENDING_APPROVAL
-- thesis proposal (enforced later, in the RPCs, not here).
-- Maps to docs/BATCH_4_THESIS_ADVISOR_DESIGN.md section D.0.

create table public.research_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.research_areas is 'Training-staff-managed catalog of thesis research areas. No hard delete: deactivate via is_active=false (BUS-61). Batch 4.';

create trigger research_areas_set_updated_at
  before update on public.research_areas
  for each row
  execute function public.set_updated_at();

create index research_areas_is_active_idx on public.research_areas (is_active);
