-- 0029_advisors.sql
-- advisors: training-staff-managed catalog of thesis advisors. No login, no
-- link to auth.users (BUS-54). Schema only in this migration -- the
-- IN_PROGRESS deactivate guard (BUS-58/BUS-64) needs the theses table, which
-- does not exist yet, so that trigger ships separately in 0031, after 0030
-- creates theses. See docs/BATCH_4_THESIS_ADVISOR_DESIGN.md section I for why
-- this ordering is intentional and does not weaken the final guarantee.

create table public.advisors (
  id uuid primary key default gen_random_uuid(),
  advisor_code text not null unique,
  full_name text not null,
  specialization text not null,
  max_active_theses integer not null check (max_active_theses > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.advisors is 'Training-staff-managed catalog of thesis advisors (no login). No hard delete: deactivate via is_active=false, blocked while any IN_PROGRESS thesis references the advisor (guard trigger added in 0031, after theses exists). Batch 4.';

create trigger advisors_set_updated_at
  before update on public.advisors
  for each row
  execute function public.set_updated_at();

create index advisors_is_active_idx on public.advisors (is_active);
create index advisors_advisor_code_idx on public.advisors (advisor_code);
