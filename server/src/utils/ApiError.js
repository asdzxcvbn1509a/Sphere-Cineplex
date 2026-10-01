/**
 * Error ที่ตั้งใจส่งให้ client — errorHandler จะแปลงเป็น JSON
 * `code` เป็นรหัสคงที่ให้ frontend เอาไปเลือกข้อความ i18n เอง
 * `details` ใส่ข้อมูลเพิ่ม เช่น รายการที่นั่งที่ถูกจองตัดหน้า
 */
export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code = 'UNAUTHORIZED', message = 'กรุณาเข้าสู่ระบบ') {
    return new ApiError(401, code, message);
  }

  static forbidden(code = 'FORBIDDEN', message = 'ไม่มีสิทธิ์เข้าถึง', details) {
    return new ApiError(403, code, message, details);
  }

  static notFound(code = 'NOT_FOUND', message = 'ไม่พบข้อมูลที่ต้องการ') {
    return new ApiError(404, code, message);
  }

  static conflict(code, message, details) {
    return new ApiError(409, code, message, details);
  }

  static tooMany(code = 'TOO_MANY_REQUESTS', message = 'ทำรายการถี่เกินไป กรุณารอสักครู่') {
    return new ApiError(429, code, message);
  }
}

export default ApiError;
