/**
 * ข้อมูลตั้งต้นของ seed: ผู้ใช้ ภาพยนตร์ และโรง
 * วันที่ทุกตัวนับจากวันที่รัน seed (releaseInDays = วันฉายวันแรก เทียบกับวันนี้ตามเวลาไทย)
 * รันซ้ำเดือนไหนข้อมูลก็ยังสมเหตุสมผล — หนัง "เร็ว ๆ นี้" ไม่กลายเป็นหนังที่วันเข้าฉายผ่านไปแล้ว
 *
 * ฟิลด์ที่ไม่ใช่คอลัมน์ (releaseInDays, lastShowInDays, popularity, formats, ...) seed.js ตัดออกก่อนบันทึก
 */

const poster = (slug) => `https://picsum.photos/seed/${slug}/400/600`;
const backdrop = (slug) => `https://picsum.photos/seed/${slug}-bd/1280/720`;

// ---------- ผู้ใช้ ----------

/** ผู้ดูแลสองคน — คิวตรวจสลิปและคิวคืนเงินจะเห็นว่าใครเป็นคนตรวจ/โอนคืน */
export const ADMINS = [
  { key: 'admin', email: 'admin@cinebook.test', phone: '0800000000', name: 'ผู้ดูแลระบบ', joinedDaysAgo: 200 },
  { key: 'staff', email: 'staff@cinebook.test', phone: '0800000001', name: 'วรรณา ศรีสุข', joinedDaysAgo: 90 },
];

/**
 * ลูกค้า — activity คือน้ำหนักตอนสุ่มว่าใครเป็นคนจอง (0 = ยังไม่เคยจองเลย)
 * somchai คือบัญชีตัวอย่างใน README จึงถูกกำหนดให้มีการจองครบทุกแท็บด้วย (ดู scenarios.js)
 */
export const CUSTOMERS = [
  // น้ำหนักต่ำ — ใบส่วนใหญ่ของ somchai มาจากสถานการณ์ที่กำหนดไว้แล้ว หน้าการจองของฉันจะได้ไม่ยาวจนไล่ดูไม่ไหว
  { key: 'somchai', email: 'somchai@example.test', phone: '0891234567', name: 'สมชาย ใจดี', joinedDaysAgo: 150, activity: 0.4 },
  { key: 'somying', email: 'somying@example.test', phone: '0812345671', name: 'สมหญิง รักสงบ', joinedDaysAgo: 140, activity: 3 },
  { key: 'nattawut', email: 'nattawut@example.test', phone: '0823456712', name: 'ณัฐวุฒิ แสงทอง', joinedDaysAgo: 120, activity: 2 },
  { key: 'piyanuch', email: 'piyanuch@example.test', phone: '0834567123', name: 'ปิยะนุช วงศ์ใหญ่', joinedDaysAgo: 110, activity: 2 },
  { key: 'thanakorn', email: 'thanakorn@example.test', phone: '0845671234', name: 'ธนากร บุญมา', joinedDaysAgo: 96, activity: 2 },
  { key: 'kamonchanok', email: 'kamonchanok@example.test', phone: '0856712345', name: 'กมลชนก ศรีสวัสดิ์', joinedDaysAgo: 88, activity: 1.5 },
  { key: 'weerapong', email: 'weerapong@example.test', phone: '0867123456', name: 'วีระพงษ์ ทองดี', joinedDaysAgo: 75, activity: 1.5 },
  { key: 'onuma', email: 'onuma@example.test', phone: '0871234560', name: 'อรอุมา จันทร์เพ็ญ', joinedDaysAgo: 64, activity: 1 },
  { key: 'panuwat', email: 'panuwat@example.test', phone: '0912345678', name: 'ภาณุวัฒน์ มีสุข', joinedDaysAgo: 58, activity: 1 },
  { key: 'siriporn', email: 'siriporn@example.test', phone: '0923456781', name: 'ศิริพร แก้วมณี', joinedDaysAgo: 51, activity: 1 },
  { key: 'chayapon', email: 'chayapon@example.test', phone: '0934567812', name: 'ชยพล ประเสริฐ', joinedDaysAgo: 43, activity: 1 },
  { key: 'nanthida', email: 'nanthida@example.test', phone: '0945678123', name: 'นันทิดา พรหมมา', joinedDaysAgo: 37, activity: 0.8 },
  { key: 'malee', email: 'malee@example.test', phone: '0956781234', name: 'มาลี สุขใจ', joinedDaysAgo: 30, activity: 0.6 },
  { key: 'emily', email: 'emily.carter@example.test', phone: '0967812345', name: 'Emily Carter', joinedDaysAgo: 26, activity: 0.8 },
  { key: 'kenji', email: 'kenji.tanaka@example.test', phone: '0978123456', name: 'Kenji Tanaka', joinedDaysAgo: 22, activity: 0.5 },
  // สมัครแล้วยังไม่เคยจอง — หน้าการจองของฉันว่างทุกแท็บ หน้าผู้ใช้ของผู้ดูแลเห็นบัญชีใหม่
  { key: 'paweena', email: 'paweena@example.test', phone: '0612345678', name: 'ปวีณา นาคสวัสดิ์', joinedDaysAgo: 2, activity: 0 },
];

/** ชื่อธนาคารตามรายการใน client/src/utils/banks.js (เก็บเป็นชื่อภาษาไทยแบบเดียวกับที่หน้าเว็บส่งมา) */
export const REFUND_BANKS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรีอยุธยา', 'ออมสิน'];

// ---------- ภาพยนตร์ ----------

/**
 * popularity = น้ำหนักตอนจัดรอบและตอนสุ่มยอดขาย · formats = ระบบฉายที่หนังเรื่องนี้ลงได้
 * lastShowInDays = วันสุดท้ายที่มีรอบ (เฉพาะหนังที่เลิกฉายแล้ว)
 */
export const MOVIES = [
  {
    titleTh: 'ฤดูฝนที่หายไป',
    titleEn: 'The Vanished Monsoon',
    synopsisTh:
      'เรื่องราวของช่างภาพสารคดีที่กลับบ้านเกิดในหน้าฝน แล้วพบว่าหมู่บ้านทั้งหมู่บ้านจำเธอไม่ได้ ระหว่างตามหาคำตอบ เธอค่อย ๆ ค้นพบความลับที่ครอบครัวเก็บงำมานานยี่สิบปี',
    synopsisEn:
      'A documentary photographer returns to her hometown during the rainy season to find that no one remembers her. Her search for answers unearths a secret her family buried twenty years ago.',
    posterUrl: poster('monsoon'),
    backdropUrl: backdrop('monsoon'),
    durationMin: 118,
    rating: 'PG13',
    genres: ['ดราม่า', 'ลึกลับ'],
    status: 'NOW_SHOWING',
    releaseInDays: -40,
    popularity: 1,
    formats: ['2D'],
  },
  {
    titleTh: 'ล่าข้ามมิติ',
    titleEn: 'Rift Runner',
    synopsisTh:
      'นักวิ่งส่งของในกรุงเทพฯ ปี 2078 บังเอิญได้ครอบครองอุปกรณ์ที่เปิดรอยแยกระหว่างมิติ เขามีเวลา 12 ชั่วโมงในการส่งของชิ้นสุดท้าย ก่อนที่เมืองทั้งเมืองจะถูกกลืนหายไป',
    synopsisEn:
      'A courier in 2078 Bangkok stumbles upon a device that tears open the space between worlds. He has twelve hours to complete one last delivery before the city collapses into the rift.',
    posterUrl: poster('rift'),
    backdropUrl: backdrop('rift'),
    durationMin: 132,
    rating: 'PG13',
    genres: ['ไซไฟ', 'แอ็คชั่น'],
    status: 'NOW_SHOWING',
    releaseInDays: -26,
    popularity: 2.2,
    formats: ['2D', '3D', 'IMAX', '4DX'],
  },
  {
    titleTh: 'บ้านเลขที่ 13',
    titleEn: 'House No. 13',
    synopsisTh:
      'ครอบครัวหนึ่งย้ายเข้าบ้านเช่าราคาถูกผิดปกติในซอยเปลี่ยว คืนแรกที่ย้ายเข้า เสียงเคาะประตูดังขึ้นสิบสามครั้งตรงเวลาเที่ยงคืน และดังต่อเนื่องทุกคืนไม่มีขาด',
    synopsisEn:
      'A family moves into a suspiciously cheap rental house. On the first night, thirteen knocks land on the door at exactly midnight — and every night after that.',
    posterUrl: poster('house13'),
    backdropUrl: backdrop('house13'),
    durationMin: 105,
    rating: 'N15',
    genres: ['สยองขวัญ', 'ระทึกขวัญ'],
    status: 'NOW_SHOWING',
    releaseInDays: -19,
    popularity: 1.6,
    formats: ['2D', '4DX'],
  },
  {
    titleTh: 'รักครั้งสุดท้ายที่เชียงคาน',
    titleEn: 'Last Love in Chiang Khan',
    synopsisTh:
      'ชายหนุ่มผู้สูญเสียความทรงจำระยะสั้นเดินทางไปเชียงคานทุกปีเพื่อตามหาใครบางคนที่เขาจำหน้าไม่ได้ แต่จำความรู้สึกได้ทุกครั้ง',
    synopsisEn:
      'A young man with short-term memory loss travels to Chiang Khan every year, searching for someone whose face he cannot recall but whose presence he always feels.',
    posterUrl: poster('chiangkhan'),
    backdropUrl: backdrop('chiangkhan'),
    durationMin: 112,
    rating: 'G',
    genres: ['โรแมนติก', 'ดราม่า'],
    status: 'NOW_SHOWING',
    releaseInDays: -54,
    popularity: 0.8,
    formats: ['2D'],
  },
  {
    titleTh: 'ปฏิบัติการล่าฝัน',
    titleEn: 'Operation Daydream',
    synopsisTh:
      'พนักงานออฟฟิศสี่คนตัดสินใจลาออกพร้อมกันเพื่อเปิดร้านก๋วยเตี๋ยวเรือ แต่ทำเลที่เลือกดันอยู่ตรงข้ามร้านของอดีตเจ้านาย',
    synopsisEn:
      'Four office workers quit on the same day to open a boat-noodle shop — directly across the street from their former boss.',
    posterUrl: poster('daydream'),
    backdropUrl: backdrop('daydream'),
    durationMin: 98,
    rating: 'G',
    genres: ['ตลก', 'ฟีลกู๊ด'],
    status: 'NOW_SHOWING',
    releaseInDays: -33,
    popularity: 1.2,
    formats: ['2D'],
  },
  {
    titleTh: 'ว่าวกระดาษของมะลิ',
    titleEn: "Mali's Paper Kite",
    synopsisTh:
      'เด็กหญิงมะลิทำว่าวจากจดหมายเก่าของพ่อที่จากไป ว่าวตัวนั้นพาเธอลอยข้ามทุ่งนาไปสู่ดินแดนที่ทุกถ้อยคำซึ่งไม่เคยได้พูดออกมากลายเป็นนก',
    synopsisEn:
      "Young Mali folds a kite from her late father's old letters. It carries her over the rice fields into a land where every word left unsaid has turned into a bird.",
    posterUrl: poster('paperkite'),
    backdropUrl: backdrop('paperkite'),
    durationMin: 94,
    rating: 'G',
    genres: ['แอนิเมชัน', 'ครอบครัว'],
    status: 'NOW_SHOWING',
    releaseInDays: -12,
    popularity: 1.4,
    formats: ['2D', '3D'],
  },
  {
    titleTh: 'บัญชีเงา',
    titleEn: 'Shadow Ledger',
    synopsisTh:
      'พนักงานบัญชีธรรมดาพบว่าเงินสามพันล้านบาทถูกโยกผ่านบัญชีในชื่อของเธอทุกคืนตอนตีสาม เมื่อเธอเริ่มสืบ คนที่รู้ความลับเดียวกันก็เริ่มหายตัวไปทีละคน',
    synopsisEn:
      'An ordinary accountant discovers that three billion baht moves through an account in her name every night at 3 a.m. Once she starts digging, everyone else who knows the secret begins to disappear.',
    posterUrl: poster('ledger'),
    backdropUrl: backdrop('ledger'),
    durationMin: 127,
    rating: 'N18',
    genres: ['อาชญากรรม', 'ระทึกขวัญ'],
    status: 'NOW_SHOWING',
    // เพิ่งเข้าฉายสัปดาห์นี้ — รายงานรายวันเห็นหนังใหม่เริ่มขายกลางช่วง
    releaseInDays: -4,
    popularity: 1.5,
    formats: ['2D', 'IMAX'],
  },
  {
    titleTh: 'เพลงรักเยาวราช',
    titleEn: 'Yaowarat Serenade',
    synopsisTh:
      'นักร้องร้านอาหารริมถนนเยาวราชกับนักเปียโนคลาสสิกที่เพิ่งตกงาน ต้องร่วมวงกันเพื่อชิงเงินรางวัลประกวดดนตรีที่จะช่วยร้านเก่าแก่ของอาม่าไม่ให้ถูกรื้อ',
    synopsisEn:
      "A street-food singer from Yaowarat and an out-of-work classical pianist team up for a music contest whose prize could save Grandma's old restaurant from demolition.",
    posterUrl: poster('yaowarat'),
    backdropUrl: backdrop('yaowarat'),
    durationMin: 121,
    rating: 'PG13',
    genres: ['เพลง', 'โรแมนติก'],
    status: 'NOW_SHOWING',
    releaseInDays: -22,
    popularity: 0.9,
    formats: ['2D'],
  },
  {
    titleTh: 'ยกสุดท้าย',
    titleEn: 'The Final Round',
    synopsisTh:
      'อดีตนักมวยไทยวัยสี่สิบกลับขึ้นเวทีอีกครั้งเพื่อหาเงินรักษาลูกสาว คู่ชกของเขาคือลูกศิษย์ที่เขาเคยทิ้งไว้กลางทางเมื่อสิบปีก่อน',
    synopsisEn:
      'A forty-year-old former Muay Thai fighter steps back into the ring to pay for his daughter’s treatment. His opponent is the student he walked out on ten years ago.',
    posterUrl: poster('finalround'),
    backdropUrl: backdrop('finalround'),
    durationMin: 116,
    rating: 'PG13',
    genres: ['กีฬา', 'ดราม่า'],
    status: 'NOW_SHOWING',
    releaseInDays: -9,
    popularity: 1.1,
    formats: ['2D'],
  },
  {
    titleTh: 'ตำนานนาคี ภาค 4',
    titleEn: 'Naga Legend IV',
    synopsisTh:
      'บทสรุปของตำนานพญานาคแห่งลุ่มน้ำโขง เมื่อคำสาบานเมื่อสามร้อยปีก่อนถูกทวงคืนในคืนวันออกพรรษา',
    synopsisEn:
      'The finale of the Mekong naga saga, as a three-hundred-year-old oath comes due on the night of the end of Buddhist Lent.',
    posterUrl: poster('naga'),
    backdropUrl: backdrop('naga'),
    durationMin: 140,
    rating: 'PG13',
    genres: ['แฟนตาซี', 'ผจญภัย'],
    // หนังภาคต่อที่คนรอ — ยังไม่เปิดขาย (หน้าเว็บไม่ขายบัตรหนัง COMING_SOON) จึงไม่มีรอบ
    status: 'COMING_SOON',
    releaseInDays: 8,
    popularity: 2,
    formats: ['2D', '3D', 'IMAX', '4DX'],
  },
  {
    titleTh: 'สัญญาณจากดาวอังคาร',
    titleEn: 'Signal from Mars',
    synopsisTh:
      'นักดาราศาสตร์สมัครเล่นบนดอยอินทนนท์รับสัญญาณวิทยุจากดาวอังคาร ซึ่งกลายเป็นเสียงของเธอเองที่กำลังเตือนถึงเรื่องที่ยังไม่เกิดขึ้น',
    synopsisEn:
      "An amateur astronomer on Doi Inthanon picks up a radio signal from Mars — in her own voice, warning her about something that hasn't happened yet.",
    posterUrl: poster('marssignal'),
    backdropUrl: backdrop('marssignal'),
    durationMin: 109,
    rating: 'PG13',
    genres: ['ไซไฟ', 'ลึกลับ'],
    status: 'COMING_SOON',
    releaseInDays: 12,
    popularity: 1,
    formats: ['2D', 'IMAX'],
  },
  {
    titleTh: 'ภารกิจลับของคุณยายวัยเก้าสิบ',
    titleEn: "Grandma's Secret Mission",
    synopsisTh:
      'คุณยายวัยเก้าสิบแอบหนีออกจากบ้านพักคนชราพร้อมเพื่อนอีกสามคน เพื่อไปทวงสูตรน้ำพริกที่ถูกขโมยไปเมื่อหกสิบปีก่อน',
    synopsisEn:
      'A ninety-year-old grandmother sneaks out of her care home with three friends to reclaim the chili-paste recipe that was stolen from her sixty years ago.',
    posterUrl: poster('grandma'),
    // ไม่มีรูปพื้นหลัง — หน้ารายละเอียดหนังต้องแสดงได้ทั้งแบบมีและไม่มี
    backdropUrl: null,
    durationMin: 101,
    rating: 'G',
    genres: ['ตลก', 'ครอบครัว'],
    status: 'COMING_SOON',
    releaseInDays: 26,
    popularity: 1,
    formats: ['2D'],
  },
  {
    titleTh: 'ทะเลไม่เคยหลับ',
    titleEn: 'The Sleepless Sea',
    synopsisTh:
      'สารคดีติดตามชาวประมงพื้นบ้านฝั่งอันดามันตลอดหนึ่งปี ตั้งแต่มรสุมลูกแรกจนถึงคืนที่ฝูงหมึกกลับมาที่อ่าว',
    synopsisEn:
      'A documentary that follows the small-boat fishers of the Andaman coast for a year, from the first monsoon to the night the squid return to the bay.',
    posterUrl: poster('sleeplesssea'),
    backdropUrl: backdrop('sleeplesssea'),
    durationMin: 86,
    rating: 'G',
    genres: ['สารคดี'],
    // เลิกฉายแล้ว — ไม่ขึ้นหน้าแรก แต่ยังอยู่ในรายงานยอดขายย้อนหลังและประวัติการจอง
    status: 'ARCHIVED',
    releaseInDays: -60,
    lastShowInDays: -7,
    popularity: 0.5,
    formats: ['2D'],
  },
  {
    titleTh: 'ป้อมสุดท้ายแห่งกรุงศรี',
    titleEn: 'The Last Fort of Ayutthaya',
    synopsisTh:
      'ทหารเลวสิบสองนายได้รับคำสั่งให้รักษาป้อมดินริมแม่น้ำไว้หนึ่งคืน เพื่อซื้อเวลาให้ชาวบ้านหนีออกจากเมือง เรื่องแต่งที่อิงบรรยากาศช่วงปลายกรุงศรีอยุธยา',
    synopsisEn:
      'Twelve foot soldiers are ordered to hold a riverside earthwork for a single night so the townsfolk can escape. A fictional story set in the last days of Ayutthaya.',
    posterUrl: poster('lastfort'),
    backdropUrl: backdrop('lastfort'),
    // หนังยาวเกือบสามชั่วโมง — ตารางรอบต้องเว้นที่ให้พอ
    durationMin: 168,
    rating: 'N15',
    genres: ['ประวัติศาสตร์', 'แอ็คชั่น'],
    status: 'ARCHIVED',
    releaseInDays: -70,
    lastShowInDays: -5,
    popularity: 1,
    formats: ['2D', 'IMAX'],
  },
];

// ---------- โรงภาพยนตร์ ----------

/**
 * basePrice = ราคาโซนธรรมดาก่อนปรับตามวัน/เวลา (ดู schedule.js) · opensAt = รอบแรกของวันเริ่มได้ตั้งแต่กี่โมง
 * brokenSeats = ที่นั่งชำรุดที่ปิดใช้งานไว้ · closedFromDay = ปิดใช้งานตั้งแต่วันไหน (มีแต่รอบย้อนหลัง)
 */
export const THEATRES = [
  { name: 'โรงที่ 1', screenType: '2D', rowsCount: 8, colsCount: 12, basePrice: 180, opensAt: [10, 0], brokenSeats: ['C5', 'C6'] },
  { name: 'โรงที่ 2', screenType: '3D', rowsCount: 7, colsCount: 14, basePrice: 220, opensAt: [10, 30] },
  { name: 'โรงที่ 3 (IMAX)', screenType: 'IMAX', rowsCount: 10, colsCount: 16, basePrice: 300, opensAt: [11, 0], brokenSeats: ['A1'] },
  { name: 'โรงที่ 4 (4DX)', screenType: '4DX', rowsCount: 6, colsCount: 10, basePrice: 380, opensAt: [11, 30] },
  { name: 'โรงที่ 5', screenType: '2D', rowsCount: 12, colsCount: 18, basePrice: 160, opensAt: [10, 15] },
  // ปิดปรับปรุง — ลบไม่ได้เพราะมีประวัติการจอง จึงปิดใช้งานแทน (ลงรอบใหม่ไม่ได้)
  { name: 'โรงที่ 6', screenType: '2D', rowsCount: 6, colsCount: 10, basePrice: 160, opensAt: [10, 45], isActive: false, closedFromDay: -4 },
];
