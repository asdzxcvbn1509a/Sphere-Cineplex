/**
 * ตัวสุ่มแบบกำหนด seed ได้ (mulberry32) — รัน seed กี่ครั้งก็ได้ข้อมูลหน้าตาเดิม
 * ที่ต่างกันมีแค่เวลา (อิงจากวันที่รัน) กับรหัสการจอง/เลขอ้างอิงที่ระบบสุ่มเองตามปกติ
 * จะได้เทียบผลก่อน/หลังแก้โค้ดได้ และบั๊กที่เจอจากข้อมูลชุดหนึ่งเรียกซ้ำได้
 */
export const createRandom = (seed = 20261105) => {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** จำนวนเต็มในช่วง [min, max] รวมปลายทั้งสองข้าง */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));

  const pick = (items) => items[Math.floor(next() * items.length)];

  const chance = (probability) => next() < probability;

  /** สุ่มตามน้ำหนัก — weightOf คืนค่า ≥ 0 (0 = ไม่มีสิทธิ์ถูกเลือก) */
  const weighted = (items, weightOf) => {
    const weights = items.map(weightOf);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return undefined;
    let roll = next() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  };

  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  return { next, int, pick, chance, weighted, shuffle };
};
