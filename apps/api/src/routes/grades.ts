import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  courseClassIdParamsSchema,
  createDraftGradeBodySchema,
  enrollmentIdParamsSchema,
  studentIdParamsSchema,
  updateDraftGradeBodySchema,
} from '../schemas/grades.js';

/**
 * Batch 3 (docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md): grade entry/publish
 * for training staff, and grade/progress viewing for students and staff. All
 * reads/writes go through the RPCs added in 0021-0025 (never direct table
 * writes) so business rules (BUS-27..35) are enforced in exactly one place.
 */
export const gradesRouter = Router();

gradesRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));
gradesRouter.use('/student', requireAuth, requireRole('STUDENT'));

function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
}

/**
 * GET /api/staff/course-classes/:id/grades
 * Roster of CONFIRMED enrollments for a class with their current grade state.
 */
gradesRouter.get('/staff/course-classes/:id/grades', async (req, res, next) => {
  try {
    const { id } = courseClassIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_list_class_grades', { p_course_class_id: id });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/staff/enrollments/:enrollmentId/grade
 * Creates a new DRAFT grade. finalScore is mandatory (BUS-27/29).
 */
gradesRouter.post('/staff/enrollments/:enrollmentId/grade', async (req, res, next) => {
  try {
    const { enrollmentId } = enrollmentIdParamsSchema.parse(req.params);

    let body;
    try {
      body = createDraftGradeBodySchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_create_draft_grade', {
      p_enrollment_id: enrollmentId,
      p_final_score: body.finalScore,
    });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    if (!data?.success) {
      sendError(res, 400, 'CREATE_GRADE_REJECTED', data?.reason ?? 'Không thể tạo điểm.');
      return;
    }

    sendSuccess(res, data, 201);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/staff/enrollments/:enrollmentId/grade
 * Edits final_score while still DRAFT (BUS-30).
 */
gradesRouter.patch('/staff/enrollments/:enrollmentId/grade', async (req, res, next) => {
  try {
    const { enrollmentId } = enrollmentIdParamsSchema.parse(req.params);

    let body;
    try {
      body = updateDraftGradeBodySchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_update_draft_grade', {
      p_enrollment_id: enrollmentId,
      p_final_score: body.finalScore,
    });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    if (!data?.success) {
      sendError(res, 400, 'UPDATE_GRADE_REJECTED', data?.reason ?? 'Không thể sửa điểm.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/staff/enrollments/:enrollmentId/grade/publish
 * DRAFT -> PUBLISHED, system computes PASS/FAIL (BUS-32).
 */
gradesRouter.post('/staff/enrollments/:enrollmentId/grade/publish', async (req, res, next) => {
  try {
    const { enrollmentId } = enrollmentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_publish_grade', {
      p_enrollment_id: enrollmentId,
    });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    if (!data?.success) {
      sendError(res, 400, 'PUBLISH_GRADE_REJECTED', data?.reason ?? 'Không thể công bố điểm.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/students/:id/grades
 * Full grade history of a student (DRAFT and PUBLISHED) - staff is not
 * limited to PUBLISHED-only the way the student view is.
 */
gradesRouter.get('/staff/students/:id/grades', async (req, res, next) => {
  try {
    const { id } = studentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_get_student_grades', { p_student_id: id });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/students/:id/progress
 * Read-only credit progress for an arbitrary student (design decision #3).
 */
gradesRouter.get('/staff/students/:id/progress', async (req, res, next) => {
  try {
    const { id } = studentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_get_student_progress', { p_student_id: id });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    sendSuccess(res, row ?? null);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/student/grades
 * Only the caller's own PUBLISHED grades (UC-25). DRAFT never leaves the RPC.
 */
gradesRouter.get('/student/grades', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('student_get_own_grades');

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/student/progress
 * Only the caller's own progress (UC-26).
 */
gradesRouter.get('/student/progress', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('student_get_own_progress');

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    sendSuccess(res, row ?? null);
  } catch (err) {
    next(err);
  }
});
