import express from 'express';
import { z } from 'zod';

// controllers
import { getPayment, uploadSlip, getSlipImage, getRefundSlipImage } from '../controllers/payments.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { uploadPaymentSlip } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();
router.use(authenticate);

// ?payment= = รายการส่วนต่างเปลี่ยนที่นั่งของการจองนี้ (ไม่ส่ง = ใบหลัก ค่าตั๋วตอนจอง)
const slipQuerySchema = z.object({
  payment: z.string().min(1).optional(),
});

// @ENDPOINT http://localhost:4000/api/payments/:bookingId
router.get('/:bookingId', getPayment);
// @ENDPOINT http://localhost:4000/api/payments/:bookingId/slip
router.post('/:bookingId/slip', uploadPaymentSlip, uploadSlip);
router.get('/:bookingId/slip', validate({ query: slipQuerySchema }), getSlipImage);
// @ENDPOINT http://localhost:4000/api/payments/:bookingId/refund-slip
router.get('/:bookingId/refund-slip', validate({ query: slipQuerySchema }), getRefundSlipImage);

export default router;
