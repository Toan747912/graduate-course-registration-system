import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  courseClassIdParamsSchema,
  createDraftGradeBodySchema,
  enrollmentIdParamsSchema,
  finalScoreSchema,
  studentIdParamsSchema,
  updateDraftGradeBodySchema,
} from './grades.js';

test('finalScoreSchema accepts the full [0,10] range including boundaries', () => {
  assert.doesNotThrow(() => finalScoreSchema.parse(0));
  assert.doesNotThrow(() => finalScoreSchema.parse(10));
  assert.doesNotThrow(() => finalScoreSchema.parse(7.5));
});

test('finalScoreSchema rejects out-of-range values (BUS-29)', () => {
  assert.throws(() => finalScoreSchema.parse(-0.1));
  assert.throws(() => finalScoreSchema.parse(10.1));
  assert.throws(() => finalScoreSchema.parse(10.5));
});

test('finalScoreSchema rejects more than one decimal place', () => {
  assert.throws(() => finalScoreSchema.parse(7.55));
  assert.doesNotThrow(() => finalScoreSchema.parse(7.5));
});

test('finalScoreSchema rejects missing/non-numeric values (no empty draft rows, BUS-27)', () => {
  assert.throws(() => finalScoreSchema.parse(undefined));
  assert.throws(() => finalScoreSchema.parse(null));
  assert.throws(() => finalScoreSchema.parse('7.5'));
});

test('createDraftGradeBodySchema / updateDraftGradeBodySchema require finalScore', () => {
  assert.throws(() => createDraftGradeBodySchema.parse({}));
  assert.doesNotThrow(() => createDraftGradeBodySchema.parse({ finalScore: 8 }));
  assert.throws(() => updateDraftGradeBodySchema.parse({}));
  assert.doesNotThrow(() => updateDraftGradeBodySchema.parse({ finalScore: 5 }));
});

test('courseClassIdParamsSchema / enrollmentIdParamsSchema / studentIdParamsSchema require a UUID', () => {
  assert.throws(() => courseClassIdParamsSchema.parse({ id: 'nope' }));
  assert.doesNotThrow(() => courseClassIdParamsSchema.parse({ id: '11111111-1111-1111-1111-111111111111' }));
  assert.throws(() => enrollmentIdParamsSchema.parse({ enrollmentId: 'nope' }));
  assert.doesNotThrow(() =>
    enrollmentIdParamsSchema.parse({ enrollmentId: '11111111-1111-1111-1111-111111111111' }),
  );
  assert.throws(() => studentIdParamsSchema.parse({ id: 'nope' }));
  assert.doesNotThrow(() => studentIdParamsSchema.parse({ id: '11111111-1111-1111-1111-111111111111' }));
});
