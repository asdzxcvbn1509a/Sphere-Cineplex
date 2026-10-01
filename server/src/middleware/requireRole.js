import ApiError from '../utils/ApiError.js';

/** ใช้ต่อจาก authenticate เสมอ เช่น router.use(authenticate, requireRole('ADMIN')) */
export const requireRole = (...roles) => {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('ROLE_REQUIRED', 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้'));
    }
    next();
  };
};

export default requireRole;
