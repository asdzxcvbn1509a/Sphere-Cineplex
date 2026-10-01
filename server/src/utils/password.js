import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';

/** bcrypt อ่านรหัสผ่านแค่ 72 ไบต์แรก ยาวกว่านั้นต้องกันไว้ตั้งแต่ชั้น validate ไม่ใช่ปล่อยให้ถูกตัดเงียบ ๆ */
export const MAX_PASSWORD_LENGTH = 72;
export const MIN_PASSWORD_LENGTH = 8;

export const hashPassword = (plain) => {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
};

export const verifyPassword = (plain, hash) => {
  // bcryptjs คืน false ให้เองถ้า hash ผิดรูป (เช่นบัญชีเก่าที่ยังไม่เคยตั้งรหัสผ่าน)
  return bcrypt.compare(String(plain ?? ''), String(hash ?? ''));
};

/**
 * hash ที่ไม่มีทางตรงกับรหัสผ่านใด ๆ — ใช้เทียบทิ้งเปล่า ๆ ตอนหาบัญชีไม่เจอ
 * ให้เวลาตอบกลับใกล้เคียงกับตอนที่บัญชีมีอยู่จริง ไม่งั้นคนร้ายจับเวลา response
 * ก็ไล่ได้ว่าอีเมลหรือเบอร์ไหนมีบัญชีอยู่ในระบบ
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomUUID(), env.BCRYPT_ROUNDS);

/**
 * เกณฑ์รหัสผ่าน: ยาวพอและมีทั้งตัวอักษรกับตัวเลข
 * ไม่บังคับอักขระพิเศษ เพราะทำให้คนตั้งรหัสที่จำยากแล้วไปจดไว้ที่อื่นแทน
 *
 * อยู่ที่นี่เพื่อให้ทุกทางที่ตั้งรหัสผ่านได้ (สมัคร, เปลี่ยนเอง, ผู้ดูแลรีเซ็ตให้) ใช้เกณฑ์เดียวกัน
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`)
  .max(MAX_PASSWORD_LENGTH, `รหัสผ่านต้องไม่เกิน ${MAX_PASSWORD_LENGTH} ตัวอักษร`)
  .refine((value) => /[A-Za-z]/.test(value), 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว')
  .refine((value) => /[0-9]/.test(value), 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');
