import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { AcademicStatus, Cohort, Program, StudentProfile, UpdateStudentResult } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

const ACADEMIC_STATUS_LABELS: Record<AcademicStatus, string> = {
  STUDYING: 'Đang học',
  SUSPENDED: 'Bảo lưu',
  GRADUATED: 'Đã tốt nghiệp',
  WITHDRAWN: 'Đã thôi học',
};

interface FormState {
  studentCode: string;
  fullName: string;
  programId: string;
  cohortId: string;
  academicStatus: AcademicStatus;
}

function toForm(student: StudentProfile): FormState {
  return {
    studentCode: student.student_code ?? '',
    fullName: student.full_name,
    programId: student.program_id ?? '',
    cohortId: student.cohort_id ?? '',
    academicStatus: student.academic_status,
  };
}

export function StaffStudentDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [studentData, programData] = await Promise.all([
        apiFetch<StudentProfile>(`/staff/students/${id}`),
        apiFetch<Program[]>('/staff/programs'),
      ]);
      setStudent(studentData);
      setForm(toForm(studentData));
      setPrograms(programData);
      if (studentData.program_id) {
        const cohortData = await apiFetch<Cohort[]>(`/staff/cohorts?programId=${studentData.program_id}`);
        setCohorts(cohortData);
      } else {
        setCohorts([]);
      }
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải hồ sơ học viên.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleProgramChange = async (programId: string): Promise<void> => {
    setForm((prev) => (prev ? { ...prev, programId, cohortId: '' } : prev));
    if (!programId) {
      setCohorts([]);
      return;
    }
    try {
      const cohortData = await apiFetch<Cohort[]>(`/staff/cohorts?programId=${programId}`);
      setCohorts(cohortData);
    } catch {
      setCohorts([]);
    }
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!id || !form) return;

    if (!form.fullName.trim()) {
      setFormError('Vui lòng nhập họ tên.');
      return;
    }
    if (form.cohortId && !form.programId) {
      setFormError('Vui lòng chọn chương trình trước khi chọn khóa.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<UpdateStudentResult>(`/staff/students/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          studentCode: form.studentCode.trim() || null,
          fullName: form.fullName.trim(),
          programId: form.programId || null,
          cohortId: form.cohortId || null,
          academicStatus: form.academicStatus,
        }),
      });
      if (!result.success) {
        setFormError(result.reason ?? 'Không thể cập nhật hồ sơ học viên.');
        return;
      }
      setFormSuccess('Đã cập nhật hồ sơ học viên.');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật hồ sơ học viên.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <p>
        <Link to="/staff/students">← Quay lại danh sách học viên</Link>
      </p>
      <h1>Chi tiết học viên</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' && student && form ? (
        <div className="card">
          <h2>{student.full_name}</h2>
          <p>
            <strong>Email:</strong> {student.email}
          </p>
          <form className="form form-grid-2" onSubmit={handleSubmit}>
            <label className="field">
              <span>Mã học viên</span>
              <input
                type="text"
                value={form.studentCode}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, studentCode: e.target.value } : prev))}
              />
            </label>
            <label className="field">
              <span>Họ tên</span>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, fullName: e.target.value } : prev))}
                required
              />
            </label>
            <label className="field">
              <span>Chương trình</span>
              <select value={form.programId} onChange={(e) => handleProgramChange(e.target.value)}>
                <option value="">— Chưa gán —</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.code} — {program.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Khóa</span>
              <select
                value={form.cohortId}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, cohortId: e.target.value } : prev))}
                disabled={!form.programId}
              >
                <option value="">— Chưa gán —</option>
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.code} — {cohort.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Trạng thái học tập</span>
              <select
                value={form.academicStatus}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, academicStatus: e.target.value as AcademicStatus } : prev))
                }
                required
              >
                {(Object.keys(ACADEMIC_STATUS_LABELS) as AcademicStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {ACADEMIC_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang lưu…' : 'Lưu hồ sơ học viên'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </div>
      ) : null}
    </main>
  );
}
