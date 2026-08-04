-- 0030_theses.sql
-- theses: one row is both the proposal and, once approved, the thesis itself
-- (BUS-38..51, BUS-56..57, BUS-60). Maps to
-- docs/BATCH_4_THESIS_ADVISOR_DESIGN.md section D.2.
--
-- thesis_code atomic generation (BUS-60): a per-year counter table plus a
-- single `insert ... on conflict (year) do update set last_seq = last_seq + 1
-- returning last_seq` statement. This single statement is atomic under
-- Postgres MVCC — concurrent inserts targeting the same year row serialize on
-- the row's implicit lock acquired by the UPSERT, so two concurrent callers
-- can never observe/return the same last_seq. This is the DB/RPC-level atomic
-- mechanism required by BUS-60 (no read-then-max in application code, no
-- client-supplied thesis_code, no retry-on-conflict as the primary strategy).

create table public.thesis_code_counters (
  year integer primary key,
  last_seq integer not null default 0
);

comment on table public.thesis_code_counters is 'Per-year sequential counter backing atomic thesis_code generation (LV-YYYY-XXXX, BUS-60). Only written via the atomic upsert inside student_create_thesis_proposal (0035); never exposed as an RPC/table to clients directly.';

create table public.theses (
  id uuid primary key default gen_random_uuid(),
  thesis_code text not null unique,
  student_id uuid not null references public.profiles (id),
  title text not null,
  description text not null,
  research_area_id uuid not null references public.research_areas (id),
  status text not null default 'PENDING_APPROVAL' check (
    status in ('PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED')
  ),
  advisor_id uuid references public.advisors (id),
  rejection_reason text,
  cancellation_reason text,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  advisor_assigned_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint theses_title_not_blank check (btrim(title) <> ''),
  constraint theses_description_not_blank check (btrim(description) <> ''),
  constraint theses_rejection_reason_requires_status check (
    (status = 'REJECTED' and rejection_reason is not null and btrim(rejection_reason) <> '')
    or (status <> 'REJECTED')
  )
);

comment on table public.theses is 'One row per thesis proposal/thesis, covering the full lifecycle PENDING_APPROVAL -> APPROVED/REJECTED -> IN_PROGRESS -> COMPLETED/CANCELLED (BUS-38..51). thesis_code is immutable once generated (BUS-60). All writes go through the RPCs in 0035-0037 (SECURITY DEFINER) -- no direct client INSERT/UPDATE policy is granted in RLS (0033).';

-- BUS-41: at most one ACTIVE thesis per student at a time. Postgres enforces
-- this itself via the partial unique index, so two concurrent
-- student_create_thesis_proposal calls for the same student can never both
-- succeed -- no manual locking required for this particular rule.
create unique index theses_one_active_per_student
  on public.theses (student_id)
  where status in ('PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS');

create index theses_student_idx on public.theses (student_id);
create index theses_advisor_idx on public.theses (advisor_id);
create index theses_status_idx on public.theses (status);
create index theses_research_area_idx on public.theses (research_area_id);

create trigger theses_set_updated_at
  before update on public.theses
  for each row
  execute function public.set_updated_at();

-- BUS-59 backstop (pre-apply review finding F-2): DB-level guard mirroring
-- 0031's advisor-deactivate trigger -- blocks any INSERT/UPDATE that would
-- leave a thesis IN_PROGRESS pointing at an inactive advisor, independent of
-- the RPC pre-checks in 0037 (staff_assign_advisor / staff_change_advisor).
-- Applies regardless of write path (service-role, direct SQL, a future RPC
-- bug), since theses has no client INSERT/UPDATE RLS policy at all (0033) --
-- the only legitimate writers are the SECURITY DEFINER RPCs, but this trigger
-- does not rely on that being true.
create or replace function public.theses_block_inactive_advisor_in_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_active boolean;
begin
  if new.status = 'IN_PROGRESS' and new.advisor_id is not null then
    select is_active into v_advisor_active from public.advisors where id = new.advisor_id;
    if v_advisor_active is null or v_advisor_active = false then
      raise exception 'Không thể gán/giữ giảng viên không còn hoạt động cho luận văn đang thực hiện.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.theses_block_inactive_advisor_in_progress() from public;
revoke all on function public.theses_block_inactive_advisor_in_progress() from anon;
revoke all on function public.theses_block_inactive_advisor_in_progress() from authenticated;

create trigger theses_block_inactive_advisor_in_progress
  before insert or update on public.theses
  for each row
  execute function public.theses_block_inactive_advisor_in_progress();

-- BUS-62/63 backstop (finding F-2): blocks INSERT or a change of
-- research_area_id that points to an inactive area. Scoped to "update of
-- research_area_id" so a thesis created before its area was deactivated keeps
-- referencing it untouched by any *other* column update (BUS-63) -- this
-- trigger only fires when research_area_id itself is part of the UPDATE's SET
-- list, not on every row touch.
create or replace function public.theses_block_inactive_research_area()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_area_active boolean;
begin
  select is_active into v_area_active from public.research_areas where id = new.research_area_id;
  if v_area_active is null or v_area_active = false then
    raise exception 'Lĩnh vực nghiên cứu không hợp lệ hoặc đã ngừng hoạt động.';
  end if;
  return new;
end;
$$;

revoke all on function public.theses_block_inactive_research_area() from public;
revoke all on function public.theses_block_inactive_research_area() from anon;
revoke all on function public.theses_block_inactive_research_area() from authenticated;

create trigger theses_block_inactive_research_area_insert
  before insert on public.theses
  for each row
  execute function public.theses_block_inactive_research_area();

create trigger theses_block_inactive_research_area_update
  before update of research_area_id on public.theses
  for each row
  execute function public.theses_block_inactive_research_area();

-- Finding F-3: staff-initiated cancellation (from APPROVED/IN_PROGRESS) must
-- always carry a non-blank cancellation_reason (BUS-47), while a student
-- self-cancel out of PENDING_APPROVAL requires no reason (BUS-46). A plain
-- CHECK constraint cannot distinguish these two cases because it only sees
-- NEW, not the prior status -- so this is a transition-aware trigger instead,
-- mirroring the asymmetry already documented for theses_rejection_reason_
-- requires_status but keyed off OLD.status.
create or replace function public.theses_require_cancellation_reason()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'CANCELLED' and old.status in ('APPROVED', 'IN_PROGRESS') then
    if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
      raise exception 'Phải nhập lý do khi hủy luận văn đã duyệt hoặc đang thực hiện.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.theses_require_cancellation_reason() from public;
revoke all on function public.theses_require_cancellation_reason() from anon;
revoke all on function public.theses_require_cancellation_reason() from authenticated;

create trigger theses_require_cancellation_reason
  before update on public.theses
  for each row
  execute function public.theses_require_cancellation_reason();
