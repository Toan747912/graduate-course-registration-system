import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listStudentsQuerySchema, studentIdParamsSchema, updateStudentSchema } from './students.js';

test('listStudentsQuerySchema allows an empty query (list-all)', () => {
  const parsed = listStudentsQuerySchema.parse({});
  assert.equal(parsed.programId, undefined);
  assert.equal(parsed.academicStatus, undefined);
});

test('listStudentsQuerySchema only accepts a known academicStatus (BUS-25)', () => {
  assert.doesNotThrow(() => listStudentsQuerySchema.parse({ academicStatus: 'STUDYING' }));
  assert.throws(() => listStudentsQuerySchema.parse({ academicStatus: 'ACTIVE' }));
});

test('studentIdParamsSchema requires a UUID', () => {
  assert.throws(() => studentIdParamsSchema.parse({ id: 'not-a-uuid' }));
  assert.doesNotThrow(() => studentIdParamsSchema.parse({ id: '11111111-1111-1111-1111-111111111111' }));
});

test('updateStudentSchema requires a non-blank fullName and a valid academicStatus', () => {
  const base = { fullName: 'Nguyễn Văn A', academicStatus: 'STUDYING' as const };
  assert.doesNotThrow(() => updateStudentSchema.parse(base));
  assert.throws(() => updateStudentSchema.parse({ ...base, fullName: '  ' }));
  assert.throws(() => updateStudentSchema.parse({ ...base, academicStatus: 'ACTIVE' }));
});

test('updateStudentSchema allows null/omitted programId, cohortId, studentCode (unassigned student)', () => {
  const parsed = updateStudentSchema.parse({
    fullName: 'Trần Thị B',
    academicStatus: 'SUSPENDED',
    programId: null,
    cohortId: null,
    studentCode: null,
  });
  assert.equal(parsed.programId, null);
  assert.equal(parsed.cohortId, null);
});

test('updateStudentSchema accepts every non-GRADUATED academic_status enum value (STUDYING, SUSPENDED, WITHDRAWN)', () => {
  for (const status of ['STUDYING', 'SUSPENDED', 'WITHDRAWN']) {
    assert.doesNotThrow(() => updateStudentSchema.parse({ fullName: 'X', academicStatus: status }));
  }
});

test('updateStudentSchema rejects GRADUATED (Batch 5 hardening, P1: only staff_confirm_graduation may set it)', () => {
  assert.throws(() => updateStudentSchema.parse({ fullName: 'X', academicStatus: 'GRADUATED' }));
  try {
    updateStudentSchema.parse({ fullName: 'X', academicStatus: 'GRADUATED' });
    assert.fail('expected updateStudentSchema.parse to throw for GRADUATED');
  } catch (err) {
    const zodErr = err as { issues: Array<{ message: string }> };
    assert.ok(zodErr.issues.some((issue) => issue.message.includes('Xác nhận tốt nghiệp')));
  }
});

test('updateStudentSchema rejects cohortId without programId (P2-1: mirrors profiles_cohort_requires_program)', () => {
  const base = {
    fullName: 'Lê Văn C',
    academicStatus: 'STUDYING' as const,
    cohortId: '11111111-1111-1111-1111-111111111111',
  };

  assert.throws(() => updateStudentSchema.parse(base));
  assert.throws(() => updateStudentSchema.parse({ ...base, programId: null }));

  try {
    updateStudentSchema.parse(base);
    assert.fail('expected updateStudentSchema.parse to throw');
  } catch (err) {
    const zodErr = err as { issues: Array<{ path: (string | number)[]; message: string }> };
    assert.ok(zodErr.issues.some((issue) => issue.path.includes('programId')));
  }

  assert.doesNotThrow(() =>
    updateStudentSchema.parse({
      ...base,
      programId: '22222222-2222-2222-2222-222222222222',
    }),
  );
});
