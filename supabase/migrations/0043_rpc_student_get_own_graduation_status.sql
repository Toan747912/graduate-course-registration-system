-- 0043_rpc_student_get_own_graduation_status.sql
-- Batch 5, UC-43. Returns the caller's existing graduation_records row if
-- one exists (already GRADUATED), otherwise the live eligibility computed by
-- the shared helper (0042).

create or replace function public.student_get_own_graduation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_record public.graduation_records%rowtype;
  v_eligibility record;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_record from public.graduation_records where student_id = v_student_id;
  if found then
    return jsonb_build_object(
      'is_graduated', true,
      'graduation_record', to_jsonb(v_record)
    );
  end if;

  select * into v_eligibility from public._compute_graduation_eligibility(v_student_id);

  return jsonb_build_object(
    'is_graduated', false,
    'graduation_record', null,
    'eligibility', to_jsonb(v_eligibility)
  );
end;
$$;

comment on function public.student_get_own_graduation_status() is 'Any authenticated student (UC-43). Own graduation_records row if it exists, otherwise live eligibility via _compute_graduation_eligibility (0042).';

revoke all on function public.student_get_own_graduation_status() from public, anon;
grant execute on function public.student_get_own_graduation_status() to authenticated;
