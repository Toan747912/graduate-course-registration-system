import { z } from 'zod';

export const academicStatusEnum = z.enum(['STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN']);

export const listStudentsQuerySchema = z.object({
  programId: z.string().uuid().optional(),
  cohortId: z.string().uuid().optional(),
  academicStatus: academicStatusEnum.optional(),
  search: z.string().trim().min(1).optional(),
});

export const studentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateStudentSchema = z
  .object({
    studentCode: z.string().trim().min(1).max(50).optional().nullable(),
    fullName: z.string().trim().min(1),
    programId: z.string().uuid().optional().nullable(),
    cohortId: z.string().uuid().optional().nullable(),
    academicStatus: academicStatusEnum,
  })
  .superRefine((value, ctx) => {
    // Mirrors the DB-level profiles_cohort_requires_program constraint
    // (0018): reject cohort-without-program here so the request never
    // reaches the RPC and triggers a raw Postgres constraint-violation
    // message.
    if (value.cohortId && !value.programId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['programId'],
        message: 'Phải chọn chương trình đào tạo trước khi chọn khóa học.',
      });
    }
  });
