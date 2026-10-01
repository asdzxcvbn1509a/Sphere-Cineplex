import express from 'express';

// controllers
import { getPayment, uploadSlip, getSlipImage, getRefundSlipImage } from '../controllers/payments.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { uploadPaymentSlip } from '../middleware/upload.js';

const router = express.Router();
router.use(authenticate);

// @ENDPOINT http://localhost:4000/api/payments/:bookingId
router.get('/:bookingId', getPayment);
// @ENDPOINT http://localhost:4000/api/payments/:bookingId/slip
router.post('/:bookingId/slip', uploadPaymentSlip, uploadSlip);
router.get('/:bookingId/slip', getSlipImage);
// @ENDPOINT http://localhost:4000/api/payments/:bookingId/refund-slip
router.get('/:bookingId/refund-slip', getRefundSlipImage);

export default router;
