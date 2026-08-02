import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { listStudentsQuerySchema, studentIdParamsSchema, updateStudentSchema } from '../schemas/students.js';

/**
 * Batch 2 of the academic-management expansion
 * (docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md): student profile management
 * (student_code, full_name, email, program, cohort, academic_status).
 *
 * All reads/writes go through the RPCs added in
 * 0019_rpc_student_profiles.sql (staff_list_students, staff_get_student,
 * staff_update_student, student_get_own_profile) rather than direct table
 * access, since email must come from auth.users (never exposed via a plain
 * table select) and profiles has no client-facing UPDATE policy (writes are
 * RPC-only, matching the existing convention - see 0007_rls_policies.sql).
 */
export const studentsRouter = Router();

studentsRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));
studentsRouter.use('/student', requireAuth, requireRole('STUDENT'));

function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
}

/**
 * GET /api/staff/students?programId=&cohortId=&academicStatus=&search=
 */
studentsRouter.get('/staff/students', async (req, res, next) => {
  try {
    const query = listStudentsQuerySchema.parse(req.query);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_list_students', {
      p_program_id: query.programId ?? null,
      p_cohort_id: query.cohortId ?? null,
      p_academic_status: query.academicStatus ?? null,
      p_search: query.search ?? null,
    });

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
 * GET /api/staff/students/:id
 */
studentsRouter.get('/staff/students/:id', async (req, res, next) => {
  try {
    const { id } = studentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_get_student', { p_student_id: id });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy học viên.');
      return;
    }

    sendSuccess(res, row);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/staff/students/:id
 * Only the Batch 2 academic fields are editable here; role/student_status are
 * never accepted from the client (student_status is set exclusively by the
 * profiles_academic_guard trigger, one-way from academic_status).
 */
studentsRouter.patch('/staff/students/:id', async (req, res, next) => {
  try {
    const { id } = studentIdParamsSchema.parse(req.params);

    let body;
    try {
      body = updateStudentSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('staff_update_student', {
      p_student_id: id,
      p_student_code: body.studentCode ?? null,
      p_full_name: body.fullName,
      p_program_id: body.programId ?? null,
      p_cohort_id: body.cohortId ?? null,
      p_academic_status: body.academicStatus,
    });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    if (!data?.success) {
      sendError(res, 409, 'UPDATE_REJECTED', data?.reason ?? 'Không thể cập nhật hồ sơ học viên.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/student/profile
 * The caller's own profile, including their own email (read from auth.users
 * inside the RPC - never any other user's).
 */
studentsRouter.get('/student/profile', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('student_get_own_profile');

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy hồ sơ học viên.');
      return;
    }

    sendSuccess(res, row);
  } catch (err) {
    next(err);
  }
});
