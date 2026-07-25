-- 0006_enrollment_history.sql
-- enrollment_history: append-only log of every enrollment status transition.
-- Maps to BA docs: 03_Business_Rules.md BUS-09 (no deletes, ever).

create table public.enrollment_history (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  status text not null check (
    status in ('CONFIRMED', 'REJECTED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_SCHOOL')
  ),
  reason text,
  changed_at timestamptz not null default now()
);

comment on table public.enrollment_history is 'Append-only. Rows are inserted by RPC functions only; never updated or deleted (BUS-09).';

create index enrollment_history_enrollment_idx on public.enrollment_history (enrollment_id);
create index enrollment_history_changed_at_idx on public.enrollment_history (changed_at);

-- Enforce append-only at the database level: block UPDATE and DELETE outright.
revoke update, delete on public.enrollment_history from public;

create or replace function public.forbid_enrollment_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'enrollment_history is append-only: % is not permitted', tg_op;
end;
$$;

create trigger enrollment_history_no_update
  before update on public.enrollment_history
  for each row
  execute function public.forbid_enrollment_history_mutation();

create trigger enrollment_history_no_delete
  before delete on public.enrollment_history
  for each row
  execute function public.forbid_enrollment_history_mutation();
