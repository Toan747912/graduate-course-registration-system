import { describe, expect, it } from 'vitest';
import { resolveRouteGuardDecision } from './routeGuard';
import type { SessionProfile } from '../context/AuthContext';

const staffProfile: SessionProfile = {
  id: 'staff-1',
  email: 'staff@example.local',
  role: 'TRAINING_STAFF',
  studentStatus: null,
};

const studentProfile: SessionProfile = {
  id: 'student-1',
  email: 'student@example.local',
  role: 'STUDENT',
  studentStatus: 'ACTIVE',
};

describe('resolveRouteGuardDecision', () => {
  it('shows loading while the initial supabase getSession() call is in flight', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: true,
      session: null,
      profileStatus: 'idle',
      profile: null,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'loading' });
  });

  it('redirects to /login when there is truly no session', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: null,
      profileStatus: 'idle',
      profile: null,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'redirect', to: '/login' });
  });

  it('shows loading (not a redirect) while a session exists but the profile verify call is still pending - this is the hard-refresh-on-deep-route regression', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'loading',
      profile: null,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'loading' });
  });

  it('shows loading when profileStatus is idle but a session already exists (verify effect not yet scheduled)', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'idle',
      profile: null,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'loading' });
  });

  it('redirects to /login when the profile verify call genuinely failed', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'error',
      profile: null,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'redirect', to: '/login' });
  });

  it('allows a staff profile on a staff-only deep route once ready', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'ready',
      profile: staffProfile,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'allow' });
  });

  it('allows a student profile on a student-only route once ready', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'ready',
      profile: studentProfile,
      allow: ['STUDENT'],
    });
    expect(decision).toEqual({ type: 'allow' });
  });

  it('redirects a student away from a staff-only route to the student home', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'ready',
      profile: studentProfile,
      allow: ['TRAINING_STAFF'],
    });
    expect(decision).toEqual({ type: 'redirect', to: '/student/classes' });
  });

  it('redirects staff away from a student-only route to the staff home', () => {
    const decision = resolveRouteGuardDecision({
      authLoading: false,
      session: { access_token: 'token' },
      profileStatus: 'ready',
      profile: staffProfile,
      allow: ['STUDENT'],
    });
    expect(decision).toEqual({ type: 'redirect', to: '/staff' });
  });
});
