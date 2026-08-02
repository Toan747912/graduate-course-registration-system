import type { AppRole, ProfileStatus, SessionProfile } from '../context/AuthContext';

export const HOME_PATH_BY_ROLE: Record<AppRole, string> = {
  STUDENT: '/student/classes',
  TRAINING_STAFF: '/staff',
};

export type RouteGuardDecision =
  | { type: 'loading' }
  | { type: 'redirect'; to: string }
  | { type: 'allow' };

export interface RouteGuardInput {
  /** True only while the initial supabase.auth.getSession() call is in flight. */
  authLoading: boolean;
  session: unknown | null;
  profileStatus: ProfileStatus;
  profile: SessionProfile | null;
  allow: AppRole[];
}

/**
 * Pure decision function behind RequireRole, kept separate from the
 * component so it can be unit-tested without rendering React/JSX or a
 * router. A session existing but profileStatus still 'loading'/'idle' must
 * resolve to 'loading', never to a redirect - otherwise a hard refresh on a
 * deep staff/student route bounces through /login and loses the original
 * path (see docs/BATCH_1_INTEGRATION_REPORT.md Part F/G).
 */
export function resolveRouteGuardDecision({
  authLoading,
  session,
  profileStatus,
  profile,
  allow,
}: RouteGuardInput): RouteGuardDecision {
  if (authLoading) {
    return { type: 'loading' };
  }

  if (!session) {
    return { type: 'redirect', to: '/login' };
  }

  if (profileStatus === 'idle' || profileStatus === 'loading') {
    return { type: 'loading' };
  }

  if (profileStatus === 'error' || !profile) {
    return { type: 'redirect', to: '/login' };
  }

  if (!allow.includes(profile.role)) {
    return { type: 'redirect', to: HOME_PATH_BY_ROLE[profile.role] };
  }

  return { type: 'allow' };
}
