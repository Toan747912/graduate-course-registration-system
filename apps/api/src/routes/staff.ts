import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  cancelCourseClassBodySchema,
  cancelCourseClassParamsSchema,
  courseClassIdParamsSchema,
  createCourseClassSchema,
  createRegistrationPeriodSchema,
  listClassEnrollmentsParamsSchema,
} from '../schemas/staff.js';

export const staffRouter = Router();

/**
 * Supabase's untyped client (no generated DB types are wired up in this
 * project) infers a generic/error type for deeply-nested embedded selects.
 * These interfaces describe the actual runtime shape of the
 * course_classes+courses+registration_periods+semesters+class_schedules
 * select used below, so the route code can work with real field names
 * instead of `any`.
 */
interface CourseClassRow {
  id: string;
  class_code: string;
  max_seats: number;
  status: 'ACTIVE' | 'CANCELLED';
  cancellation_reason: string | null;
  registration_period_id: string;
  course_id: string;
  created_at: string;
  courses: { code: string; name: string; credits: number };
  registration_periods: {
    id: string;
    opens_at: string;
    closes_at: string;
    semesters: { name: string };
  };
  class_schedules: { day_of_week: number; session_slot: number; room: string | null }[];
}

const COURSE_CLASS_SELECT =
  'id, class_code, max_seats, status, cancellation_reason, registration_period_id, course_id, created_at, ' +
  'courses!inner(code, name, credits), ' +
  'registration_periods!inner(id, opens_at, closes_at, semesters!inner(name)), ' +
  'class_schedules(day_of_week, session_slot, room)';

// Scoped to '/staff' for the same reason student.ts scopes to '/student': an
// unscoped .use() would run for every request Express forwards into this
// router, not just the ones this router actually has routes for.
staffRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));

/**
 * GET /api/staff/semesters
 * All semesters, for the registration-period create form's dropdown.
 */
staffRouter.get('/staff/semesters', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.from('semesters').select('id, name').order('name', { ascending: true });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/registration-periods
 * All registration periods with their semester name. "Open/closed" status is
 * derived client-side from opens_at/closes_at (same convention as elsewhere
 * in this codebase - no stored status column, see 0002 migration).
 */
staffRouter.get('/staff/registration-periods', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('registration_periods')
      .select('id, semester_id, opens_at, closes_at, max_credits, created_at, semesters!inner(name)')
      .order('opens_at', { ascending: false });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/staff/registration-periods
 * Direct insert (not an RPC): creating a period is a plain data-entry
 * operation, not a multi-rule business transaction. RLS still requires
 * is_training_staff() and the unique(semester_id) constraint enforces BUS-13.
 * The duplicate-semester check below is a pre-check purely so the UI can show
 * a clear Vietnamese message instead of a raw Postgres constraint error; the
 * DB constraint remains the actual source of truth/enforcement.
 */
staffRouter.post('/staff/registration-periods', async (req, res, next) => {
  try {
    let body;
    try {
      body = createRegistrationPeriodSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
        sendError(res, 400, 'VALIDATION_ERROR', message, err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data: existing, error: existingError } = await client
      .from('registration_periods')
      .select('id')
      .eq('semester_id', body.semesterId)
      .maybeSingle();

    if (existingError) {
      sendError(res, 400, 'QUERY_ERROR', existingError.message);
      return;
    }

    if (existing) {
      sendError(res, 409, 'PERIOD_EXISTS', 'Học kỳ này đã có đợt đăng ký.');
      return;
    }

    const { data, error } = await client
      .from('registration_periods')
      .insert({
        semester_id: body.semesterId,
        opens_at: body.opensAt,
        closes_at: body.closesAt,
        max_credits: body.maxCredits,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'PERIOD_EXISTS', 'Học kỳ này đã có đợt đăng ký.');
        return;
      }
      if (error.code === '23514') {
        sendError(res, 400, 'VALIDATION_ERROR', 'Thời gian hoặc giới hạn tín chỉ không hợp lệ.');
        return;
      }
      sendError(res, 400, 'INSERT_ERROR', error.message);
      return;
    }

    sendSuccess(res, data, 201);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/courses
 * Reference data only (no CRUD here), for the course-class create form.
 */
staffRouter.get('/staff/courses', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('courses')
      .select('id, code, name, credits')
      .order('code', { ascending: true });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/course-classes
 * All course classes with course/period/semester info, schedules, and
 * confirmed seat count. confirmed_count is computed in a second query rather
 * than an embedded PostgREST count-filter (not supported cleanly for a
 * filtered embedded count), then merged in application code.
 */
staffRouter.get('/staff/course-classes', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('course_classes')
      .select(COURSE_CLASS_SELECT)
      .order('created_at', { ascending: false });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    const classes = (data ?? []) as unknown as CourseClassRow[];
    const classIds = classes.map((c) => c.id);
    let confirmedCounts: Record<string, number> = {};

    if (classIds.length > 0) {
      const { data: enrollments, error: enrollmentsError } = await client
        .from('enrollments')
        .select('course_class_id')
        .eq('status', 'CONFIRMED')
        .in('course_class_id', classIds);

      if (enrollmentsError) {
        sendError(res, 400, 'QUERY_ERROR', enrollmentsError.message);
        return;
      }

      confirmedCounts = (enrollments ?? []).reduce<Record<string, number>>((acc, row: { course_class_id: string }) => {
        acc[row.course_class_id] = (acc[row.course_class_id] ?? 0) + 1;
        return acc;
      }, {});
    }

    const result = classes.map((c) => ({
      ...c,
      confirmed_count: confirmedCounts[c.id] ?? 0,
    }));

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/staff/course-classes/:id
 * Single course-class detail, same shape as the list above, for the
 * class-detail/enrollment-roster screen.
 */
staffRouter.get('/staff/course-classes/:id', async (req, res, next) => {
  try {
    const { id } = courseClassIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('course_classes')
      .select(COURSE_CLASS_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    if (!data) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy lớp học phần.');
      return;
    }

    const courseClass = data as unknown as CourseClassRow;

    const { count, error: countError } = await client
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('course_class_id', id)
      .eq('status', 'CONFIRMED');

    if (countError) {
      sendError(res, 400, 'QUERY_ERROR', countError.message);
      return;
    }

    sendSuccess(res, { ...courseClass, confirmed_count: count ?? 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/staff/course-classes
 * Calls the create_course_class RPC (0012 migration) so the class row and all
 * of its schedule rows are created atomically - no partially-created class
 * with zero schedules can result from a mid-way failure.
 */
staffRouter.post('/staff/course-classes', async (req, res, next) => {
  try {
    const body = createCourseClassSchema.parse(req.body);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('create_course_class', {
      p_registration_period_id: body.registrationPeriodId,
      p_course_id: body.courseId,
      p_class_code: body.classCode,
      p_max_seats: body.maxSeats,
      p_schedules: body.schedules.map((s) => ({
        day_of_week: s.dayOfWeek,
        session_slot: s.sessionSlot,
        room: s.room ?? null,
      })),
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
 * POST /api/staff/course-classes/:id/cancel
 * Calls the cancel_course_class RPC, which cascades CONFIRMED enrollments to
 * CANCELLED_BY_SCHOOL (BUS-11).
 */
staffRouter.post('/staff/course-classes/:id/cancel', async (req, res, next) => {
  try {
    const { id } = cancelCourseClassParamsSchema.parse(req.params);
    const { reason } = cancelCourseClassBodySchema.parse(req.body);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.rpc('cancel_course_class', {
      p_class_id: id,
      p_reason: reason,
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
 * GET /api/staff/course-classes/:id/enrollments
 * Read-only query, scoped by RLS to training staff.
 */
staffRouter.get('/staff/course-classes/:id/enrollments', async (req, res, next) => {
  try {
    const { id } = listClassEnrollmentsParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('enrollments')
      .select('id, student_id, status, reason, created_at, updated_at, profiles!inner(full_name)')
      .eq('course_class_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});
