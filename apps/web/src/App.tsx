import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireRole } from './routes/RequireRole';
import { Login } from './pages/Login';
import { StudentClasses } from './pages/student/StudentClasses';
import { StudentHistory } from './pages/student/StudentHistory';
import { StudentProfile } from './pages/student/StudentProfile';
import { StudentGrades } from './pages/student/StudentGrades';
import { StaffRegistrationPeriods } from './pages/staff/StaffRegistrationPeriods';
import { StaffCourseClasses } from './pages/staff/StaffCourseClasses';
import { StaffCourseClassDetail } from './pages/staff/StaffCourseClassDetail';
import { StaffCourseClassGrades } from './pages/staff/StaffCourseClassGrades';
import { StaffHome } from './pages/staff/StaffHome';
import { StaffPrograms } from './pages/staff/StaffPrograms';
import { StaffProgramDetail } from './pages/staff/StaffProgramDetail';
import { StaffStudents } from './pages/staff/StaffStudents';
import { StaffStudentDetail } from './pages/staff/StaffStudentDetail';
import { StaffResearchAreas } from './pages/staff/StaffResearchAreas';
import { StaffAdvisors } from './pages/staff/StaffAdvisors';
import { StaffTheses } from './pages/staff/StaffTheses';
import { StaffThesisDetail } from './pages/staff/StaffThesisDetail';
import { StudentThesis } from './pages/student/StudentThesis';

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/student/classes"
          element={
            <RequireRole allow={['STUDENT']}>
              <StudentClasses />
            </RequireRole>
          }
        />
        <Route
          path="/student/history"
          element={
            <RequireRole allow={['STUDENT']}>
              <StudentHistory />
            </RequireRole>
          }
        />
        <Route
          path="/student/profile"
          element={
            <RequireRole allow={['STUDENT']}>
              <StudentProfile />
            </RequireRole>
          }
        />
        <Route
          path="/student/grades"
          element={
            <RequireRole allow={['STUDENT']}>
              <StudentGrades />
            </RequireRole>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffHome />
            </RequireRole>
          }
        />
        <Route
          path="/staff/programs"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffPrograms />
            </RequireRole>
          }
        />
        <Route
          path="/staff/programs/:id"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffProgramDetail />
            </RequireRole>
          }
        />
        <Route
          path="/staff/students"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffStudents />
            </RequireRole>
          }
        />
        <Route
          path="/staff/students/:id"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffStudentDetail />
            </RequireRole>
          }
        />
        <Route
          path="/staff/registration-periods"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffRegistrationPeriods />
            </RequireRole>
          }
        />
        <Route
          path="/staff/course-classes"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffCourseClasses />
            </RequireRole>
          }
        />
        <Route
          path="/staff/course-classes/:id"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffCourseClassDetail />
            </RequireRole>
          }
        />
        <Route
          path="/staff/course-classes/:id/grades"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffCourseClassGrades />
            </RequireRole>
          }
        />
        <Route
          path="/staff/research-areas"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffResearchAreas />
            </RequireRole>
          }
        />
        <Route
          path="/staff/advisors"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffAdvisors />
            </RequireRole>
          }
        />
        <Route
          path="/staff/theses"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffTheses />
            </RequireRole>
          }
        />
        <Route
          path="/staff/theses/:id"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffThesisDetail />
            </RequireRole>
          }
        />
        <Route
          path="/student/thesis"
          element={
            <RequireRole allow={['STUDENT']}>
              <StudentThesis />
            </RequireRole>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
