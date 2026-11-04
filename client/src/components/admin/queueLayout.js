/**
 * โครงหน้าคิวงานของผู้ดูแลแบบสามแผง (รายการ · สลิป · รายละเอียด) — ใช้ร่วมกันระหว่างหน้าตรวจสลิปและหน้าคืนเงิน
 * ค่าในไฟล์นี้ต้องเปลี่ยนไปด้วยกัน: breakpoint ของ QUEUE_GRID กับ STACKED_QUERY ต้องตรงกัน
 */

/** จอที่แผงเรียงลงมาแทนการวางสามคอลัมน์ (เล็กกว่า xl) — ใช้ตัดสินว่าต้องพาเลื่อนไปที่แผงสลิปไหม */
export const STACKED_QUERY = '(width < 80rem)';

/**
 * จอ xl: หน้าสูงพอดีจอใต้ header (h-16 + เส้นขอบ 1px) แต่ละแผงเลื่อนในตัวเอง ปุ่มยืนยันจึงอยู่ในจอเสมอ
 * min-h กันแผงเตี้ยจนใช้ไม่ได้บนจอเตี้ย (เช่นซูมเบราว์เซอร์) — ต่ำกว่านั้นปล่อยให้ทั้งหน้าเลื่อนแทน
 */
export const QUEUE_PAGE = 'flex flex-col gap-5 p-4 sm:p-6 xl:h-[calc(100dvh-4rem-1px)] xl:min-h-160';

/**
 * xl: รายการ · สลิป · รายละเอียด สามคอลัมน์ แถวเดียวสูงเท่าพื้นที่ที่เหลือ (grid-rows minmax(0,1fr) ไม่ให้เนื้อหาดันแถวสูงเกินจอ)
 * md–xl: รายการเต็มความกว้างด้านบน แล้วสลิปคู่รายละเอียด · มือถือ: เรียงลงมาทีละแผง
 */
export const QUEUE_GRID =
  'grid gap-4 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-[17rem_minmax(0,1fr)_22rem] xl:grid-rows-[minmax(0,1fr)] xl:gap-6';

/**
 * แผงสลิป — รูปหรือช่องแนบสลิปวาง absolute ให้เต็มแผงได้ทั้งตอนแผงสูงตามแถวของ grid (xl, md) และตอนสูงตาม min-h (มือถือ)
 * scroll-mt เว้นที่ใต้ header ตอนพาเลื่อนมาที่แผงนี้
 */
export const SLIP_PANEL = 'card relative min-h-112 scroll-mt-20 xl:min-h-0';

/** แผงรายละเอียด — เนื้อหาเลื่อนในแผงได้ ส่วนปุ่มอยู่ท้ายแผงเสมอ */
export const DETAIL_PANEL = 'card flex flex-col xl:min-h-0';
export const DETAIL_BODY = 'flex-1 p-5 xl:min-h-0 xl:overflow-y-auto';
export const DETAIL_FOOTER = 'flex shrink-0 flex-col gap-2 px-5 pb-5';

/** หัวข้อซ้าย ค่าชิดซ้ายถัดไป · overflow-wrap สืบทอดลงไป ชื่อหรือเลขยาว ๆ ตัดบรรทัดในช่องไม่ดันแผงให้กว้างขึ้น */
export const DETAIL_LIST = 'grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body-2 wrap-anywhere';
