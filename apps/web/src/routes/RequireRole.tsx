import { Navigate } from 'react-router-dom';
import { useAuth, type AppRole } from '../context/AuthContext';
import { resolveRouteGuardDecision } from './routeGuard';

interface RequireRoleProps {
  allow: AppRole[];
  children: JSX.Element;
}

/**
 * Frontend-level route guard only. This is a UX convenience (avoid flashing
 * screens the current user shouldn't see); it is not a security boundary.
 * Every actual write goes through apps/api, which re-verifies the JWT and
 * role via requireAuth/requireRole regardless of what the frontend allowed.
 */
export function RequireRole({ allow, children }: RequireRoleProps): JSX.Element {
  const { session, profile, profileStatus, loading } = useAuth();

  const decision = resolveRouteGuardDecision({
    authLoading: loading,
    session,
    profileStatus,
    profile,
    allow,
  });

  if (decision.type === 'loading') {
    return <p>Loading...</p>;
  }

  if (decision.type === 'redirect') {
    return <Navigate to={decision.to} replace />;
  }

  return children;
}
