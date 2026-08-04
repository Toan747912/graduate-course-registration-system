import { z } from 'zod';

// Batch 4 (docs/BATCH_4_THESIS_ADVISOR_DESIGN.md). Strict schemas: no
// `.passthrough()`, no `any`. RPCs are the real enforcement layer (see
// migrations 0034-0037); these schemas exist to fail fast with a clear
// Vietnamese message before ever reaching the RPC and to keep req.body typed.

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const thesisIdParamsSchema = z.object({
  thesisId: z.string().uuid(),
});

const nonBlank = (message: string) =>
  z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message);

// ---------------------------------------------------------------------------
// research areas
// ---------------------------------------------------------------------------
export const createResearchAreaSchema = z.object({
  name: nonBlank('Tên lĩnh vực nghiên cứu không được để trống'),
  description: z.string().trim().max(2000).optional(),
});

export const updateResearchAreaSchema = z.object({
  name: nonBlank('Tên lĩnh vực nghiên cứu không được để trống'),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean(),
});

// ---------------------------------------------------------------------------
// advisors
// ---------------------------------------------------------------------------
export const createAdvisorSchema = z.object({
  advisorCode: nonBlank('Mã giảng viên không được để trống'),
  fullName: nonBlank('Họ tên giảng viên không được để trống'),
  specialization: nonBlank('Chuyên môn giảng viên không được để trống'),
  maxActiveTheses: z
    .number({ invalid_type_error: 'Số luận văn tối đa phải là một số' })
    .int('Số luận văn tối đa phải là số nguyên')
    .positive('Số luận văn tối đa phải lớn hơn 0'),
});

export const updateAdvisorSchema = z.object({
  fullName: nonBlank('Họ tên giảng viên không được để trống'),
  specialization: nonBlank('Chuyên môn giảng viên không được để trống'),
  maxActiveTheses: z
    .number({ invalid_type_error: 'Số luận văn tối đa phải là một số' })
    .int('Số luận văn tối đa phải là số nguyên')
    .positive('Số luận văn tối đa phải lớn hơn 0'),
});

// ---------------------------------------------------------------------------
// thesis proposal (student)
// ---------------------------------------------------------------------------
export const createThesisProposalSchema = z.object({
  title: nonBlank('Tiêu đề đề xuất không được để trống').max(300),
  description: nonBlank('Mô tả đề xuất không được để trống').max(5000),
  researchAreaId: z.string().uuid('Vui lòng chọn lĩnh vực nghiên cứu hợp lệ'),
});

export const updateThesisProposalSchema = createThesisProposalSchema;

export const cancelOwnThesisSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// staff review / lifecycle
// ---------------------------------------------------------------------------
export const rejectThesisSchema = z.object({
  reason: nonBlank('Vui lòng nhập lý do từ chối').max(2000),
});

export const cancelThesisStaffSchema = z.object({
  reason: nonBlank('Vui lòng nhập lý do hủy').max(2000),
});

export const assignAdvisorSchema = z.object({
  advisorId: z.string().uuid('Vui lòng chọn giảng viên hợp lệ'),
});

export const changeAdvisorSchema = z.object({
  advisorId: z.string().uuid('Vui lòng chọn giảng viên hợp lệ'),
  reason: nonBlank('Vui lòng nhập lý do đổi giảng viên').max(2000),
});

export const listThesesQuerySchema = z.object({
  status: z
    .enum(['PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'])
    .optional(),
});
