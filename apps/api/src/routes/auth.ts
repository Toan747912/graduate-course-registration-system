import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';

export const authRouter = Router();

/**
 * POST /api/auth/session/verify
 * Verifies the bearer token and echoes back the caller's id/role/status.
 * Frontend uses this after login to confirm the session is valid and to
 * decide which area (student/staff) to route into.
 */
authRouter.post('/auth/session/verify', requireAuth, (req, res) => {
  const { id, email, role, studentStatus } = req.authUser!;
  sendSuccess(res, { id, email, role, studentStatus });
});
