import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  cohortIdParamsSchema,
  createCohortSchema,
  createProgramCourseSchema,
  createProgramSchema,
  listCohortsQuerySchema,
  listProgramCoursesQuerySchema,
  programCourseIdParamsSchema,
  programIdParamsSchema,
  updateCohortSchema,
  updateProgramCourseSchema,
  updateProgramSchema,
} from '../schemas/academic.js';

/**
 * Batch 1 of the academic-management expansion
 * (docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md): programs, cohorts, and the
 * program/course requirement mapping. Training-staff-only, same pattern as
 * routes/staff.ts - thin routes, user-scoped Supabase client, RLS as the
 * actual write guard, this router's requireRole as the independent API-side
 * check.
 */
export const academicRouter = Router();

academicRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));

function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
}

// ---------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------

/**
 * GET /api/staff/programs
 */
academicRouter.get('/staff/programs', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.from('programs').select('*').order('code', { ascending: true });

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
 * GET /api/staff/programs/:id
 */
academicRouter.get('/staff/programs/:id', async (req, res, next) => {
  try {
    const { id } = programIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client.from('programs').select('*').eq('id', id).maybeSingle();

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', error.message);
      return;
    }

    if (!data) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy chương trình đào tạo.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/staff/programs
 * Plain data-entry insert, mirroring registration_periods above: RLS +
 * the unique(code) constraint are the real enforcement, this route only
 * exists to turn the raw Postgres error into a clear Vietnamese message.
 */
academicRouter.post('/staff/programs', async (req, res, next) => {
  try {
    let body;
    try {
      body = createProgramSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('programs')
      .insert({
        code: body.code,
        name: body.name,
        required_credits_min: body.requiredCreditsMin,
        elective_credits_min: body.electiveCreditsMin,
        pass_score_min: body.passScoreMin,
        thesis_credits_min: body.thesisCreditsMin,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'PROGRAM_CODE_EXISTS', 'Mã chương trình đào tạo này đã tồn tại.');
        return;
      }
      if (error.code === '23514') {
        sendError(res, 400, 'VALIDATION_ERROR', 'Cấu hình tín chỉ/điểm đạt không hợp lệ.');
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
 * PATCH /api/staff/programs/:id
 * Update the program's configurable fields. No delete endpoint: programs are
 * never hard-deleted in the MVP.
 */
academicRouter.patch('/staff/programs/:id', async (req, res, next) => {
  try {
    const { id } = programIdParamsSchema.parse(req.params);

    let body;
    try {
      body = updateProgramSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('programs')
      .update({
        code: body.code,
        name: body.name,
        required_credits_min: body.requiredCreditsMin,
        elective_credits_min: body.electiveCreditsMin,
        pass_score_min: body.passScoreMin,
        thesis_credits_min: body.thesisCreditsMin,
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'PROGRAM_CODE_EXISTS', 'Mã chương trình đào tạo này đã tồn tại.');
        return;
      }
      if (error.code === '23514') {
        sendError(res, 400, 'VALIDATION_ERROR', 'Cấu hình tín chỉ/điểm đạt không hợp lệ.');
        return;
      }
      sendError(res, 400, 'UPDATE_ERROR', error.message);
      return;
    }

    if (!data) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy chương trình đào tạo.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// cohorts
// ---------------------------------------------------------------------------

/**
 * GET /api/staff/cohorts?programId=
 */
academicRouter.get('/staff/cohorts', async (req, res, next) => {
  try {
    const { programId } = listCohortsQuerySchema.parse(req.query);
    const client = createUserScopedClient(req.authUser!.accessToken);

    let query = client.from('cohorts').select('*').order('code', { ascending: true });
    if (programId) {
      query = query.eq('program_id', programId);
    }

    const { data, error } = await query;

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
 * POST /api/staff/cohorts
 */
academicRouter.post('/staff/cohorts', async (req, res, next) => {
  try {
    let body;
    try {
      body = createCohortSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('cohorts')
      .insert({
        program_id: body.programId,
        code: body.code,
        name: body.name,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'COHORT_CODE_EXISTS', 'Mã khóa này đã tồn tại trong chương trình đào tạo.');
        return;
      }
      if (error.code === '23503') {
        sendError(res, 400, 'VALIDATION_ERROR', 'Chương trình đào tạo không tồn tại.');
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
 * PATCH /api/staff/cohorts/:id
 * Only code/name are editable; program_id is fixed at creation time (a cohort
 * always belongs to exactly one program, BUS-17). No delete endpoint.
 */
academicRouter.patch('/staff/cohorts/:id', async (req, res, next) => {
  try {
    const { id } = cohortIdParamsSchema.parse(req.params);

    let body;
    try {
      body = updateCohortSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('cohorts')
      .update({ code: body.code, name: body.name })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'COHORT_CODE_EXISTS', 'Mã khóa này đã tồn tại trong chương trình đào tạo.');
        return;
      }
      sendError(res, 400, 'UPDATE_ERROR', error.message);
      return;
    }

    if (!data) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy khóa.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// program_courses (required/elective course assignment)
// ---------------------------------------------------------------------------

/**
 * GET /api/staff/program-courses?programId=
 */
academicRouter.get('/staff/program-courses', async (req, res, next) => {
  try {
    const { programId } = listProgramCoursesQuerySchema.parse(req.query);
    const client = createUserScopedClient(req.authUser!.accessToken);

    let query = client
      .from('program_courses')
      .select('id, program_id, course_id, requirement_type, created_at, updated_at, courses!inner(code, name, credits)')
      .order('created_at', { ascending: true });
    if (programId) {
      query = query.eq('program_id', programId);
    }

    const { data, error } = await query;

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
 * POST /api/staff/program-courses
 * BUS-18: a course has exactly one requirement type per program, enforced by
 * the unique(program_id, course_id) constraint (0016 migration).
 */
academicRouter.post('/staff/program-courses', async (req, res, next) => {
  try {
    let body;
    try {
      body = createProgramCourseSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('program_courses')
      .insert({
        program_id: body.programId,
        course_id: body.courseId,
        requirement_type: body.requirementType,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sendError(res, 409, 'PROGRAM_COURSE_EXISTS', 'Môn học này đã được gán vào chương trình đào tạo.');
        return;
      }
      if (error.code === '23503') {
        sendError(res, 400, 'VALIDATION_ERROR', 'Chương trình đào tạo hoặc môn học không tồn tại.');
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
 * PATCH /api/staff/program-courses/:id
 * Change REQUIRED <-> ELECTIVE for an existing assignment. No delete
 * endpoint: assignments are never hard-deleted in the MVP.
 */
academicRouter.patch('/staff/program-courses/:id', async (req, res, next) => {
  try {
    const { id } = programCourseIdParamsSchema.parse(req.params);

    let body;
    try {
      body = updateProgramCourseSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);

    const { data, error } = await client
      .from('program_courses')
      .update({ requirement_type: body.requirementType })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      sendError(res, 400, 'UPDATE_ERROR', error.message);
      return;
    }

    if (!data) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy môn học đã gán trong chương trình đào tạo.');
      return;
    }

    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});
