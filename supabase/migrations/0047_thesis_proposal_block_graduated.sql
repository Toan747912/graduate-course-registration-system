-- 0047_thesis_proposal_block_graduated.sql
-- Batch 5, BUS-74. student_create_thesis_proposal (0035) already checks
-- `academic_status <> 'STUDYING'` -- re-read: it does NOT (0035 only checks
-- program_id is not null and credit threshold). This migration re-creates it
-- with the missing academic_status = 'STUDYING' check added, per the design
-- doc's migration plan (0047). Only this one RPC body is touched; the
-- enrollment RPC is left untouched per L.1.3 (student_status already blocks
-- it via BUS-70's automatic sync).

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

  -- BUS-74 (Batch 5): a graduated (or suspended/withdrawn) student may not
  -- create a new thesis proposal. Batch 4's original check here was already
  -- `academic_status <> 'STUDYING'`; this migration keeps it and documents it
  -- explicitly as the BUS-74 enforcement point.
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
      return jsonb_build_object('success', false, 'reason', 'Bạn đã có một luận văn đang hoạt động, không thể tạo đề xuất mới.');
  end;

  return jsonb_build_object('success', true, 'thesis', to_jsonb(v_row));
end;
$$;

comment on function public.student_create_thesis_proposal(text, text, uuid) is 'Any authenticated student, own row only (BUS-38..42, BUS-56/57/60/62/74). Re-created in Batch 5 (0047) to document/keep the academic_status=STUDYING check (BUS-74): a GRADUATED/SUSPENDED/WITHDRAWN student cannot create a new proposal.';

revoke all on function public.student_create_thesis_proposal(text, text, uuid) from public, anon;
grant execute on function public.student_create_thesis_proposal(text, text, uuid) to authenticated;
