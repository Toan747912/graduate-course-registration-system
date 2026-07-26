import { useCallback, useEffect, useRef, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { EnrollmentActionResult, EnrollmentWithHistory } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const STATUS_LABELS: Record<string, string> = {
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
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function StudentHistory(): JSX.Element {
  const [enrollments, setEnrollments] = useState<EnrollmentWithHistory[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cancelMessages, setCancelMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [cancelTarget, setCancelTarget] = useState<EnrollmentWithHistory | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (cancelTarget && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [cancelTarget]);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const data = await apiFetch<EnrollmentWithHistory[]>('/student/enrollments/history');
      setEnrollments(data);
      setState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải lịch sử đăng ký.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeCancelDialog = (): void => {
    setCancelTarget(null);
  };

  const handleConfirmCancel = async (): Promise<void> => {
    const enrollment = cancelTarget;
    if (!enrollment) {
      return;
    }

    setPendingId(enrollment.id);
    try {
      const result = await apiFetch<EnrollmentActionResult>(`/student/enrollments/${enrollment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setCancelMessages((prev) => ({
        ...prev,
        [enrollment.id]: {
          ok: result.success,
          text: result.success ? 'Đã hủy đăng ký.' : (result.reason ?? 'Không thể hủy đăng ký.'),
        },
      }));
    } catch (err) {
      setCancelMessages((prev) => ({
        ...prev,
        [enrollment.id]: {
          ok: false,
          text: err instanceof ApiRequestError ? err.message : 'Không thể hủy đăng ký.',
        },
      }));
    } finally {
      setPendingId(null);
      setCancelTarget(null);
      load();
    }
  };

  return (
    <main className="page">
      <StudentNav />
      <h1>Lịch sử đăng ký</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}
      {state === 'empty' ? <p>Bạn chưa có lượt đăng ký nào.</p> : null}

      {state === 'ready' ? (
        <ul className="history-list">
          {enrollments.map((enrollment) => {
            const message = cancelMessages[enrollment.id];
            const canCancel = enrollment.status === 'CONFIRMED';
            const isPending = pendingId === enrollment.id;
            return (
              <li key={enrollment.id} className="card history-card">
                <div className="history-card-header">
                  <div>
                    <strong>{enrollment.course_classes.courses.code}</strong> —{' '}
                    {enrollment.course_classes.courses.name} ({enrollment.course_classes.class_code})
                  </div>
                  <span className={`badge badge-${enrollment.status.toLowerCase()}`}>
                    {STATUS_LABELS[enrollment.status] ?? enrollment.status}
                  </span>
                </div>

                <ol className="transition-list">
                  {enrollment.enrollment_history.map((entry, idx) => (
                    <li key={idx}>
                      <span>{STATUS_LABELS[entry.status] ?? entry.status}</span>
                      <time>{formatDateTime(entry.changed_at)}</time>
                      {entry.reason ? <span className="reason-text"> — {entry.reason}</span> : null}
                    </li>
                  ))}
                </ol>

                {canCancel ? (
                  <div className="history-card-actions">
                    <button type="button" disabled={isPending} onClick={() => setCancelTarget(enrollment)}>
                      {isPending ? 'Đang gửi…' : 'Hủy'}
                    </button>
                  </div>
                ) : null}

                {message ? (
                  <p className={message.ok ? 'result-text result-ok' : 'result-text result-error'}>{message.text}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <dialog ref={dialogRef} onClose={closeCancelDialog} className="confirm-dialog">
        {cancelTarget ? (
          <div className="dialog-body">
            <h3>Xác nhận hủy đăng ký</h3>
            <p>
              Bạn có chắc muốn hủy đăng ký lớp{' '}
              <strong>
                {cancelTarget.course_classes.courses.code} ({cancelTarget.course_classes.class_code})
              </strong>
              ? Hành động này không thể hoàn tác.
            </p>
            <div className="dialog-actions">
              <form method="dialog">
                <button type="submit">Quay lại</button>
              </form>
              <button type="button" onClick={handleConfirmCancel} disabled={pendingId === cancelTarget.id}>
                {pendingId === cancelTarget.id ? 'Đang gửi…' : 'Đồng ý hủy'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </main>
  );
}
