-- 0044_rpc_staff_get_student_graduation_status.sql
-- Batch 5, UC-46. Staff-only equivalent of 0043 for an arbitrary student.

create or replace function public.staff_get_student_graduation_status(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.graduation_records%rowtype;
  v_eligibility record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may view a student''s graduation status';
  end if;

  select * into v_record from public.graduation_records where student_id = p_student_id;
  if found then
    return jsonb_build_object(
      'is_graduated', true,
      'graduation_record', to_jsonb(v_record)
    );
  end if;

  select * into v_eligibility from public._compute_graduation_eligibility(p_student_id);

  return jsonb_build_object(
    'is_graduated', false,
    'graduation_record', null,
    'eligibility', to_jsonb(v_eligibility)
  );
end;
$$;

comment on function public.staff_get_student_graduation_status(uuid) is 'Staff-only (UC-46). Same shape as student_get_own_graduation_status but for an arbitrary student_id.';

revoke all on function public.staff_get_student_graduation_status(uuid) from public, anon;
grant execute on function public.staff_get_student_graduation_status(uuid) to authenticated;
