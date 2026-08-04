-- 0034_rpc_catalog_research_areas_advisors.sql
-- Staff-only catalog management RPCs for research_areas and advisors
-- (BUS-54, BUS-58, BUS-59, BUS-61). Every RPC: SECURITY DEFINER, explicit
-- search_path, explicit role check in the body (RLS is not relied upon
-- alone), revoke all from public/anon, grant execute to authenticated only.

-- ---------------------------------------------------------------------------
-- research_areas
-- ---------------------------------------------------------------------------

create or replace function public.staff_create_research_area(
  p_name text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_row public.research_areas%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage research areas';
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Tên lĩnh vực nghiên cứu không được để trống.');
  end if;

  insert into public.research_areas (name, description, created_by, updated_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_staff_id, v_staff_id)
  returning * into v_row;

  return jsonb_build_object('success', true, 'research_area', to_jsonb(v_row));
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'reason', 'Tên lĩnh vực nghiên cứu này đã tồn tại.');
end;
$$;

create or replace function public.staff_update_research_area(
  p_id uuid,
  p_name text,
  p_description text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_row public.research_areas%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage research areas';
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Tên lĩnh vực nghiên cứu không được để trống.');
  end if;

  update public.research_areas
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      is_active = coalesce(p_is_active, is_active),
      updated_by = v_staff_id
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy lĩnh vực nghiên cứu.');
  end if;

  return jsonb_build_object('success', true, 'research_area', to_jsonb(v_row));
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'reason', 'Tên lĩnh vực nghiên cứu này đã tồn tại.');
end;
$$;

create or replace function public.staff_deactivate_research_area(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_row public.research_areas%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage research areas';
  end if;

  update public.research_areas
  set is_active = false, updated_by = v_staff_id
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy lĩnh vực nghiên cứu.');
  end if;

  return jsonb_build_object('success', true, 'research_area', to_jsonb(v_row));
end;
$$;

create or replace function public.staff_list_research_areas()
returns setof public.research_areas
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.research_areas
  where public.is_training_staff()
  order by name asc;
$$;

-- ---------------------------------------------------------------------------
-- advisors
-- ---------------------------------------------------------------------------

create or replace function public.staff_create_advisor(
  p_advisor_code text,
  p_full_name text,
  p_specialization text,
  p_max_active_theses integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_row public.advisors%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage advisors';
  end if;
  if p_advisor_code is null or btrim(p_advisor_code) = '' then
    return jsonb_build_object('success', false, 'reason', 'Mã giảng viên không được để trống.');
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Họ tên giảng viên không được để trống.');
  end if;
  if p_specialization is null or btrim(p_specialization) = '' then
    return jsonb_build_object('success', false, 'reason', 'Chuyên môn giảng viên không được để trống.');
  end if;
  if p_max_active_theses is null or p_max_active_theses <= 0 then
    return jsonb_build_object('success', false, 'reason', 'Số luận văn tối đa phải lớn hơn 0.');
  end if;

  insert into public.advisors (advisor_code, full_name, specialization, max_active_theses, created_by, updated_by)
  values (btrim(p_advisor_code), btrim(p_full_name), btrim(p_specialization), p_max_active_theses, v_staff_id, v_staff_id)
  returning * into v_row;

  return jsonb_build_object('success', true, 'advisor', to_jsonb(v_row));
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'reason', 'Mã giảng viên này đã tồn tại.');
end;
$$;

create or replace function public.staff_update_advisor(
  p_id uuid,
  p_full_name text,
  p_specialization text,
  p_max_active_theses integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_row public.advisors%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage advisors';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Họ tên giảng viên không được để trống.');
  end if;
  if p_specialization is null or btrim(p_specialization) = '' then
    return jsonb_build_object('success', false, 'reason', 'Chuyên môn giảng viên không được để trống.');
  end if;
  if p_max_active_theses is null or p_max_active_theses <= 0 then
    return jsonb_build_object('success', false, 'reason', 'Số luận văn tối đa phải lớn hơn 0.');
  end if;

  update public.advisors
  set full_name = btrim(p_full_name),
      specialization = btrim(p_specialization),
      max_active_theses = p_max_active_theses,
      updated_by = v_staff_id
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy giảng viên.');
  end if;

  return jsonb_build_object('success', true, 'advisor', to_jsonb(v_row));
end;
$$;

-- BUS-58/BUS-64: UX pre-check only. The DB trigger added in 0031 is the real
-- enforcement layer and applies regardless of whether this RPC is used.
create or replace function public.staff_deactivate_advisor(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_advisor public.advisors%rowtype;
  v_blocking jsonb;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may manage advisors';
  end if;

  select * into v_advisor from public.advisors where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy giảng viên.');
  end if;

  select jsonb_agg(jsonb_build_object('thesis_id', t.id, 'thesis_code', t.thesis_code))
  into v_blocking
  from public.theses t
  where t.advisor_id = p_id and t.status = 'IN_PROGRESS';

  if v_blocking is not null then
    return jsonb_build_object(
      'success', false,
      'reason', 'Không thể ngừng hoạt động giảng viên còn luận văn đang thực hiện. Vui lòng đổi giảng viên cho các luận văn sau trước.',
      'blocking_theses', v_blocking
    );
  end if;

  update public.advisors
  set is_active = false, updated_by = v_staff_id
  where id = p_id
  returning * into v_advisor;

  return jsonb_build_object('success', true, 'advisor', to_jsonb(v_advisor));
end;
$$;

create or replace function public.staff_list_advisors()
returns table (
  id uuid,
  advisor_code text,
  full_name text,
  specialization text,
  max_active_theses integer,
  is_active boolean,
  current_in_progress_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    a.id, a.advisor_code, a.full_name, a.specialization, a.max_active_theses, a.is_active,
    coalesce((select count(*) from public.theses t where t.advisor_id = a.id and t.status = 'IN_PROGRESS'), 0),
    a.created_at, a.updated_at
  from public.advisors a
  where public.is_training_staff()
  order by a.advisor_code asc;
$$;

-- ---------------------------------------------------------------------------
-- ACL hardening (Batch 3 lesson, docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md
-- section 8.3): explicitly revoke from public AND anon, grant to
-- authenticated only. Default privileges can grant anon EXECUTE directly,
-- bypassing a `revoke ... from public` alone.
-- ---------------------------------------------------------------------------

revoke all on function public.staff_create_research_area(text, text) from public;
revoke all on function public.staff_create_research_area(text, text) from anon;
grant execute on function public.staff_create_research_area(text, text) to authenticated;

revoke all on function public.staff_update_research_area(uuid, text, text, boolean) from public;
revoke all on function public.staff_update_research_area(uuid, text, text, boolean) from anon;
grant execute on function public.staff_update_research_area(uuid, text, text, boolean) to authenticated;

revoke all on function public.staff_deactivate_research_area(uuid) from public;
revoke all on function public.staff_deactivate_research_area(uuid) from anon;
grant execute on function public.staff_deactivate_research_area(uuid) to authenticated;

revoke all on function public.staff_list_research_areas() from public;
revoke all on function public.staff_list_research_areas() from anon;
grant execute on function public.staff_list_research_areas() to authenticated;

revoke all on function public.staff_create_advisor(text, text, text, integer) from public;
revoke all on function public.staff_create_advisor(text, text, text, integer) from anon;
grant execute on function public.staff_create_advisor(text, text, text, integer) to authenticated;

revoke all on function public.staff_update_advisor(uuid, text, text, integer) from public;
revoke all on function public.staff_update_advisor(uuid, text, text, integer) from anon;
grant execute on function public.staff_update_advisor(uuid, text, text, integer) to authenticated;

revoke all on function public.staff_deactivate_advisor(uuid) from public;
revoke all on function public.staff_deactivate_advisor(uuid) from anon;
grant execute on function public.staff_deactivate_advisor(uuid) to authenticated;

revoke all on function public.staff_list_advisors() from public;
revoke all on function public.staff_list_advisors() from anon;
grant execute on function public.staff_list_advisors() to authenticated;
