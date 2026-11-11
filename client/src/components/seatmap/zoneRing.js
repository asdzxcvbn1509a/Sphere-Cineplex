/**
 * สีขอบบอกโซนในตัวแก้ผังที่นั่งของผู้ดูแล (ผังฝั่งลูกค้าใช้ zoneFill ด้านล่าง)
 * ไม่ใช้สีน้ำเงินกับโซนไหนเลย เพราะที่นั่งที่เลือกในตัวแก้ผังเป็นสีน้ำเงิน (รายการที่เลือกตาม DS)
 */
export const zoneRing = {
  NORMAL: 'border-line-strong',
  PREMIUM: 'border-cream-50',
  SOFA: 'border-accent/60',
};

/**
 * สีพื้นของที่นั่งว่างในผังฝั่งลูกค้า — โซนแพงขึ้นน้ำเงินเข้มขึ้น
 * ที่นั่งที่เลือกจึงเปลี่ยนเป็นขอบเขียวพื้นโปร่ง ไม่ให้ชนกับสีโซน
 */
export const zoneFill = {
  NORMAL: 'border-blue-40 bg-blue-40 text-cream-10',
  PREMIUM: 'border-blue-60 bg-blue-60 text-cream-10',
  SOFA: 'border-blue-100 bg-blue-100 text-cream-10',
};
