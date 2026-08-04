import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Static SQL evidence for the Batch 4 DB-level hardening added in response to
// docs/BATCH_4_PRE_APPLY_SECURITY_REVIEW.md findings F-1, F-2, F-3. These are
// text-based checks against the migration files (no live DB available in this
// environment) -- they prove the trigger definitions are present with the
// expected shape; they do NOT prove runtime behavior. See the review doc's
// Section 6b transactional test plan (items 8/9, extended) for the live
// BEGIN...ROLLBACK proof this must still receive before Cloud apply.

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

// ---------------------------------------------------------------------------
// F-1: thesis_advisor_history append-only trigger (0032)
// ---------------------------------------------------------------------------
test('F-1: thesis_advisor_history has explicit BEFORE DELETE and BEFORE UPDATE guard triggers, not just RLS omission', () => {
  const sql = readMigration('0032_thesis_advisor_history.sql');

  assert.match(sql, /revoke update, delete on public\.thesis_advisor_history from public;/);
  assert.match(sql, /create or replace function public\.thesis_advisor_history_guard\(\)/);
  assert.match(sql, /raise exception 'thesis_advisor_history is append-only: DELETE is not permitted';/);
  assert.match(
    sql,
    /raise exception 'thesis_advisor_history is append-only: only setting unassigned_at once, from NULL, is permitted';/,
  );
  assert.match(sql, /create trigger thesis_advisor_history_no_delete\s+before delete on public\.thesis_advisor_history/);
  assert.match(
    sql,
    /create trigger thesis_advisor_history_guarded_update\s+before update on public\.thesis_advisor_history/,
  );

  // The internal guard function must never be directly callable.
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.thesis_advisor_history_guard\\(\\) from ${role};`));
  }
  assert.doesNotMatch(sql, /grant execute on function public\.thesis_advisor_history_guard\(\) to/);
});

test('F-1: the guarded-update shape only tolerates the unassigned_at close-out, not arbitrary column changes', () => {
  const sql = readMigration('0032_thesis_advisor_history.sql');
  // Every other column must be compared old vs new before allowing the update.
  for (const col of ['id', 'thesis_id', 'advisor_id', 'assigned_at', 'assigned_by', 'change_reason']) {
    assert.match(
      sql,
      new RegExp(`old\\.${col}\\s*(<>|is distinct from)\\s*new\\.${col}`),
      `guard must compare old/new ${col} before allowing an update`,
    );
  }
  assert.match(sql, /old\.unassigned_at is not null/);
  assert.match(sql, /new\.unassigned_at is null/);
});

// ---------------------------------------------------------------------------
// F-2: inactive research_area / inactive advisor backstop (0030)
// ---------------------------------------------------------------------------
test('F-2: theses blocks INSERT/UPDATE that would leave an IN_PROGRESS row pointing at an inactive advisor', () => {
  const sql = readMigration('0030_theses.sql');

  assert.match(sql, /create or replace function public\.theses_block_inactive_advisor_in_progress\(\)/);
  assert.match(sql, /new\.status = 'IN_PROGRESS' and new\.advisor_id is not null/);
  assert.match(sql, /select is_active into v_advisor_active from public\.advisors where id = new\.advisor_id;/);
  assert.match(
    sql,
    /create trigger theses_block_inactive_advisor_in_progress\s+before insert or update on public\.theses/,
  );
});

test('F-2: theses blocks INSERT or research_area_id change pointing at an inactive research area, without touching unrelated updates', () => {
  const sql = readMigration('0030_theses.sql');

  assert.match(sql, /create or replace function public\.theses_block_inactive_research_area\(\)/);
  assert.match(sql, /select is_active into v_area_active from public\.research_areas where id = new\.research_area_id;/);
  assert.match(sql, /create trigger theses_block_inactive_research_area_insert\s+before insert on public\.theses/);
  // Column-scoped trigger: must NOT fire on every update, only when
  // research_area_id is part of the SET list (preserves BUS-63 for theses
  // whose area was deactivated after the fact).
  assert.match(
    sql,
    /create trigger theses_block_inactive_research_area_update\s+before update of research_area_id on public\.theses/,
  );
});

test('F-2: both new backstop trigger functions are revoked from public/anon/authenticated (never directly callable)', () => {
  const sql = readMigration('0030_theses.sql');
  for (const fn of ['theses_block_inactive_advisor_in_progress', 'theses_block_inactive_research_area']) {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(\\) from ${role};`));
    }
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${fn}\\(\\) to`));
  }
});

// ---------------------------------------------------------------------------
// F-3: transition-aware cancellation_reason requirement (0030)
// ---------------------------------------------------------------------------
test('F-3: staff cancellation from APPROVED/IN_PROGRESS requires a non-blank cancellation_reason at the DB layer', () => {
  const sql = readMigration('0030_theses.sql');

  assert.match(sql, /create or replace function public\.theses_require_cancellation_reason\(\)/);
  assert.match(sql, /new\.status = 'CANCELLED' and old\.status in \('APPROVED', 'IN_PROGRESS'\)/);
  assert.match(sql, /new\.cancellation_reason is null or btrim\(new\.cancellation_reason\) = ''/);
  assert.match(sql, /create trigger theses_require_cancellation_reason\s+before update on public\.theses/);
});

test('F-3: the trigger is transition-aware (keys off OLD.status), not a plain CHECK -- student self-cancel from PENDING_APPROVAL is untouched', () => {
  const sql = readMigration('0030_theses.sql');
  // The function body must reference OLD.status; a CHECK constraint cannot,
  // which is exactly why this had to be a trigger and not a symmetric CHECK.
  assert.match(sql, /old\.status in \('APPROVED', 'IN_PROGRESS'\)/);
  // PENDING_APPROVAL is deliberately absent from the guarded OLD statuses.
  const guardFn = sql.slice(
    sql.indexOf('create or replace function public.theses_require_cancellation_reason'),
    sql.indexOf('create trigger theses_require_cancellation_reason'),
  );
  assert.doesNotMatch(guardFn, /PENDING_APPROVAL/);
});

// ---------------------------------------------------------------------------
// Verification pass (docs/BATCH_4_PRE_APPLY_SECURITY_REVIEW.md §8.8):
// "REJECTED requires rejection_reason" is already DB-enforced by a plain CHECK
// constraint (not a trigger) on `theses`, present since the original 0030 --
// no fix was needed, but this test supplies the static evidence the review
// requires before treating it as verified.
// ---------------------------------------------------------------------------
test('REJECTED rejection_reason CHECK constraint: exact constraint text is present in 0030_theses.sql', () => {
  const sql = readMigration('0030_theses.sql');
  assert.match(sql, /constraint theses_rejection_reason_requires_status check \(/);
  assert.match(
    sql,
    /\(status = 'REJECTED' and rejection_reason is not null and btrim\(rejection_reason\) <> ''\)/,
  );
});

test('REJECTED rejection_reason CHECK constraint: blank/whitespace-only reason is rejected, not just NULL', () => {
  const sql = readMigration('0030_theses.sql');
  // btrim(...) <> '' means a whitespace-only string (which is NOT NULL) still
  // fails the constraint -- a plain "is not null" check alone would not catch this.
  assert.match(sql, /rejection_reason is not null and btrim\(rejection_reason\) <> ''/);
});

test('REJECTED rejection_reason CHECK constraint: non-REJECTED transitions are never blocked (no false positive)', () => {
  const sql = readMigration('0030_theses.sql');
  // The `or (status <> 'REJECTED')` disjunct means PENDING_APPROVAL/APPROVED/
  // IN_PROGRESS/COMPLETED/CANCELLED rows are never constrained by
  // rejection_reason, regardless of its value.
  assert.match(sql, /or \(status <> 'REJECTED'\)/);
});

test('0038 ACL sweep revokes execute on all four new internal trigger functions from every role', () => {
  const sweep = readMigration('0038_rpc_revoke_anon_batch4.sql');
  for (const fn of [
    'theses_block_inactive_advisor_in_progress',
    'theses_block_inactive_research_area',
    'theses_require_cancellation_reason',
    'thesis_advisor_history_guard',
  ]) {
    assert.match(sweep, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated;`));
    assert.doesNotMatch(sweep, new RegExp(`grant execute on function public\\.${fn}\\(\\) to`));
  }
});
