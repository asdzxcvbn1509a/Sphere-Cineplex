import * as paymentService from '../services/payments.js';

// @ENDPOINT GET http://localhost:4000/api/payments/:bookingId
export const getPayment = async (req, res, next) => {
  try {
    const payment = await paymentService.getPaymentForBooking({
      bookingId: req.params.bookingId,
      userId: req.user.id,
    });
    res.json({ payment });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/payments/:bookingId/slip
export const uploadSlip = async (req, res, next) => {
  try {
    const payment = await paymentService.uploadSlip({
      bookingId: req.params.bookingId,
      userId: req.user.id,
      file: req.file,
    });
    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
};

/** รูปสลิป — เจ้าของการจองหรือ admin เท่านั้น (client ดึงเป็น blob พร้อม auth header) */
// @ENDPOINT GET http://localhost:4000/api/payments/:bookingId/slip
export const getSlipImage = async (req, res, next) => {
  try {
    const filePath = await paymentService.getSlipFilePath({
      bookingId: req.params.bookingId,
      requester: req.user,
    });
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
};

/** สลิปคืนเงิน — เจ้าของการจองหรือ admin เท่านั้น */
// @ENDPOINT GET http://localhost:4000/api/payments/:bookingId/refund-slip
export const getRefundSlipImage = async (req, res, next) => {
  try {
    const filePath = await paymentService.getRefundSlipFilePath({
      bookingId: req.params.bookingId,
      requester: req.user,
    });
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
};