import type { EnrollmentWithHistory } from '../types/api';

// Keyed by course_classes.id (UUID), not class_code, since class_code is only
// unique within a single registration period and would otherwise match a
// same-coded class from a different semester.
export function buildConfirmedClassIds(enrollments: EnrollmentWithHistory[]): Set<string> {
  const ids = new Set<string>();
  for (const enrollment of enrollments) {
    if (enrollment.status !== 'CONFIRMED') {
      continue;
    }
    ids.add(enrollment.course_classes.id);
  }
  return ids;
}
