import { Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  assignAdvisorSchema,
  cancelOwnThesisSchema,
  cancelThesisStaffSchema,
  changeAdvisorSchema,
  createAdvisorSchema,
  createResearchAreaSchema,
  createThesisProposalSchema,
  idParamsSchema,
  listThesesQuerySchema,
  rejectThesisSchema,
  updateAdvisorSchema,
  updateResearchAreaSchema,
  updateThesisProposalSchema,
} from '../schemas/theses.js';

/**
 * Batch 4 (docs/BATCH_4_THESIS_ADVISOR_DESIGN.md): thesis proposals, advisor
 * catalog, research area catalog, and the assignment/lifecycle RPCs. Every
 * write goes through a SECURITY DEFINER RPC (0034-0037) -- never a direct
 * table write -- so BUS-38..64 are enforced in exactly one place. This
 * router only translates request/response shape and turns RPC `{ success:
 * false, reason }` payloads into client-safe Vietnamese error responses.
 */
export const thesesRouter = Router();

thesesRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'));
thesesRouter.use('/student', requireAuth, requireRole('STUDENT'));

function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dữ liệu không hợp lệ';
}

// Never forward raw Postgres/PostgREST error text to the client (Batch 3
// lesson, docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 6/P3): a
// constraint-violation or other unexpected DB error could otherwise leak
// internal table/column/constraint names. Every business-rule rejection is
// already reported via the RPC's own jsonb {success:false, reason} payload
// in Vietnamese; anything landing in `error` instead is unexpected, so it
// gets a single generic message here.
const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại sau.';

function handleRpcResult(res: import('express').Response, data: unknown, error: unknown, rejectedCode: string, successStatus = 200): void {
  if (error) {
    sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
    return;
  }
  const payload = data as { success?: boolean; reason?: string } | null;
  if (!payload?.success) {
    sendError(res, 400, rejectedCode, payload?.reason ?? 'Yêu cầu không thể thực hiện.');
    return;
  }
  sendSuccess(res, payload, successStatus);
}

// ---------------------------------------------------------------------------
// research areas (staff manage; anyone authenticated can list active ones)
// ---------------------------------------------------------------------------

/** GET /api/research-areas -- ACTIVE areas only, for the student picker. */
thesesRouter.get('/research-areas', requireAuth, async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client
      .from('research_areas')
      .select('id, name, description')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      sendError(res, 400, 'QUERY_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/** GET /api/staff/research-areas -- full catalog including inactive. */
thesesRouter.get('/staff/research-areas', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_list_research_areas');
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/research-areas', async (req, res, next) => {
  try {
    let body;
    try {
      body = createResearchAreaSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_create_research_area', {
      p_name: body.name,
      p_description: body.description ?? null,
    });
    handleRpcResult(res, data, error, 'CREATE_RESEARCH_AREA_REJECTED', 201);
  } catch (err) {
    next(err);
  }
});

thesesRouter.patch('/staff/research-areas/:id', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = updateResearchAreaSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_update_research_area', {
      p_id: id,
      p_name: body.name,
      p_description: body.description ?? null,
      p_is_active: body.isActive,
    });
    handleRpcResult(res, data, error, 'UPDATE_RESEARCH_AREA_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/research-areas/:id/deactivate', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_deactivate_research_area', { p_id: id });
    handleRpcResult(res, data, error, 'DEACTIVATE_RESEARCH_AREA_REJECTED');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// advisors (staff manage; students never read this table directly)
// ---------------------------------------------------------------------------

thesesRouter.get('/staff/advisors', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_list_advisors');
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/advisors', async (req, res, next) => {
  try {
    let body;
    try {
      body = createAdvisorSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_create_advisor', {
      p_advisor_code: body.advisorCode,
      p_full_name: body.fullName,
      p_specialization: body.specialization,
      p_max_active_theses: body.maxActiveTheses,
    });
    handleRpcResult(res, data, error, 'CREATE_ADVISOR_REJECTED', 201);
  } catch (err) {
    next(err);
  }
});

thesesRouter.patch('/staff/advisors/:id', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = updateAdvisorSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_update_advisor', {
      p_id: id,
      p_full_name: body.fullName,
      p_specialization: body.specialization,
      p_max_active_theses: body.maxActiveTheses,
    });
    handleRpcResult(res, data, error, 'UPDATE_ADVISOR_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/advisors/:id/deactivate', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_deactivate_advisor', { p_id: id });
    handleRpcResult(res, data, error, 'DEACTIVATE_ADVISOR_REJECTED');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// student: own thesis
// ---------------------------------------------------------------------------

thesesRouter.get('/student/theses/eligibility', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_check_thesis_eligibility');
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

thesesRouter.get('/student/theses', async (req, res, next) => {
  try {
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_get_own_theses');
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

thesesRouter.get('/student/theses/:id', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_get_own_thesis', { p_id: id });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy luận văn.');
      return;
    }
    sendSuccess(res, row);
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/student/theses', async (req, res, next) => {
  try {
    let body;
    try {
      body = createThesisProposalSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_create_thesis_proposal', {
      p_title: body.title,
      p_description: body.description,
      p_research_area_id: body.researchAreaId,
    });
    handleRpcResult(res, data, error, 'CREATE_THESIS_REJECTED', 201);
  } catch (err) {
    next(err);
  }
});

thesesRouter.patch('/student/theses/:id', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = updateThesisProposalSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_update_own_thesis_proposal', {
      p_id: id,
      p_title: body.title,
      p_description: body.description,
      p_research_area_id: body.researchAreaId,
    });
    handleRpcResult(res, data, error, 'UPDATE_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/student/theses/:id/cancel', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = cancelOwnThesisSchema.parse(req.body ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_cancel_own_thesis', {
      p_id: id,
      p_reason: body.reason ?? null,
    });
    handleRpcResult(res, data, error, 'CANCEL_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.get('/student/theses/:id/advisor-history', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('student_get_own_thesis_advisor_history', { p_thesis_id: id });
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
// staff: thesis review/lifecycle
// ---------------------------------------------------------------------------

thesesRouter.get('/staff/theses', async (req, res, next) => {
  try {
    const { status } = listThesesQuerySchema.parse(req.query);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_list_theses', { p_status: status ?? null });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

thesesRouter.get('/staff/theses/:id', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_get_thesis', { p_id: id });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy luận văn.');
      return;
    }
    sendSuccess(res, row);
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/approve', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_approve_thesis', { p_id: id });
    handleRpcResult(res, data, error, 'APPROVE_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/reject', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = rejectThesisSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_reject_thesis', { p_id: id, p_reason: body.reason });
    handleRpcResult(res, data, error, 'REJECT_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/assign-advisor', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = assignAdvisorSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_assign_advisor', {
      p_thesis_id: id,
      p_advisor_id: body.advisorId,
    });
    handleRpcResult(res, data, error, 'ASSIGN_ADVISOR_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/change-advisor', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = changeAdvisorSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_change_advisor', {
      p_thesis_id: id,
      p_new_advisor_id: body.advisorId,
      p_reason: body.reason,
    });
    handleRpcResult(res, data, error, 'CHANGE_ADVISOR_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/cancel', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    let body;
    try {
      body = cancelThesisStaffSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', zodErrorMessage(err), err.flatten());
        return;
      }
      throw err;
    }

    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_cancel_thesis', { p_id: id, p_reason: body.reason });
    handleRpcResult(res, data, error, 'CANCEL_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.post('/staff/theses/:id/complete', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_complete_thesis', { p_id: id });
    handleRpcResult(res, data, error, 'COMPLETE_THESIS_REJECTED');
  } catch (err) {
    next(err);
  }
});

thesesRouter.get('/staff/theses/:id/advisor-history', async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const client = createUserScopedClient(req.authUser!.accessToken);
    const { data, error } = await client.rpc('staff_get_thesis_advisor_history', { p_thesis_id: id });
    if (error) {
      sendError(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE);
      return;
    }
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});
