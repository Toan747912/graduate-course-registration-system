import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { AcademicStatus, Cohort, Program, StudentProfile } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const ACADEMIC_STATUS_LABELS: Record<AcademicStatus, string> = {
  STUDYING: 'Đang học',
  SUSPENDED: 'Bảo lưu',
  GRADUATED: 'Đã tốt nghiệp',
  WITHDRAWN: 'Đã thôi học',
};

const ACADEMIC_STATUS_BADGE: Record<AcademicStatus, string> = {
  STUDYING: 'badge badge-open',
  SUSPENDED: 'badge badge-upcoming',
  GRADUATED: 'badge badge-open',
  WITHDRAWN: 'badge badge-closed',
};

export function StaffStudents(): JSX.Element {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AcademicStatus | ''>('');

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (programFilter) params.set('programId', programFilter);
      if (cohortFilter) params.set('cohortId', cohortFilter);
      if (statusFilter) params.set('academicStatus', statusFilter);

      const [studentData, programData] = await Promise.all([
        apiFetch<StudentProfile[]>(`/staff/students?${params.toString()}`),
        apiFetch<Program[]>('/staff/programs'),
      ]);
      setStudents(studentData);
      setPrograms(programData);
      setState(studentData.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách học viên.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, programFilter, cohortFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

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

  const programName = (programId: string | null): string => {
    if (!programId) return '—';
    return programs.find((p) => p.id === programId)?.code ?? programId;
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Học viên</h1>

      <form
        className="form form-grid-2"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label className="field">
          <span>Tìm kiếm (mã, họ tên, email)</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
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
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AcademicStatus | '')}>
            <option value="">— Tất cả —</option>
            {(Object.keys(ACADEMIC_STATUS_LABELS) as AcademicStatus[]).map((status) => (
              <option key={status} value={status}>
                {ACADEMIC_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Lọc</button>
      </form>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}
      {state === 'empty' ? <p>Không tìm thấy học viên nào phù hợp.</p> : null}

      {state === 'ready' ? (
        <div className="table-scroll">
          <table className="classes-table">
            <thead>
              <tr>
                <th>Mã học viên</th>
                <th>Họ tên</th>
                <th>Email</th>
                <th>Chương trình</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td data-label="Mã học viên">
                    <strong>{student.student_code ?? '—'}</strong>
                  </td>
                  <td data-label="Họ tên">{student.full_name}</td>
                  <td data-label="Email">{student.email}</td>
                  <td data-label="Chương trình">{programName(student.program_id)}</td>
                  <td data-label="Trạng thái" className="cell-nowrap">
                    <span className={ACADEMIC_STATUS_BADGE[student.academic_status]}>
                      {ACADEMIC_STATUS_LABELS[student.academic_status]}
                    </span>
                  </td>
                  <td data-label="" className="cell-nowrap">
                    <Link to={`/staff/students/${student.id}`}>Quản lý</Link>
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
