// Shapes returned by apps/api. These mirror the backend response bodies
// (see apps/api/src/routes/student.ts) so the frontend never needs `any`.

export type EnrollmentStatus = 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_STUDENT' | 'CANCELLED_BY_SCHOOL';

export interface SemesterOption {
  id: string;
  name: string;
}

export interface ClassSchedule {
  day_of_week: number;
  session_slot: number;
  room: string | null;
}

export interface RegistrationClass {
  class_id: string;
  course_code: string;
  course_name: string;
  credits: number;
  class_code: string;
  max_seats: number;
  confirmed_count: number;
  seats_remaining: number;
  display_status: 'OPEN' | 'FULL';
  schedules: ClassSchedule[];
}

export interface EnrollmentActionResult {
  success: boolean;
  enrollment_id: string;
  status: EnrollmentStatus;
  reason: string | null;
}

export interface EnrollmentHistoryEntry {
  status: EnrollmentStatus;
  reason: string | null;
  changed_at: string;
}

export interface EnrollmentWithHistory {
  id: string;
  status: EnrollmentStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  course_classes: {
    id: string;
    class_code: string;
    courses: {
      code: string;
      name: string;
    };
  };
  enrollment_history: EnrollmentHistoryEntry[];
}

export interface RegistrationPeriod {
  id: string;
  semester_id: string;
  opens_at: string;
  closes_at: string;
  max_credits: number;
  created_at: string;
  semesters: {
    name: string;
  };
}

export interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
}

export type CourseClassStatus = 'ACTIVE' | 'CANCELLED';

export interface CourseClassStaff {
  id: string;
  class_code: string;
  max_seats: number;
  status: CourseClassStatus;
  cancellation_reason: string | null;
  registration_period_id: string;
  course_id: string;
  created_at: string;
  confirmed_count: number;
  courses: {
    code: string;
    name: string;
    credits: number;
  };
  registration_periods: {
    id: string;
    opens_at: string;
    closes_at: string;
    semesters: {
      name: string;
    };
  };
  class_schedules: ClassSchedule[];
}

export interface CreateCourseClassResult {
  success: boolean;
  class_id?: string;
  class_code?: string;
  status?: CourseClassStatus;
  schedule_count?: number;
  reason?: string;
}

export interface ClassEnrollmentRow {
  id: string;
  student_id: string;
  status: EnrollmentStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  profiles: {
    full_name: string;
  };
}

export interface CancelCourseClassResult {
  success: boolean;
  class_id: string;
  status?: CourseClassStatus;
  cancelled_enrollment_count?: number;
  reason?: string;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
}
