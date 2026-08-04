import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Static ACL check for Batch 5 (graduation/dashboard) migrations, same intent
// as batch3GrantAcl.test.ts / batch4GrantAcl.test.ts: no DB connection, pure
// text inspection of the migration files. Batch 5 mostly uses the terser
// `revoke all on function ... from public, anon;` combined form (also used in
// the 0038 Batch 4 sweep) rather than two separate `revoke` statements, so
// the regexes here match that form.
//
// This is a STATIC review only -- it proves the SQL source text contains the
// correct revoke/grant statements, not that a real Postgres instance actually
// ends up with those exact privileges (see docs/BATCH_5_IMPLEMENTATION_REPORT.md
// for the explicit "static-only, no live DB" caveat, following the precedent
// set by docs/BATCH_4_PRE_APPLY_SECURITY_REVIEW.md section 8.2).

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

function esc(fn: string): string {
  return fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INTERNAL_HELPERS = ['_compute_graduation_eligibility(uuid)', '_graduation_filtered_rows(uuid, uuid, text, text)'];

const PUBLIC_RPCS = [
  'student_get_own_graduation_status()',
  'staff_get_student_graduation_status(uuid)',
  'staff_confirm_graduation(uuid)',
  'staff_get_graduation_summary(uuid, uuid, text, text)',
  'staff_list_graduation_status(uuid, uuid, text, text, integer, integer)',
];

// Re-created in Batch 5 but originally defined in Batch 4 files; still must
// carry a correct ACL wherever they are re-created.
const RECREATED_BATCH4_RPCS = [
  { fn: 'staff_complete_thesis(uuid)', file: '0039_thesis_completed_at_immutable.sql' },
  { fn: 'student_create_thesis_proposal(text, text, uuid)', file: '0047_thesis_proposal_block_graduated.sql' },
];

const SWEEP_FILE = '0048_rpc_revoke_anon_batch5.sql';

test('Batch 5 internal helpers are never granted execute to any role and are revoked from public/anon/authenticated in the sweep', () => {
  const sweep = readMigration(SWEEP_FILE);
  const allMigrationText = [
    '0042_helper_compute_graduation_eligibility.sql',
    '0046_rpc_staff_graduation_summary_and_list.sql',
    SWEEP_FILE,
  ]
    .map(readMigration)
    .join('\n');

  for (const fn of INTERNAL_HELPERS) {
    const escaped = esc(fn);
    assert.doesNotMatch(
      allMigrationText,
      new RegExp(`grant execute on function public\\.${escaped} to`),
      `${fn} is an internal helper and must never be granted execute`,
    );
    assert.match(
      sweep,
      new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`),
      `0048 sweep must revoke ${fn} from public, anon, and authenticated`,
    );
  }
});

test('Batch 5 public-facing RPCs revoke from public+anon and grant execute only to authenticated (defining migration)', () => {
  const files: Record<string, string> = {
    'student_get_own_graduation_status()': '0043_rpc_student_get_own_graduation_status.sql',
    'staff_get_student_graduation_status(uuid)': '0044_rpc_staff_get_student_graduation_status.sql',
    'staff_confirm_graduation(uuid)': '0045_rpc_staff_confirm_graduation.sql',
    'staff_get_graduation_summary(uuid, uuid, text, text)': '0046_rpc_staff_graduation_summary_and_list.sql',
    'staff_list_graduation_status(uuid, uuid, text, text, integer, integer)': '0046_rpc_staff_graduation_summary_and_list.sql',
  };

  for (const fn of PUBLIC_RPCS) {
    const escaped = esc(fn);
    const file = files[fn];
    assert.ok(file, `missing migration file mapping for ${fn}`);
    const sql = readMigration(file);

    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public, anon;`),
      `${fn} must revoke execute from public and anon`,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      `${fn} must grant execute to authenticated`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to anon\\b`),
      `${fn} must never be granted execute to anon`,
    );
  }
});

test('Batch 5: 0048 final ACL sweep re-asserts every public RPC (incl. re-created Batch 4 RPCs) to authenticated only', () => {
  const sweep = readMigration(SWEEP_FILE);

  for (const fn of [...PUBLIC_RPCS, ...RECREATED_BATCH4_RPCS.map((r) => r.fn)]) {
    const escaped = esc(fn);
    assert.match(
      sweep,
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      `0048 sweep must grant ${fn} to authenticated`,
    );
    assert.doesNotMatch(
      sweep,
      new RegExp(`grant execute on function public\\.${escaped} to anon\\b`),
      `0048 sweep must never grant ${fn} to anon`,
    );
  }
});

test('Batch 5: re-created Batch 4 RPCs (0039 completion, 0047 thesis proposal) also carry a correct inline ACL block', () => {
  for (const { fn, file } of RECREATED_BATCH4_RPCS) {
    const escaped = esc(fn);
    const sql = readMigration(file);
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public, anon;`),
      `${fn} (${file}) must revoke execute from public and anon`,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      `${fn} (${file}) must grant execute to authenticated`,
    );
  }
});

test('Batch 5: graduation_records has no INSERT/UPDATE/DELETE RLS policy for any role (immutability invariant)', () => {
  const rls = readMigration('0041_rls_graduation_records.sql');
  assert.doesNotMatch(rls, /for insert/i, 'graduation_records must never have an INSERT policy');
  assert.doesNotMatch(rls, /for update/i, 'graduation_records must never have an UPDATE policy');
  assert.doesNotMatch(rls, /for delete/i, 'graduation_records must never have a DELETE policy');
  assert.match(rls, /for select/i, 'graduation_records must have at least one SELECT policy');
});

test('Batch 5: no migration file defines an UPDATE or DELETE RPC/statement against graduation_records', () => {
  const files = [
    '0040_graduation_records.sql',
    '0041_rls_graduation_records.sql',
    '0042_helper_compute_graduation_eligibility.sql',
    '0043_rpc_student_get_own_graduation_status.sql',
    '0044_rpc_staff_get_student_graduation_status.sql',
    '0045_rpc_staff_confirm_graduation.sql',
    '0046_rpc_staff_graduation_summary_and_list.sql',
    '0047_thesis_proposal_block_graduated.sql',
    '0048_rpc_revoke_anon_batch5.sql',
  ];
  for (const file of files) {
    const sql = readMigration(file);
    assert.doesNotMatch(
      sql,
      /update\s+public\.graduation_records/i,
      `${file} must not UPDATE graduation_records`,
    );
    assert.doesNotMatch(
      sql,
      /delete\s+from\s+public\.graduation_records/i,
      `${file} must not DELETE from graduation_records`,
    );
  }
});

test('Batch 5: staff_confirm_graduation (0045) is the only migration that INSERTs into graduation_records', () => {
  const files = [
    '0040_graduation_records.sql',
    '0041_rls_graduation_records.sql',
    '0042_helper_compute_graduation_eligibility.sql',
    '0043_rpc_student_get_own_graduation_status.sql',
    '0044_rpc_staff_get_student_graduation_status.sql',
    '0045_rpc_staff_confirm_graduation.sql',
    '0046_rpc_staff_graduation_summary_and_list.sql',
    '0047_thesis_proposal_block_graduated.sql',
    '0048_rpc_revoke_anon_batch5.sql',
  ];
  for (const file of files) {
    const sql = readMigration(file);
    const hasInsert = /insert\s+into\s+public\.graduation_records/i.test(sql);
    if (file === '0045_rpc_staff_confirm_graduation.sql') {
      assert.ok(hasInsert, `${file} must INSERT into graduation_records`);
    } else {
      assert.equal(hasInsert, false, `${file} must not INSERT into graduation_records`);
    }
  }
});

test('Batch 5: staff_confirm_graduation locks the target profile row FOR UPDATE before checking/writing', () => {
  const sql = readMigration('0045_rpc_staff_confirm_graduation.sql');
  assert.match(sql, /from\s+public\.profiles\s+where\s+id\s*=\s*p_student_id\s+for\s+update/i);
});

test('Batch 5: staff_list_graduation_status rejects page_size outside [1,100] rather than clamping', () => {
  const sql = readMigration('0046_rpc_staff_graduation_summary_and_list.sql');
  assert.match(sql, /v_page_size\s*<\s*1\s+or\s+v_page_size\s*>\s*100/);
  assert.match(sql, /raise exception 'page_size must be between 1 and 100'/);
});
