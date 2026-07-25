-- 0008_rpc_register_for_class.sql
-- register_for_class(p_class_id): the single entry point for student registration.
-- Implements BUS-01..BUS-07, BUS-09, BUS-15 in one transaction-safe function.
--
-- Two row locks make this function safe under concurrency:
-- 1. profiles row (select ... for update), taken immediately after resolving
--    auth.uid(): this serializes ALL registration attempts by the same
--    student, even against different classes. Without it, two concurrent
--    requests for two different classes could each read the same
--    "not-yet-updated" confirmed-credit total and both pass the BUS-05 credit
--    check, or both pass the BUS-03 duplicate-course / BUS-04 schedule-conflict
--    checks, because neither request's INSERT is visible to the other until
--    commit. Locking the student's own profile row forces the second request
--    to wait for the first to finish (commit or rollback) before it reads
--    enrollments, so BUS-03/BUS-04/BUS-05 are evaluated against a
--    consistent, up-to-date view.
-- 2. course_classes row (select ... for update), taken next: this serializes
--    concurrent registration attempts against the same class, which is what
--    makes the seat check further down atomic (BUS-07) - no two transactions
--    can both read "one seat left" and both insert a CONFIRMED row.
-- Locks are always acquired in this order (profile, then class) across every
-- call, so this cannot deadlock against itself.

create or replace function public.register_for_class(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_class public.course_classes%rowtype;
  v_period public.registration_periods%rowtype;
  v_course public.courses%rowtype;
  v_reason text := null;
  v_enrollment_id uuid;
  v_status text;
  v_confirmed_credits integer;
  v_confirmed_seats integer;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the student's own profile row for the remainder of this transaction.
  -- This serializes every registration attempt by this student (across all
  -- classes), which is what makes BUS-03/BUS-04/BUS-05 safe under concurrency.
  select * into v_profile from public.profiles where id = v_student_id for update;
  if not found or v_profile.role <> 'STUDENT' then
    raise exception 'only students may register for a class';
  end if;

  -- Lock the class row for the remainder of this transaction: this is the
  -- atomic allocation point referenced by BUS-07.
  select * into v_class from public.course_classes where id = p_class_id for update;
  if not found then
    raise exception 'course class not found';
  end if;

  select * into v_period from public.registration_periods where id = v_class.registration_period_id;
  select * into v_course from public.courses where id = v_class.course_id;

  -- Evaluate business rules in order; the first failure determines the
  -- rejection reason (BUS-09 requires a specific reason on REJECTED rows).
  if v_profile.student_status <> 'ACTIVE' then
    v_reason := 'Học viên không ở trạng thái đang học';
  elsif now() < v_period.opens_at or now() > v_period.closes_at then
    v_reason := 'Đợt đăng ký không còn mở';
  elsif v_class.status <> 'ACTIVE' then
    v_reason := 'Lớp học phần đã bị hủy';
  elsif exists (
    select 1
    from public.enrollments e
    join public.course_classes cc on cc.id = e.course_class_id
    where e.student_id = v_student_id
      and e.status = 'CONFIRMED'
      and cc.registration_period_id = v_class.registration_period_id
      and cc.course_id = v_class.course_id
  ) then
    v_reason := 'Đã đăng ký môn này trong học kỳ';
  elsif exists (
    select 1
    from public.enrollments e
    join public.class_schedules cs_existing on cs_existing.course_class_id = e.course_class_id
    join public.class_schedules cs_new on cs_new.course_class_id = p_class_id
    where e.student_id = v_student_id
      and e.status = 'CONFIRMED'
      and cs_existing.day_of_week = cs_new.day_of_week
      and cs_existing.session_slot = cs_new.session_slot
  ) then
    v_reason := 'Trùng lịch học với lớp đã đăng ký';
  else
    select coalesce(sum(c.credits), 0) into v_confirmed_credits
    from public.enrollments e
    join public.course_classes cc on cc.id = e.course_class_id
    join public.courses c on c.id = cc.course_id
    where e.student_id = v_student_id
      and e.status = 'CONFIRMED'
      and cc.registration_period_id = v_class.registration_period_id;

    if v_confirmed_credits + v_course.credits > v_period.max_credits then
      v_reason := 'Vượt giới hạn tín chỉ cho phép';
    else
      select count(*) into v_confirmed_seats
      from public.enrollments e
      where e.course_class_id = p_class_id
        and e.status = 'CONFIRMED';

      if v_confirmed_seats >= v_class.max_seats then
        v_reason := 'Lớp đã đủ sĩ số';
      end if;
    end if;
  end if;

  v_status := case when v_reason is null then 'CONFIRMED' else 'REJECTED' end;

  insert into public.enrollments (student_id, course_class_id, status, reason)
  values (v_student_id, p_class_id, v_status, v_reason)
  returning id into v_enrollment_id;

  insert into public.enrollment_history (enrollment_id, status, reason)
  values (v_enrollment_id, v_status, v_reason);

  return jsonb_build_object(
    'success', v_status = 'CONFIRMED',
    'enrollment_id', v_enrollment_id,
    'status', v_status,
    'reason', v_reason
  );
end;
$$;

comment on function public.register_for_class(uuid) is 'Student self-registration. Evaluates BUS-01..BUS-07/BUS-15 atomically and always writes an enrollment + history row.';

revoke all on function public.register_for_class(uuid) from public;
grant execute on function public.register_for_class(uuid) to authenticated;
