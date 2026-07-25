import { z } from 'zod';

export const createRegistrationPeriodSchema = z
  .object({
    semesterId: z.string().uuid(),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    maxCredits: z.number().int().positive(),
  })
  .refine((body) => new Date(body.closesAt).getTime() > new Date(body.opensAt).getTime(), {
    message: 'Thời gian đóng phải sau thời gian mở đăng ký',
    path: ['closesAt'],
  });

export const courseClassIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const scheduleEntrySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  sessionSlot: z.number().int().min(1).max(10),
  room: z.string().trim().min(1).optional(),
});

export const createCourseClassSchema = z.object({
  registrationPeriodId: z.string().uuid(),
  courseId: z.string().uuid(),
  classCode: z.string().trim().min(1),
  maxSeats: z.number().int().positive(),
  schedules: z.array(scheduleEntrySchema).min(1),
});

export const cancelCourseClassParamsSchema = z.object({
  id: z.string().uuid(),
});

export const cancelCourseClassBodySchema = z.object({
  reason: z.string().trim().min(1),
});

export const listClassEnrollmentsParamsSchema = z.object({
  id: z.string().uuid(),
});
