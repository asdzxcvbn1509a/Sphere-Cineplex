import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { hashPassword } from '../utils/password.js';
import { normalizePhone, requireThaiMobile } from '../utils/phone.js';
import { findPage } from '../utils/pagination.js';
import { normalizeEmail, revokeAllSessions } from './auth.js';

/**
 * ผู้ดูแลระบบเห็นข้อมูลผู้ใช้ได้เท่าที่จำเป็นต่อการช่วยลูกค้า
 * ไม่มี passwordHash หลุดออกไปแม้แต่ในรูป hash
 */
const shapeUser = (user) => ({
  id: user.id,
  email: user.email,
  phone: user.phone,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
  bookingCount: user._count?.bookings ?? 0,
});

/** จำนวนการจองของบัญชี — หน้าผู้ใช้โชว์ และใช้ตัดสินว่าลบบัญชีได้ไหม */
const WITH_BOOKING_COUNT = { _count: { select: { bookings: true } } };

const userNotFound = () => {
  return ApiError.notFound('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
};

const duplicateFieldError = (target) => {
  const fields = Array.isArray(target) ? target : [target];
  if (fields.includes('email')) {
    return ApiError.conflict('EMAIL_TAKEN', 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว');
  }
  if (fields.includes('phone')) {
    return ApiError.conflict('PHONE_TAKEN', 'เบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว');
  }
  return ApiError.conflict('DUPLICATE', 'ข้อมูลซ้ำกับบัญชีที่มีอยู่แล้ว');
};

export const listUsers = async ({ q, role, page, pageSize } = {}) => {
  const where = {};
  if (role) where.role = role;
  if (q) {
    // ลูกค้าโทรเข้ามามักบอกแค่ชื่อหรือเบอร์ ค้นทีเดียวให้ครบทั้งสามช่องจะได้ไม่ต้องเดาว่าใช้อะไรสมัคร
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: normalizePhone(q) || q } },
    ];
  }

  const { rows, ...pageInfo } = await findPage(
    prisma.user,
    { where, include: WITH_BOOKING_COUNT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
    { page, pageSize },
  );
  return { items: rows.map(shapeUser), ...pageInfo };
};

export const getUser = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: WITH_BOOKING_COUNT });
  if (!user) throw userNotFound();
  return shapeUser(user);
};

/**
 * แก้ข้อมูลบัญชีแทนลูกค้า (เช่นกรอกอีเมลผิดตอนสมัครจนล็อกอินไม่ได้) และเปลี่ยนบทบาท
 *
 * ห้ามเปลี่ยนบทบาทของตัวเอง — ผู้ดูแลคนสุดท้ายจะได้ถอดสิทธิ์ตัวเองจนไม่มีใครเข้าหลังบ้านได้อีกไม่ได้
 * ถ้าจะย้ายมือ ให้ตั้งคนใหม่เป็นผู้ดูแลก่อน แล้วให้คนนั้นเป็นคนถอดสิทธิ์ให้
 */
export const updateUser = async ({ userId, actorId, name, email, phone, role }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw userNotFound();

  if (role && role !== user.role && userId === actorId) {
    throw ApiError.badRequest(
      'CANNOT_CHANGE_OWN_ROLE',
      'เปลี่ยนบทบาทของตัวเองไม่ได้ ต้องให้ผู้ดูแลอีกคนเป็นคนเปลี่ยนให้',
    );
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = normalizeEmail(email);
  if (phone !== undefined) data.phone = requireThaiMobile(phone);
  if (role !== undefined) data.role = role;

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      include: WITH_BOOKING_COUNT,
    });
    return shapeUser(updated);
  } catch (error) {
    if (error?.code === 'P2002') throw duplicateFieldError(error.meta?.target);
    throw error;
  }
};

/**
 * ตั้งรหัสผ่านใหม่ให้ลูกค้าที่ลืมรหัส — ทางสำรองของกรณีที่ลูกค้าเข้าอีเมลตัวเองไม่ได้แล้ว
 * ปกติลูกค้ากู้เองได้จากหน้า "ลืมรหัสผ่าน" ผู้ดูแลตั้งรหัสชั่วคราวแล้วแจ้งเจ้าของไปตั้งใหม่เอง
 *
 * ตั้งเสร็จเพิกถอนทุกเซสชันของบัญชีนั้น เผื่อกรณีที่ต้องรีเซ็ตเพราะบัญชีโดนยึด
 */
export const resetUserPassword = async ({ userId, actorId, newPassword }) => {
  if (userId === actorId) {
    throw ApiError.badRequest(
      'USE_PROFILE_PAGE',
      'เปลี่ยนรหัสผ่านของตัวเองที่หน้าโปรไฟล์ เพราะต้องยืนยันรหัสผ่านเดิมก่อน',
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw userNotFound();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      // access token ที่ค้างอยู่ในเครื่องคนที่ยึดบัญชีไปก็ใช้ไม่ได้ทันทีด้วย ไม่ใช่แค่ refresh token
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    }),
    revokeAllSessions(userId),
  ]);

  return { ok: true };
};

/**
 * ลบบัญชีได้เฉพาะที่ยังไม่เคยจอง
 *
 * Booking ผูกกับ User แบบ cascade ถ้าลบบัญชีที่มีประวัติ ยอดขายกับรายงานจะหายตามไปเงียบ ๆ
 * บัญชีที่เคยใช้งานจริงจึงควรถอดสิทธิ์หรือแก้ข้อมูลแทนการลบ
 */
export const deleteUser = async ({ userId, actorId }) => {
  if (userId === actorId) {
    throw ApiError.badRequest('CANNOT_DELETE_SELF', 'ลบบัญชีของตัวเองไม่ได้');
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, include: WITH_BOOKING_COUNT });
  if (!user) throw userNotFound();

  if (user._count.bookings > 0) {
    throw ApiError.conflict(
      'USER_HAS_BOOKINGS',
      'บัญชีนี้มีประวัติการจองอยู่ ลบไม่ได้เพราะยอดขายในรายงานจะหายไปด้วย',
      { bookingCount: user._count.bookings },
    );
  }

  await prisma.user.delete({ where: { id: userId } });
  return { ok: true };
};
