import { z } from 'zod';

export const listClassesQuerySchema = z.object({
  semesterId: z.string().uuid(),
});

export const createEnrollmentSchema = z.object({
  classId: z.string().uuid(),
});

export const cancelEnrollmentParamsSchema = z.object({
  id: z.string().uuid(),
});

export const cancelEnrollmentBodySchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

// Validates the raw `semesters` table read before it is filtered/returned by
// GET /student/semesters (see routes/student.ts for why filtering happens in
// app code rather than in RLS/SQL).
export const semesterRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export type SemesterRow = z.infer<typeof semesterRowSchema>;
