/**
 * ตรวจ request ด้วย zod แล้วเขียนค่าที่ผ่าน parse กลับเข้า req
 * ใช้: router.post('/', validate({ body: schema }), handler)
 */
export const validate = (schemas) => {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
};

/** ครอบ async handler ให้ error วิ่งเข้า errorHandler โดยไม่ต้องเขียน try/catch ทุกที่ */
export const asyncHandler = (fn) => {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};

export default validate;
