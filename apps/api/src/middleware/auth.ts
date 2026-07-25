import type { NextFunction, Request, Response } from 'express';
import { createUserScopedClient } from '../lib/supabaseClient.js';
import { sendError } from '../utils/response.js';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  accessToken: string;
  role: 'STUDENT' | 'TRAINING_STAFF';
  studentStatus: 'ACTIVE' | 'INACTIVE' | null;
}

/**
 * Verifies the Supabase-issued JWT on every request and loads the caller's
 * profile (role, student_status). This is independent of and in addition to
 * RLS: the API must not trust the frontend's claimed role.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header('authorization') ?? req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Missing bearer token');
    return;
  }

  const accessToken = authHeader.slice('Bearer '.length).trim();
  const client = createUserScopedClient(accessToken);

  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData.user) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Invalid or expired token');
    return;
  }

  // RLS's profiles_select_own_or_staff policy allows `id = auth.uid()`, which
  // covers this own-profile lookup without needing an RLS-bypassing key.
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('role, student_status')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    sendError(res, 401, 'PROFILE_NOT_FOUND', 'No profile found for this user');
    return;
  }

  req.authUser = {
    id: userData.user.id,
    email: userData.user.email ?? null,
    accessToken,
    role: profile.role as AuthenticatedUser['role'],
    studentStatus: (profile.student_status ?? null) as AuthenticatedUser['studentStatus'],
  };

  next();
}
