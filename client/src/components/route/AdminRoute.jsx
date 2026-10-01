import { Navigate, useLocation } from 'react-router-dom';
import { useIsAdmin, useIsAuthenticated, useIsAuthLoading } from '../../store/authStore.js';
import LoadingBlock from '../ui/LoadingBlock.jsx';

/** ต้องล็อกอินและมี role = ADMIN เท่านั้น ผู้ใช้ทั่วไปจะถูกส่งกลับหน้าแรก */
const AdminRoute = ({ children }) => {
  const isLoading = useIsAuthLoading();
  const isAuthenticated = useIsAuthenticated();
  const isAdmin = useIsAdmin();
  const location = useLocation();

  if (isLoading) return <LoadingBlock />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
};

export default AdminRoute;
