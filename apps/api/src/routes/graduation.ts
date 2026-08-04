import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { buildGraduationCsv, type GraduationCsvRow } from '../lib/csv.js';
import {
  graduationFilterQuerySchema,
  graduationListQuerySchema,
  studentIdParamsSchema,
} from '../schemas/graduation.js';

/**
 * Batch 5 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md): graduation
 * eligibility, confirm, dashboard/list, CSV export. Every write goes through
 * a SECURITY DEFINER RPC (migrations 0043-0047) -- this router only
 * translates request/response shape and turns RPC rejections into
 * client-safe Vietnamese error responses, exactly like theses.ts.
 */
export const graduationRouter = Router();

graduationRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));
graduationRouter.use('/student', requireAuth, requireRole('STUDENT'));

function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
}

// Same rationale as theses.ts: never forward raw Postgres/PostgREST error
// text to the client (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section
// 6/P3) -- it could leak internal table/column/constraint names.
const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại sau.';

// ---------------------------------------------------------------------------
// student: own graduation status
// ---------------------------------------------------------------------------

graduationRouter.get('/student/graduation', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_get_own_graduation_status');
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// staff: summary / list / detail / confirm / export
// ---------------------------------------------------------------------------

graduationRouter.get('/staff/graduation/summary', async (req, res, next) => {
  try {
    let query;
    try {
      query = graduationFilterQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_get_graduation_summary', {
      p_program_id: query.program_id ?? null,
      p_cohort_id: query.cohort_id ?? null,
      p_academic_status: query.academic_status ?? null,
      p_eligibility_status: query.eligibility_status ?? null,
    });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

graduationRouter.get('/staff/graduation/students', async (req, res, next) => {
  try {
    let query;
    try {
      query = graduationListQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_list_graduation_status', {
      p_program_id: query.program_id ?? null,
      p_cohort_id: query.cohort_id ?? null,
      p_academic_status: query.academic_status ?? null,
      p_eligibility_status: query.eligibility_status ?? null,
      p_page: query.page ?? 1,
      p_page_size: query.page_size ?? 20,
    });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

graduationRouter.get('/staff/graduation/students/:studentId', async (req, res, next) => {
  try {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_get_student_graduation_status', {
      p_student_id: studentId,
    });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

graduationRouter.post('/staff/graduation/students/:studentId/confirm', async (req, res, next) => {
  try {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_confirm_graduation', { p_student_id: studentId });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    const payload = data as { success?: boolean; reason?: string; details?: unknown } | null;
    if (!payload?.success) {
      sendError(res, 400, 'CONFIRM_GRADUATION_REJECTED', payload?.reason ?? 'Không thể xác nhận tốt nghiệp.', payload?.details);
      return;
    }
    sendSuccess(res, payload);
  } catch (err) {
    next(err);
  }
});

// GET /staff/graduation/export.csv -- BUS-77: same filters as the dashboard,
// no pagination (always the full filtered set), no server-side file storage
// (streamed directly in the response).
graduationRouter.get('/staff/graduation/export.csv', async (req, res, next) => {
  try {
    let query;
    try {
      query = graduationFilterQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_list_graduation_status', {
      p_program_id: query.program_id ?? null,
      p_cohort_id: query.cohort_id ?? null,
      p_academic_status: query.academic_status ?? null,
      p_eligibility_status: query.eligibility_status ?? null,
      p_page: 1,
      // The dashboard list caps page_size at 100 server-side (BUS-81); a
      // CSV export must reflect the whole filtered set regardless of that
      // cap, so this pulls the total count first and requests exactly that
      // many rows in one page (still bounded to a single RPC call — this is
      // an export tool used interactively by staff, not a bulk data feed).
      p_page_size: 100,
    });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    const firstPage = data as { items: GraduationCsvRow[]; total: number } | null;
    if (!firstPage) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }

    let allItems: GraduationCsvRow[] = firstPage.items;
    const total = firstPage.total;
    let fetched = allItems.length;
    let page = 2;
    while (fetched < total) {
      const { data: nextData, error: nextError } = await client.rpc('staff_list_graduation_status', {
        p_program_id: query.program_id ?? null,
        p_cohort_id: query.cohort_id ?? null,
        p_academic_status: query.academic_status ?? null,
        p_eligibility_status: query.eligibility_status ?? null,
        p_page: page,
        p_page_size: 100,
      });
      if (nextError) {
        sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
        return;
      }
      const nextPage = nextData as { items: GraduationCsvRow[] } | null;
      const items = nextPage?.items ?? [];
      if (items.length === 0) break;
      allItems = allItems.concat(items);
      fetched += items.length;
      page += 1;
    }

    const csv = buildGraduationCsv(allItems);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="graduation-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
