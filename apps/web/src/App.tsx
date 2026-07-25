import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireRole } from './routes/RequireRole';
import { Login } from './pages/Login';
import { StudentClasses } from './pages/student/StudentClasses';
import { StudentHistory } from './pages/student/StudentHistory';
import { StaffRegistrationPeriods } from './pages/staff/StaffRegistrationPeriods';
import { StaffCourseClasses } from './pages/staff/StaffCourseClasses';
import { StaffCourseClassDetail } from './pages/staff/StaffCourseClassDetail';
import { StaffHome } from './pages/staff/StaffHome';

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
          path="/staff"
          element={
            <RequireRole allow={['TRAINING_STAFF']}>
              <StaffHome />
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
