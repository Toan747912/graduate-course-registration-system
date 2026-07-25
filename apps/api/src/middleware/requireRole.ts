import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../utils/response.js';
import type { AuthenticatedUser } from './auth.js';

/**
 * Must run after requireAuth. Rejects the request unless req.authUser.role is
 * one of the allowed roles. This is the API-side authorization check the
 * business requirements call for in addition to (not instead of) RLS.
 */
export function requireRole(...allowedRoles: Array<AuthenticatedUser['role']>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Missing authenticated user context');
      return;
    }

    if (!allowedRoles.includes(req.authUser.role)) {
      sendError(res, 403, 'FORBIDDEN', `Requires role: ${allowedRoles.join(' or ')}`);
      return;
    }

    next();
  };
}
