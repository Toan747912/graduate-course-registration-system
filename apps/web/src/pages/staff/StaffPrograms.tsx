import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Program } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

interface FormState {
  code: string;
  name: string;
  requiredCreditsMin: string;
  electiveCreditsMin: string;
  passScoreMin: string;
  thesisCreditsMin: string;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  requiredCreditsMin: '',
  electiveCreditsMin: '',
  passScoreMin: '',
  thesisCreditsMin: '',
};

export function StaffPrograms(): JSX.Element {
  const [programs, setPrograms] = useState<Program[]>([]);
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
      const data = await apiFetch<Program[]>('/staff/programs');
      setPrograms(data);
      setState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách chương trình đào tạo.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Vui lòng nhập mã và tên chương trình đào tạo.');
      return;
    }

    const requiredCreditsMin = Number(form.requiredCreditsMin);
    const electiveCreditsMin = Number(form.electiveCreditsMin);
    const passScoreMin = Number(form.passScoreMin);
    const thesisCreditsMin = Number(form.thesisCreditsMin);

    if (!Number.isInteger(requiredCreditsMin) || requiredCreditsMin <= 0) {
      setFormError('Tín chỉ tối thiểu bắt buộc phải là số nguyên lớn hơn 0.');
      return;
    }
    if (!Number.isInteger(electiveCreditsMin) || electiveCreditsMin < 0) {
      setFormError('Tín chỉ tối thiểu tự chọn phải là số nguyên không âm.');
      return;
    }
    if (Number.isNaN(passScoreMin) || passScoreMin < 0 || passScoreMin > 10) {
      setFormError('Điểm đạt tối thiểu phải trong khoảng 0–10.');
      return;
    }
    if (!Number.isInteger(thesisCreditsMin) || thesisCreditsMin < 0) {
      setFormError('Tín chỉ tối thiểu để phân công luận văn phải là số nguyên không âm.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/staff/programs', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          requiredCreditsMin,
          electiveCreditsMin,
          passScoreMin,
          thesisCreditsMin,
        }),
      });
      setFormSuccess('Tạo chương trình đào tạo thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo chương trình đào tạo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Chương trình đào tạo</h1>

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
          {state === 'empty' ? <p>Chưa có chương trình đào tạo nào.</p> : null}
          {state === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên chương trình</th>
                    <th>Tín chỉ bắt buộc tối thiểu</th>
                    <th>Tín chỉ tự chọn tối thiểu</th>
                    <th>Điểm đạt tối thiểu</th>
                    <th>Tín chỉ tối thiểu để làm luận văn</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((program) => (
                    <tr key={program.id}>
                      <td data-label="Mã">
                        <strong>{program.code}</strong>
                      </td>
                      <td data-label="Tên chương trình">{program.name}</td>
                      <td data-label="Tín chỉ bắt buộc tối thiểu" className="cell-nowrap">
                        {program.required_credits_min}
                      </td>
                      <td data-label="Tín chỉ tự chọn tối thiểu" className="cell-nowrap">
                        {program.elective_credits_min}
                      </td>
                      <td data-label="Điểm đạt tối thiểu" className="cell-nowrap">
                        {program.pass_score_min}
                      </td>
                      <td data-label="Tín chỉ tối thiểu để làm luận văn" className="cell-nowrap">
                        {program.thesis_credits_min}
                      </td>
                      <td data-label="" className="cell-nowrap">
                        <Link to={`/staff/programs/${program.id}`}>Quản lý</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <h2>Tạo chương trình đào tạo mới</h2>
          <form className="form form-grid-2" onSubmit={handleSubmit}>
            <label className="field">
              <span>Mã chương trình</span>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Tên chương trình</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Tín chỉ tối thiểu bắt buộc</span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.requiredCreditsMin}
                onChange={(e) => setForm((prev) => ({ ...prev, requiredCreditsMin: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Tín chỉ tối thiểu tự chọn</span>
              <input
                type="number"
                min={0}
                step={1}
                value={form.electiveCreditsMin}
                onChange={(e) => setForm((prev) => ({ ...prev, electiveCreditsMin: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Điểm đạt tối thiểu (0–10)</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={form.passScoreMin}
                onChange={(e) => setForm((prev) => ({ ...prev, passScoreMin: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Tín chỉ tối thiểu trước khi phân công luận văn</span>
              <input
                type="number"
                min={0}
                step={1}
                value={form.thesisCreditsMin}
                onChange={(e) => setForm((prev) => ({ ...prev, thesisCreditsMin: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang tạo…' : 'Tạo chương trình đào tạo'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </>
      ) : null}
    </main>
  );
}
