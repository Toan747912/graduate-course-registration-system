-- 0035_rpc_thesis_proposal.sql
-- Student-facing thesis proposal RPCs (BUS-38..42, BUS-46, BUS-56, BUS-57,
-- BUS-60, BUS-62). Reuses public._student_progress (0025, Batch 3) read-only
-- to check the credit threshold -- never re-implements or edits that
-- function.

-- ---------------------------------------------------------------------------
-- student_check_thesis_eligibility: read-only, tells the caller whether they
-- may create a proposal right now and why not, without side effects.
-- ---------------------------------------------------------------------------
create or replace function public.student_check_thesis_eligibility()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_thesis_credits_min integer;
  v_earned integer;
  v_has_active boolean;
  v_reasons text[] := array[]::text[];
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles where id = v_student_id;
  if not found or v_profile.role <> 'STUDENT' then
    raise exception 'only a student may check their own thesis eligibility';
  end if;

  if v_profile.academic_status <> 'STUDYING' then
    v_reasons := array_append(v_reasons, 'Trạng thái học tập hiện tại không phải Đang học.');
  end if;

  if v_profile.program_id is null then
    v_reasons := array_append(v_reasons, 'Chưa được gán chương trình đào tạo.');
  end if;

  select p.thesis_credits_min into v_thesis_credits_min
  from public.programs p where p.id = v_profile.program_id;

  if v_profile.program_id is not null then
    select coalesce(required_credits_earned, 0) + coalesce(elective_credits_earned, 0)
    into v_earned
    from public._student_progress(v_student_id);

    if v_thesis_credits_min is not null and coalesce(v_earned, 0) < v_thesis_credits_min then
      v_reasons := array_append(
        v_reasons,
        format('Chưa đủ tín chỉ tích lũy (hiện có %s, cần tối thiểu %s).', coalesce(v_earned, 0), v_thesis_credits_min)
      );
    end if;
  end if;

  select exists (
    select 1 from public.theses
    where student_id = v_student_id
      and status in ('PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS')
  ) into v_has_active;

  if v_has_active then
    v_reasons := array_append(v_reasons, 'Đã có một luận văn đang hoạt động.');
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_reasons, 1) is null,
    'reasons', to_jsonb(v_reasons),
    'current_credits', coalesce(v_earned, 0),
    'thesis_credits_min', v_thesis_credits_min
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- student_create_thesis_proposal: transition #1 (BUS-38..42, BUS-60, BUS-62).
-- thesis_code generated atomically via thesis_code_counters upsert.
-- ---------------------------------------------------------------------------
create or replace function public.student_create_thesis_proposal(
  p_title text,
  p_description text,
  p_research_area_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_thesis_credits_min integer;
  v_earned integer;
  v_area public.research_areas%rowtype;
  v_year integer := extract(year from now())::integer;
  v_seq integer;
  v_thesis_code text;
  v_row public.theses%rowtype;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles where id = v_student_id;
  if not found or v_profile.role <> 'STUDENT' then
    raise exception 'only a student may create their own thesis proposal';
  end if;

  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('success', false, 'reason', 'Tiêu đề đề xuất không được để trống.');
  end if;
  if p_description is null or btrim(p_description) = '' then
    return jsonb_build_object('success', false, 'reason', 'Mô tả đề xuất không được để trống.');
  end if;
  if p_research_area_id is null then
    return jsonb_build_object('success', false, 'reason', 'Vui lòng chọn lĩnh vực nghiên cứu.');
  end if;

  if v_profile.academic_status <> 'STUDYING' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ học viên đang học mới được tạo đề xuất luận văn.');
  end if;

  if v_profile.program_id is null then
    return jsonb_build_object('success', false, 'reason', 'Bạn chưa được gán chương trình đào tạo.');
  end if;

  select p.thesis_credits_min into v_thesis_credits_min
  from public.programs p where p.id = v_profile.program_id;

  select coalesce(required_credits_earned, 0) + coalesce(elective_credits_earned, 0)
  into v_earned
  from public._student_progress(v_student_id);

  if v_thesis_credits_min is not null and coalesce(v_earned, 0) < v_thesis_credits_min then
    return jsonb_build_object(
      'success', false,
      'reason', format('Chưa đủ tín chỉ tích lũy (hiện có %s, cần tối thiểu %s).', coalesce(v_earned, 0), v_thesis_credits_min)
    );
  end if;

  select * into v_area from public.research_areas where id = p_research_area_id for share;
  if not found or v_area.is_active = false then
    return jsonb_build_object('success', false, 'reason', 'Lĩnh vực nghiên cứu không hợp lệ hoặc đã ngừng hoạt động.');
  end if;

  -- BUS-60: atomic per-year counter upsert. Concurrent callers in the same
  -- year serialize on this row's lock; each gets a distinct v_seq.
  insert into public.thesis_code_counters (year, last_seq)
  values (v_year, 1)
  on conflict (year) do update set last_seq = public.thesis_code_counters.last_seq + 1
  returning last_seq into v_seq;

  v_thesis_code := format('LV-%s-%s', v_year, lpad(v_seq::text, 4, '0'));

  begin
    insert into public.theses (thesis_code, student_id, title, description, research_area_id, status)
    values (v_thesis_code, v_student_id, btrim(p_title), btrim(p_description), p_research_area_id, 'PENDING_APPROVAL')
    returning * into v_row;
  exception
    when unique_violation then
      -- BUS-41 (one active thesis per student) via the partial unique index,
      -- or an extremely unlikely thesis_code collision. Either way, no
      -- silent retry: report a clear business error.
      return jsonb_build_object('success', false, 'reason', 'Bạn đã có một luận văn đang hoạt động, không thể tạo đề xuất mới.');
  end;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- student_update_own_thesis_proposal: transition #0 (BUS-56, BUS-57, BUS-62).
-- ---------------------------------------------------------------------------
create or replace function public.student_update_own_thesis_proposal(
  p_id uuid,
  p_title text,
  p_description text,
  p_research_area_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_thesis public.theses%rowtype;
  v_area public.research_areas%rowtype;
  v_row public.theses%rowtype;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found or v_thesis.student_id <> v_student_id then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy đề xuất luận văn.');
  end if;

  if v_thesis.status <> 'PENDING_APPROVAL' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể sửa đề xuất khi còn chờ duyệt.');
  end if;

  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('success', false, 'reason', 'Tiêu đề đề xuất không được để trống.');
  end if;
  if p_description is null or btrim(p_description) = '' then
    return jsonb_build_object('success', false, 'reason', 'Mô tả đề xuất không được để trống.');
  end if;
  if p_research_area_id is null then
    return jsonb_build_object('success', false, 'reason', 'Vui lòng chọn lĩnh vực nghiên cứu.');
  end if;

  select * into v_area from public.research_areas where id = p_research_area_id for share;
  if not found or v_area.is_active = false then
    return jsonb_build_object('success', false, 'reason', 'Lĩnh vực nghiên cứu không hợp lệ hoặc đã ngừng hoạt động.');
  end if;

  update public.theses
  set title = btrim(p_title), description = btrim(p_description), research_area_id = p_research_area_id
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- student_cancel_own_thesis: transition #4 (BUS-46). Reason optional.
-- ---------------------------------------------------------------------------
create or replace function public.student_cancel_own_thesis(
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_thesis public.theses%rowtype;
  v_row public.theses%rowtype;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_thesis from public.theses where id = p_id for update;
  if not found or v_thesis.student_id <> v_student_id then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy đề xuất luận văn.');
  end if;

  if v_thesis.status <> 'PENDING_APPROVAL' then
    return jsonb_build_object('success', false, 'reason', 'Chỉ có thể tự hủy đề xuất khi còn chờ duyệt.');
  end if;

  update public.theses
  set status = 'CANCELLED', cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      cancelled_at = now(), cancelled_by = v_student_id
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- read RPCs
-- ---------------------------------------------------------------------------
create or replace function public.student_get_own_theses()
returns setof public.theses
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.theses where student_id = auth.uid() order by created_at desc;
$$;

create or replace function public.student_get_own_thesis(p_id uuid)
returns setof public.theses
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.theses where id = p_id and student_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- ACL hardening: revoke public+anon, grant authenticated only.
-- ---------------------------------------------------------------------------

revoke all on function public.student_check_thesis_eligibility() from public;
revoke all on function public.student_check_thesis_eligibility() from anon;
grant execute on function public.student_check_thesis_eligibility() to authenticated;

revoke all on function public.student_create_thesis_proposal(text, text, uuid) from public;
revoke all on function public.student_create_thesis_proposal(text, text, uuid) from anon;
grant execute on function public.student_create_thesis_proposal(text, text, uuid) to authenticated;

revoke all on function public.student_update_own_thesis_proposal(uuid, text, text, uuid) from public;
revoke all on function public.student_update_own_thesis_proposal(uuid, text, text, uuid) from anon;
grant execute on function public.student_update_own_thesis_proposal(uuid, text, text, uuid) to authenticated;

revoke all on function public.student_cancel_own_thesis(uuid, text) from public;
revoke all on function public.student_cancel_own_thesis(uuid, text) from anon;
grant execute on function public.student_cancel_own_thesis(uuid, text) to authenticated;

revoke all on function public.student_get_own_theses() from public;
revoke all on function public.student_get_own_theses() from anon;
grant execute on function public.student_get_own_theses() to authenticated;

revoke all on function public.student_get_own_thesis(uuid) from public;
revoke all on function public.student_get_own_thesis(uuid) from anon;
grant execute on function public.student_get_own_thesis(uuid) to authenticated;
