import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graduationFilterQuerySchema, graduationListQuerySchema, studentIdParamsSchema } from './graduation.js';

test('studentIdParamsSchema requires a valid uuid', () => {
  assert.throws(() => studentIdParamsSchema.parse({ studentId: 'not-a-uuid' }));
  assert.doesNotThrow(() => studentIdParamsSchema.parse({ studentId: '11111111-1111-1111-1111-111111111111' }));
});

test('graduationFilterQuerySchema accepts empty query (no filters)', () => {
  const parsed = graduationFilterQuerySchema.parse({});
  assert.equal(parsed.program_id, undefined);
  assert.equal(parsed.cohort_id, undefined);
  assert.equal(parsed.academic_status, undefined);
  assert.equal(parsed.eligibility_status, undefined);
});

test('graduationFilterQuerySchema rejects invalid enum values', () => {
  assert.throws(() => graduationFilterQuerySchema.parse({ academic_status: 'NOT_A_STATUS' }));
  assert.throws(() => graduationFilterQuerySchema.parse({ eligibility_status: 'MAYBE' }));
});

test('graduationFilterQuerySchema accepts every documented academic_status/eligibility_status value', () => {
  for (const s of ['STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN']) {
    assert.doesNotThrow(() => graduationFilterQuerySchema.parse({ academic_status: s }));
  }
  for (const s of ['ELIGIBLE', 'NOT_ELIGIBLE']) {
    assert.doesNotThrow(() => graduationFilterQuerySchema.parse({ eligibility_status: s }));
  }
});

test('graduationFilterQuerySchema rejects malformed uuid filters', () => {
  assert.throws(() => graduationFilterQuerySchema.parse({ program_id: 'xyz' }));
  assert.throws(() => graduationFilterQuerySchema.parse({ cohort_id: '123' }));
});

// ---------------------------------------------------------------------------
// Pagination (BUS-81): default 20, max 100, REJECT (not clamp) above 100.
// ---------------------------------------------------------------------------

test('graduationListQuerySchema: page/page_size are optional (defaults applied by the route/RPC, not the schema)', () => {
  const parsed = graduationListQuerySchema.parse({});
  assert.equal(parsed.page, undefined);
  assert.equal(parsed.page_size, undefined);
});

test('graduationListQuerySchema: page_size=100 is accepted (the maximum)', () => {
  const parsed = graduationListQuerySchema.parse({ page_size: '100' });
  assert.equal(parsed.page_size, 100);
});

test('graduationListQuerySchema: page_size=101 is REJECTED, not silently clamped to 100', () => {
  assert.throws(() => graduationListQuerySchema.parse({ page_size: '101' }));
  assert.throws(() => graduationListQuerySchema.parse({ page_size: '5000' }));
});

test('graduationListQuerySchema: page_size=0 or negative is rejected', () => {
  assert.throws(() => graduationListQuerySchema.parse({ page_size: '0' }));
  assert.throws(() => graduationListQuerySchema.parse({ page_size: '-1' }));
});

test('graduationListQuerySchema: page_size must be an integer', () => {
  assert.throws(() => graduationListQuerySchema.parse({ page_size: '20.5' }));
});

test('graduationListQuerySchema: page must be >= 1', () => {
  assert.throws(() => graduationListQuerySchema.parse({ page: '0' }));
  assert.doesNotThrow(() => graduationListQuerySchema.parse({ page: '1' }));
});

test('graduationListQuerySchema: query-string values coerce to numbers (Express req.query is always strings)', () => {
  const parsed = graduationListQuerySchema.parse({ page: '3', page_size: '50' });
  assert.equal(parsed.page, 3);
  assert.equal(parsed.page_size, 50);
});
