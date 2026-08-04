import { useCallback, useEffect, useState } from 'react';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { supabase } from '../../lib/supabaseClient';
import type {
  AcademicStatus,
  Cohort,
  ConfirmGraduationResult,
  EligibilityStatus,
  GraduationListResponse,
  GraduationListRow,
  GraduationSummary,
  Program,
} from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const ACADEMIC_STATUS_LABELS: Record<AcademicStatus, string> = {
  STUDYING: 'Đang học',
  SUSPENDED: 'Bảo lưu',
  GRADUATED: 'Đã tốt nghiệp',
  WITHDRAWN: 'Đã thôi học',
};

const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  ELIGIBLE: 'Đủ điều kiện',
  NOT_ELIGIBLE: 'Chưa đủ điều kiện',
  NOT_APPLICABLE: 'Không áp dụng',
};

const REASON_LABELS: Record<string, string> = {
  not_studying: 'Không ở trạng thái Đang học',
  not_assigned_to_program: 'Chưa gán chương trình',
  required_credits_not_met: 'Chưa đủ tín chỉ bắt buộc',
  elective_credits_not_met: 'Chưa đủ tín chỉ tự chọn',
  no_completed_thesis: 'Chưa có luận văn hoàn thành',
  has_active_thesis: 'Còn luận văn đang hoạt động',
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const PAGE_SIZE = 20;

/** UC-44/45/46/47/49 (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md). */
export function StaffGraduationDashboard(): JSX.Element {
  const [summary, setSummary] = useState<GraduationSummary | null>(null);
  const [rows, setRows] = useState<GraduationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [programs, setPrograms] = useState<Program[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [programFilter, setProgramFilter] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [academicStatusFilter, setAcademicStatusFilter] = useState<AcademicStatus | ''>('');
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityStatus | ''>('');

  const [confirmTarget, setConfirmTarget] = useState<GraduationListRow | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (extra: Record<string, string> = {}): string => {
      const params = new URLSearchParams();
      if (programFilter) params.set('program_id', programFilter);
      if (cohortFilter) params.set('cohort_id', cohortFilter);
      if (academicStatusFilter) params.set('academic_status', academicStatusFilter);
      if (eligibilityFilter) params.set('eligibility_status', eligibilityFilter);
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      return params.toString();
    },
    [programFilter, cohortFilter, academicStatusFilter, eligibilityFilter],
  );

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const query = buildQuery({ page: String(page), page_size: String(PAGE_SIZE) });
      const summaryQuery = buildQuery();
      const [summaryData, listData, programData] = await Promise.all([
        apiFetch<GraduationSummary>(`/staff/graduation/summary?${summaryQuery}`),
        apiFetch<GraduationListResponse>(`/staff/graduation/students?${query}`),
        apiFetch<Program[]>('/staff/programs'),
      ]);
      setSummary(summaryData);
      setRows(listData.items);
      setTotal(listData.total);
      setPrograms(programData);
      setState(listData.items.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải dữ liệu tốt nghiệp.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQuery, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [programFilter, cohortFilter, academicStatusFilter, eligibilityFilter]);

  useEffect(() => {
    if (!programFilter) {
      setCohorts([]);
      setCohortFilter('');
      return;
    }
    apiFetch<Cohort[]>(`/staff/cohorts?programId=${programFilter}`)
      .then(setCohorts)
      .catch(() => setCohorts([]));
  }, [programFilter]);

  const handleConfirm = async (): Promise<void> => {
    if (!confirmTarget) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const result = await apiFetch<ConfirmGraduationResult>(
        `/staff/graduation/students/${confirmTarget.student_id}/confirm`,
        { method: 'POST' },
      );
      if (!result.success) {
        setConfirmError(result.reason ?? 'Không thể xác nhận tốt nghiệp.');
        return;
      }
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setConfirmError(err instanceof ApiRequestError ? err.message : 'Không thể xác nhận tốt nghiệp.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleExportCsv = async (): Promise<void> => {
    setCsvError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const query = buildQuery();
      const response = await fetch(`${API_BASE_URL}/staff/graduation/export.csv?${query}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!response.ok) {
        setCsvError('Không thể xuất CSV. Vui lòng thử lại sau.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'graduation-export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setCsvError('Không thể xuất CSV. Vui lòng thử lại sau.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="page">
      <StaffNav />
      <h1>Xét tốt nghiệp</h1>

      {summary ? (
        <div className="stat-tiles">
          <div className="stat-tile">
            <span className="stat-value">{summary.studying}</span>
            <span className="stat-label">Đang học</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{summary.eligible}</span>
            <span className="stat-label">Đủ điều kiện</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{summary.not_eligible}</span>
            <span className="stat-label">Chưa đủ điều kiện</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{summary.graduated}</span>
            <span className="stat-label">Đã tốt nghiệp</span>
          </div>
        </div>
      ) : null}

      <form
        className="form form-grid-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
      >
        <label className="field">
          <span>Chương trình</span>
          <select value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
            <option value="">— Tất cả —</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.code} — {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Khóa</span>
          <select value={cohortFilter} onChange={(e) => setCohortFilter(e.target.value)} disabled={!programFilter}>
            <option value="">— Tất cả —</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.code} — {cohort.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Trạng thái học tập</span>
          <select value={academicStatusFilter} onChange={(e) => setAcademicStatusFilter(e.target.value as AcademicStatus | '')}>
            <option value="">— Tất cả —</option>
            {(Object.keys(ACADEMIC_STATUS_LABELS) as AcademicStatus[]).map((status) => (
              <option key={status} value={status}>
                {ACADEMIC_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Điều kiện tốt nghiệp</span>
          <select value={eligibilityFilter} onChange={(e) => setEligibilityFilter(e.target.value as EligibilityStatus | '')}>
            <option value="">— Tất cả —</option>
            <option value="ELIGIBLE">{ELIGIBILITY_LABELS.ELIGIBLE}</option>
            <option value="NOT_ELIGIBLE">{ELIGIBILITY_LABELS.NOT_ELIGIBLE}</option>
          </select>
        </label>
        <button type="submit">Lọc</button>
        <button type="button" onClick={handleExportCsv}>
          Xuất CSV
        </button>
      </form>

      {csvError ? (
        <div className="banner banner-error">
          <p>{csvError}</p>
        </div>
      ) : null}

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}
      {state === 'empty' ? <p>Không có học viên nào phù hợp với bộ lọc hiện tại.</p> : null}

      {state === 'ready' ? (
        <>
          <div className="table-scroll">
            <table className="classes-table">
              <thead>
                <tr>
                  <th>Mã học viên</th>
                  <th>Họ tên</th>
                  <th>Chương trình</th>
                  <th>Khóa</th>
                  <th>Trạng thái</th>
                  <th>Điều kiện</th>
                  <th>Chi tiết còn thiếu</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.student_id}>
                    <td data-label="Mã học viên">
                      <strong>{row.student_code ?? '—'}</strong>
                    </td>
                    <td data-label="Họ tên">{row.full_name}</td>
                    <td data-label="Chương trình">{row.program_code ?? '—'}</td>
                    <td data-label="Khóa">{row.cohort_code ?? '—'}</td>
                    <td data-label="Trạng thái" className="cell-nowrap">
                      <span className="badge">{ACADEMIC_STATUS_LABELS[row.academic_status]}</span>
                    </td>
                    <td data-label="Điều kiện" className="cell-nowrap">
                      <span className={row.eligibility_status === 'ELIGIBLE' ? 'badge badge-open' : 'badge badge-upcoming'}>
                        {ELIGIBILITY_LABELS[row.eligibility_status]}
                      </span>
                    </td>
                    <td data-label="Chi tiết còn thiếu">
                      {row.reasons.length === 0 ? '—' : row.reasons.map((r) => REASON_LABELS[r] ?? r).join('; ')}
                    </td>
                    <td data-label="" className="cell-nowrap">
                      {row.academic_status === 'STUDYING' && row.eligibility_status === 'ELIGIBLE' && !row.graduation_record_id ? (
                        <button type="button" onClick={() => setConfirmTarget(row)}>
                          Xác nhận tốt nghiệp
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Trang trước
            </button>
            <span>
              Trang {page}/{totalPages} (tổng {total})
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Trang sau
            </button>
          </div>
        </>
      ) : null}

      {confirmTarget ? (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Xác nhận tốt nghiệp</h2>
            <p>
              Xác nhận tốt nghiệp cho học viên <strong>{confirmTarget.full_name}</strong> ({confirmTarget.student_code ?? '—'})?
              Hành động này không thể hoàn tác.
            </p>
            {confirmError ? (
              <div className="banner banner-error">
                <p>{confirmError}</p>
              </div>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirmTarget(null)} disabled={confirmBusy}>
                Hủy
              </button>
              <button type="button" onClick={handleConfirm} disabled={confirmBusy}>
                {confirmBusy ? 'Đang xác nhận…' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
