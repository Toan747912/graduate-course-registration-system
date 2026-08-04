import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Shared top navigation for every student-facing page. */
export function StudentNav(): JSX.Element {
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
      <NavLink to="/student/classes" className={linkClassName}>
        Danh sách lớp
      </NavLink>
      <NavLink to="/student/history" className={linkClassName}>
        Lịch sử đăng ký
      </NavLink>
      <NavLink to="/student/profile" className={linkClassName}>
        Hồ sơ học tập
      </NavLink>
      <NavLink to="/student/grades" className={linkClassName}>
        Kết quả học tập
      </NavLink>
      <NavLink to="/student/thesis" className={linkClassName}>
        Luận văn của tôi
      </NavLink>
      <button type="button" className="nav-link nav-logout" onClick={handleLogout}>
        Đăng xuất
      </button>
    </nav>
  );
}
