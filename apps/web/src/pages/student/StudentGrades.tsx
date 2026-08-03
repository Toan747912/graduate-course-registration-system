import { useCallback, useEffect, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { StudentGradeRow, StudentProgress } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

export function StudentGrades(): JSX.Element {
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [gradeData, progressData] = await Promise.all([
        apiFetch<StudentGradeRow[]>('/student/grades'),
        apiFetch<StudentProgress | null>('/student/progress'),
      ]);
      setGrades(gradeData);
      setProgress(progressData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải kết quả học tập.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const requiredPct =
    progress && progress.required_credits_min
      ? Math.min(100, Math.round((progress.required_credits_earned / progress.required_credits_min) * 100))
      : 0;
  const electivePct =
    progress && progress.elective_credits_min
      ? Math.min(100, Math.round((progress.elective_credits_earned / progress.elective_credits_min) * 100))
      : 0;

  return (
    <main className="page">
      <StudentNav />
      <h1>Kết quả học tập</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' ? (
        <>
          <div className="card">
            <h2>Tiến độ tín chỉ</h2>
            {!progress || !progress.program_id ? (
              <p>Chưa được gán chương trình đào tạo, chưa thể tính tiến độ tín chỉ.</p>
            ) : (
              <>
                <p>
                  Tín chỉ bắt buộc: {progress.required_credits_earned}/{progress.required_credits_min}
                </p>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${requiredPct}%` }} />
                </div>
                <p>
                  Tín chỉ tự chọn: {progress.elective_credits_earned}/{progress.elective_credits_min}
                </p>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${electivePct}%` }} />
                </div>
              </>
            )}
          </div>

          <h2>Bảng điểm</h2>
          {grades.length === 0 ? (
            <p>Chưa có kết quả học tập.</p>
          ) : (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Môn học</th>
                    <th>Lớp/Học kỳ</th>
                    <th>Điểm</th>
                    <th>Kết quả</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((row) => (
                    <tr key={row.enrollment_id}>
                      <td data-label="Môn học">
                        {row.course_code} — {row.course_name}
                      </td>
                      <td data-label="Lớp/Học kỳ" className="cell-nowrap">
                        {row.class_code} · {row.semester_name}
                      </td>
                      <td data-label="Điểm">{row.final_score}</td>
                      <td data-label="Kết quả" className="cell-nowrap">
                        <span className={row.result_status === 'PASS' ? 'badge badge-pass' : 'badge badge-fail'}>
                          {row.result_status === 'PASS' ? 'Đạt' : 'Không đạt'}
                        </span>
                      </td>
                      <td data-label="Ghi chú">
                        {!row.in_program ? (
                          <span className="note-text">Không tính vào tiến độ chương trình hiện tại</span>
                        ) : row.counts_towards_progress ? (
                          <span className="note-text">Đã tính tín chỉ</span>
                        ) : (
                          '—'
                        )}
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
