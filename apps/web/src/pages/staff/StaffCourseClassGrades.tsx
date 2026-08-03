import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { ClassGradeRow, CourseClassStaff, GradeMutationResult } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

function gradeStatusBadge(row: ClassGradeRow): { className: string; label: string } {
  if (!row.grade_id) {
    return { className: 'badge badge-none', label: 'Chưa có điểm' };
  }
  if (row.grade_status === 'PUBLISHED') {
    return { className: 'badge badge-published', label: 'Đã công bố' };
  }
  return { className: 'badge badge-draft', label: 'Nháp' };
}

export function StaffCourseClassGrades(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const [courseClass, setCourseClass] = useState<CourseClassStaff | null>(null);
  const [rows, setRows] = useState<ClassGradeRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [publishTarget, setPublishTarget] = useState<ClassGradeRow | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [classData, gradeRows] = await Promise.all([
        apiFetch<CourseClassStaff>(`/staff/course-classes/${id}`),
        apiFetch<ClassGradeRow[]>(`/staff/course-classes/${id}/grades`),
      ]);
      setCourseClass(classData);
      setRows(gradeRows);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of gradeRows) {
          if (next[row.enrollment_id] === undefined) {
            next[row.enrollment_id] = row.final_score !== null ? String(row.final_score) : '';
          }
        }
        return next;
      });
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách điểm.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (publishTarget && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [publishTarget]);

  const handleSave = async (row: ClassGradeRow): Promise<void> => {
    const raw = drafts[row.enrollment_id] ?? '';
    const value = Number(raw);

    if (raw.trim() === '' || Number.isNaN(value) || value < 0 || value > 10) {
      setRowMessages((prev) => ({
        ...prev,
        [row.enrollment_id]: { ok: false, text: 'Điểm phải nằm trong khoảng 0-10.' },
      }));
      return;
    }

    setSavingId(row.enrollment_id);
    setRowMessages((prev) => {
      const next = { ...prev };
      delete next[row.enrollment_id];
      return next;
    });
    try {
      const isUpdate = Boolean(row.grade_id);
      const result = await apiFetch<GradeMutationResult>(`/staff/enrollments/${row.enrollment_id}/grade`, {
        method: isUpdate ? 'PATCH' : 'POST',
        body: JSON.stringify({ finalScore: value }),
      });

      if (!result.success) {
        setRowMessages((prev) => ({
          ...prev,
          [row.enrollment_id]: { ok: false, text: result.reason ?? 'Không thể lưu điểm.' },
        }));
        return;
      }

      setRowMessages((prev) => ({ ...prev, [row.enrollment_id]: { ok: true, text: 'Đã lưu nháp.' } }));
      await load();
    } catch (err) {
      setRowMessages((prev) => ({
        ...prev,
        [row.enrollment_id]: { ok: false, text: err instanceof ApiRequestError ? err.message : 'Không thể lưu điểm.' },
      }));
    } finally {
      setSavingId(null);
    }
  };

  const closePublishDialog = (): void => {
    setPublishTarget(null);
  };

  const handleConfirmPublish = async (): Promise<void> => {
    const row = publishTarget;
    if (!row) return;

    setSavingId(row.enrollment_id);
    try {
      const result = await apiFetch<GradeMutationResult>(`/staff/enrollments/${row.enrollment_id}/grade/publish`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      setRowMessages((prev) => ({
        ...prev,
        [row.enrollment_id]: {
          ok: result.success,
          text: result.success ? 'Đã công bố điểm.' : (result.reason ?? 'Không thể công bố điểm.'),
        },
      }));
    } catch (err) {
      setRowMessages((prev) => ({
        ...prev,
        [row.enrollment_id]: {
          ok: false,
          text: err instanceof ApiRequestError ? err.message : 'Không thể công bố điểm.',
        },
      }));
    } finally {
      setSavingId(null);
      setPublishTarget(null);
      await load();
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <p>
        <Link to={`/staff/course-classes/${id}`}>← Quay lại chi tiết lớp học phần</Link>
      </p>
      <h1>Nhập điểm lớp học phần</h1>

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
        <div className="card">
          <h2>
            {courseClass.courses.code} — {courseClass.courses.name} ({courseClass.class_code})
          </h2>

          {rows.length === 0 ? (
            <p>Lớp chưa có học viên đã xác nhận nào.</p>
          ) : (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Mã học viên</th>
                    <th>Họ tên</th>
                    <th>Điểm</th>
                    <th>Trạng thái</th>
                    <th>Kết quả</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const badge = gradeStatusBadge(row);
                    const isPublished = row.grade_status === 'PUBLISHED';
                    const message = rowMessages[row.enrollment_id];
                    const isSaving = savingId === row.enrollment_id;
                    return (
                      <tr key={row.enrollment_id}>
                        <td data-label="Mã học viên">{row.student_code ?? '—'}</td>
                        <td data-label="Họ tên">{row.full_name}</td>
                        <td data-label="Điểm">
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.1}
                            disabled={isPublished}
                            value={drafts[row.enrollment_id] ?? ''}
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [row.enrollment_id]: e.target.value }))
                            }
                            style={{ width: '5rem' }}
                          />
                        </td>
                        <td data-label="Trạng thái" className="cell-nowrap">
                          <span className={badge.className}>{badge.label}</span>
                        </td>
                        <td data-label="Kết quả" className="cell-nowrap">
                          {row.result_status ? (
                            <span className={row.result_status === 'PASS' ? 'badge badge-pass' : 'badge badge-fail'}>
                              {row.result_status === 'PASS' ? 'Đạt' : 'Không đạt'}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-label="Thao tác" className="cell-nowrap">
                          {!isPublished ? (
                            <div className="history-card-actions">
                              <button type="button" disabled={isSaving} onClick={() => handleSave(row)}>
                                {isSaving ? 'Đang lưu…' : 'Lưu nháp'}
                              </button>
                              {row.grade_id ? (
                                <button type="button" disabled={isSaving} onClick={() => setPublishTarget(row)}>
                                  Công bố
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="note-text">Đã khóa</span>
                          )}
                          {message ? (
                            <p className={message.ok ? 'result-text result-ok' : 'result-text result-error'}>
                              {message.text}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <dialog ref={dialogRef} onClose={closePublishDialog} className="confirm-dialog">
        {publishTarget ? (
          <div className="dialog-body">
            <h3>Xác nhận công bố điểm</h3>
            <p>
              Bạn có chắc muốn công bố điểm ({drafts[publishTarget.enrollment_id]}) cho{' '}
              <strong>{publishTarget.full_name}</strong>? Sau khi công bố, điểm sẽ bị khóa và không thể sửa được nữa.
            </p>
            <div className="dialog-actions">
              <form method="dialog">
                <button type="submit">Quay lại</button>
              </form>
              <button type="button" onClick={handleConfirmPublish} disabled={savingId === publishTarget.enrollment_id}>
                {savingId === publishTarget.enrollment_id ? 'Đang xử lý…' : 'Đồng ý công bố'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </main>
  );
}
