-- 0049_harden_graduation_status_transition.sql
-- Batch 5 hardening (docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md, Finding #1,
-- P1). staff_update_student (0019, Batch 2, never touched by 0039-0048)
-- allowed TRAINING_STAFF to set profiles.academic_status = 'GRADUATED'
-- directly (bypassing staff_confirm_graduation's eligibility check and
-- graduation_records snapshot, BUS-68/69) and to revert an already-GRADUATED
-- student back to any other status (violating BUS-71's "no RPC/UI may move
-- academic_status away from GRADUATED" invariant). This migration adds two
-- independent layers:
--   1. A DB-level BEFORE UPDATE trigger backstop on public.profiles that
--      enforces the same invariant regardless of which RPC/role performs the
--      write (defense-in-depth even against a future RPC that forgets the
--      check, or a service_role write).
--   2. staff_update_student itself is re-created to reject both cases with a
--      safe, staff-facing Vietnamese message before it ever reaches the
--      trigger.
-- staff_confirm_graduation (0045) already inserts graduation_records BEFORE
-- updating academic_status='GRADUATED' (0045:63-82) -- correct order,
-- verified by re-reading the migration; NOT changed here.

-- ---------------------------------------------------------------------------
-- 1. Trigger backstop on public.profiles.
--
-- Must run BEFORE profiles_academic_guard (0018), which also fires
-- `before insert or update` on this table and one-way syncs
-- academic_status -> student_status. Postgres runs same-timing triggers on a
-- table in alphabetical order by trigger name, so this trigger is named to
-- sort before "profiles_academic_guard" ('0' < 'g'); raising here aborts the
-- whole statement before profiles_academic_guard (or any AFTER trigger) runs.
-- SECURITY INVOKER is sufficient: graduation_records SELECT is already
-- readable by any TRAINING_STAFF via graduation_records_select_staff (0041),
-- and the only role expected to UPDATE profiles.academic_status is
-- authenticated (via RPCs) or service_role (which bypasses RLS anyway, so
-- INVOKER vs DEFINER makes no difference for that path).
-- ---------------------------------------------------------------------------
create or replace function public.profiles_graduation_status_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'UPDATE' or new.role <> 'STUDENT' then
    return new;
  end if;

  -- (a) GRADUATED is one-way: never allow reverting away from it.
  if old.academic_status = 'GRADUATED' and new.academic_status is distinct from 'GRADUATED' then
    raise exception 'Không thể thay đổi trạng thái của học viên đã tốt nghiệp.';
  end if;

  -- (c) GRADUATED -> GRADUATED no-op (e.g. unrelated field edit) is fine,
  -- falls through to (b)'s guard which is satisfied because a
  -- graduation_records row must already exist for old.academic_status to be
  -- GRADUATED in the first place -- no separate branch needed.

  -- (b) Moving INTO GRADUATED must already have a graduation_records
  -- snapshot (i.e. must have gone through staff_confirm_graduation, 0045).
  if new.academic_status = 'GRADUATED' and old.academic_status is distinct from 'GRADUATED' then
    if not exists (select 1 from public.graduation_records where student_id = new.id) then
      raise exception 'Không thể đặt trạng thái Tốt nghiệp trực tiếp; phải xác nhận tốt nghiệp qua chức năng Xác nhận tốt nghiệp.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.profiles_graduation_status_guard() is 'BEFORE UPDATE backstop on profiles (Batch 5 hardening, BUS-71): blocks reverting academic_status away from GRADUATED, and blocks setting GRADUATED without an existing graduation_records snapshot. Runs before profiles_academic_guard (0018) by trigger name ordering; independent of RPC-level checks in staff_update_student.';

drop trigger if exists profiles_academic_00_graduation_guard on public.profiles;
create trigger profiles_academic_00_graduation_guard
  before insert or update on public.profiles
  for each row
  execute function public.profiles_graduation_status_guard();

revoke all on function public.profiles_graduation_status_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. staff_update_student (0019) re-created: same signature, adds explicit
-- rejection of both unsafe transitions before the UPDATE statement runs, so
-- staff get a clear jsonb {success:false, reason} instead of a raised
-- exception from the trigger above for this specific RPC's normal usage.
-- ---------------------------------------------------------------------------
create or replace function public.staff_update_student(
  p_student_id uuid,
  p_student_code text,
  p_full_name text,
  p_program_id uuid,
  p_cohort_id uuid,
  p_academic_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles%rowtype;
  v_current public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may update student profiles';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Họ tên không được để trống');
  end if;

  if p_academic_status is null or p_academic_status not in ('STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN') then
    return jsonb_build_object('success', false, 'reason', 'Trạng thái học tập không hợp lệ');
  end if;

  select * into v_current from public.profiles where id = p_student_id and role = 'STUDENT';
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy học viên');
  end if;

  -- Batch 5 hardening (BUS-68/69, BUS-71): GRADUATED may only ever be set by
  -- staff_confirm_graduation (0045), never through this general-purpose
  -- profile edit RPC.
  if p_academic_status = 'GRADUATED' then
    return jsonb_build_object('success', false, 'reason', 'Không thể đặt trạng thái Tốt nghiệp qua chức năng này. Vui lòng sử dụng chức năng Xác nhận tốt nghiệp.');
  end if;

  if v_current.academic_status = 'GRADUATED' then
    return jsonb_build_object('success', false, 'reason', 'Không thể thay đổi trạng thái của học viên đã tốt nghiệp.');
  end if;

  if p_program_id is not null and not exists (select 1 from public.programs where id = p_program_id) then
    return jsonb_build_object('success', false, 'reason', 'Chương trình đào tạo không tồn tại');
  end if;

  if p_cohort_id is not null and not exists (select 1 from public.cohorts where id = p_cohort_id) then
    return jsonb_build_object('success', false, 'reason', 'Khóa học không tồn tại');
  end if;

  begin
    update public.profiles
    set
      student_code = nullif(btrim(p_student_code), ''),
      full_name = btrim(p_full_name),
      program_id = p_program_id,
      cohort_id = p_cohort_id,
      academic_status = p_academic_status
    where id = p_student_id
    returning * into v_profile;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'reason', 'Mã học viên đã tồn tại');
    when sqlstate 'P0001' then
      -- Catches profiles_academic_guard (0018) and the new
      -- profiles_graduation_status_guard (0049) trigger exceptions (cohort/
      -- program mismatch, locked reassignment, graduation transition guard)
      -- and returns them as the same jsonb {success:false, reason} shape as
      -- every other validatable failure, instead of surfacing a raw
      -- Postgres error.
      return jsonb_build_object('success', false, 'reason', sqlerrm);
  end;

  return jsonb_build_object(
    'success', true,
    'id', v_profile.id,
    'student_code', v_profile.student_code,
    'full_name', v_profile.full_name,
    'program_id', v_profile.program_id,
    'cohort_id', v_profile.cohort_id,
    'academic_status', v_profile.academic_status
  );
end;
$$;

comment on function public.staff_update_student(uuid, text, text, uuid, uuid, text) is 'Staff-only. Updates the Batch 2 academic profile fields; never role or student_status directly. Batch 5 hardening (0049, BUS-68/69/71): rejects setting academic_status=GRADUATED (only staff_confirm_graduation may do that) and rejects changing the status of an already-GRADUATED student. Business-rule failures come back as jsonb {success:false, reason}.';

revoke all on function public.staff_update_student(uuid, text, text, uuid, uuid, text) from public;
grant execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) to authenticated;
