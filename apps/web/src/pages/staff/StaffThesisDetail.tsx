import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Advisor, Thesis, ThesisAdvisorHistoryEntry, ThesisStatus } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_LABEL: Record<ThesisStatus, string> = {
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
};

type PendingAction = 'approve' | 'reject' | 'assign' | 'reassign' | 'complete' | 'cancel' | null;

export function StaffThesisDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [history, setHistory] = useState<ThesisAdvisorHistoryEntry[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<PendingAction>(null);

  const [rejectReason, setRejectReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [selectedAdvisorId, setSelectedAdvisorId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [thesisData, advisorsData, historyData] = await Promise.all([
        apiFetch<Thesis>(`/staff/theses/${id}`),
        apiFetch<Advisor[]>('/staff/advisors'),
        apiFetch<ThesisAdvisorHistoryEntry[]>(`/staff/theses/${id}/advisor-history`),
      ]);
      setThesis(thesisData);
      setAdvisors(advisorsData);
      setHistory(historyData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải chi tiết luận văn.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (path: string, body?: unknown): Promise<void> => {
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setActionSuccess('Thao tác thành công.');
      setConfirmAction(null);
      setRejectReason('');
      setCancelReason('');
      setReassignReason('');
      setSelectedAdvisorId('');
      await load();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Không thể thực hiện thao tác.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <main className="page">
        <StaffNav />
        <p>Đang tải…</p>
      </main>
    );
  }

  if (state === 'error' || !thesis) {
    return (
      <main className="page">
        <StaffNav />
        <div className="banner banner-error">
          <p>{error ?? 'Không tìm thấy luận văn.'}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      </main>
    );
  }

  const eligibleAdvisors = advisors.filter((a) => a.is_active && a.current_in_progress_count < a.max_active_theses);

  return (
    <main className="page">
      <StaffNav />
      <h1>Luận văn {thesis.thesis_code}</h1>

      <section>
        <p>
          <strong>Tiêu đề:</strong> {thesis.title}
        </p>
        <p>
          <strong>Mô tả:</strong> {thesis.description}
        </p>
        <p>
          <strong>Trạng thái:</strong> {STATUS_LABEL[thesis.status]}
        </p>
        {thesis.rejection_reason ? (
          <p>
            <strong>Lý do từ chối:</strong> {thesis.rejection_reason}
          </p>
        ) : null}
        {thesis.cancellation_reason ? (
          <p>
            <strong>Lý do hủy:</strong> {thesis.cancellation_reason}
          </p>
        ) : null}
      </section>

      {actionError ? <p className="error-text">{actionError}</p> : null}
      {actionSuccess ? <p className="result-text result-ok">{actionSuccess}</p> : null}

      <section className="form">
        <h2>Thao tác</h2>

        {thesis.status === 'PENDING_APPROVAL' ? (
          <div>
            {confirmAction === 'approve' ? (
              <>
                <span>Xác nhận duyệt đề xuất này?</span>{' '}
                <button type="button" disabled={busy} onClick={() => runAction(`/staff/theses/${thesis.id}/approve`)}>
                  {busy ? 'Đang xử lý…' : 'Xác nhận duyệt'}
                </button>{' '}
                <button type="button" onClick={() => setConfirmAction(null)}>
                  Hủy
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmAction('approve')}>
                Duyệt đề xuất
              </button>
            )}

            <div style={{ marginTop: '0.5rem' }}>
              {confirmAction === 'reject' ? (
                <>
                  <label className="field">
                    <span>Lý do từ chối (bắt buộc)</span>
                    <input type="text" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !rejectReason.trim()}
                    onClick={() => runAction(`/staff/theses/${thesis.id}/reject`, { reason: rejectReason.trim() })}
                  >
                    {busy ? 'Đang xử lý…' : 'Xác nhận từ chối'}
                  </button>{' '}
                  <button type="button" onClick={() => setConfirmAction(null)}>
                    Hủy
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmAction('reject')}>
                  Từ chối đề xuất
                </button>
              )}
            </div>
          </div>
        ) : null}

        {thesis.status === 'APPROVED' ? (
          <div>
            <label className="field">
              <span>Phân công giảng viên hướng dẫn</span>
              <select value={selectedAdvisorId} onChange={(e) => setSelectedAdvisorId(e.target.value)}>
                <option value="">-- Chọn giảng viên --</option>
                {eligibleAdvisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name} ({a.current_in_progress_count}/{a.max_active_theses})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !selectedAdvisorId}
              onClick={() => runAction(`/staff/theses/${thesis.id}/assign-advisor`, { advisorId: selectedAdvisorId })}
            >
              {busy ? 'Đang xử lý…' : 'Phân công giảng viên'}
            </button>

            <div style={{ marginTop: '0.5rem' }}>
              {confirmAction === 'cancel' ? (
                <>
                  <label className="field">
                    <span>Lý do hủy (bắt buộc)</span>
                    <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !cancelReason.trim()}
                    onClick={() => runAction(`/staff/theses/${thesis.id}/cancel`, { reason: cancelReason.trim() })}
                  >
                    {busy ? 'Đang xử lý…' : 'Xác nhận hủy luận văn'}
                  </button>{' '}
                  <button type="button" onClick={() => setConfirmAction(null)}>
                    Hủy thao tác
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmAction('cancel')}>
                  Hủy luận văn
                </button>
              )}
            </div>
          </div>
        ) : null}

        {thesis.status === 'IN_PROGRESS' ? (
          <div>
            <label className="field">
              <span>Đổi giảng viên hướng dẫn</span>
              <select value={selectedAdvisorId} onChange={(e) => setSelectedAdvisorId(e.target.value)}>
                <option value="">-- Chọn giảng viên mới --</option>
                {eligibleAdvisors
                  .filter((a) => a.id !== thesis.advisor_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} ({a.current_in_progress_count}/{a.max_active_theses})
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Lý do đổi giảng viên (bắt buộc)</span>
              <input type="text" value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={busy || !selectedAdvisorId || !reassignReason.trim()}
              onClick={() =>
                runAction(`/staff/theses/${thesis.id}/reassign-advisor`, {
                  advisorId: selectedAdvisorId,
                  reason: reassignReason.trim(),
                })
              }
            >
              {busy ? 'Đang xử lý…' : 'Đổi giảng viên'}
            </button>

            <div style={{ marginTop: '0.5rem' }}>
              {confirmAction === 'complete' ? (
                <>
                  <span>Xác nhận đánh dấu hoàn thành luận văn này?</span>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(`/staff/theses/${thesis.id}/complete`)}
                  >
                    {busy ? 'Đang xử lý…' : 'Xác nhận hoàn thành'}
                  </button>{' '}
                  <button type="button" onClick={() => setConfirmAction(null)}>
                    Hủy
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmAction('complete')}>
                  Đánh dấu hoàn thành
                </button>
              )}
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              {confirmAction === 'cancel' ? (
                <>
                  <label className="field">
                    <span>Lý do hủy (bắt buộc)</span>
                    <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !cancelReason.trim()}
                    onClick={() => runAction(`/staff/theses/${thesis.id}/cancel`, { reason: cancelReason.trim() })}
                  >
                    {busy ? 'Đang xử lý…' : 'Xác nhận hủy luận văn'}
                  </button>{' '}
                  <button type="button" onClick={() => setConfirmAction(null)}>
                    Hủy thao tác
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmAction('cancel')}>
                  Hủy luận văn
                </button>
              )}
            </div>
          </div>
        ) : null}

        {['COMPLETED', 'REJECTED', 'CANCELLED'].includes(thesis.status) ? (
          <p>Luận văn ở trạng thái cuối, không còn thao tác nào khả dụng.</p>
        ) : null}
      </section>

      <section>
        <h2>Lịch sử giảng viên hướng dẫn</h2>
        {history.length === 0 ? (
          <p>Chưa có giảng viên nào được phân công.</p>
        ) : (
          <div className="table-scroll">
            <table className="classes-table">
              <thead>
                <tr>
                  <th>Ngày phân công</th>
                  <th>Ngày kết thúc</th>
                  <th>Lý do đổi</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td data-label="Ngày phân công">{new Date(h.assigned_at).toLocaleString('vi-VN')}</td>
                    <td data-label="Ngày kết thúc">{h.unassigned_at ? new Date(h.unassigned_at).toLocaleString('vi-VN') : '—'}</td>
                    <td data-label="Lý do đổi">{h.change_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
