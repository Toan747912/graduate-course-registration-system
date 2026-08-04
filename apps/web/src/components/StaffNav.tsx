import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Shared top navigation for every training-staff-facing page. */
export function StaffNav(): JSX.Element {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleLogout = async (): Promise<void> => {
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const linkClassName = ({ isActive }: { isActive: boolean }): string =>
    isActive ? 'nav-link nav-link-active' : 'nav-link';

  return (
    <nav className="nav">
      <NavLink to="/staff/students" className={linkClassName}>
        Học viên
      </NavLink>
      <NavLink to="/staff/programs" className={linkClassName}>
        Chương trình đào tạo
      </NavLink>
      <NavLink to="/staff/registration-periods" className={linkClassName}>
        Đợt đăng ký
      </NavLink>
      <NavLink to="/staff/course-classes" className={linkClassName}>
        Lớp học phần
      </NavLink>
      <NavLink to="/staff/research-areas" className={linkClassName}>
        Lĩnh vực nghiên cứu
      </NavLink>
      <NavLink to="/staff/advisors" className={linkClassName}>
        Giảng viên hướng dẫn
      </NavLink>
      <NavLink to="/staff/theses" className={linkClassName}>
        Luận văn
      </NavLink>
      <NavLink to="/staff/graduation" className={linkClassName}>
        Xét tốt nghiệp
      </NavLink>
      <button type="button" className="nav-link nav-logout" onClick={handleLogout}>
        Đăng xuất
      </button>
    </nav>
  );
}
