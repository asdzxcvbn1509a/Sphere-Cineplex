import * as bookingService from '../services/bookings.js';
import * as receiptService from '../services/receipts.js';
import * as seatChangeService from '../services/seatChanges.js';

// @ENDPOINT POST http://localhost:4000/api/bookings
export const createBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.createBooking({
      userId: req.user.id,
      ...req.body,
    });
    res.status(201).json({ booking });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings
export const listMyBookings = async (req, res, next) => {
  try {
    const bookings = await bookingService.listMyBookings(req.user.id, req.validatedQuery);
    res.json({ bookings });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings/:id
export const getBooking = async (req, res, next) => {
  try {
    // ผู้ดูแลเปิดการจองของลูกค้าได้ (หน้าเปลี่ยนที่นั่งแทนลูกค้า) — แบบเดียวกับใบเสร็จ
    const booking = await bookingService.getBookingById(req.params.id, {
      userId: req.user.role === 'ADMIN' ? undefined : req.user.id,
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings/:id/ticket
export const getTicket = async (req, res, next) => {
  try {
    const ticket = await bookingService.getTicket({
      bookingId: req.params.id,
      userId: req.user.id,
    });
    res.json({ ticket });
  } catch (error) {
    next(error);
  }
};

/** ใบเสร็จรับเงิน — เจ้าของการจอง หรือผู้ดูแล (เปิดดูของลูกค้าได้ทุกใบ) · ?payment= = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง */
// @ENDPOINT GET http://localhost:4000/api/bookings/:id/receipt
export const getReceipt = async (req, res, next) => {
  try {
    const receipt = await receiptService.getReceipt({
      bookingId: req.params.id,
      paymentId: req.validatedQuery.payment,
      requester: req.user,
    });
    res.json({ receipt });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/bookings/:id/cancel
export const cancelBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.cancelBooking({
      bookingId: req.params.id,
      userId: req.user.id,
      reason: req.body.reason,
      refundAccount: {
        bankName: req.body.refundBankName,
        accountNo: req.body.refundAccountNo,
      },
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

/** แจ้ง/แก้บัญชีรับเงินคืน สำหรับใบที่รอโอนคืนอยู่ */
// @ENDPOINT PATCH http://localhost:4000/api/bookings/:id/refund-account
export const updateRefundAccount = async (req, res, next) => {
  try {
    const booking = await bookingService.updateRefundAccount({
      bookingId: req.params.id,
      userId: req.user.id,
      bankName: req.body.refundBankName,
      accountNo: req.body.refundAccountNo,
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

/** ขอเปลี่ยนที่นั่ง — ราคาเท่าเดิม/ถูกลงย้ายทันที · แพงขึ้นได้คำขอที่รอโอนส่วนต่าง (seatChange.status = PENDING_PAYMENT) */
// @ENDPOINT POST http://localhost:4000/api/bookings/:id/seat-changes
export const requestSeatChange = async (req, res, next) => {
  try {
    const result = await seatChangeService.requestSeatChange({
      bookingId: req.params.id,
      userId: req.user.id,
      seatIds: req.body.seatIds,
      refundAccount: {
        bankName: req.body.refundBankName,
        accountNo: req.body.refundAccountNo,
      },
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
