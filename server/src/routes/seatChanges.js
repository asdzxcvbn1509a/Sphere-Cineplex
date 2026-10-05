import express from 'express';

// controllers
import { getSeatChange, uploadSeatChangeSlip, cancelSeatChange } from '../controllers/seatChanges.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { uploadPaymentSlip } from '../middleware/upload.js';

// สร้างคำขออยู่ที่ POST /api/bookings/:id/seat-changes — ไฟล์นี้คือขั้นถัดไปของคำขอที่ต้องโอนส่วนต่าง
const router = express.Router();
router.use(authenticate);

// @ENDPOINT http://localhost:4000/api/seat-changes/:id
router.get('/:id', getSeatChange);
// สลิปส่วนต่างใช้ middleware และโฟลเดอร์เดียวกับสลิปค่าตั๋ว (field ชื่อ slip, ตรวจไส้ในไฟล์)
// @ENDPOINT http://localhost:4000/api/seat-changes/:id/slip
router.post('/:id/slip', uploadPaymentSlip, uploadSeatChangeSlip);
// @ENDPOINT http://localhost:4000/api/seat-changes/:id/cancel
router.post('/:id/cancel', cancelSeatChange);

export default router;
