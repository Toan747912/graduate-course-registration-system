-- 0036_rpc_thesis_staff_review.sql
-- Training-staff RPCs: list/get all theses, approve, reject (BUS-42..44).

create or replace function public.staff_list_theses(p_status text)
returns setof public.theses
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may list theses';
  end if;

  if p_status is null then
    return query select * from public.theses order by created_at desc;
  else
    return query select * from public.theses where status = p_status order by created_at desc;
  end if;
end;
$$;

create or replace function public.staff_get_thesis(p_id uuid)
returns setof public.theses
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may view thesis details';
  end if;

  return query select * from public.theses where id = p_id;
end;
$$;

-- transition #2 (BUS-43)
create or replace function public.staff_approve_thesis(p_id uuid)
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
    raise exception 'only training staff may approve a thesis';
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;

  if v_thesis.status <> 'PENDING_APPROVAL' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể duyệt đề xuất đang chờ duyệt.');
  end if;

  update public.theses
  set status = 'APPROVED', approved_at = now(), approved_by = v_staff_id
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- transition #3 (BUS-44), rejection_reason required
create or replace function public.staff_reject_thesis(p_id uuid, p_reason text)
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
    raise exception 'only training staff may reject a thesis';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'reason', 'Vui lòng nhập lý do từ chối.');
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy luận văn.');
  end if;

  if v_thesis.status <> 'PENDING_APPROVAL' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể từ chối đề xuất đang chờ duyệt.');
  end if;

  update public.theses
  set status = 'REJECTED', rejection_reason = btrim(p_reason)
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

revoke all on function public.staff_list_theses(text) from public;
revoke all on function public.staff_list_theses(text) from anon;
grant execute on function public.staff_list_theses(text) to authenticated;

revoke all on function public.staff_get_thesis(uuid) from public;
revoke all on function public.staff_get_thesis(uuid) from anon;
grant execute on function public.staff_get_thesis(uuid) to authenticated;

revoke all on function public.staff_approve_thesis(uuid) from public;
revoke all on function public.staff_approve_thesis(uuid) from anon;
grant execute on function public.staff_approve_thesis(uuid) to authenticated;

revoke all on function public.staff_reject_thesis(uuid, text) from public;
revoke all on function public.staff_reject_thesis(uuid, text) from anon;
grant execute on function public.staff_reject_thesis(uuid, text) to authenticated;
