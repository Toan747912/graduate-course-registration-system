import { useCallback, useEffect, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { GraduationStatusResponse } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const REASON_LABELS: Record<string, string> = {
  not_studying: 'Trạng thái học tập hiện tại không phải Đang học.',
  not_assigned_to_program: 'Chưa được gán chương trình đào tạo.',
  required_credits_not_met: 'Chưa đạt đủ tín chỉ bắt buộc.',
  elective_credits_not_met: 'Chưa đạt đủ tín chỉ tự chọn.',
  no_completed_thesis: 'Chưa có luận văn đã hoàn thành.',
  has_active_thesis: 'Còn luận văn đang chờ duyệt/đã duyệt/đang thực hiện.',
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** UC-43 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md). Same LoadState/banner convention as StudentGrades.tsx. */
export function StudentGraduation(): JSX.Element {
  const [status, setStatus] = useState<GraduationStatusResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const data = await apiFetch<GraduationStatusResponse>('/student/graduation');
      setStatus(data);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải tình trạng tốt nghiệp.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="page">
      <StudentNav />
      <h1>Tình trạng tốt nghiệp</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' && status ? (
        status.is_graduated && status.graduation_record ? (
          <div className="card">
            <span className="badge badge-open">Đã tốt nghiệp</span>
            <h2>Thông tin xác nhận tốt nghiệp</h2>
            <p>Chương trình: {status.graduation_record.program_name} ({status.graduation_record.program_code})</p>
            {status.graduation_record.cohort_code ? <p>Khóa: {status.graduation_record.cohort_code}</p> : null}
            <p>
              Tín chỉ bắt buộc đạt: {status.graduation_record.required_credits_earned}/{status.graduation_record.required_credits_min}
            </p>
            <p>
              Tín chỉ tự chọn đạt: {status.graduation_record.elective_credits_earned}/{status.graduation_record.elective_credits_min}
            </p>
            <p>Mã luận văn: {status.graduation_record.thesis_code}</p>
            <p>Ngày xác nhận: {new Date(status.graduation_record.confirmed_at).toLocaleString('vi-VN')}</p>
          </div>
        ) : (
          <div className="card">
            {status.eligibility?.eligibility_status === 'ELIGIBLE' ? (
              <span className="badge badge-open">Đủ điều kiện tốt nghiệp</span>
            ) : status.eligibility?.eligibility_status === 'NOT_APPLICABLE' ? (
              <span className="badge badge-closed">Không áp dụng</span>
            ) : (
              <span className="badge badge-upcoming">Chưa đủ điều kiện tốt nghiệp</span>
            )}

            {status.eligibility && status.eligibility.reasons.length > 0 ? (
              <>
                <h2>Điều kiện còn thiếu</h2>
                <ul>
                  {status.eligibility.reasons.map((reason) => (
                    <li key={reason}>{reasonLabel(reason)}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {status.eligibility && status.eligibility.program_id ? (
              <>
                <h2>Tiến độ hiện tại</h2>
                <p>
                  Tín chỉ bắt buộc: {status.eligibility.required_credits_earned ?? 0}/{status.eligibility.required_credits_min ?? 0}
                </p>
                <p>
                  Tín chỉ tự chọn: {status.eligibility.elective_credits_earned ?? 0}/{status.eligibility.elective_credits_min ?? 0}
                </p>
              </>
            ) : null}
          </div>
        )
      ) : null}
    </main>
  );
}
