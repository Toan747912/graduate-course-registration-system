import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Static check for Batch 5 P2 (docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md):
// theses.completed_at must be immutable at the DB level, not just via the
// `where completed_at is null` guard inside staff_complete_thesis (0039).
// This is a STATIC review only -- pure text inspection of the migration
// file, no DB connection, same intent/precedent as batch5GrantAcl.test.ts.

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

function readMigration(file: string): string {
  return readFileSync(`${migrationsDir}${file}`, 'utf8');
}

const FILE = '0039_thesis_completed_at_immutable.sql';

test('Batch 5 P2: 0039 backfills COMPLETED theses missing completed_at before the guard trigger is created', () => {
  const sql = readMigration(FILE);

  const backfillIdx = sql.indexOf(
    "update public.theses\nset completed_at = now()\nwhere status = 'COMPLETED' and completed_at is null;",
  );
  const triggerCreateIdx = sql.indexOf('create trigger theses_completed_at_guard');

  assert.notEqual(backfillIdx, -1, '0039 must backfill COMPLETED theses with a null completed_at');
  assert.notEqual(triggerCreateIdx, -1, '0039 must create the theses_completed_at_guard trigger');
  assert.ok(
    backfillIdx < triggerCreateIdx,
    'the backfill UPDATE must run before the guard trigger is created, otherwise the trigger would reject the backfill itself',
  );
});

test('Batch 5 P2: theses_completed_at_guard trigger function exists and is wired to public.theses for INSERT and UPDATE', () => {
  const sql = readMigration(FILE);

  assert.match(
    sql,
    /create or replace function public\.theses_completed_at_guard\(\)/,
    'guard trigger function must be defined',
  );
  assert.match(
    sql,
    /create trigger theses_completed_at_guard\s+before insert or update on public\.theses\s+for each row\s+execute function public\.theses_completed_at_guard\(\);/,
    'guard trigger must fire before insert or update on public.theses',
  );
});

test('Batch 5 P2: guard blocks any raw completed_at write that is not part of an IN_PROGRESS -> COMPLETED transition', () => {
  const sql = readMigration(FILE);
  const fnBody = sql.slice(
    sql.indexOf('create or replace function public.theses_completed_at_guard()'),
    sql.indexOf('create trigger theses_completed_at_guard'),
  );

  // Once set, completed_at can never change again (immutability).
  assert.match(fnBody, /if old\.completed_at is not null then/);
  assert.match(fnBody, /raise exception 'completed_at là bất biến sau khi đã được thiết lập\.';/);

  // A change to completed_at is only allowed on the exact IN_PROGRESS -> COMPLETED transition.
  assert.match(fnBody, /if not \(old\.status = 'IN_PROGRESS' and new\.status = 'COMPLETED'\) then/);

  // Any status other than COMPLETED must carry a null completed_at.
  assert.match(fnBody, /if new\.status <> 'COMPLETED' and new\.completed_at is not null then/);

  // INSERT path: a thesis can never be created already carrying completed_at.
  assert.match(fnBody, /if tg_op = 'INSERT' then/);
  assert.match(fnBody, /if new\.completed_at is not null then/);
});

test('Batch 5 P2: guard trigger function is not granted execute to anon/authenticated/public (only reachable as a trigger)', () => {
  const sql = readMigration(FILE);

  assert.match(sql, /revoke all on function public\.theses_completed_at_guard\(\) from public;/);
  assert.match(sql, /revoke all on function public\.theses_completed_at_guard\(\) from anon;/);
  assert.match(sql, /revoke all on function public\.theses_completed_at_guard\(\) from authenticated;/);
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.theses_completed_at_guard\(\) to/,
    'guard trigger function must never be granted execute to any role',
  );
});

test('Batch 5 P2: staff_complete_thesis sets completed_at in the same UPDATE that transitions status IN_PROGRESS -> COMPLETED', () => {
  const sql = readMigration(FILE);
  const rpcBody = sql.slice(
    sql.indexOf('create or replace function public.staff_complete_thesis(p_id uuid)'),
    sql.indexOf('comment on function public.staff_complete_thesis'),
  );

  assert.match(
    rpcBody,
    /set status = 'COMPLETED', completed_at = coalesce\(completed_at, now\(\)\)/,
    'staff_complete_thesis must set status and completed_at together in one UPDATE',
  );
  assert.match(
    rpcBody,
    /v_thesis\.status <> 'IN_PROGRESS'/,
    'staff_complete_thesis must pre-check that the thesis is currently IN_PROGRESS',
  );
});
