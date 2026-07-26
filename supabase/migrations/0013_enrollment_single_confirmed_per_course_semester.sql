-- 0013_enrollment_single_confirmed_per_course_semester.sql
-- Defense-in-depth guard for BUS-03: a student may not hold more than one
-- CONFIRMED enrollment for the same course within the same semester.
--
-- register_for_class() (0008) already evaluates this rule before insert, but
-- only for callers going through the RPC. This migration adds a database-level
-- constraint trigger so the rule holds even for inserts/updates that bypass
-- the RPC entirely (a service-role script, a manual psql session, a future RPC
-- that forgets the check). It intentionally does NOT touch REJECTED,
-- CANCELLED_BY_STUDENT or CANCELLED_BY_SCHOOL rows: a student may accumulate
-- any number of those for the same course/semester.
--
-- Why a trigger and not a unique index:
-- enrollments has no semester_id column (by design, see 0005) and a unique
-- index cannot join through course_classes -> registration_periods to compare
-- course_id + semester scope. registration_periods.semester_id is UNIQUE
-- (0002, BUS-13: at most one period per semester), so "same registration
-- period" and "same semester" are equivalent scopes here - the trigger uses
-- registration_period_id directly, no join to semesters is required.
--
-- Concurrency: this trigger acquires a `select ... for update` lock on the
-- student's own profiles row, mirroring the exact lock register_for_class()
-- already takes first (0008). Two calls - RPC or direct - inserting/updating
-- enrollments for the same student now serialize on that single row, so
-- neither can commit a conflicting CONFIRMED row after the other's check ran.
-- When fired from inside register_for_class(), the profile row is already
-- locked by the same transaction, so the extra `for update` is a no-op (same
-- xact, no self-block). The trigger never locks course_classes, so it adds no
-- new lock-order edge relative to register_for_class()'s (profile, then
-- class) ordering - no new deadlock potential is introduced.

create or replace function public.enforce_single_confirmed_enrollment_per_course_semester()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course_id uuid;
  v_registration_period_id uuid;
  v_conflict boolean;
begin
  if new.status <> 'CONFIRMED' then
    return new;
  end if;

  -- Serialize against every other registration attempt (RPC or direct) by
  -- this same student, using the same row/lock register_for_class() takes.
  perform 1 from public.profiles where id = new.student_id for update;

  select cc.course_id, cc.registration_period_id
    into v_course_id, v_registration_period_id
  from public.course_classes cc
  where cc.id = new.course_class_id;

  if v_course_id is null then
    raise exception 'course class not found for enrollment';
  end if;

  select exists (
    select 1
    from public.enrollments e
    join public.course_classes cc on cc.id = e.course_class_id
    where e.student_id = new.student_id
      and e.status = 'CONFIRMED'
      and e.id <> new.id
      and cc.course_id = v_course_id
      and cc.registration_period_id = v_registration_period_id
  ) into v_conflict;

  if v_conflict then
    raise exception 'Học viên đã có một đăng ký CONFIRMED cho môn học này trong cùng học kỳ'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_single_confirmed_enrollment_per_course_semester() is
  'BUS-03 defense in depth: blocks a second CONFIRMED enrollment for the same student/course/registration_period regardless of insert path. Locks profiles row to match register_for_class() lock order (profile before class; this trigger never locks course_classes).';

revoke all on function public.enforce_single_confirmed_enrollment_per_course_semester() from public;

create trigger enrollments_enforce_single_confirmed_per_course_semester
  before insert or update of status, course_class_id, student_id on public.enrollments
  for each row
  execute function public.enforce_single_confirmed_enrollment_per_course_semester();

comment on trigger enrollments_enforce_single_confirmed_per_course_semester on public.enrollments is
  'BUS-03 defense in depth: see public.enforce_single_confirmed_enrollment_per_course_semester().';
