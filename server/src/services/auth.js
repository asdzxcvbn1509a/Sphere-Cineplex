import crypto from 'node:crypto';
import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { APP_URL, env, isDev, isMailConfigured } from '../config/env.js';
import { sendMail } from '../utils/mailer.js';
import { passwordResetEmail } from '../emails/passwordReset.js';
import { requireThaiMobile } from '../utils/phone.js';
import { loginLookup, normalizeEmail } from '../utils/loginIdentifier.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../utils/password.js';
import {
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../utils/jwt.js';

export const publicUser = (user) => {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role,
  };
};

// ย้ายไปอยู่ utils/loginIdentifier.js คู่กับ loginLookup — ส่งต่อจากที่นี่ให้ service อื่นที่ import ไว้เดิม
export { normalizeEmail };

/**
 * เพิกถอนทุกเซสชันที่ยังใช้ได้ของผู้ใช้ — except = refresh token ของเครื่องที่ให้คงไว้ (ไม่ส่ง = ไม่เว้นเครื่องไหน)
 * คืน PrismaPromise จึงใส่ใน prisma.$transaction([...]) ได้ด้วย · ใน interactive transaction ส่ง tx มาเป็น client
 */
export const revokeAllSessions = (userId, { except, at = new Date(), client = prisma } = {}) => {
  return client.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(except && { NOT: { tokenHash: hashToken(except) } }) },
    data: { revokedAt: at },
  });
};

/** ข้อความเดียวกันทุกกรณีที่ล็อกอินไม่ผ่าน — ไม่บอกว่าผิดที่บัญชีหรือรหัสผ่าน */
const invalidCredentials = () => {
  return ApiError.unauthorized(
    'INVALID_CREDENTIALS',
    'อีเมล/เบอร์โทรศัพท์ หรือรหัสผ่านไม่ถูกต้อง',
  );
};

/** แปลง unique constraint ของ Prisma เป็นข้อความที่ชี้ช่องที่ต้องแก้ได้ */
const duplicateFieldError = (target) => {
  const fields = Array.isArray(target) ? target : [target];
  if (fields.includes('email')) {
    return ApiError.conflict('EMAIL_TAKEN', 'อีเมลนี้ถูกใช้สมัครไปแล้ว กรุณาเข้าสู่ระบบแทน');
  }
  if (fields.includes('phone')) {
    return ApiError.conflict('PHONE_TAKEN', 'เบอร์โทรศัพท์นี้ถูกใช้สมัครไปแล้ว กรุณาเข้าสู่ระบบแทน');
  }
  return ApiError.conflict('DUPLICATE', 'ข้อมูลซ้ำกับบัญชีที่มีอยู่แล้ว');
};

/**
 * สมัครสมาชิก — อีเมลใช้เป็นชื่อผู้ใช้หลัก ส่วนเบอร์โทรเก็บไว้ติดต่อและใช้ล็อกอินได้เหมือนกัน
 * สมัครเสร็จถือว่าล็อกอินให้เลย ผู้ใช้จะได้กลับไปจองที่นั่งต่อได้ทันทีโดยไม่ต้องกรอกซ้ำ
 */
export const register = async ({ name, email, phone, password, userAgent }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = requireThaiMobile(phone);

  // เช็กก่อนเพื่อให้ได้ข้อความที่ชี้ช่องถูก — ส่วน unique index ใน DB เป็นด่านสุดท้ายกันสมัครพร้อมกัน
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] },
    select: { email: true, phone: true },
  });
  if (existing) {
    throw duplicateFieldError(existing.email === normalizedEmail ? 'email' : 'phone');
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash: await hashPassword(password),
      },
    });
    return { ...(await issueSession(user, userAgent)), isNewUser: true };
  } catch (error) {
    if (error?.code === 'P2002') throw duplicateFieldError(error.meta?.target);
    throw error;
  }
};

/**
 * เข้าสู่ระบบด้วยอีเมลหรือเบอร์โทรศัพท์ก็ได้ — ดูจากว่ามี @ อยู่ในสิ่งที่กรอกมาหรือไม่
 * loginLookup ตัวเดียวกับที่ rate limit ใช้ทำกุญแจ (routes/auth.js) โควตาจึงนับตรงกับบัญชีที่ค้นเจอจริง
 */
export const login = async ({ identifier, password, userAgent }) => {
  const where = loginLookup(identifier);
  const user = where ? await prisma.user.findUnique({ where }) : null;
  // เทียบรหัสผ่านเสมอแม้ไม่เจอบัญชี เพื่อให้เวลาที่ใช้ตอบใกล้เคียงกันทุกกรณี
  const matched = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !matched) throw invalidCredentials();

  return await issueSession(user, userAgent);
};

export const issueSession = async (user, userAgent) => {
  const { token, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: refreshTokenExpiry(),
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
  return { user: publicUser(user), accessToken: signAccessToken(user), refreshToken: token };
};

/**
 * ใบที่เพิ่งถูก rotate ไปไม่เกินเท่านี้ ถือว่าเป็นคำขอที่ชนกันจากเบราว์เซอร์เดียวกัน ไม่ใช่ token ถูกขโมย
 * (เปิดหลายแท็บพร้อมกัน — ทุกแท็บส่ง cookie ใบเดียวกันมาต่ออายุในเสี้ยววินาทีเดียวกัน)
 * ตั้งไว้สั้นเพราะช่วงนี้เท่ากับช่วงที่ "การใช้ซ้ำ" ไม่ถูกนับเป็นการขโมย — คำขอที่ชนกันจริงห่างกันไม่ถึงวินาที
 */
const REFRESH_RACE_GRACE_MS = 10 * 1000;

/** ตอบให้ฝั่งเว็บรอแป๊บแล้วลองใหม่ — ถึงตอนนั้น cookie ในเบราว์เซอร์จะเป็นใบใหม่ที่อีกแท็บเพิ่งได้ไปแล้ว */
const refreshRace = () => {
  return ApiError.conflict('REFRESH_RACE', 'กำลังต่ออายุเซสชันจากอีกแท็บ กรุณาลองใหม่อีกครั้ง');
};

/**
 * ต่ออายุเซสชันแบบ rotate — ใบเก่าถูก revoke ทันทีที่ออกใบใหม่
 * ถ้ามีใครเอาใบที่ revoke แล้วมาใช้ซ้ำ = token ถูกขโมย → เพิกถอนทุกเซสชันของ user คนนั้น
 *
 * ยกเว้นใบที่เพิ่งถูก rotate ไปไม่กี่วินาที (REFRESH_RACE_GRACE_MS) ซึ่งตอบ 409 REFRESH_RACE แทน
 * ไม่ออกเซสชันใหม่ให้ — คนที่ถือใบเก่าจึงไม่ได้อะไรไป แต่ก็ไม่เตะเจ้าของออกจากทุกอุปกรณ์เพราะเปิดหลายแท็บ
 */
export const rotateSession = async (rawToken, userAgent) => {
  if (!rawToken) {
    throw ApiError.unauthorized('NO_REFRESH_TOKEN', 'ไม่พบเซสชัน กรุณาเข้าสู่ระบบใหม่');
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!stored) {
    throw ApiError.unauthorized('INVALID_REFRESH_TOKEN', 'เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }

  if (stored.revokedAt) {
    // มี replacedById = ถูก rotate ตามปกติ (ไม่ใช่ถูกเพิกถอนเพราะ logout/เปลี่ยนรหัส)
    const justRotated =
      stored.replacedById && Date.now() - stored.revokedAt.getTime() < REFRESH_RACE_GRACE_MS;
    if (justRotated) throw refreshRace();

    await revokeAllSessions(stored.userId);
    throw ApiError.unauthorized(
      'REFRESH_TOKEN_REUSED',
      'ตรวจพบการใช้เซสชันซ้ำ ระบบได้ออกจากระบบทุกอุปกรณ์เพื่อความปลอดภัย',
    );
  }

  if (stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized('REFRESH_TOKEN_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  const next = generateRefreshToken();
  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: next.tokenHash,
        expiresAt: refreshTokenExpiry(),
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
    // เพิกถอนใบเก่าได้ก็ต่อเมื่อยังไม่มีใครเพิกถอนไปก่อน — สองคำขอที่อ่านใบเดียวกันมาพร้อมกัน
    // จะได้ใบใหม่แค่คำขอเดียว อีกคำขอได้ REFRESH_RACE (ใบใหม่ที่สร้างไว้ถูก rollback ทิ้ง)
    const { count } = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: created.id },
    });
    if (count === 0) throw refreshRace();
  });

  return {
    user: publicUser(stored.user),
    accessToken: signAccessToken(stored.user),
    refreshToken: next.token,
  };
};

export const revokeSession = async (rawToken) => {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/**
 * เปลี่ยนรหัสผ่านด้วยตัวเอง — ต้องยืนยันรหัสเดิมก่อน
 * ถ้ามีใครขโมยเซสชันไปได้ จะได้ยึดบัญชีทั้งใบด้วยการเปลี่ยนรหัสไม่ได้
 *
 * เปลี่ยนสำเร็จแล้วเพิกถอนเซสชันอื่นทั้งหมด เหลือแค่เครื่องที่กำลังใช้อยู่
 * เพราะเหตุผลหลักที่คนเปลี่ยนรหัสคือสงสัยว่ารหัสรั่ว การไล่เครื่องอื่นออกจึงเป็นสิ่งที่คาดหวัง
 */
export const changePassword = async ({ userId, currentPassword, newPassword, keepToken }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('WRONG_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }

  // tokenVersion +1 = access token ทุกใบที่ออกก่อนหน้าใช้ไม่ได้ทันที
  // เครื่องที่กดเปลี่ยนเองได้ใบใหม่กลับไปในคำตอบเลย ไม่ต้องไปเจอ 401 ก่อน (refresh token ของเครื่องนี้ก็ยังใช้ได้ — keepToken)
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
  });

  await revokeAllSessions(userId, { except: keepToken });

  return { ok: true, accessToken: signAccessToken(updated) };
};

/**
 * ปิดอีเมลไว้บางส่วนตอนเอาไปแสดงบนหน้าเว็บ
 * คนที่ถือลิงก์จะได้ยืนยันว่าเป็นบัญชีของตัวเองจริง โดยที่ลิงก์หลุดไปก็ไม่ประกาศอีเมลเต็ม ๆ ให้คนอื่น
 */
export const maskEmail = (email) => {
  const [name = '', domain = ''] = String(email ?? '').split('@');
  const head = name.slice(0, 2);
  // จำนวนดาวคงที่ไม่เกิน 6 ตัว ไม่ได้ไล่ตามความยาวจริง — ความยาวอีเมลก็เป็นข้อมูลที่ไม่ต้องบอก
  const hidden = Math.min(Math.max(name.length - head.length, 1), 6);
  return `${head}${'*'.repeat(hidden)}@${domain}`;
};

/** ลิงก์ผิด/ถูกใช้ไปแล้ว ใช้ข้อความเดียวกัน — ไม่บอกคนที่เดา token ว่าเดาใกล้เคียงแค่ไหน */
const invalidResetLink = () => {
  return ApiError.badRequest(
    'RESET_LINK_INVALID',
    'ลิงก์ตั้งรหัสผ่านนี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่อีกครั้ง',
  );
};

const findLiveResetToken = async (rawToken) => {
  const token = String(rawToken ?? '');
  if (!token) throw invalidResetLink();

  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!stored || stored.usedAt) throw invalidResetLink();
  if (stored.expiresAt <= new Date()) {
    // แยกรหัสจากกรณีลิงก์ผิด เพราะ "หมดอายุ" ผู้ใช้แก้เองได้ด้วยการขอใหม่ ไม่ใช่ความผิดพลาดของเขา
    throw ApiError.badRequest(
      'RESET_LINK_EXPIRED',
      `ลิงก์ตั้งรหัสผ่านหมดอายุแล้ว (ลิงก์มีอายุ ${env.PASSWORD_RESET_TTL_MINUTES} นาที) กรุณาขอลิงก์ใหม่อีกครั้ง`,
    );
  }

  return stored;
};

/**
 * ขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล
 *
 * ตอบ ok เหมือนกันทุกครั้งไม่ว่าอีเมลนั้นจะมีบัญชีอยู่จริงหรือไม่
 * ไม่งั้นหน้านี้จะกลายเป็นเครื่องมือไล่เช็กว่าอีเมลไหนเป็นลูกค้าของเราบ้าง
 */
export const requestPasswordReset = async ({ email, lang, ip }) => {
  // ตอบเหมือนกันทุกกรณี รวมถึงอายุลิงก์ที่หน้าเว็บเอาไปบอกผู้ใช้ว่าต้องกดภายในกี่นาที
  const answer = { ok: true, ttlMinutes: env.PASSWORD_RESET_TTL_MINUTES };

  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) return answer;

  // 32 ไบต์สุ่ม = เดาไม่ได้ในทางปฏิบัติ · base64url ใส่ใน query string ได้โดยไม่ต้อง encode
  const token = crypto.randomBytes(32).toString('base64url');

  await prisma.$transaction([
    // ขอใบใหม่แล้วใบเก่าใช้ไม่ได้ทันที (และเป็นการเก็บกวาดใบที่หมดอายุไปในตัว)
    // คนที่กด "ส่งอีกครั้ง" จะได้ไม่ต้องเดาว่าต้องเปิดเมลฉบับไหน — ฉบับล่าสุดเสมอ
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
        requestIp: ip ?? null,
      },
    }),
  ]);

  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const { delivered } = await sendMail({
    to: user.email,
    ...passwordResetEmail({
      name: user.name,
      resetUrl,
      ttlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      lang,
    }),
  });

  // ตอนพัฒนาที่ยังไม่ได้ตั้ง SMTP ส่งลิงก์กลับไปให้หน้าเว็บด้วย จะได้ทดสอบจนจบขั้นตอนได้โดยไม่ต้องมีเมลเซิร์ฟเวอร์
  // เงื่อนไขผูกกับ NODE_ENV ด้วย ต่อให้ลืมตั้ง SMTP ตอนขึ้นจริง ลิงก์ก็ไม่หลุดออกไปทาง API
  const exposeLink = isDev && !isMailConfigured && !delivered;
  return { ...answer, ...(exposeLink && { devResetUrl: resetUrl }) };
};

/** ตรวจลิงก์ก่อนแสดงฟอร์ม ผู้ใช้จะได้ไม่ตั้งรหัสใหม่จนเสร็จแล้วค่อยมารู้ว่าลิงก์หมดอายุ */
export const checkResetToken = async (token) => {
  const stored = await findLiveResetToken(token);
  return {
    email: maskEmail(stored.user.email),
    name: stored.user.name,
    expiresAt: stored.expiresAt,
  };
};

/**
 * ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล
 *
 * เสร็จแล้วเพิกถอนเซสชันของบัญชีนั้น "ทุกเครื่อง" ไม่เว้นเครื่องไหนเลย
 * ต่างจากการเปลี่ยนรหัสเองที่หน้าโปรไฟล์ เพราะกรณีนี้คนตั้งรหัสยังไม่ได้ล็อกอิน
 * และเหตุผลที่ต้องรีเซ็ตมักเป็นเพราะบัญชีอาจถูกคนอื่นเข้าถึงอยู่
 */
export const resetPassword = async ({ token, password }) => {
  const stored = await findLiveResetToken(token);
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // ลำดับล็อก PasswordResetToken → User → RefreshToken ให้ตรงกับ updateProfile
  await prisma.$transaction(async (tx) => {
    // ลิงก์ใช้ได้ครั้งเดียวจริง ๆ — สองคำขอที่ถือลิงก์เดียวกันมาพร้อมกันผ่าน findLiveResetToken ได้ทั้งคู่
    // เงื่อนไข "ยังไม่ถูกใช้" อยู่ใน where จึงมีคำขอเดียวที่ปิดลิงก์ได้ อีกคำขอได้ข้อความเดียวกับลิงก์ที่ใช้ไปแล้ว
    // (เดิมทั้งสองคำขอตั้งรหัสสำเร็จทั้งคู่ คำขอที่ช้ากว่าเขียนทับรหัสของคำขอแรกโดยไม่มีใครรู้)
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) throw invalidResetLink();

    // ลิงก์อื่นของบัญชีนี้ที่ยังค้างอยู่ก็ใช้ไม่ได้อีก (ปกติไม่มี เพราะขอลิงก์ใหม่แล้วใบเก่าถูกลบ)
    await tx.passwordResetToken.updateMany({
      where: { userId: stored.userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.user.update({
      where: { id: stored.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await revokeAllSessions(stored.userId, { at: now, client: tx });
  });

  // คืนอีเมลเต็มให้หน้าเว็บเอาไปเติมในช่องล็อกอินต่อ — คนที่ถือลิงก์คือคนที่เปิดเมลฉบับนั้นได้อยู่แล้ว
  return { ok: true, email: stored.user.email };
};

/**
 * แก้ข้อมูลของตัวเอง — แก้ชื่ออย่างเดียวไม่ต้องยืนยันอะไร
 *
 * เปลี่ยนอีเมลต้องยืนยันรหัสผ่านปัจจุบันก่อน แบบเดียวกับการเปลี่ยนรหัสผ่าน เพราะอีเมลคือช่องทางกู้บัญชี (ลืมรหัสผ่าน)
 * ถ้าเปลี่ยนได้ด้วย access token อย่างเดียว คนที่ขโมยเซสชันไปได้จะเปลี่ยนเป็นอีเมลของตัวเอง
 * แล้วขอลิงก์ตั้งรหัสใหม่ ยึดบัญชีไปถาวร และการรีเซ็ตยังเตะเจ้าของตัวจริงออกจากทุกเครื่องด้วย
 */
export const updateProfile = async (userId, { name, email, currentPassword } = {}) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');

  const nextEmail = email === undefined ? undefined : normalizeEmail(email);
  const emailChanged = nextEmail !== undefined && nextEmail !== user.email;
  if (emailChanged) {
    if (!currentPassword) {
      throw ApiError.badRequest(
        'CURRENT_PASSWORD_REQUIRED',
        'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนอีเมล',
      );
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw ApiError.badRequest('WRONG_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
  }

  try {
    const results = await prisma.$transaction([
      // ลิงก์ตั้งรหัสผ่านที่ส่งไปอีเมลเดิมต้องใช้ไม่ได้อีก — ลบก่อนแก้ผู้ใช้ ตามลำดับล็อกเดียวกับ resetPassword
      ...(emailChanged ? [prisma.passwordResetToken.deleteMany({ where: { userId } })] : []),
      prisma.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined && { name }),
          ...(emailChanged && { email: nextEmail }),
        },
      }),
    ]);
    return publicUser(results.at(-1));
  } catch (error) {
    if (error?.code === 'P2002') throw duplicateFieldError(error.meta?.target);
    throw error;
  }
};
