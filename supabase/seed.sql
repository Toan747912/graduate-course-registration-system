-- seed.sql
-- Reference/demo data only: semester, one registration period, courses, classes
-- and schedules. Does NOT create any auth.users / profiles rows — demo accounts
-- are created by the idempotent `apps/api` script `npm run seed:demo-users`,
-- which needs the service_role key and therefore must never live in a migration
-- or in this file.
--
-- Safe to re-run: every insert is guarded by a matching unique key via
-- ON CONFLICT DO NOTHING.

insert into public.semesters (id, name)
values ('11111111-1111-1111-1111-111111111111', '2026-1')
on conflict (name) do nothing;

insert into public.registration_periods (id, semester_id, opens_at, closes_at, max_credits)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  now() - interval '1 day',
  now() + interval '30 days',
  18
)
on conflict (semester_id) do nothing;

insert into public.courses (id, code, name, credits)
values
  ('33333333-3333-3333-3333-333333333331', 'CS601', 'Advanced Algorithms', 3),
  ('33333333-3333-3333-3333-333333333332', 'CS602', 'Distributed Systems', 3),
  ('33333333-3333-3333-3333-333333333333', 'CS603', 'Applied Machine Learning', 4),
  ('33333333-3333-3333-3333-333333333334', 'MG601', 'Research Methodology', 2)
on conflict (code) do nothing;

insert into public.course_classes (id, registration_period_id, course_id, class_code, max_seats, status)
values
  ('44444444-4444-4444-4444-444444444441', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333331', 'CS601-01', 2, 'ACTIVE'),
  ('44444444-4444-4444-4444-444444444442', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333332', 'CS602-01', 40, 'ACTIVE'),
  ('44444444-4444-4444-4444-444444444443', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'CS603-01', 35, 'ACTIVE'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333334', 'MG601-01', 50, 'ACTIVE')
on conflict (registration_period_id, class_code) do nothing;

-- CS601-01: max_seats = 2, useful for exercising the BUS-06/BUS-07 full-class path.
insert into public.class_schedules (course_class_id, day_of_week, session_slot, room)
values
  ('44444444-4444-4444-4444-444444444441', 2, 1, 'A101'),
  ('44444444-4444-4444-4444-444444444441', 4, 1, 'A101'),
  ('44444444-4444-4444-4444-444444444442', 3, 2, 'B203'),
  ('44444444-4444-4444-4444-444444444443', 2, 1, 'C305'),
  ('44444444-4444-4444-4444-444444444443', 5, 3, 'C305'),
  ('44444444-4444-4444-4444-444444444444', 6, 2, 'A101')
on conflict (course_class_id, day_of_week, session_slot) do nothing;

-- Batch 1 of the academic-management expansion
-- (docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md): programs, cohorts, and the
-- program/course requirement mapping. Not applied to any cloud environment as
-- part of this change; local-only reference data for future local testing.
insert into public.programs (
  id, code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min
)
values (
  '55555555-5555-5555-5555-555555555551',
  'CS-MASTER',
  'Thạc sĩ Khoa học Máy tính',
  20,
  6,
  5.0,
  12
)
on conflict (code) do nothing;

insert into public.cohorts (id, program_id, code, name)
values (
  '66666666-6666-6666-6666-666666666661',
  '55555555-5555-5555-5555-555555555551',
  'K2026',
  'Khóa 2026'
)
on conflict (program_id, code) do nothing;

-- CS601/CS602/CS603 required, MG601 elective - matches the existing demo
-- course catalog above so the assignment is meaningful without new courses.
insert into public.program_courses (program_id, course_id, requirement_type)
values
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333331', 'REQUIRED'),
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333332', 'REQUIRED'),
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333333', 'REQUIRED'),
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333334', 'ELECTIVE')
on conflict (program_id, course_id) do nothing;
