import { Navigate } from 'react-router-dom';
import { useAuth, type AppRole } from '../context/AuthContext';

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
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile || !allow.includes(profile.role)) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
