import { z } from 'zod';

export const academicStatusEnum = z.enum(['STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN']);

// Batch 5 hardening (docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md, Finding #1,
// P1): GRADUATED must never be settable through the generic staff profile
// update endpoint -- only staff_confirm_graduation (RPC, migration 0045) may
// move a student into GRADUATED, after recomputing eligibility. This is a
// narrower enum used ONLY for the update-student input; academicStatusEnum
// above stays unchanged for read/filter/display use (list filter, etc.)
// which must still accept/return GRADUATED.
export const updateAcademicStatusEnum = z.enum(['STUDYING', 'SUSPENDED', 'WITHDRAWN'], {
  errorMap: () => ({
    message:
      'Không thể đặt trạng thái Tốt nghiệp qua chức năng này. Vui lòng sử dụng chức năng Xác nhận tốt nghiệp.',
  }),
});

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
    academicStatus: updateAcademicStatusEnum,
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
