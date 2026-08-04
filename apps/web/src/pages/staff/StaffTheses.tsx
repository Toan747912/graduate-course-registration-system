import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Thesis, ThesisStatus } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const STATUS_LABEL: Record<ThesisStatus, string> = {
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
};

const STATUS_FILTERS: (ThesisStatus | 'ALL')[] = [
  'ALL',
  'PENDING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

export function StaffTheses(): JSX.Element {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ThesisStatus | 'ALL'>('ALL');

  const load = useCallback(async (status: ThesisStatus | 'ALL') => {
    setState('loading');
    setError(null);
    try {
      const query = status === 'ALL' ? '' : `?status=${status}`;
      const data = await apiFetch<Thesis[]>(`/staff/theses${query}`);
      setTheses(data);
      setState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách luận văn.');
    }
  }, []);

  useEffect(() => {
    load(statusFilter);
  }, [load, statusFilter]);

  return (
    <main className="page">
      <StaffNav />
      <h1>Luận văn</h1>

      <div className="field">
        <span>Lọc theo trạng thái</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ThesisStatus | 'ALL')}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'ALL' ? 'Tất cả' : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={() => load(statusFilter)}>
            Thử lại
          </button>
        </div>
      ) : null}
      {state === 'empty' ? <p>Không có luận văn nào phù hợp với bộ lọc.</p> : null}

      {state === 'ready' ? (
        <div className="table-scroll">
          <table className="classes-table">
            <thead>
              <tr>
                <th>Mã luận văn</th>
                <th>Tiêu đề</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {theses.map((thesis) => (
                <tr key={thesis.id}>
                  <td data-label="Mã luận văn">
                    <strong>{thesis.thesis_code}</strong>
                  </td>
                  <td data-label="Tiêu đề">{thesis.title}</td>
                  <td data-label="Trạng thái">{STATUS_LABEL[thesis.status]}</td>
                  <td data-label="" className="cell-nowrap">
                    <Link to={`/staff/theses/${thesis.id}`}>Chi tiết</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
