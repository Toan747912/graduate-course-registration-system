import { useCallback, useEffect, useState } from 'react';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { ResearchArea } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

interface FormState {
  name: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', description: '' };

export function StaffResearchAreas(): JSX.Element {
  const [areas, setAreas] = useState<ResearchArea[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const data = await apiFetch<ResearchArea[]>('/staff/research-areas');
      setAreas(data);
      setState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách lĩnh vực nghiên cứu.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.name.trim()) {
      setFormError('Vui lòng nhập tên lĩnh vực nghiên cứu.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/staff/research-areas', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || undefined }),
      });
      setFormSuccess('Tạo lĩnh vực nghiên cứu thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo lĩnh vực nghiên cứu.');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (area: ResearchArea): void => {
    setEditingId(area.id);
    setEditForm({ name: area.name, description: area.description ?? '' });
    setRowError(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const saveEdit = async (area: ResearchArea): Promise<void> => {
    if (!editForm.name.trim()) {
      setRowError('Vui lòng nhập tên lĩnh vực nghiên cứu.');
      return;
    }
    setRowBusyId(area.id);
    setRowError(null);
    try {
      await apiFetch(`/staff/research-areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim() || undefined,
          isActive: area.is_active,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật lĩnh vực nghiên cứu.');
    } finally {
      setRowBusyId(null);
    }
  };

  const deactivate = async (area: ResearchArea): Promise<void> => {
    setRowBusyId(area.id);
    setRowError(null);
    try {
      await apiFetch(`/staff/research-areas/${area.id}/deactivate`, { method: 'POST' });
      setConfirmDeactivateId(null);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiRequestError ? err.message : 'Không thể ngừng hoạt động lĩnh vực nghiên cứu.');
    } finally {
      setRowBusyId(null);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Quản lý lĩnh vực nghiên cứu</h1>

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
          {state === 'empty' ? <p>Chưa có lĩnh vực nghiên cứu nào.</p> : null}
          {rowError ? <p className="error-text">{rowError}</p> : null}
          {state === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Tên lĩnh vực</th>
                    <th>Mô tả</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {areas.map((area) => (
                    <tr key={area.id}>
                      {editingId === area.id ? (
                        <>
                          <td data-label="Tên lĩnh vực">
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            />
                          </td>
                          <td data-label="Mô tả">
                            <input
                              type="text"
                              value={editForm.description}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                            />
                          </td>
                          <td data-label="Trạng thái">{area.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
                          <td data-label="" className="cell-nowrap">
                            <button type="button" disabled={rowBusyId === area.id} onClick={() => saveEdit(area)}>
                              {rowBusyId === area.id ? 'Đang lưu…' : 'Lưu'}
                            </button>{' '}
                            <button type="button" onClick={cancelEdit}>
                              Hủy
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td data-label="Tên lĩnh vực">
                            <strong>{area.name}</strong>
                          </td>
                          <td data-label="Mô tả">{area.description ?? '—'}</td>
                          <td data-label="Trạng thái">{area.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
                          <td data-label="" className="cell-nowrap">
                            <button type="button" onClick={() => startEdit(area)}>
                              Sửa
                            </button>{' '}
                            {area.is_active ? (
                              confirmDeactivateId === area.id ? (
                                <>
                                  <span>Xác nhận ngừng hoạt động?</span>{' '}
                                  <button
                                    type="button"
                                    disabled={rowBusyId === area.id}
                                    onClick={() => deactivate(area)}
                                  >
                                    {rowBusyId === area.id ? 'Đang xử lý…' : 'Xác nhận'}
                                  </button>{' '}
                                  <button type="button" onClick={() => setConfirmDeactivateId(null)}>
                                    Hủy
                                  </button>
                                </>
                              ) : (
                                <button type="button" onClick={() => setConfirmDeactivateId(area.id)}>
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

          <h2>Tạo lĩnh vực nghiên cứu mới</h2>
          <form className="form form-grid-2" onSubmit={handleCreate}>
            <label className="field">
              <span>Tên lĩnh vực</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Mô tả (tuỳ chọn)</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang tạo…' : 'Tạo lĩnh vực nghiên cứu'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </>
      ) : null}
    </main>
  );
}
