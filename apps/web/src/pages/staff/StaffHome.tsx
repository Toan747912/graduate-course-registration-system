import { StaffNav } from '../../components/StaffNav';

export function StaffHome(): JSX.Element {
  return (
    <main className="page">
      <StaffNav />
      <h1>Khu vực nhân viên đào tạo</h1>
      <p>Chọn một mục ở thanh điều hướng phía trên để quản lý đợt đăng ký hoặc lớp học phần.</p>
    </main>
  );
}
