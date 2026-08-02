import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Cohort, Course, Program, ProgramCourse, RequirementType } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'error';

interface ProgramFormState {
  code: string;
  name: string;
  requiredCreditsMin: string;
  electiveCreditsMin: string;
  passScoreMin: string;
  thesisCreditsMin: string;
}

function toProgramForm(program: Program): ProgramFormState {
  return {
    code: program.code,
    name: program.name,
    requiredCreditsMin: String(program.required_credits_min),
    electiveCreditsMin: String(program.elective_credits_min),
    passScoreMin: String(program.pass_score_min),
    thesisCreditsMin: String(program.thesis_credits_min),
  };
}

const REQUIREMENT_LABELS: Record<RequirementType, string> = {
  REQUIRED: 'Bắt buộc',
  ELECTIVE: 'Tự chọn',
};

export function StaffProgramDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const [program, setProgram] = useState<Program | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [programCourses, setProgramCourses] = useState<ProgramCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [programForm, setProgramForm] = useState<ProgramFormState | null>(null);
  const [programSubmitting, setProgramSubmitting] = useState(false);
  const [programFormError, setProgramFormError] = useState<string | null>(null);
  const [programFormSuccess, setProgramFormSuccess] = useState<string | null>(null);

  const [cohortCode, setCohortCode] = useState('');
  const [cohortName, setCohortName] = useState('');
  const [cohortSubmitting, setCohortSubmitting] = useState(false);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [cohortSuccess, setCohortSuccess] = useState<string | null>(null);

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [requirementType, setRequirementType] = useState<RequirementType>('REQUIRED');
  const [pcSubmitting, setPcSubmitting] = useState(false);
  const [pcError, setPcError] = useState<string | null>(null);
  const [pcSuccess, setPcSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setState('loading');
    setError(null);
    try {
      const [programData, cohortData, programCourseData, courseData] = await Promise.all([
        apiFetch<Program>(`/staff/programs/${id}`),
        apiFetch<Cohort[]>(`/staff/cohorts?programId=${id}`),
        apiFetch<ProgramCourse[]>(`/staff/program-courses?programId=${id}`),
        apiFetch<Course[]>('/staff/courses'),
      ]);
      setProgram(programData);
      setProgramForm(toProgramForm(programData));
      setCohorts(cohortData);
      setProgramCourses(programCourseData);
      setCourses(courseData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải chi tiết chương trình đào tạo.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const assignedCourseIds = useMemo(() => new Set(programCourses.map((pc) => pc.course_id)), [programCourses]);
  const availableCourses = useMemo(
    () => courses.filter((c) => !assignedCourseIds.has(c.id)),
    [courses, assignedCourseIds],
  );

  const handleProgramSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setProgramFormError(null);
    setProgramFormSuccess(null);
    if (!id || !programForm) {
      return;
    }

    if (!programForm.code.trim() || !programForm.name.trim()) {
      setProgramFormError('Vui lòng nhập mã và tên chương trình đào tạo.');
      return;
    }
    const requiredCreditsMin = Number(programForm.requiredCreditsMin);
    const electiveCreditsMin = Number(programForm.electiveCreditsMin);
    const passScoreMin = Number(programForm.passScoreMin);
    const thesisCreditsMin = Number(programForm.thesisCreditsMin);

    if (!Number.isInteger(requiredCreditsMin) || requiredCreditsMin <= 0) {
      setProgramFormError('Tín chỉ tối thiểu bắt buộc phải là số nguyên lớn hơn 0.');
      return;
    }
    if (!Number.isInteger(electiveCreditsMin) || electiveCreditsMin < 0) {
      setProgramFormError('Tín chỉ tối thiểu tự chọn phải là số nguyên không âm.');
      return;
    }
    if (Number.isNaN(passScoreMin) || passScoreMin < 0 || passScoreMin > 10) {
      setProgramFormError('Điểm đạt tối thiểu phải trong khoảng 0–10.');
      return;
    }
    if (!Number.isInteger(thesisCreditsMin) || thesisCreditsMin < 0) {
      setProgramFormError('Tín chỉ tối thiểu để phân công luận văn phải là số nguyên không âm.');
      return;
    }

    setProgramSubmitting(true);
    try {
      const updated = await apiFetch<Program>(`/staff/programs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          code: programForm.code.trim(),
          name: programForm.name.trim(),
          requiredCreditsMin,
          electiveCreditsMin,
          passScoreMin,
          thesisCreditsMin,
        }),
      });
      setProgram(updated);
      setProgramForm(toProgramForm(updated));
      setProgramFormSuccess('Đã cập nhật cấu hình chương trình đào tạo.');
    } catch (err) {
      setProgramFormError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật chương trình đào tạo.');
    } finally {
      setProgramSubmitting(false);
    }
  };

  const handleCohortSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setCohortError(null);
    setCohortSuccess(null);
    if (!id) {
      return;
    }
    if (!cohortCode.trim() || !cohortName.trim()) {
      setCohortError('Vui lòng nhập mã và tên khóa.');
      return;
    }

    setCohortSubmitting(true);
    try {
      await apiFetch('/staff/cohorts', {
        method: 'POST',
        body: JSON.stringify({ programId: id, code: cohortCode.trim(), name: cohortName.trim() }),
      });
      setCohortSuccess('Tạo khóa thành công.');
      setCohortCode('');
      setCohortName('');
      await load();
    } catch (err) {
      setCohortError(err instanceof ApiRequestError ? err.message : 'Không thể tạo khóa.');
    } finally {
      setCohortSubmitting(false);
    }
  };

  const handleProgramCourseSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPcError(null);
    setPcSuccess(null);
    if (!id) {
      return;
    }
    if (!selectedCourseId) {
      setPcError('Vui lòng chọn môn học.');
      return;
    }

    setPcSubmitting(true);
    try {
      await apiFetch('/staff/program-courses', {
        method: 'POST',
        body: JSON.stringify({ programId: id, courseId: selectedCourseId, requirementType }),
      });
      setPcSuccess('Gán môn học vào chương trình thành công.');
      setSelectedCourseId('');
      setRequirementType('REQUIRED');
      await load();
    } catch (err) {
      setPcError(err instanceof ApiRequestError ? err.message : 'Không thể gán môn học vào chương trình.');
    } finally {
      setPcSubmitting(false);
    }
  };

  const handleToggleRequirement = async (programCourse: ProgramCourse): Promise<void> => {
    setPcError(null);
    setPcSuccess(null);
    const nextType: RequirementType = programCourse.requirement_type === 'REQUIRED' ? 'ELECTIVE' : 'REQUIRED';
    try {
      await apiFetch(`/staff/program-courses/${programCourse.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ requirementType: nextType }),
      });
      await load();
    } catch (err) {
      setPcError(err instanceof ApiRequestError ? err.message : 'Không thể cập nhật phân loại môn học.');
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <p>
        <Link to="/staff/programs">← Quay lại danh sách chương trình đào tạo</Link>
      </p>
      <h1>Chi tiết chương trình đào tạo</h1>

      {state === 'loading' ? <p>Đang tải…</p> : null}
      {state === 'error' ? (
        <div className="banner banner-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : null}

      {state === 'ready' && program && programForm ? (
        <>
          <div className="card">
            <h2>
              {program.code} — {program.name}
            </h2>
            <form className="form form-grid-2" onSubmit={handleProgramSubmit}>
              <label className="field">
                <span>Mã chương trình</span>
                <input
                  type="text"
                  value={programForm.code}
                  onChange={(e) => setProgramForm((prev) => (prev ? { ...prev, code: e.target.value } : prev))}
                  required
                />
              </label>
              <label className="field">
                <span>Tên chương trình</span>
                <input
                  type="text"
                  value={programForm.name}
                  onChange={(e) => setProgramForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                  required
                />
              </label>
              <label className="field">
                <span>Tín chỉ tối thiểu bắt buộc</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={programForm.requiredCreditsMin}
                  onChange={(e) =>
                    setProgramForm((prev) => (prev ? { ...prev, requiredCreditsMin: e.target.value } : prev))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Tín chỉ tối thiểu tự chọn</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={programForm.electiveCreditsMin}
                  onChange={(e) =>
                    setProgramForm((prev) => (prev ? { ...prev, electiveCreditsMin: e.target.value } : prev))
                  }
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
                  value={programForm.passScoreMin}
                  onChange={(e) =>
                    setProgramForm((prev) => (prev ? { ...prev, passScoreMin: e.target.value } : prev))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Tín chỉ tối thiểu trước khi phân công luận văn</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={programForm.thesisCreditsMin}
                  onChange={(e) =>
                    setProgramForm((prev) => (prev ? { ...prev, thesisCreditsMin: e.target.value } : prev))
                  }
                  required
                />
              </label>
              <button type="submit" disabled={programSubmitting}>
                {programSubmitting ? 'Đang lưu…' : 'Lưu cấu hình chương trình'}
              </button>
              {programFormError ? <p className="error-text">{programFormError}</p> : null}
              {programFormSuccess ? <p className="result-text result-ok">{programFormSuccess}</p> : null}
            </form>
          </div>

          <h2>Khóa thuộc chương trình</h2>
          {cohorts.length === 0 ? (
            <p>Chưa có khóa nào thuộc chương trình này.</p>
          ) : (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Mã khóa</th>
                    <th>Tên khóa</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort) => (
                    <tr key={cohort.id}>
                      <td data-label="Mã khóa">
                        <strong>{cohort.code}</strong>
                      </td>
                      <td data-label="Tên khóa">{cohort.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="form" onSubmit={handleCohortSubmit}>
            <label className="field">
              <span>Mã khóa</span>
              <input type="text" value={cohortCode} onChange={(e) => setCohortCode(e.target.value)} required />
            </label>
            <label className="field">
              <span>Tên khóa</span>
              <input type="text" value={cohortName} onChange={(e) => setCohortName(e.target.value)} required />
            </label>
            <button type="submit" disabled={cohortSubmitting}>
              {cohortSubmitting ? 'Đang tạo…' : 'Tạo khóa'}
            </button>
            {cohortError ? <p className="error-text">{cohortError}</p> : null}
            {cohortSuccess ? <p className="result-text result-ok">{cohortSuccess}</p> : null}
          </form>

          <h2>Khung môn học của chương trình</h2>
          {programCourses.length === 0 ? (
            <p>Chưa có môn học nào được gán vào chương trình này.</p>
          ) : (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Mã môn</th>
                    <th>Tên môn</th>
                    <th>Tín chỉ</th>
                    <th>Phân loại</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {programCourses.map((pc) => (
                    <tr key={pc.id}>
                      <td data-label="Mã môn">
                        <strong>{pc.courses.code}</strong>
                      </td>
                      <td data-label="Tên môn">{pc.courses.name}</td>
                      <td data-label="Tín chỉ" className="cell-nowrap">
                        {pc.courses.credits}
                      </td>
                      <td data-label="Phân loại" className="cell-nowrap">
                        <span className={pc.requirement_type === 'REQUIRED' ? 'badge badge-open' : 'badge badge-upcoming'}>
                          {REQUIREMENT_LABELS[pc.requirement_type]}
                        </span>
                      </td>
                      <td data-label="" className="cell-nowrap">
                        <button type="button" onClick={() => handleToggleRequirement(pc)}>
                          Đổi thành {REQUIREMENT_LABELS[pc.requirement_type === 'REQUIRED' ? 'ELECTIVE' : 'REQUIRED']}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {courses.length > 0 && availableCourses.length === 0 ? (
            <p>Tất cả môn học hiện có đều đã được gán vào chương trình này.</p>
          ) : (
            <form className="form" onSubmit={handleProgramCourseSubmit}>
              <label className="field">
                <span>Môn học</span>
                <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)} required>
                  <option value="">— Chọn môn học —</option>
                  {availableCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.code} — {course.name} ({course.credits} tín chỉ)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Phân loại</span>
                <select
                  value={requirementType}
                  onChange={(e) => setRequirementType(e.target.value as RequirementType)}
                  required
                >
                  <option value="REQUIRED">Bắt buộc</option>
                  <option value="ELECTIVE">Tự chọn</option>
                </select>
              </label>
              <button type="submit" disabled={pcSubmitting}>
                {pcSubmitting ? 'Đang gán…' : 'Gán môn học'}
              </button>
              {pcError ? <p className="error-text">{pcError}</p> : null}
              {pcSuccess ? <p className="result-text result-ok">{pcSuccess}</p> : null}
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
