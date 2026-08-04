import { useCallback, useEffect, useState } from 'react';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Advisor } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

interface FormState {
  advisorCode: string;
  fullName: string;
  specialization: string;
  maxActiveTheses: string;
}

const EMPTY_FORM: FormState = { advisorCode: '', fullName: '', specialization: '', maxActiveTheses: '' };

export function StaffAdvisors(): JSX.Element {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<FormState, 'advisorCode'>>({
    fullName: '',
    specialization: '',
    maxActiveTheses: '',
  });
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const data = await apiFetch<Advisor[]>('/staff/advisors');
      setAdvisors(data);
      setState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách giảng viên hướng dẫn.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.advisorCode.trim() || !form.fullName.trim() || !form.specialization.trim()) {
      setFormError('Vui lòng nhập đầy đủ mã giảng viên, họ tên và chuyên môn.');
      return;
    }
    const maxActiveTheses = Number(form.maxActiveTheses);
    if (!Number.isInteger(maxActiveTheses) || maxActiveTheses <= 0) {
      setFormError('Số luận văn tối đa phải là số nguyên lớn hơn 0.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/staff/advisors', {
        method: 'POST',
        body: JSON.stringify({
          advisorCode: form.advisorCode.trim(),
          fullName: form.fullName.trim(),
          specialization: form.specialization.trim(),
          maxActiveTheses,
        }),
      });
      setFormSuccess('Tạo giảng viên hướng dẫn thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo giảng viên hướng dẫn.');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (advisor: Advisor): void => {
    setEditingId(advisor.id);
    setEditForm({
      fullName: advisor.full_name,
      specialization: advisor.specialization,
      maxActiveTheses: String(advisor.max_active_theses),
    });
    setRowError(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
  };

  const saveEdit = async (advisor: Advisor): Promise<void> => {
    const maxActiveTheses = Number(editForm.maxActiveTheses);
    if (!editForm.fullName.trim() || !editForm.specialization.trim()) {
      setRowError('Vui lòng nhập đầy đủ họ tên và chuyên môn.');
      return;
    }
    if (!Number.isInteger(maxActiveTheses) || maxActiveTheses <= 0) {
      setRowError('Số luận văn tối đa phải là số nguyên lớn hơn 0.');
      return;
    }
    setRowBusyId(advisor.id);
    setRowError(null);
    try {
      await apiFetch(`/staff/advisors/${advisor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editForm.fullName.trim(),
          specialization: editForm.specialization.trim(),
          maxActiveTheses,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật giảng viên hướng dẫn.');
    } finally {
      setRowBusyId(null);
    }
  };

  const deactivate = async (advisor: Advisor): Promise<void> => {
    setRowBusyId(advisor.id);
    setRowError(null);
    try {
      await apiFetch(`/staff/advisors/${advisor.id}/deactivate`, { method: 'POST' });
      setConfirmDeactivateId(null);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiRequestError ? err.message : 'Không thể ngừng hoạt động giảng viên.');
    } finally {
      setRowBusyId(null);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Giảng viên hướng dẫn</h1>

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
          {state === 'empty' ? <p>Chưa có giảng viên hướng dẫn nào.</p> : null}
          {rowError ? <p className="error-text">{rowError}</p> : null}
          {state === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Họ tên</th>
                    <th>Chuyên môn</th>
                    <th>Đang hướng dẫn / Tối đa</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {advisors.map((advisor) => (
                    <tr key={advisor.id}>
                      {editingId === advisor.id ? (
                        <>
                          <td data-label="Mã">
                            <strong>{advisor.advisor_code}</strong>
                          </td>
                          <td data-label="Họ tên">
                            <input
                              type="text"
                              value={editForm.fullName}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                            />
                          </td>
                          <td data-label="Chuyên môn">
                            <input
                              type="text"
                              value={editForm.specialization}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, specialization: e.target.value }))}
                            />
                          </td>
                          <td data-label="Đang hướng dẫn / Tối đa" className="cell-nowrap">
                            {advisor.current_in_progress_count} /{' '}
                            <input
                              type="number"
                              min={1}
                              step={1}
                              style={{ width: '4rem' }}
                              value={editForm.maxActiveTheses}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, maxActiveTheses: e.target.value }))}
                            />
                          </td>
                          <td data-label="Trạng thái">{advisor.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
                          <td data-label="" className="cell-nowrap">
                            <button type="button" disabled={rowBusyId === advisor.id} onClick={() => saveEdit(advisor)}>
                              {rowBusyId === advisor.id ? 'Đang lưu…' : 'Lưu'}
                            </button>{' '}
                            <button type="button" onClick={cancelEdit}>
                              Hủy
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td data-label="Mã">
                            <strong>{advisor.advisor_code}</strong>
                          </td>
                          <td data-label="Họ tên">{advisor.full_name}</td>
                          <td data-label="Chuyên môn">{advisor.specialization}</td>
                          <td data-label="Đang hướng dẫn / Tối đa" className="cell-nowrap">
                            {advisor.current_in_progress_count} / {advisor.max_active_theses}
                          </td>
                          <td data-label="Trạng thái">{advisor.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
                          <td data-label="" className="cell-nowrap">
                            <button type="button" onClick={() => startEdit(advisor)}>
                              Sửa
                            </button>{' '}
                            {advisor.is_active ? (
                              confirmDeactivateId === advisor.id ? (
                                <>
                                  <span>Xác nhận ngừng hoạt động?</span>{' '}
                                  <button
                                    type="button"
                                    disabled={rowBusyId === advisor.id}
                                    onClick={() => deactivate(advisor)}
                                  >
                                    {rowBusyId === advisor.id ? 'Đang xử lý…' : 'Xác nhận'}
                                  </button>{' '}
                                  <button type="button" onClick={() => setConfirmDeactivateId(null)}>
                                    Hủy
                                  </button>
                                </>
                              ) : (
                                <button type="button" onClick={() => setConfirmDeactivateId(advisor.id)}>
                                  Ngừng hoạt động
                                </button>
                              )
                            ) : null}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <h2>Tạo giảng viên hướng dẫn mới</h2>
          <form className="form form-grid-2" onSubmit={handleCreate}>
            <label className="field">
              <span>Mã giảng viên</span>
              <input
                type="text"
                value={form.advisorCode}
                onChange={(e) => setForm((prev) => ({ ...prev, advisorCode: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Họ tên</span>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Chuyên môn</span>
              <input
                type="text"
                value={form.specialization}
                onChange={(e) => setForm((prev) => ({ ...prev, specialization: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Số luận văn hướng dẫn tối đa</span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.maxActiveTheses}
                onChange={(e) => setForm((prev) => ({ ...prev, maxActiveTheses: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang tạo…' : 'Tạo giảng viên hướng dẫn'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </>
      ) : null}
    </main>
  );
}
