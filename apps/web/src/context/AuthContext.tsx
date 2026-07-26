import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { apiFetch } from '../lib/api';

export type AppRole = 'STUDENT' | 'TRAINING_STAFF';

export interface SessionProfile {
  id: string;
  email: string | null;
  role: AppRole;
  studentStatus: 'ACTIVE' | 'INACTIVE' | null;
}

export type ProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AuthContextValue {
  session: Session | null;
  profile: SessionProfile | null;
  /** Distinguishes "no session yet" (idle), "verifying with the API" (loading),
   * a resolved profile (ready), and a failed /auth/session/verify call (error) -
   * Login needs this to tell "still checking" apart from "verify failed". */
  profileStatus: ProfileStatus;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileStatus('idle');
      return;
    }

    setProfileStatus('loading');

    // Confirms the session against the backend and loads role/student_status
    // via POST /api/auth/session/verify, rather than trusting client-side state.
    apiFetch<SessionProfile>('/auth/session/verify', { method: 'POST' })
      .then((verifiedProfile) => {
        setProfile(verifiedProfile);
        setProfileStatus('ready');
      })
      .catch(() => {
        setProfile(null);
        setProfileStatus('error');
      });
  }, [session]);

  const signOut = async (): Promise<void> => {
    // Clear local state immediately rather than waiting for the async
    // onAuthStateChange listener, so RequireRole/UI reflect the logged-out
    // state right away even if the network call is slow.
    setProfile(null);
    setProfileStatus('idle');
    setSession(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, profile, profileStatus, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
