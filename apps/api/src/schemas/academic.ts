import { z } from 'zod';

export const createProgramSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  requiredCreditsMin: z.number().int().positive(),
  electiveCreditsMin: z.number().int().nonnegative(),
  passScoreMin: z.number().min(0).max(10),
  thesisCreditsMin: z.number().int().nonnegative(),
});

export const updateProgramSchema = createProgramSchema;

export const programIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createCohortSchema = z.object({
  programId: z.string().uuid(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export const updateCohortSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export const cohortIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listCohortsQuerySchema = z.object({
  programId: z.string().uuid().optional(),
});

export const createProgramCourseSchema = z.object({
  programId: z.string().uuid(),
  courseId: z.string().uuid(),
  requirementType: z.enum(['REQUIRED', 'ELECTIVE']),
});

export const updateProgramCourseSchema = z.object({
  requirementType: z.enum(['REQUIRED', 'ELECTIVE']),
});

export const programCourseIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listProgramCoursesQuerySchema = z.object({
  programId: z.string().uuid().optional(),
});
