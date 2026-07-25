import { useCallback, useEffect, useState } from 'react';
import { StudentNav } from '../../components/StudentNav';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { buildConfirmedClassIds } from '../../lib/enrollmentMatching';
import type {
  EnrollmentActionResult,
  EnrollmentWithHistory,
  RegistrationClass,
  SemesterOption,
} from '../../types/api';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ Nhật',
};

const DISPLAY_STATUS_LABELS: Record<RegistrationClass['display_status'], string> = {
  OPEN: 'Còn đăng ký',
  FULL: 'Đã đầy',
};

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

export function StudentClasses(): JSX.Element {
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [semesterState, setSemesterState] = useState<LoadState>('loading');
  const [semesterError, setSemesterError] = useState<string | null>(null);
  const [selectedSemesterId, setSelectedSemesterId] = useState<string | null>(null);

  const [classes, setClasses] = useState<RegistrationClass[]>([]);
  const [classesState, setClassesState] = useState<LoadState>('loading');
  const [classesError, setClassesError] = useState<string | null>(null);

  const [confirmedClassIds, setConfirmedClassIds] = useState<Set<string>>(new Set());

  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [registerMessages, setRegisterMessages] = useState<Record<string, { ok: boolean; text: string }>>({});

  const loadSemesters = useCallback(async () => {
    setSemesterState('loading');
    setSemesterError(null);
    try {
      const data = await apiFetch<SemesterOption[]>('/student/semesters');
      setSemesters(data);
      if (data.length === 0) {
        setSemesterState('empty');
        return;
      }
      setSemesterState('ready');
      setSelectedSemesterId((current) => current ?? data[0].id);
    } catch (err) {
      setSemesterState('error');
      setSemesterError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách học kỳ.');
    }
  }, []);

  const loadClasses = useCallback(async (semesterId: string) => {
    setClassesState('loading');
    setClassesError(null);
    try {
      const [data, history] = await Promise.all([
        apiFetch<RegistrationClass[]>(`/student/classes?semesterId=${encodeURIComponent(semesterId)}`),
        apiFetch<EnrollmentWithHistory[]>('/student/enrollments/history'),
      ]);
      setClasses(data);
      setConfirmedClassIds(buildConfirmedClassIds(history));
      setClassesState(data.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setClassesState('error');
      setClassesError(err instanceof ApiRequestError ? err.message : 'Không thể tải danh sách lớp.');
    }
  }, []);

  useEffect(() => {
    loadSemesters();
  }, [loadSemesters]);

  useEffect(() => {
    if (selectedSemesterId) {
      loadClasses(selectedSemesterId);
    }
  }, [selectedSemesterId, loadClasses]);

  const handleRegister = async (classId: string): Promise<void> => {
    setPendingClassId(classId);
    try {
      const result = await apiFetch<EnrollmentActionResult>('/student/enrollments', {
        method: 'POST',
        body: JSON.stringify({ classId }),
      });
      setRegisterMessages((prev) => ({
        ...prev,
        [classId]: {
          ok: result.success,
          text: result.success ? 'Đăng ký thành công.' : (result.reason ?? 'Đăng ký không thành công.'),
        },
      }));
    } catch (err) {
      setRegisterMessages((prev) => ({
        ...prev,
        [classId]: {
          ok: false,
          text: err instanceof ApiRequestError ? err.message : 'Đăng ký không thành công.',
        },
      }));
    } finally {
      setPendingClassId(null);
      if (selectedSemesterId) {
        loadClasses(selectedSemesterId);
      }
    }
  };

  const selectedSemester = semesters.find((semester) => semester.id === selectedSemesterId) ?? null;

  return (
    <main className="page">
      <StudentNav />
      <h1>Danh sách lớp học phần</h1>

      {semesterState === 'loading' ? <p>Đang tải học kỳ…</p> : null}
      {semesterState === 'error' ? (
        <div className="banner banner-error">
          <p>{semesterError}</p>
          <button type="button" onClick={loadSemesters}>
            Thử lại
          </button>
        </div>
      ) : null}
      {semesterState === 'empty' ? <p>Hiện không có học kỳ nào đang mở đăng ký.</p> : null}

      {semesterState === 'ready' && semesters.length > 1 ? (
        <label className="field field-inline">
          <span>Học kỳ</span>
          <select value={selectedSemesterId ?? ''} onChange={(e) => setSelectedSemesterId(e.target.value)}>
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedSemesterId ? (
        <>
          {selectedSemester ? (
            <p className="current-semester">
              Học kỳ đang xem: <strong>{selectedSemester.name}</strong>
            </p>
          ) : null}
          {classesState === 'loading' ? <p>Đang tải danh sách lớp…</p> : null}
          {classesState === 'error' ? (
            <div className="banner banner-error">
              <p>{classesError}</p>
              <button type="button" onClick={() => loadClasses(selectedSemesterId)}>
                Thử lại
              </button>
            </div>
          ) : null}
          {classesState === 'empty' ? <p>Không có lớp học phần nào đang mở đăng ký trong học kỳ này.</p> : null}

          {classesState === 'ready' ? (
            <div className="table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th>Môn học</th>
                    <th>Lớp</th>
                    <th>Tín chỉ</th>
                    <th>Lịch học</th>
                    <th>Sĩ số</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((cls) => {
                    const message = registerMessages[cls.class_id];
                    const isFull = cls.display_status === 'FULL';
                    const isPending = pendingClassId === cls.class_id;
                    const isEnrolled = confirmedClassIds.has(cls.class_id);
                    return (
                      <tr key={cls.class_id}>
                        <td data-label="Môn học">
                          <strong>{cls.course_code}</strong> — {cls.course_name}
                        </td>
                        <td data-label="Lớp" className="cell-nowrap">
                          {cls.class_code}
                        </td>
                        <td data-label="Tín chỉ" className="cell-nowrap">
                          {cls.credits}
                        </td>
                        <td data-label="Lịch học">
                          <ul className="schedule-list">
                            {cls.schedules.map((s, idx) => (
                              <li key={idx}>
                                {WEEKDAY_LABELS[s.day_of_week] ?? `Thứ ${s.day_of_week}`} — Ca {s.session_slot}
                                {s.room ? ` — Phòng ${s.room}` : ''}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td data-label="Sĩ số" className="cell-nowrap">
                          {cls.confirmed_count}/{cls.max_seats} (còn {cls.seats_remaining})
                        </td>
                        <td data-label="Trạng thái" className="cell-nowrap">
                          <span className={isFull ? 'badge badge-full' : 'badge badge-open'}>
                            {DISPLAY_STATUS_LABELS[cls.display_status] ?? cls.display_status}
                          </span>
                        </td>
                        <td data-label="Thao tác">
                          {isEnrolled ? (
                            <button type="button" disabled className="button-enrolled">
                              Đã đăng ký
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isFull || isPending}
                              onClick={() => handleRegister(cls.class_id)}
                            >
                              {isPending ? 'Đang gửi…' : 'Đăng ký'}
                            </button>
                          )}
                          {message ? (
                            <p className={message.ok ? 'result-text result-ok' : 'result-text result-error'}>
                              {message.text}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
