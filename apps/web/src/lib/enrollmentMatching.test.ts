import { describe, expect, it } from 'vitest';
import { buildConfirmedClassIds } from './enrollmentMatching';
import type { EnrollmentWithHistory } from '../types/api';

function makeEnrollment(overrides: Partial<EnrollmentWithHistory> = {}): EnrollmentWithHistory {
  return {
    id: 'enrollment-1',
    status: 'CONFIRMED',
    reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    course_classes: {
      id: 'class-uuid-1',
      class_code: 'CS601-01',
      courses: { code: 'CS601', name: 'Advanced Algorithms' },
    },
    enrollment_history: [],
    ...overrides,
  };
}

describe('buildConfirmedClassIds', () => {
  it('includes the course_classes UUID for CONFIRMED enrollments', () => {
    const ids = buildConfirmedClassIds([makeEnrollment()]);
    expect(ids.has('class-uuid-1')).toBe(true);
  });

  it('excludes REJECTED and CANCELLED_BY_STUDENT enrollments so those classes stay registrable', () => {
    const ids = buildConfirmedClassIds([
      makeEnrollment({ status: 'REJECTED', course_classes: { id: 'class-uuid-2', class_code: 'CS602-01', courses: { code: 'CS602', name: 'Distributed Systems' } } }),
      makeEnrollment({ status: 'CANCELLED_BY_STUDENT', course_classes: { id: 'class-uuid-3', class_code: 'CS603-01', courses: { code: 'CS603', name: 'Applied ML' } } }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('does not lock a same-coded class from a different semester/UUID', () => {
    // A CONFIRMED enrollment for class_code "CS601-01" in a past registration
    // period (different UUID) must not match the current semester's class
    // that happens to reuse the same display class_code.
    const pastSemesterEnrollment = makeEnrollment({
      status: 'CONFIRMED',
      course_classes: { id: 'past-period-class-uuid', class_code: 'CS601-01', courses: { code: 'CS601', name: 'Advanced Algorithms' } },
    });
    const ids = buildConfirmedClassIds([pastSemesterEnrollment]);

    const currentSemesterClassId = 'current-period-class-uuid';
    expect(ids.has(currentSemesterClassId)).toBe(false);
    expect(ids.has('past-period-class-uuid')).toBe(true);
  });
});
