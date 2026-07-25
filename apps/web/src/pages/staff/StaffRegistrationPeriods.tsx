import { useCallback, useEffect, useMemo, useState } from 'react';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { RegistrationPeriod, SemesterOption } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function derivePeriodStatus(opensAt: string, closesAt: string): { label: string; className: string } {
  const now = Date.now();
  const opens = new Date(opensAt).getTime();
  const closes = new Date(closesAt).getTime();

  if (now < opens) {
    return { label: 'Chưa mở', className: 'badge-upcoming' };
  }
  if (now > closes) {
    return { label: 'Đã đóng', className: 'badge-closed' };
  }
  return { label: 'Đang mở', className: 'badge-open' };
}

interface FormState {
  semesterId: string;
  opensAt: string;
  closesAt: string;
  maxCredits: string;
}

const EMPTY_FORM: FormState = { semesterId: '', opensAt: '', closesAt: '', maxCredits: '' };

export function StaffRegistrationPeriods(): JSX.Element {
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [periods, setPeriods] = useState<RegistrationPeriod[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [semesterData, periodData] = await Promise.all([
        apiFetch<SemesterOption[]>('/staff/semesters'),
        apiFetch<RegistrationPeriod[]>('/staff/registration-periods'),
      ]);
      setSemesters(semesterData);
      setPeriods(periodData);
      setState(periodData.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách đợt đăng ký.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const assignedSemesterIds = useMemo(() => new Set(periods.map((p) => p.semester_id)), [periods]);
  const availableSemesters = useMemo(
    () => semesters.filter((s) => !assignedSemesterIds.has(s.id)),
    [semesters, assignedSemesterIds],
  );

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.semesterId) {
      setFormError('Vui lòng chọn học kỳ.');
      return;
    }
    if (!form.opensAt || !form.closesAt) {
      setFormError('Vui lòng nhập đầy đủ thời gian mở và đóng đăng ký.');
      return;
    }
    if (new Date(form.closesAt).getTime() <= new Date(form.opensAt).getTime()) {
      setFormError('Thời gian đóng phải sau thời gian mở đăng ký.');
      return;
    }
    const maxCredits = Number(form.maxCredits);
    if (!Number.isInteger(maxCredits) || maxCredits <= 0) {
      setFormError('Giới hạn tín chỉ phải là số nguyên lớn hơn 0.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/staff/registration-periods', {
        method: 'POST',
        body: JSON.stringify({
          semesterId: form.semesterId,
          opensAt: new Date(form.opensAt).toISOString(),
          closesAt: new Date(form.closesAt).toISOString(),
          maxCredits,
        }),
      });
      setFormSuccess('Tạo đợt đăng ký thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo đợt đăng ký.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Quản lý đợt đăng ký</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' || state === 'empty' ? (
        <>
          {state === 'empty' ? <p>Chưa có đợt đăng ký nào.</p> : null}
          {state === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Học kỳ</th>
                    <th>Mở lúc</th>
                    <th>Đóng lúc</th>
                    <th>Giới hạn tín chỉ</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => {
                    const status = derivePeriodStatus(period.opens_at, period.closes_at);
                    return (
                      <tr key={period.id}>
                        <td data-label="Học kỳ">
                          <strong>{period.semesters.name}</strong>
                        </td>
                        <td data-label="Mở lúc" className="cell-nowrap">
                          {formatDateTime(period.opens_at)}
                        </td>
                        <td data-label="Đóng lúc" className="cell-nowrap">
                          {formatDateTime(period.closes_at)}
                        </td>
                        <td data-label="Giới hạn tín chỉ" className="cell-nowrap">
                          {period.max_credits}
                        </td>
                        <td data-label="Trạng thái" className="cell-nowrap">
                          <span className={`badge ${status.className}`}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <h2>Tạo đợt đăng ký mới</h2>
          {semesters.length > 0 && availableSemesters.length === 0 ? (
            <p>Tất cả học kỳ hiện có đều đã có đợt đăng ký.</p>
          ) : (
            <form className="form" onSubmit={handleSubmit}>
              <label className="field">
                <span>Học kỳ</span>
                <select
                  value={form.semesterId}
                  onChange={(e) => setForm((prev) => ({ ...prev, semesterId: e.target.value }))}
                  required
                >
                  <option value="">— Chọn học kỳ —</option>
                  {availableSemesters.map((semester) => (
                    <option key={semester.id} value={semester.id}>
                      {semester.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Thời gian mở đăng ký</span>
                <input
                  type="datetime-local"
                  value={form.opensAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, opensAt: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Thời gian đóng đăng ký</span>
                <input
                  type="datetime-local"
                  value={form.closesAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, closesAt: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Giới hạn tín chỉ</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.maxCredits}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxCredits: e.target.value }))}
                  required
                />
              </label>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Đang tạo…' : 'Tạo đợt đăng ký'}
              </button>
              {formError ? <p className="error-text">{formError}</p> : null}
              {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
