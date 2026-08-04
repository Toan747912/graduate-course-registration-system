import { useCallback, useEffect, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { ResearchArea, Thesis, ThesisEligibility, ThesisStatus } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_LABEL: Record<ThesisStatus, string> = {
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
};

const ACTIVE_STATUSES: ThesisStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS'];

interface FormState {
  title: string;
  description: string;
  researchAreaId: string;
}

const EMPTY_FORM: FormState = { title: '', description: '', researchAreaId: '' };

export function StudentThesis(): JSX.Element {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [areas, setAreas] = useState<ResearchArea[]>([]);
  const [eligibility, setEligibility] = useState<ThesisEligibility | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [thesesData, areasData, eligibilityData] = await Promise.all([
        apiFetch<Thesis[]>('/student/theses'),
        apiFetch<ResearchArea[]>('/research-areas'),
        apiFetch<ThesisEligibility>('/student/theses/eligibility'),
      ]);
      setTheses(thesesData);
      setAreas(areasData);
      setEligibility(eligibilityData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải thông tin luận văn.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeThesis = theses.find((t) => ACTIVE_STATUSES.includes(t.status)) ?? null;
  const historyTheses = theses.filter((t) => t.id !== activeThesis?.id);

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.title.trim() || !form.description.trim() || !form.researchAreaId) {
      setFormError('Vui lòng nhập đầy đủ tiêu đề, mô tả và chọn lĩnh vực nghiên cứu.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/student/theses', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          researchAreaId: form.researchAreaId,
        }),
      });
      setFormSuccess('Tạo đề xuất luận văn thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo đề xuất luận văn.');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (): void => {
    if (!activeThesis) return;
    setEditForm({
      title: activeThesis.title,
      description: activeThesis.description,
      researchAreaId: activeThesis.research_area_id,
    });
    setEditing(true);
    setEditError(null);
  };

  const saveEdit = async (): Promise<void> => {
    if (!activeThesis) return;
    if (!editForm.title.trim() || !editForm.description.trim() || !editForm.researchAreaId) {
      setEditError('Vui lòng nhập đầy đủ tiêu đề, mô tả và chọn lĩnh vực nghiên cứu.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      await apiFetch(`/student/theses/${activeThesis.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title.trim(),
          description: editForm.description.trim(),
          researchAreaId: editForm.researchAreaId,
        }),
      });
      setEditing(false);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật đề xuất luận văn.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const cancelProposal = async (): Promise<void> => {
    if (!activeThesis) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`/student/theses/${activeThesis.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      setConfirmCancel(false);
      setCancelReason('');
      await load();
    } catch (err) {
      setCancelError(err instanceof ApiRequestError ? err.message : 'Không thể hủy đề xuất luận văn.');
    } finally {
      setCancelling(false);
    }
  };

  if (state === 'loading') {
    return (
      <main className="page">
        <StudentNav />
        <p>Đang tải…</p>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="page">
        <StudentNav />
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <StudentNav />
      <h1>Luận văn của tôi</h1>

      {activeThesis ? (
        <section>
          <h2>
            {activeThesis.thesis_code} — {STATUS_LABEL[activeThesis.status]}
          </h2>
          {editing ? (
            <div className="form">
              <label className="field">
                <span>Tiêu đề</span>
                <input type="text" value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} />
              </label>
              <label className="field">
                <span>Mô tả</span>
                <textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
              </label>
              <label className="field">
                <span>Lĩnh vực nghiên cứu</span>
                <select value={editForm.researchAreaId} onChange={(e) => setEditForm((p) => ({ ...p, researchAreaId: e.target.value }))}>
                  <option value="">-- Chọn lĩnh vực --</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={editSubmitting} onClick={saveEdit}>
                {editSubmitting ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>{' '}
              <button type="button" onClick={() => setEditing(false)}>
                Hủy
              </button>
              {editError ? <p className="error-text">{editError}</p> : null}
            </div>
          ) : (
            <>
              <p>
                <strong>Tiêu đề:</strong> {activeThesis.title}
              </p>
              <p>
                <strong>Mô tả:</strong> {activeThesis.description}
              </p>
              {activeThesis.status === 'PENDING_APPROVAL' ? (
                <>
                  <button type="button" onClick={startEdit}>
                    Sửa đề xuất
                  </button>{' '}
                  {confirmCancel ? (
                    <>
                      <label className="field">
                        <span>Lý do hủy (tuỳ chọn)</span>
                        <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                      </label>
                      <button type="button" disabled={cancelling} onClick={cancelProposal}>
                        {cancelling ? 'Đang hủy…' : 'Xác nhận hủy đề xuất'}
                      </button>{' '}
                      <button type="button" onClick={() => setConfirmCancel(false)}>
                        Không hủy
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(true)}>
                      Hủy đề xuất
                    </button>
                  )}
                  {cancelError ? <p className="error-text">{cancelError}</p> : null}
                </>
              ) : (
                <p>Đề xuất đã được duyệt; nội dung không thể chỉnh sửa nữa.</p>
              )}
            </>
          )}
        </section>
      ) : (
        <section>
          <p>Bạn hiện chưa có luận văn đang hoạt động.</p>
          {eligibility && !eligibility.eligible ? (
            <div className="banner banner-error">
              <p>Bạn chưa đủ điều kiện tạo đề xuất luận văn:</p>
              <ul>
                {eligibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2>Tạo đề xuất luận văn mới</h2>
          <form className="form" onSubmit={handleCreate}>
            <label className="field">
              <span>Tiêu đề</span>
              <input type="text" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
            </label>
            <label className="field">
              <span>Mô tả</span>
              <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </label>
            <label className="field">
              <span>Lĩnh vực nghiên cứu</span>
              <select value={form.researchAreaId} onChange={(e) => setForm((p) => ({ ...p, researchAreaId: e.target.value }))} required>
                <option value="">-- Chọn lĩnh vực --</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={submitting || (eligibility ? !eligibility.eligible : false)}>
              {submitting ? 'Đang tạo…' : 'Tạo đề xuất'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </section>
      )}

      {historyTheses.length > 0 ? (
        <section>
          <h2>Lịch sử đề xuất trước đây</h2>
          <div className="table-scroll">
            <table className="classes-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tiêu đề</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {historyTheses.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Mã">{t.thesis_code}</td>
                    <td data-label="Tiêu đề">{t.title}</td>
                    <td data-label="Trạng thái">{STATUS_LABEL[t.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
