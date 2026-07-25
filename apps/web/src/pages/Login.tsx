import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

/**
 * Supabase Auth email/password sign-in. After a successful sign-in, the
 * session change is picked up by AuthProvider, which calls
 * POST /auth/session/verify to resolve the caller's role; this page waits for
 * that result and routes by role rather than assuming STUDENT.
 */
export function Login(): JSX.Element {
  const navigate = useNavigate();
  const { session, profile, profileStatus, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session) {
      return;
    }

    if (profileStatus === 'ready' && profile) {
      navigate(profile.role === 'STUDENT' ? '/student/classes' : '/staff', { replace: true });
    }

    if (profileStatus === 'error') {
      setError('Đăng nhập thành công nhưng không thể xác minh phiên làm việc. Vui lòng thử lại sau.');
    }
  }, [session, profile, profileStatus, loading, navigate]);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);

    if (signInError) {
      setError('Email hoặc mật khẩu không đúng.');
    }
  };

  const busy = submitting || (Boolean(session) && profileStatus === 'loading');

  return (
    <main className="page page-centered">
      <form className="card form" onSubmit={handleSubmit}>
        <h1>Đăng nhập</h1>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>Mật khẩu</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Đang xử lý…' : 'Đăng nhập'}
        </button>
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
