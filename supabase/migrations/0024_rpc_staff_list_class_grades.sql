-- 0024_rpc_staff_list_class_grades.sql
-- staff_list_class_grades(p_course_class_id): roster of CONFIRMED enrollments
-- for a class plus their current grade state, for the staff grade-entry
-- screen (UC-24, J.1/J.2).

create or replace function public.staff_list_class_grades(p_course_class_id uuid)
returns table (
  enrollment_id uuid,
  student_id uuid,
  student_code text,
  full_name text,
  grade_id uuid,
  final_score numeric,
  grade_status text,
  result_status text,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may list class grades';
  end if;

  return query
  select
    e.id,
    e.student_id,
    p.student_code,
    p.full_name,
    g.id,
    g.final_score,
    g.grade_status,
    g.result_status,
    g.published_at
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  left join public.enrollment_grades g on g.enrollment_id = e.id
  where e.course_class_id = p_course_class_id
    and e.status = 'CONFIRMED'
  order by p.full_name asc;
end;
$$;

comment on function public.staff_list_class_grades(uuid) is 'Staff-only. Roster of CONFIRMED enrollments for a course class with their current grade state (grade_id/grade_status/etc. are null when no grade row exists yet). UC-24.';

-- Batch 3 P3 hardening (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.3):
-- explicit revoke from anon, not just public — see 0023 header comment.
revoke all on function public.staff_list_class_grades(uuid) from public;
revoke all on function public.staff_list_class_grades(uuid) from anon;
grant execute on function public.staff_list_class_grades(uuid) to authenticated;
