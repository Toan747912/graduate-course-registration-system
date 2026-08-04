import { z } from 'zod';

// Batch 5 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md). Strict schemas: no
// `.passthrough()`, no `any`. RPCs (migrations 0039-0048) are the real
// enforcement layer; these schemas fail fast with a Vietnamese message.

export const studentIdParamsSchema = z.object({
  studentId: z.string().uuid('Mã học viên không hợp lệ'),
});

const academicStatusEnum = z.enum(['STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN']);
const eligibilityStatusEnum = z.enum(['ELIGIBLE', 'NOT_ELIGIBLE']);

// BUS-81: page_size default 20, max 100 -- reject (do not clamp) above 100.
// z.coerce so `?page_size=50` (a query string) parses to a number, matching
// how every other query-param schema in this codebase handles req.query.
export const graduationFilterQuerySchema = z.object({
  program_id: z.string().uuid('Mã chương trình không hợp lệ').optional(),
  cohort_id: z.string().uuid('Mã khóa học không hợp lệ').optional(),
  academic_status: academicStatusEnum.optional(),
  eligibility_status: eligibilityStatusEnum.optional(),
});

export const graduationListQuerySchema = graduationFilterQuerySchema.extend({
  page: z.coerce.number().int('Số trang phải là số nguyên').min(1, 'Số trang phải >= 1').optional(),
  page_size: z.coerce
    .number()
    .int('Số dòng mỗi trang phải là số nguyên')
    .min(1, 'Số dòng mỗi trang phải >= 1')
    .max(100, 'Số dòng mỗi trang tối đa là 100')
    .optional(),
});
