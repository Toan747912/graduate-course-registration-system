import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression test for the P0 found during the Batch 5 pre-apply transaction
// test (docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md, "RUNTIME VERIFICATION"
// section): public._compute_graduation_eligibility(uuid) declares an OUT/
// `returns table` column named `student_id`, which shadows any unqualified
// `student_id` reference inside the function body -- Postgres raised
// "column reference \"student_id\" is ambiguous" at runtime for the
// has_active_thesis and completed-thesis-selection queries against
// public.theses. This is a STATIC-only check (no DB connection): it proves
// the migration source text no longer contains the unqualified pattern and
// that the fixed queries use a table alias, not that a live Postgres
// instance now returns correct rows (see the transaction-test doc section
// for that runtime evidence).

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

const FILE = '0042_helper_compute_graduation_eligibility.sql';

test('_compute_graduation_eligibility keeps the p_student_id parameter name', () => {
  const sql = readMigration(FILE);
  assert.match(sql, /create or replace function public\._compute_graduation_eligibility\(p_student_id uuid\)/);
});

test('_compute_graduation_eligibility has no unqualified "student_id" reference that could collide with the OUT column', () => {
  const sql = readMigration(FILE);

  // The only occurrences of the bare identifier `student_id` (not prefixed by
  // a table alias / `p.` / `t.` and not part of a longer identifier like
  // `p_student_id`) must be the `returns table (student_id uuid, ...)`
  // column declaration itself -- nowhere else, and never inside a `where`
  // clause.
  const bareStudentIdMatches = [...sql.matchAll(/(?<![.\w])student_id(?!\w)/g)];
  assert.equal(
    bareStudentIdMatches.length,
    1,
    `expected exactly one bare "student_id" occurrence (the returns-table column declaration), found ${bareStudentIdMatches.length}`,
  );

  assert.doesNotMatch(sql, /where\s+student_id\s*=/i);
  assert.doesNotMatch(sql, /where\s+theses\.student_id\s*=\s*student_id/i);
});

test('the has_active_thesis subquery aliases public.theses and qualifies student_id/status', () => {
  const sql = readMigration(FILE);
  assert.match(sql, /from public\.theses t\s*\n\s*where t\.student_id = p_student_id\s*\n\s*and t\.status in \('PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS'\)/);
});

test('the COMPLETED-thesis selection query aliases public.theses and qualifies student_id/status/order-by columns', () => {
  const sql = readMigration(FILE);
  assert.match(sql, /select t\.\* into v_thesis\s*\n\s*from public\.theses t\s*\n\s*where t\.student_id = p_student_id and t\.status = 'COMPLETED'\s*\n\s*order by t\.completed_at desc nulls last, t\.created_at desc/);
});

test('the profiles/programs/cohorts lookups are also aliased (defense in depth against future OUT-column collisions)', () => {
  const sql = readMigration(FILE);
  assert.match(sql, /from public\.profiles p where p\.id = p_student_id/);
  assert.match(sql, /from public\.programs pr where pr\.id = v_progress\.program_id/);
  assert.match(sql, /from public\.cohorts c where c\.id = v_profile\.cohort_id/);
});

test('function signature called by downstream Batch 5 RPCs is unchanged: public._compute_graduation_eligibility(uuid)', () => {
  const callers = [
    '0043_rpc_student_get_own_graduation_status.sql',
    '0044_rpc_staff_get_student_graduation_status.sql',
    '0045_rpc_staff_confirm_graduation.sql',
    '0046_rpc_staff_graduation_summary_and_list.sql',
  ];
  for (const file of callers) {
    const sql = readMigration(file);
    assert.match(sql, /_compute_graduation_eligibility\(/, `${file} should still call _compute_graduation_eligibility`);
  }
});
