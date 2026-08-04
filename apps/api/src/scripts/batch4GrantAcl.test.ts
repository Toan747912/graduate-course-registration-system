import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Static ACL check for Batch 4 (thesis/advisor management) migrations,
// following the exact pattern batch3GrantAcl.test.ts established after the
// live P0 found in docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.2:
// `revoke ... from public` alone does not remove EXECUTE granted directly to
// anon/authenticated by ALTER DEFAULT PRIVILEGES on Supabase projects (that
// grant does not go through the PUBLIC pseudo-role). Every public-facing RPC
// must explicitly revoke from public AND anon, then grant to authenticated
// only. Every internal helper/trigger function must revoke from public, anon,
// AND authenticated, and never be granted to anyone.
//
// Batch 4 ships a final idempotent ACL sweep in 0038_rpc_revoke_anon_batch4.sql
// re-asserting every grant/revoke below (using the terser `from public, anon`
// form) in addition to each function's own inline block in 0031/0034-0037 —
// this test checks the per-file inline blocks, which are the first (and
// already sufficient) layer.

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

const INTERNAL_HELPERS: { file: string; fn: string }[] = [
  { file: '0031_trigger_advisor_deactivate_guard.sql', fn: 'advisors_block_deactivate_when_in_progress()' },
];

const PUBLIC_RPC_FILES = [
  '0034_rpc_catalog_research_areas_advisors.sql',
  '0035_rpc_thesis_proposal.sql',
  '0036_rpc_thesis_staff_review.sql',
  '0037_rpc_thesis_advisor_assignment_lifecycle.sql',
];

const PUBLIC_RPCS = [
  // 0034 - research areas / advisors catalog
  'staff_create_research_area(text, text)',
  'staff_update_research_area(uuid, text, text, boolean)',
  'staff_deactivate_research_area(uuid)',
  'staff_list_research_areas()',
  'staff_create_advisor(text, text, text, integer)',
  'staff_update_advisor(uuid, text, text, integer)',
  'staff_deactivate_advisor(uuid)',
  'staff_list_advisors()',
  // 0035 - student thesis proposal
  'student_check_thesis_eligibility()',
  'student_create_thesis_proposal(text, text, uuid)',
  'student_update_own_thesis_proposal(uuid, text, text, uuid)',
  'student_cancel_own_thesis(uuid, text)',
  'student_get_own_theses()',
  'student_get_own_thesis(uuid)',
  // 0036 - staff review
  'staff_list_theses(text)',
  'staff_get_thesis(uuid)',
  'staff_approve_thesis(uuid)',
  'staff_reject_thesis(uuid, text)',
  // 0037 - advisor assignment lifecycle
  'staff_assign_advisor(uuid, uuid)',
  'staff_change_advisor(uuid, uuid, text)',
  'staff_cancel_thesis(uuid, text)',
  'staff_complete_thesis(uuid)',
  'staff_get_thesis_advisor_history(uuid)',
  'student_get_own_thesis_advisor_history(uuid)',
];

test('Batch 4 internal helper/trigger functions revoke execute from public, anon, and authenticated, and are never granted', () => {
  for (const { file, fn } of INTERNAL_HELPERS) {
    const sql = readMigration(file);
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public;`),
      `${fn} must revoke execute from public`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from anon;`),
      `${fn} must revoke execute from anon explicitly`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from authenticated;`),
      `${fn} must revoke execute from authenticated explicitly (internal helper — no self-checks, safety depends entirely on not being callable)`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to`),
      `${fn} is an internal helper and must never be granted execute directly`,
    );

    // Also verify the final Batch 4 ACL sweep (0038) does not accidentally
    // grant this helper either.
    const sweep = readMigration('0038_rpc_revoke_anon_batch4.sql');
    assert.doesNotMatch(
      sweep,
      new RegExp(`grant execute on function public\\.${escaped} to`),
      `${fn} must never be granted execute in the 0038 ACL sweep either`,
    );
    assert.match(
      sweep,
      new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`),
      `0038 must re-assert the internal helper is revoked from public, anon, and authenticated`,
    );
  }
});

test('Batch 4 public-facing RPCs revoke from public+anon and grant execute only to authenticated (per-file inline block)', () => {
  const sql = PUBLIC_RPC_FILES.map(readMigration).join('\n');

  for (const fn of PUBLIC_RPCS) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from public;`),
      `${fn} must revoke execute from public (public=false)`,
    );

    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${escaped} from anon;`),
      `${fn} must explicitly revoke execute from anon (anon=false)`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function public\\.${escaped} to anon\\b`),
      `${fn} must never be granted execute to anon (anon=false)`,
    );

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

test('Batch 4: the 0038 final ACL sweep re-asserts every public RPC grant to authenticated only', () => {
  const sweep = readMigration('0038_rpc_revoke_anon_batch4.sql');

  for (const fn of PUBLIC_RPCS) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      sweep,
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      `0038 sweep must grant ${fn} to authenticated`,
    );
    assert.doesNotMatch(
      sweep,
      new RegExp(`grant execute on function public\\.${escaped} to anon\\b`),
      `0038 sweep must never grant ${fn} to anon`,
    );
  }
});

test('Batch 4: every function created in 0034-0037 appears in either the public RPC list or the internal helper list (no untracked function)', () => {
  const sql = [...PUBLIC_RPC_FILES, ...INTERNAL_HELPERS.map((h) => h.file)]
    .filter((f, i, arr) => arr.indexOf(f) === i)
    .map(readMigration)
    .join('\n');

  const createMatches = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  const trackedNames = new Set([
    ...PUBLIC_RPCS.map((s) => s.split('(')[0]),
    ...INTERNAL_HELPERS.map((h) => h.fn.split('(')[0]),
  ]);

  for (const name of createMatches) {
    assert.ok(trackedNames.has(name), `function ${name} created in Batch 4 migrations is not covered by this ACL test`);
  }
});
