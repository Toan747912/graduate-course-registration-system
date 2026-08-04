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

export interface Program {
  id: string;
  code: string;
  name: string;
  required_credits_min: number;
  elective_credits_min: number;
  pass_score_min: number;
  thesis_credits_min: number;
  created_at: string;
  updated_at: string;
}

export interface Cohort {
  id: string;
  program_id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type RequirementType = 'REQUIRED' | 'ELECTIVE';

export interface ProgramCourse {
  id: string;
  program_id: string;
  course_id: string;
  requirement_type: RequirementType;
  created_at: string;
  updated_at: string;
  courses: {
    code: string;
    name: string;
    credits: number;
  };
}

export type AcademicStatus = 'STUDYING' | 'SUSPENDED' | 'GRADUATED' | 'WITHDRAWN';

export interface StudentProfile {
  id: string;
  student_code: string | null;
  full_name: string;
  email: string;
  program_id: string | null;
  cohort_id: string | null;
  academic_status: AcademicStatus;
  created_at: string;
  updated_at: string;
}

export interface UpdateStudentResult {
  success: boolean;
  id?: string;
  student_code?: string | null;
  full_name?: string;
  program_id?: string | null;
  cohort_id?: string | null;
  academic_status?: AcademicStatus;
  reason?: string;
}

// Batch 3: grades and progress (docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md).

export type GradeStatus = 'DRAFT' | 'PUBLISHED';
export type ResultStatus = 'PASS' | 'FAIL';

export interface ClassGradeRow {
  enrollment_id: string;
  student_id: string;
  student_code: string | null;
  full_name: string;
  grade_id: string | null;
  final_score: number | null;
  grade_status: GradeStatus | null;
  result_status: ResultStatus | null;
  published_at: string | null;
}

export interface GradeMutationResult {
  success: boolean;
  id?: string;
  enrollment_id?: string;
  final_score?: number;
  grade_status?: GradeStatus;
  result_status?: ResultStatus;
  published_at?: string;
  reason?: string;
}

export interface StudentGradeRow {
  enrollment_id: string;
  course_code: string;
  course_name: string;
  credits: number;
  class_code: string;
  semester_name: string;
  final_score: number;
  grade_status?: GradeStatus;
  result_status: ResultStatus;
  published_at: string;
  in_program: boolean;
  counts_towards_progress: boolean;
}

export interface StudentProgress {
  program_id: string | null;
  required_credits_min: number | null;
  elective_credits_min: number | null;
  required_credits_earned: number;
  elective_credits_earned: number;
}

// Batch 4: thesis proposal / advisor management (docs/BATCH_4_THESIS_ADVISOR_DESIGN.md).

export interface ResearchArea {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Advisor {
  id: string;
  advisor_code: string;
  full_name: string;
  specialization: string;
  max_active_theses: number;
  is_active: boolean;
  current_in_progress_count: number;
  created_at: string;
  updated_at: string;
}

export type ThesisStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface Thesis {
  id: string;
  thesis_code: string;
  student_id: string;
  title: string;
  description: string;
  research_area_id: string;
  status: ThesisStatus;
  advisor_id: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  advisor_assigned_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThesisAdvisorHistoryEntry {
  id: string;
  thesis_id: string;
  advisor_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  assigned_by: string;
  change_reason: string | null;
}

export interface ThesisMutationResult {
  success: boolean;
  thesis?: Thesis;
  reason?: string;
}

export interface ThesisEligibility {
  eligible: boolean;
  reasons: string[];
  current_credits: number;
  thesis_credits_min: number | null;
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
