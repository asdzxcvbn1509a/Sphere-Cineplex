/**
 * เลือกที่นั่งให้การจองตัวอย่าง — คนที่มาด้วยกันได้ที่นั่งติดกันในแถวเดียวกัน ค่อนไปทางกลางแถว
 * ใช้ทั้งตอนสุ่มยอดขาย (sales.js) และตอนหาที่นั่งว่างให้สถานการณ์ที่เรียก service จริง (scenarios.js)
 */

/** ที่นั่งที่ขายได้ของโรงหนึ่ง จัดกลุ่มเป็น zone → แถว → ที่นั่ง (เรียงตามเลข) — ที่นั่งที่ปิดใช้งานไม่อยู่ในผัง */
export const buildInventory = (seats) => {
  const zones = new Map();
  let total = 0;
  for (const seat of seats) {
    if (!seat.isActive) continue;
    if (!zones.has(seat.zone)) zones.set(seat.zone, new Map());
    const rows = zones.get(seat.zone);
    if (!rows.has(seat.rowLabel)) rows.set(seat.rowLabel, []);
    rows.get(seat.rowLabel).push(seat);
    total += 1;
  }
  for (const rows of zones.values()) {
    for (const row of rows.values()) row.sort((a, b) => a.seatNumber - b.seatNumber);
  }
  return { zones, total };
};

/** ช่วงที่นั่งว่างที่เลขติดกันในแถวเดียว */
const freeRuns = (row, taken) => {
  const runs = [];
  let run = [];
  for (const seat of row) {
    const breaks = taken.has(seat.id) || (run.length > 0 && seat.seatNumber !== run[run.length - 1].seatNumber + 1);
    if (breaks && run.length > 0) {
      runs.push(run);
      run = [];
    }
    if (!taken.has(seat.id)) run.push(seat);
  }
  if (run.length > 0) runs.push(run);
  return runs;
};

/**
 * เลือก count ที่นั่งในโซน zone ที่ยังไม่อยู่ใน taken — ติดกันและใกล้กลางแถวก่อน ไม่มีค่อยยอมนั่งแยกกัน
 * คืน null ถ้าโซนนั้นเหลือไม่พอ (ไม่แตะ taken — ผู้เรียกเป็นคนจองที่นั่งเอง)
 */
export const pickSeats = (inventory, taken, { zone, count, random }) => {
  const rows = inventory.zones.get(zone);
  if (!rows || count < 1) return null;

  let best = null;
  for (const row of rows.values()) {
    const center = (row[0].seatNumber + row[row.length - 1].seatNumber) / 2;
    for (const run of freeRuns(row, taken)) {
      for (let i = 0; i + count <= run.length; i += 1) {
        const block = run.slice(i, i + count);
        const middle = (block[0].seatNumber + block[count - 1].seatNumber) / 2;
        // สุ่มบวกเพิ่มนิดหน่อย ไม่งั้นทุกการจองไปกองที่กลางแถวหน้าสุดเหมือนกันหมด
        const score = Math.abs(middle - center) + random.next() * 4;
        if (!best || score < best.score) best = { block, score };
      }
    }
  }
  if (best) return best.block;

  const free = [...rows.values()].flat().filter((seat) => !taken.has(seat.id));
  if (free.length < count) return null;
  return random.shuffle(free).slice(0, count);
};

/** จำนวนที่นั่งที่ยังว่างในผัง */
export const freeCount = (inventory, taken) => {
  let count = 0;
  for (const rows of inventory.zones.values()) {
    for (const row of rows.values()) count += row.filter((seat) => !taken.has(seat.id)).length;
  }
  return count;
};
