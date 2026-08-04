-- 0032_thesis_advisor_history.sql
-- thesis_advisor_history: append-only record of every advisor
-- assignment/reassignment (BUS-51, BUS-53). No UPDATE/DELETE is granted to
-- any application role in RLS (0033); the only writer is the SECURITY
-- DEFINER RPC logic in 0037 (staff_assign_advisor / staff_change_advisor),
-- which INSERTs a new row and, for a reassignment, UPDATEs unassigned_at on
-- the previous row -- both within the same RPC transaction, never exposed as
-- separate client-callable operations.

create table public.thesis_advisor_history (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.theses (id),
  advisor_id uuid not null references public.advisors (id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  assigned_by uuid not null references public.profiles (id),
  change_reason text
);

comment on table public.thesis_advisor_history is 'Append-only advisor assignment/reassignment history (BUS-51, BUS-53). change_reason is NULL for the first assignment (transition #5) and required (validated in the RPC, not here) for a reassignment (transition #9). Written only by SECURITY DEFINER RPCs in 0037.';

create index thesis_advisor_history_thesis_idx on public.thesis_advisor_history (thesis_id);
create index thesis_advisor_history_advisor_idx on public.thesis_advisor_history (advisor_id);

-- BUS-53 backstop (pre-apply review finding F-1): append-only was previously
-- enforced only by omission of write grants/RLS policies (0033). Mirror the
-- enrollment_history pattern (0006) with an explicit trigger, so the
-- invariant holds regardless of write path (RPC, service-role, a future
-- migration/script). Unlike enrollment_history, this table has exactly one
-- legitimate UPDATE shape used by staff_change_advisor (0037): closing out
-- the previous assignment row by setting unassigned_at from NULL to a
-- non-NULL value, with every other column unchanged. That single shape is
-- allowed; every other UPDATE shape, and every DELETE, is rejected.
revoke update, delete on public.thesis_advisor_history from public;

create or replace function public.thesis_advisor_history_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'thesis_advisor_history is append-only: DELETE is not permitted';
  end if;

  if old.id <> new.id
     or old.thesis_id <> new.thesis_id
     or old.advisor_id <> new.advisor_id
     or old.assigned_at <> new.assigned_at
     or old.assigned_by <> new.assigned_by
     or old.change_reason is distinct from new.change_reason
     or old.unassigned_at is not null
     or new.unassigned_at is null
  then
    raise exception 'thesis_advisor_history is append-only: only setting unassigned_at once, from NULL, is permitted';
  end if;

  return new;
end;
$$;

revoke all on function public.thesis_advisor_history_guard() from public;
revoke all on function public.thesis_advisor_history_guard() from anon;
revoke all on function public.thesis_advisor_history_guard() from authenticated;

create trigger thesis_advisor_history_no_delete
  before delete on public.thesis_advisor_history
  for each row
  execute function public.thesis_advisor_history_guard();

create trigger thesis_advisor_history_guarded_update
  before update on public.thesis_advisor_history
  for each row
  execute function public.thesis_advisor_history_guard();
