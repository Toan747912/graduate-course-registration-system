import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCohortSchema,
  createProgramCourseSchema,
  createProgramSchema,
  listCohortsQuerySchema,
  updateProgramCourseSchema,
} from './academic.js';

const validProgram = {
  code: 'CS-MASTER',
  name: 'Thạc sĩ Khoa học Máy tính',
  requiredCreditsMin: 20,
  electiveCreditsMin: 6,
  passScoreMin: 5,
  thesisCreditsMin: 12,
};

test('createProgramSchema accepts a valid program payload', () => {
  const parsed = createProgramSchema.parse(validProgram);
  assert.equal(parsed.code, 'CS-MASTER');
});

test('createProgramSchema rejects requiredCreditsMin <= 0 (BUS-19 config precondition)', () => {
  assert.throws(() => createProgramSchema.parse({ ...validProgram, requiredCreditsMin: 0 }));
});

test('createProgramSchema rejects negative electiveCreditsMin', () => {
  assert.throws(() => createProgramSchema.parse({ ...validProgram, electiveCreditsMin: -1 }));
});

test('createProgramSchema rejects passScoreMin outside [0, 10]', () => {
  assert.throws(() => createProgramSchema.parse({ ...validProgram, passScoreMin: 10.5 }));
  assert.throws(() => createProgramSchema.parse({ ...validProgram, passScoreMin: -0.1 }));
});

test('createProgramSchema rejects negative thesisCreditsMin', () => {
  assert.throws(() => createProgramSchema.parse({ ...validProgram, thesisCreditsMin: -1 }));
});

test('createProgramSchema rejects a blank code or name', () => {
  assert.throws(() => createProgramSchema.parse({ ...validProgram, code: '  ' }));
  assert.throws(() => createProgramSchema.parse({ ...validProgram, name: '' }));
});

test('createCohortSchema requires programId to be a UUID (BUS-17: a cohort belongs to exactly one program)', () => {
  assert.throws(() => createCohortSchema.parse({ programId: 'not-a-uuid', code: 'K2026', name: 'Khóa 2026' }));
});

test('createCohortSchema accepts a valid payload', () => {
  const parsed = createCohortSchema.parse({
    programId: '11111111-1111-1111-1111-111111111111',
    code: 'K2026',
    name: 'Khóa 2026',
  });
  assert.equal(parsed.code, 'K2026');
});

test('listCohortsQuerySchema allows an absent programId (list-all)', () => {
  const parsed = listCohortsQuerySchema.parse({});
  assert.equal(parsed.programId, undefined);
});

test('createProgramCourseSchema only accepts REQUIRED or ELECTIVE (BUS-18)', () => {
  const base = {
    programId: '11111111-1111-1111-1111-111111111111',
    courseId: '22222222-2222-2222-2222-222222222222',
  };
  assert.doesNotThrow(() => createProgramCourseSchema.parse({ ...base, requirementType: 'REQUIRED' }));
  assert.doesNotThrow(() => createProgramCourseSchema.parse({ ...base, requirementType: 'ELECTIVE' }));
  assert.throws(() => createProgramCourseSchema.parse({ ...base, requirementType: 'BOTH' }));
});

test('updateProgramCourseSchema rejects a missing requirementType', () => {
  assert.throws(() => updateProgramCourseSchema.parse({}));
});
