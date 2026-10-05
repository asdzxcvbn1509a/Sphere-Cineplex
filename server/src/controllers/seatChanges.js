import * as seatChangeService from '../services/seatChanges.js';

/** คำขอเปลี่ยนที่นั่ง + ข้อมูลชำระส่วนต่าง (QR, เวลาที่เหลือ) — เจ้าของการจองหรือผู้ดูแล */
// @ENDPOINT GET http://localhost:4000/api/seat-changes/:id
export const getSeatChange = async (req, res, next) => {
  try {
    const seatChange = await seatChangeService.getSeatChange({
      seatChangeId: req.params.id,
      requester: req.user,
    });
    res.json({ seatChange });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/seat-changes/:id/slip
export const uploadSeatChangeSlip = async (req, res, next) => {
  try {
    const seatChange = await seatChangeService.uploadSeatChangeSlip({
      seatChangeId: req.params.id,
      userId: req.user.id,
      file: req.file,
    });
    res.status(201).json({ seatChange });
  } catch (error) {
    next(error);
  }
};

/** ลูกค้ายกเลิกคำขอที่ยังไม่ได้ส่งสลิปส่วนต่าง — ที่นั่งเดิมไม่ได้แตะ */
// @ENDPOINT POST http://localhost:4000/api/seat-changes/:id/cancel
export const cancelSeatChange = async (req, res, next) => {
  try {
    const seatChange = await seatChangeService.cancelSeatChange({
      seatChangeId: req.params.id,
      userId: req.user.id,
    });
    res.json({ seatChange });
  } catch (error) {
    next(error);
  }
};
