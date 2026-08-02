import { useCallback, useEffect, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { AcademicStatus, StudentProfile as StudentProfileData } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const ACADEMIC_STATUS_LABELS: Record<AcademicStatus, string> = {
  STUDYING: 'Đang học',
  SUSPENDED: 'Bảo lưu',
  GRADUATED: 'Đã tốt nghiệp',
  WITHDRAWN: 'Đã thôi học',
};

export function StudentProfile(): JSX.Element {
  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const data = await apiFetch<StudentProfileData>('/student/profile');
      setProfile(data);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải hồ sơ học tập.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="page">
      <StudentNav />
      <h1>Hồ sơ học tập</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' && profile ? (
        <div className="card">
          <dl className="detail-list">
            <div>
              <dt>Mã học viên</dt>
              <dd>{profile.student_code ?? 'Chưa được cấp'}</dd>
            </div>
            <div>
              <dt>Họ tên</dt>
              <dd>{profile.full_name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Trạng thái học tập</dt>
              <dd>{ACADEMIC_STATUS_LABELS[profile.academic_status]}</dd>
            </div>
          </dl>
          {!profile.program_id ? (
            <p>Bạn chưa được gán vào chương trình đào tạo/khóa học. Vui lòng liên hệ phòng đào tạo.</p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
