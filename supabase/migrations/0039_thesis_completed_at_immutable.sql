-- 0039_thesis_completed_at_immutable.sql
-- Batch 5 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md), D.1.1 / BUS-79.
--
-- Discovery: `theses.completed_at timestamptz NULL` already exists on
-- public.theses (added in migration 0030_theses.sql) and
-- public.staff_complete_thesis (migration 0037) already sets it to now() on
-- the IN_PROGRESS -> COMPLETED transition. The design doc's migration plan
-- describes adding this column as new; in this repo it is already present,
-- so this migration does NOT add a column (it already exists) and instead
-- re-creates staff_complete_thesis with the explicit idempotency guard
-- required by BUS-79 (`where completed_at is null`), so a future accidental
-- re-invocation of the completion transition can never overwrite an
-- already-set completed_at. No other RPC may ever write this column.
--
-- This is the only migration in Batch 5 permitted to touch a Batch 4 RPC
-- body (staff_complete_thesis), per the design doc's migration plan (0039).

create or replace function public.staff_complete_thesis(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_thesis public.theses%rowtype;
  v_row public.theses%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may complete a thesis';
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;
  if v_thesis.status <> 'IN_PROGRESS' or v_thesis.advisor_id is null then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể đánh dấu hoàn thành luận văn đang thực hiện và đã có giảng viên.');
  end if;

  -- BUS-79: completed_at is set exactly once, only here, and never
  -- overwritten if it is somehow already non-null (defensive; in practice
  -- the status guard above already makes a second call impossible since the
  -- row would no longer be IN_PROGRESS after the first successful call).
  update public.theses
  set status = 'COMPLETED', completed_at = coalesce(completed_at, now())
  where id = p_id
    and completed_at is null
  returning * into v_row;

  if not found then
    -- completed_at was already set (should be unreachable given the status
    -- guard above, kept as a defense-in-depth business error rather than a
    -- silent no-op or a generic exception).
    return jsonb_build_object('success', false, 'reason', 'Luận văn đã được đánh dấu hoàn thành trước đó.');
  end if;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

comment on function public.staff_complete_thesis(uuid) is 'Staff-only. IN_PROGRESS -> COMPLETED transition. Sets completed_at exactly once (BUS-79, D.1.1) via `where completed_at is null`; no other RPC may ever write theses.completed_at.';

revoke all on function public.staff_complete_thesis(uuid) from public, anon;
grant execute on function public.staff_complete_thesis(uuid) to authenticated;

-- Batch 5 P2 (docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md): the guard above is
-- RPC-level only (`where completed_at is null`) and does nothing to stop a
-- raw `update public.theses set completed_at = ...` issued outside this RPC
-- (service-role script, a future RPC bug, direct SQL). Add a DB-level
-- trigger so the invariant holds regardless of write path, mirroring the
-- trigger-backstop pattern already used for advisor/research-area guards in
-- 0030/0031.
--
-- Backfill first, *before* the trigger exists: any pre-existing COMPLETED
-- thesis without completed_at gets stamped now while there is still no
-- trigger installed to reject the write. Once the trigger below is created,
-- this exact statement would itself be rejected (COMPLETED rows are not
-- mid-transition IN_PROGRESS -> COMPLETED), so the ordering here is load
-- bearing, not cosmetic.
update public.theses
set completed_at = now()
where status = 'COMPLETED' and completed_at is null;

create or replace function public.theses_completed_at_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.completed_at is not null then
      raise exception 'Không thể tạo luận văn với completed_at đã được thiết lập.';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.
  if new.completed_at is distinct from old.completed_at then
    if old.completed_at is not null then
      raise exception 'completed_at là bất biến sau khi đã được thiết lập.';
    end if;
    if not (old.status = 'IN_PROGRESS' and new.status = 'COMPLETED') then
      raise exception 'completed_at chỉ được thiết lập khi chuyển trạng thái từ IN_PROGRESS sang COMPLETED.';
    end if;
  end if;

  if new.status <> 'COMPLETED' and new.completed_at is not null then
    raise exception 'completed_at phải là NULL khi trạng thái luận văn không phải COMPLETED.';
  end if;

  return new;
end;
$$;

comment on function public.theses_completed_at_guard() is 'Batch 5 P2 DB-level backstop: blocks any INSERT/UPDATE (raw SQL, service-role, future RPC bug) that sets/clears/overwrites theses.completed_at outside the exact IN_PROGRESS -> COMPLETED transition performed by staff_complete_thesis. Not reachable by anon/authenticated directly (no execute grant); fires as a row trigger on all writes to public.theses.';

revoke all on function public.theses_completed_at_guard() from public;
revoke all on function public.theses_completed_at_guard() from anon;
revoke all on function public.theses_completed_at_guard() from authenticated;

create trigger theses_completed_at_guard
  before insert or update on public.theses
  for each row
  execute function public.theses_completed_at_guard();
