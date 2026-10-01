import { ZodError } from 'zod';
import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { isDev } from '../config/env.js';

export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound('ROUTE_NOT_FOUND', `ไม่พบเส้นทาง ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars -- Express ดูจากจำนวน arg ว่าเป็น error handler
export const errorHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'เกิดข้อผิดพลาดภายในระบบ';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'ข้อมูลที่ส่งมาไม่ถูกต้อง';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (err instanceof multer.MulterError) {
    status = 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์มีขนาดใหญ่เกินกำหนด' : 'อัปโหลดไฟล์ไม่สำเร็จ';
  } else if (err?.code === 'P2002') {
    // unique constraint — ที่นั่งชนกันจะถูกดักไว้ใน bookings.service ก่อนแล้ว
    status = 409;
    code = 'DUPLICATE';
    message = 'ข้อมูลซ้ำกับที่มีอยู่แล้ว';
    details = { target: err.meta?.target };
  } else if (err?.code === 'P2025') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'ไม่พบข้อมูลที่ต้องการ';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      ...(isDev && status >= 500 && { stack: err.stack }),
    },
  });
};
