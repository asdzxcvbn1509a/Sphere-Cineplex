import { Navigate, useLocation } from 'react-router-dom';
import { useIsAuthenticated, useIsAuthLoading } from '../../store/authStore.js';
import LoadingBlock from '../ui/LoadingBlock.jsx';

/** ต้องล็อกอินก่อน — จำหน้าที่ตั้งใจจะไปไว้ใน state.from เพื่อพากลับมาหลังล็อกอิน */
const ProtectedRoute = ({ children }) => {
  const isLoading = useIsAuthLoading();
  const isAuthenticated = useIsAuthenticated();
  const location = useLocation();

  if (isLoading) return <LoadingBlock />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
};

export default ProtectedRoute;
