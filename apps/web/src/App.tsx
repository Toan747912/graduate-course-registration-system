import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireRole } from './routes/RequireRole';
import { Login } from './pages/Login';
import { StudentClasses } from './pages/student/StudentClasses';
import { StudentHistory } from './pages/student/StudentHistory';
import { StudentProfile } from './pages/student/StudentProfile';
import { StaffRegistrationPeriods } from './pages/staff/StaffRegistrationPeriods';
import { StaffCourseClasses } from './pages/staff/StaffCourseClasses';
import { StaffCourseClassDetail } from './pages/staff/StaffCourseClassDetail';
import { StaffHome } from './pages/staff/StaffHome';
import { StaffPrograms } from './pages/staff/StaffPrograms';
import { StaffProgramDetail } from './pages/staff/StaffProgramDetail';
import { StaffStudents } from './pages/staff/StaffStudents';
import { StaffStudentDetail } from './pages/staff/StaffStudentDetail';

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
      </Routes>
    </AuthProvider>
  );
}
