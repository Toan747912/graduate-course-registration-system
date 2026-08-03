import { z } from 'zod';

// Batch 3 (docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md). final_score is
// mandatory and bounded [0, 10] with at most one decimal place (BUS-27/29) -
// validated here before the request ever reaches the RPC, in addition to the
// numeric(3,1) check constraint at the DB layer (0021).
export const finalScoreSchema = z
  .number({ invalid_type_error: 'Điểm phải là một số' })
  .min(0, 'Điểm phải nằm trong khoảng 0-10')
  .max(10, 'Điểm phải nằm trong khoảng 0-10')
  .refine((value) => Math.round(value * 10) === value * 10, {
    message: 'Điểm chỉ được có tối đa một chữ số thập phân',
  });

export const courseClassIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const enrollmentIdParamsSchema = z.object({
  enrollmentId: z.string().uuid(),
});

export const createDraftGradeBodySchema = z.object({
  finalScore: finalScoreSchema,
});

export const updateDraftGradeBodySchema = z.object({
  finalScore: finalScoreSchema,
});

export const studentIdParamsSchema = z.object({
  id: z.string().uuid(),
});
