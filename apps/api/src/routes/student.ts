import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  cancelEnrollmentBodySchema,
  cancelEnrollmentParamsSchema,
  createEnrollmentSchema,
  listClassesQuerySchema,
  semesterRowSchema,
  type SemesterRow,
} from '../schemas/student.js';

export const studentRouter = Router();

// Scoped to '/student' (not a bare .use(...)): an unscoped .use() runs for
// every request Express forwards into this router - since this router is
// mounted at app.use('/api', studentRouter), that would reject every
// /api/staff/* request with 403 before it ever reaches staffRouter.
studentRouter.use('/student', requireAuth, requireRole('STUDENT'));

/**
 * GET /api/student/semesters
 * Returns only the semesters an active student may currently register
 * classes in, so the frontend has a semesterId to pass to GET /student/classes
 * without ever reading registration_periods directly.
 *
 * `registration_periods` has no student-facing RLS select policy (by design —
 * see 0007_rls_policies.sql, students only ever read it indirectly through
 * the SECURITY DEFINER get_registration_classes RPC), so this endpoint cannot
 * check opens_at/closes_at itself. Instead it calls the same RPC the classes
 * screen uses for every semester and reports a semester as "open" when that
 * call returns at least one ACTIVE class — the same read model the student
 * screen already relies on, with no new SQL/RLS/RPC added. A period that is
 * open but has zero ACTIVE classes would not appear here; that's an accepted
 * limitation of reusing the existing RPC rather than adding new SQL.
 */
studentRouter.get('/student/semesters', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data: semesterRows, error: semesterError } = await client
      .from('semesters')
      .select('id, name')
      .order('name', { ascending: true });

    if (semesterError) {
      sendError(res, 400, 'QUERY_ERROR', semesterError.message);
      return;
    }

    const semesters = semesterRowSchema.array().parse(semesterRows ?? []);

    const openSemesters: SemesterRow[] = [];
    for (const semester of semesters) {
      const { data: classes, error: rpcError } = await client.rpc('get_registration_classes', {
        p_semester_id: semester.id,
      });

      if (rpcError) {
        continue;
      }

      if (Array.isArray(classes) && classes.length > 0) {
        openSemesters.push(semester);
      }
    }

    sendSuccess(res, openSemesters);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/student/classes?semesterId=...
 * Calls the get_registration_classes RPC; no business logic is reimplemented here.
 */
studentRouter.get('/student/classes', async (req, res, next) => {
  try {
    const { semesterId } = listClassesQuerySchema.parse(req.query);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('get_registration_classes', {
      p_semester_id: semesterId,
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
 * POST /api/student/enrollments
 * Calls the register_for_class RPC, which performs every BUS-01..BUS-07 check
 * and writes the enrollment + history rows atomically.
 */
studentRouter.post('/student/enrollments', async (req, res, next) => {
  try {
    const { classId } = createEnrollmentSchema.parse(req.body);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('register_for_class', {
      p_class_id: classId,
    });

    if (error) {
      sendError(res, 400, 'RPC_ERROR', error.message);
      return;
    }

    sendSuccess(res, data, 201);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/student/enrollments/:id/cancel
 * Calls the cancel_own_enrollment RPC.
 */
studentRouter.post('/student/enrollments/:id/cancel', async (req, res, next) => {
  try {
    const { id } = cancelEnrollmentParamsSchema.parse(req.params);
    const { reason } = cancelEnrollmentBodySchema.parse(req.body ?? {});
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('cancel_own_enrollment', {
      p_enrollment_id: id,
      p_reason: reason ?? null,
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
 * GET /api/student/enrollments/history
 * Read from `enrollments` (current status) with the full status-transition
 * log nested per row, plus the class/course info needed to render it. Scoped
 * by RLS to the caller's own rows (enrollments_select_own_or_staff), and the
 * nested course_classes/courses reads rely on the UC-07
 * *_select_own_enrollment_history policies (0007_rls_policies.sql), which stay
 * visible even after a class is cancelled or its period closes.
 */
studentRouter.get('/student/enrollments/history', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('enrollments')
      .select(
        'id, status, reason, created_at, updated_at, ' +
          'course_classes!inner(id, class_code, courses!inner(code, name)), ' +
          'enrollment_history(status, reason, changed_at)',
      )
      .order('created_at', { ascending: false })
      .order('changed_at', { ascending: true, referencedTable: 'enrollment_history' });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});
