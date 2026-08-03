import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Static ACL check for Batch 3 (grades/progress) migrations. Guards against a
// regression of the P0 found by live transaction test on 2026-08-02
// (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.2): internal helper
// functions must never be directly callable by anon/authenticated, only
// top-level RPCs may be granted execute.

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

const INTERNAL_HELPERS = ['_student_grades_rows(uuid)', '_student_progress(uuid)'];

const PUBLIC_RPCS = [
  'staff_create_draft_grade(uuid, numeric)',
  'staff_update_draft_grade(uuid, numeric)',
  'staff_publish_grade(uuid)',
  'staff_list_class_grades(uuid)',
  'student_get_own_grades()',
  'staff_get_student_grades(uuid)',
  'student_get_own_progress()',
  'staff_get_student_progress(uuid)',
  'cancel_course_class(uuid, text)',
  'cancel_own_enrollment(uuid, text)',
];

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

test('internal helpers _student_grades_rows/_student_progress revoke execute from public, anon, and authenticated', () => {
  const sql = readMigration('0025_rpc_student_grades_and_progress.sql');

  for (const fn of INTERNAL_HELPERS) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public;`),
      `${fn} must revoke execute from public`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from anon;`),
      `${fn} must revoke execute from anon explicitly (default privileges can grant anon execute outside of PUBLIC)`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from authenticated;`),
      `${fn} must revoke execute from authenticated explicitly`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to`),
      `${fn} is an internal helper and must never be granted execute directly`,
    );
  }
});

test('Batch 3 top-level RPCs revoke from public+anon and grant execute only to authenticated', () => {
  // Regression guard for P3 (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section
  // 8.3): on Supabase projects, ALTER DEFAULT PRIVILEGES grants EXECUTE to
  // anon/authenticated directly at function-creation time, bypassing the
  // PUBLIC pseudo-role — so `revoke ... from public` alone leaves anon able
  // to call these RPCs even though the body self-checks auth.uid(). Every
  // public-facing RPC must explicitly revoke from both public and anon, and
  // grant execute to authenticated only: anon=false, authenticated=true,
  // public=false.
  const files = [
    '0023_rpc_record_and_publish_grade.sql',
    '0024_rpc_staff_list_class_grades.sql',
    '0025_rpc_student_grades_and_progress.sql',
    '0026_rpc_cancel_course_class_block_if_graded.sql',
    '0027_rpc_cancel_own_enrollment_block_if_graded.sql',
  ];
  const sql = files.map(readMigration).join('\n');

  for (const fn of PUBLIC_RPCS) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // public = false
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public;`),
      `${fn} must revoke execute from public (public=false)`,
    );

    // anon = false, explicit revoke (not just inherited from the public revoke)
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from anon;`),
      `${fn} must explicitly revoke execute from anon (anon=false) — default privileges can grant anon execute outside of PUBLIC`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to anon\\b`),
      `${fn} must never be granted execute to anon (anon=false)`,
    );

    // authenticated = true, and only authenticated
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      `${fn} must grant execute to authenticated (authenticated=true)`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to service_role`),
      `${fn} must never be granted execute to service_role directly`,
    );

    // the anon revoke must come after the public revoke and before/around the
    // authenticated grant, i.e. this is a real exact-signature revoke block,
    // not a substring match against an unrelated function.
    const block = new RegExp(
      `revoke all on function public\\.${escaped} from public;\\s*` +
        `(?:--[^\\n]*\\n\\s*)?` +
        `revoke all on function public\\.${escaped} from anon;\\s*` +
        `(?:--[^\\n]*\\n\\s*)?` +
        `grant execute on function public\\.${escaped} to authenticated;`,
    );
    assert.match(
      sql,
      block,
      `${fn} must have the exact revoke(public)+revoke(anon)+grant(authenticated) ACL block in order`,
    );
  }
});
