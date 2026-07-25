import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StaffNav } from '../../components/StaffNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import type { Course, CourseClassStaff, CreateCourseClassResult, RegistrationPeriod } from '../../types/api';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ Nhật',
};

const CLASS_STATUS_LABELS: Record<CourseClassStaff['status'], string> = {
  ACTIVE: 'Hoạt động',
  CANCELLED: 'Đã hủy',
};

interface ScheduleRow {
  dayOfWeek: string;
  sessionSlot: string;
  room: string;
}

const EMPTY_SCHEDULE_ROW: ScheduleRow = { dayOfWeek: '1', sessionSlot: '1', room: '' };

interface FormState {
  registrationPeriodId: string;
  courseId: string;
  classCode: string;
  maxSeats: string;
  schedules: ScheduleRow[];
}

const EMPTY_FORM: FormState = {
  registrationPeriodId: '',
  courseId: '',
  classCode: '',
  maxSeats: '',
  schedules: [{ ...EMPTY_SCHEDULE_ROW }],
};

export function StaffCourseClasses(): JSX.Element {
  const [periods, setPeriods] = useState<RegistrationPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<CourseClassStaff[]>([]);
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
      const [periodData, courseData, classData] = await Promise.all([
        apiFetch<RegistrationPeriod[]>('/staff/registration-periods'),
        apiFetch<Course[]>('/staff/courses'),
        apiFetch<CourseClassStaff[]>('/staff/course-classes'),
      ]);
      setPeriods(periodData);
      setCourses(courseData);
      setClasses(classData);
      setState(classData.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách lớp học phần.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateSchedule = (index: number, patch: Partial<ScheduleRow>): void => {
    setForm((prev) => ({
      ...prev,
      schedules: prev.schedules.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const addSchedule = (): void => {
    setForm((prev) => ({ ...prev, schedules: [...prev.schedules, { ...EMPTY_SCHEDULE_ROW }] }));
  };

  const removeSchedule = (index: number): void => {
    setForm((prev) => ({ ...prev, schedules: prev.schedules.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.registrationPeriodId) {
      setFormError('Vui lòng chọn đợt đăng ký.');
      return;
    }
    if (!form.courseId) {
      setFormError('Vui lòng chọn môn học.');
      return;
    }
    if (!form.classCode.trim()) {
      setFormError('Vui lòng nhập mã lớp.');
      return;
    }
    const maxSeats = Number(form.maxSeats);
    if (!Number.isInteger(maxSeats) || maxSeats <= 0) {
      setFormError('Sĩ số tối đa phải là số nguyên lớn hơn 0.');
      return;
    }
    if (form.schedules.length === 0) {
      setFormError('Phải có ít nhất một buổi học.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<CreateCourseClassResult>('/staff/course-classes', {
        method: 'POST',
        body: JSON.stringify({
          registrationPeriodId: form.registrationPeriodId,
          courseId: form.courseId,
          classCode: form.classCode.trim(),
          maxSeats,
          schedules: form.schedules.map((s) => ({
            dayOfWeek: Number(s.dayOfWeek),
            sessionSlot: Number(s.sessionSlot),
            room: s.room.trim() ? s.room.trim() : undefined,
          })),
        }),
      });

      if (!result.success) {
        setFormError(result.reason ?? 'Không thể tạo lớp học phần.');
        return;
      }

      setFormSuccess('Tạo lớp học phần thành công.');
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Không thể tạo lớp học phần.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <StaffNav />
      <h1>Quản lý lớp học phần</h1>

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
          {state === 'empty' ? <p>Chưa có lớp học phần nào.</p> : null}
          {state === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Môn học</th>
                    <th>Mã lớp</th>
                    <th>Học kỳ</th>
                    <th>Sĩ số</th>
                    <th>Lịch học</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((cls) => (
                    <tr key={cls.id}>
                      <td data-label="Môn học">
                        <strong>{cls.courses.code}</strong> — {cls.courses.name}
                      </td>
                      <td data-label="Mã lớp" className="cell-nowrap">
                        {cls.class_code}
                      </td>
                      <td data-label="Học kỳ">{cls.registration_periods.semesters.name}</td>
                      <td data-label="Sĩ số" className="cell-nowrap">
                        {cls.confirmed_count}/{cls.max_seats}
                      </td>
                      <td data-label="Lịch học">
                        <ul className="schedule-list">
                          {cls.class_schedules.map((s, idx) => (
                            <li key={idx}>
                              {WEEKDAY_LABELS[s.day_of_week] ?? `Thứ ${s.day_of_week}`} — Ca {s.session_slot}
                              {s.room ? ` — Phòng ${s.room}` : ''}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td data-label="Trạng thái" className="cell-nowrap">
                        <span className={cls.status === 'ACTIVE' ? 'badge badge-open' : 'badge badge-full'}>
                          {CLASS_STATUS_LABELS[cls.status]}
                        </span>
                      </td>
                      <td data-label="Thao tác">
                        <Link to={`/staff/course-classes/${cls.id}`} className="button-link">
                          Xem chi tiết
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <h2>Tạo lớp học phần mới</h2>
          <form className="form form-wide" onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <label className="field">
                <span>Đợt đăng ký</span>
                <select
                  value={form.registrationPeriodId}
                  onChange={(e) => setForm((prev) => ({ ...prev, registrationPeriodId: e.target.value }))}
                  required
                >
                  <option value="">— Chọn đợt đăng ký —</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.semesters.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Môn học</span>
                <select
                  value={form.courseId}
                  onChange={(e) => setForm((prev) => ({ ...prev, courseId: e.target.value }))}
                  required
                >
                  <option value="">— Chọn môn học —</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.code} — {course.name} ({course.credits} tín chỉ)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Mã lớp</span>
                <input
                  type="text"
                  value={form.classCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, classCode: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Sĩ số tối đa</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.maxSeats}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxSeats: e.target.value }))}
                  required
                />
              </label>
            </div>

            <fieldset className="schedule-fieldset">
              <legend>Lịch học</legend>
              {form.schedules.map((row, index) => (
                <div className="schedule-row" key={index}>
                  <label className="field">
                    <span>Thứ</span>
                    <select value={row.dayOfWeek} onChange={(e) => updateSchedule(index, { dayOfWeek: e.target.value })}>
                      {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Ca học</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={row.sessionSlot}
                      onChange={(e) => updateSchedule(index, { sessionSlot: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Phòng (tùy chọn)</span>
                    <input type="text" value={row.room} onChange={(e) => updateSchedule(index, { room: e.target.value })} />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeSchedule(index)}
                    disabled={form.schedules.length <= 1}
                  >
                    Xóa buổi học
                  </button>
                </div>
              ))}
              <button type="button" onClick={addSchedule}>
                Thêm buổi học
              </button>
            </fieldset>

            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang tạo…' : 'Tạo lớp học phần'}
            </button>
            {formError ? <p className="error-text">{formError}</p> : null}
            {formSuccess ? <p className="result-text result-ok">{formSuccess}</p> : null}
          </form>
        </>
      ) : null}
    </main>
  );
}
