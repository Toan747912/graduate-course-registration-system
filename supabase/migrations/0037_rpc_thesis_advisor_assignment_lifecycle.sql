-- 0037_rpc_thesis_advisor_assignment_lifecycle.sql
-- Training-staff RPCs for the advisor-bearing part of the lifecycle:
-- assign (transition #5), change (transition #9), cancel (#6/#8),
-- complete (#7), and reading the advisor history (BUS-45..53, BUS-59).
--
-- Concurrency: both staff_assign_advisor and staff_change_advisor lock the
-- target advisor row with SELECT ... FOR UPDATE, then recount current
-- IN_PROGRESS theses inside the same transaction before deciding whether
-- there is remaining capacity, so two concurrent assignment requests against
-- an advisor with exactly one remaining slot cannot both succeed (BUS-49,
-- design doc D.5/H.2).

create or replace function public.staff_assign_advisor(p_thesis_id uuid, p_advisor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_thesis public.theses%rowtype;
  v_advisor public.advisors%rowtype;
  v_current_load integer;
  v_row public.theses%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may assign an advisor';
  end if;

  select * into v_thesis from public.theses where id = p_thesis_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;
  if v_thesis.status <> 'APPROVED' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể phân công giảng viên cho luận văn đã duyệt.');
  end if;

  select * into v_advisor from public.advisors where id = p_advisor_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy giảng viên.');
  end if;
  if v_advisor.is_active = false then
    return jsonb_build_object('success', false, 'reason', 'Giảng viên này không còn hoạt động.');
  end if;

  select count(*) into v_current_load from public.theses
  where advisor_id = p_advisor_id and status = 'IN_PROGRESS';

  if v_current_load >= v_advisor.max_active_theses then
    return jsonb_build_object('success', false, 'reason', 'Giảng viên đã đạt số luận văn hướng dẫn tối đa.');
  end if;

  update public.theses
  set status = 'IN_PROGRESS', advisor_id = p_advisor_id, advisor_assigned_at = now()
  where id = p_thesis_id
  returning * into v_row;

  insert into public.thesis_advisor_history (thesis_id, advisor_id, assigned_at, assigned_by, change_reason)
  values (p_thesis_id, p_advisor_id, now(), v_staff_id, null);

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

create or replace function public.staff_change_advisor(p_thesis_id uuid, p_new_advisor_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_thesis public.theses%rowtype;
  v_advisor public.advisors%rowtype;
  v_current_load integer;
  v_row public.theses%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may change an advisor';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'reason', 'Vui lòng nhập lý do đổi giảng viên.');
  end if;

  select * into v_thesis from public.theses where id = p_thesis_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;
  if v_thesis.status <> 'IN_PROGRESS' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể đổi giảng viên khi luận văn đang thực hiện.');
  end if;

  select * into v_advisor from public.advisors where id = p_new_advisor_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy giảng viên.');
  end if;
  if v_advisor.is_active = false then
    return jsonb_build_object('success', false, 'reason', 'Giảng viên này không còn hoạt động.');
  end if;
  if p_new_advisor_id = v_thesis.advisor_id then
    return jsonb_build_object('success', false, 'reason', 'Giảng viên mới phải khác giảng viên hiện tại.');
  end if;

  select count(*) into v_current_load from public.theses
  where advisor_id = p_new_advisor_id and status = 'IN_PROGRESS';

  if v_current_load >= v_advisor.max_active_theses then
    return jsonb_build_object('success', false, 'reason', 'Giảng viên đã đạt số luận văn hướng dẫn tối đa.');
  end if;

  update public.thesis_advisor_history
  set unassigned_at = now()
  where thesis_id = p_thesis_id and advisor_id = v_thesis.advisor_id and unassigned_at is null;

  update public.theses
  set advisor_id = p_new_advisor_id, advisor_assigned_at = now()
  where id = p_thesis_id
  returning * into v_row;

  insert into public.thesis_advisor_history (thesis_id, advisor_id, assigned_at, assigned_by, change_reason)
  values (p_thesis_id, p_new_advisor_id, now(), v_staff_id, btrim(p_reason));

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- transition #6/#8 (BUS-47/48)
create or replace function public.staff_cancel_thesis(p_id uuid, p_reason text)
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
    raise exception 'only training staff may cancel a thesis at this stage';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'reason', 'Vui lòng nhập lý do hủy.');
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;

  if v_thesis.status = 'COMPLETED' then
    return jsonb_build_object('success', false, 'reason', 'Không thể hủy luận văn đã hoàn thành.');
  end if;
  if v_thesis.status not in ('APPROVED', 'IN_PROGRESS') then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể hủy luận văn ở trạng thái đã duyệt hoặc đang thực hiện.');
  end if;

  update public.theses
  set status = 'CANCELLED', cancellation_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = v_staff_id
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- transition #7
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

  update public.theses
  set status = 'COMPLETED', completed_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

create or replace function public.staff_get_thesis_advisor_history(p_thesis_id uuid)
returns setof public.thesis_advisor_history
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may view advisor history via this RPC';
  end if;

  return query select * from public.thesis_advisor_history where thesis_id = p_thesis_id order by assigned_at asc;
end;
$$;

create or replace function public.student_get_own_thesis_advisor_history(p_thesis_id uuid)
returns setof public.thesis_advisor_history
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  return query
  select h.* from public.thesis_advisor_history h
  join public.theses t on t.id = h.thesis_id
  where h.thesis_id = p_thesis_id and t.student_id = v_student_id
  order by h.assigned_at asc;
end;
$$;

revoke all on function public.staff_assign_advisor(uuid, uuid) from public;
revoke all on function public.staff_assign_advisor(uuid, uuid) from anon;
grant execute on function public.staff_assign_advisor(uuid, uuid) to authenticated;

revoke all on function public.staff_change_advisor(uuid, uuid, text) from public;
revoke all on function public.staff_change_advisor(uuid, uuid, text) from anon;
grant execute on function public.staff_change_advisor(uuid, uuid, text) to authenticated;

revoke all on function public.staff_cancel_thesis(uuid, text) from public;
revoke all on function public.staff_cancel_thesis(uuid, text) from anon;
grant execute on function public.staff_cancel_thesis(uuid, text) to authenticated;

revoke all on function public.staff_complete_thesis(uuid) from public;
revoke all on function public.staff_complete_thesis(uuid) from anon;
grant execute on function public.staff_complete_thesis(uuid) to authenticated;

revoke all on function public.staff_get_thesis_advisor_history(uuid) from public;
revoke all on function public.staff_get_thesis_advisor_history(uuid) from anon;
grant execute on function public.staff_get_thesis_advisor_history(uuid) to authenticated;

revoke all on function public.student_get_own_thesis_advisor_history(uuid) from public;
revoke all on function public.student_get_own_thesis_advisor_history(uuid) from anon;
grant execute on function public.student_get_own_thesis_advisor_history(uuid) to authenticated;
