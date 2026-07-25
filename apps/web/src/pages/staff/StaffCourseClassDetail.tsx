import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { CancelCourseClassResult, ClassEnrollmentRow, CourseClassStaff } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ Nhật',
};

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Đã xác nhận',
  REJECTED: 'Bị từ chối',
  CANCELLED_BY_STUDENT: 'Đã tự hủy',
  CANCELLED_BY_SCHOOL: 'Nhà trường hủy',
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function StaffCourseClassDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const [courseClass, setCourseClass] = useState<CourseClassStaff | null>(null);
  const [enrollments, setEnrollments] = useState<ClassEnrollmentRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setState('loading');
    setError(null);
    try {
      const [classData, enrollmentData] = await Promise.all([
        apiFetch<CourseClassStaff>(`/staff/course-classes/${id}`),
        apiFetch<ClassEnrollmentRow[]>(`/staff/course-classes/${id}/enrollments`),
      ]);
      setCourseClass(classData);
      setEnrollments(enrollmentData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải chi tiết lớp học phần.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmedEnrollments = enrollments.filter((e) => e.status === 'CONFIRMED');

  const handleCancelClass = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setCancelError(null);
    setCancelMessage(null);

    if (!id) {
      return;
    }
    if (!cancelReason.trim()) {
      setCancelError('Vui lòng nhập lý do hủy lớp.');
      return;
    }

    setCancelSubmitting(true);
    try {
      const result = await apiFetch<CancelCourseClassResult>(`/staff/course-classes/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      if (!result.success) {
        setCancelError(result.reason ?? 'Không thể hủy lớp học phần.');
        return;
      }

      setCancelMessage(
        `Đã hủy lớp học phần. ${result.cancelled_enrollment_count ?? 0} đăng ký đã xác nhận đã chuyển sang "Nhà trường hủy".`,
      );
      setShowCancelForm(false);
      setCancelReason('');
      await load();
    } catch (err) {
      setCancelError(err instanceof ApiRequestError ? err.message : 'Không thể hủy lớp học phần.');
    } finally {
      setCancelSubmitting(false);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <p>
        <Link to="/staff/course-classes">← Quay lại danh sách lớp học phần</Link>
      </p>
      <h1>Chi tiết lớp học phần</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' && courseClass ? (
        <>
          <div className="card">
            <h2>
              {courseClass.courses.code} — {courseClass.courses.name}
            </h2>
            <p>
              Mã lớp: <strong>{courseClass.class_code}</strong> · Học kỳ:{' '}
              <strong>{courseClass.registration_periods.semesters.name}</strong>
            </p>
            <p>
              Sĩ số: {courseClass.confirmed_count}/{courseClass.max_seats}
            </p>
            <p>
              Trạng thái:{' '}
              <span className={courseClass.status === 'ACTIVE' ? 'badge badge-open' : 'badge badge-full'}>
                {courseClass.status === 'ACTIVE' ? 'Hoạt động' : 'Đã hủy'}
              </span>
            </p>
            {courseClass.status === 'CANCELLED' && courseClass.cancellation_reason ? (
              <p className="reason-text">Lý do hủy: {courseClass.cancellation_reason}</p>
            ) : null}
            <ul className="schedule-list">
              {courseClass.class_schedules.map((s, idx) => (
                <li key={idx}>
                  {WEEKDAY_LABELS[s.day_of_week] ?? `Thứ ${s.day_of_week}`} — Ca {s.session_slot}
                  {s.room ? ` — Phòng ${s.room}` : ''}
                </li>
              ))}
            </ul>

            {courseClass.status === 'ACTIVE' ? (
              <div className="history-card-actions">
                {!showCancelForm ? (
                  <button type="button" onClick={() => setShowCancelForm(true)}>
                    Hủy lớp học phần
                  </button>
                ) : (
                  <form className="form" onSubmit={handleCancelClass}>
                    <p className="error-text">
                      Hủy lớp sẽ chuyển toàn bộ đăng ký đã xác nhận ({confirmedEnrollments.length}) sang trạng thái
                      "Nhà trường hủy". Hành động này không thể hoàn tác.
                    </p>
                    <label className="field">
                      <span>Lý do hủy (bắt buộc)</span>
                      <input
                        type="text"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        required
                      />
                    </label>
                    <div className="history-card-actions">
                      <button type="submit" disabled={cancelSubmitting}>
                        {cancelSubmitting ? 'Đang xử lý…' : 'Xác nhận hủy lớp'}
                      </button>
                      <button type="button" onClick={() => setShowCancelForm(false)} disabled={cancelSubmitting}>
                        Hủy thao tác
                      </button>
                    </div>
                  </form>
                )}
                {cancelError ? <p className="error-text">{cancelError}</p> : null}
              </div>
            ) : null}
            {cancelMessage ? <p className="result-text result-ok">{cancelMessage}</p> : null}
          </div>

          <h2>Danh sách học viên đã đăng ký xác nhận</h2>
          {confirmedEnrollments.length === 0 ? (
            <p>Chưa có học viên nào đăng ký xác nhận cho lớp này.</p>
          ) : (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Trạng thái</th>
                    <th>Thời điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedEnrollments.map((enrollment) => (
                    <tr key={enrollment.id}>
                      <td data-label="Học viên">{enrollment.profiles.full_name}</td>
                      <td data-label="Trạng thái" className="cell-nowrap">
                        <span className={`badge badge-${enrollment.status.toLowerCase()}`}>
                          {ENROLLMENT_STATUS_LABELS[enrollment.status] ?? enrollment.status}
                        </span>
                      </td>
                      <td data-label="Thời điểm" className="cell-nowrap">
                        {formatDateTime(enrollment.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
