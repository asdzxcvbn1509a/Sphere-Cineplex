using CineBook.Web.Models.Entities;

namespace CineBook.Web.Seed;

/// <summary>ผู้ใช้ตัวอย่าง — Activity คือน้ำหนักตอนสุ่มว่าใครเป็นคนจอง (0 = ยังไม่เคยจองเลย)</summary>
public sealed record SeedPerson(string Key, string Email, string Phone, string Name, int JoinedDaysAgo, double Activity = 0);

/// <summary>
/// ภาพยนตร์ตัวอย่าง — Popularity = น้ำหนักตอนจัดรอบและตอนสุ่มยอดขาย · Formats = ระบบฉายที่หนังเรื่องนี้ลงได้
/// LastShowInDays = วันสุดท้ายที่มีรอบ (เฉพาะหนังที่เลิกฉายแล้ว)
/// </summary>
public sealed record SeedMovieData(
    string TitleTh,
    string TitleEn,
    string SynopsisTh,
    string SynopsisEn,
    string PosterUrl,
    string? BackdropUrl,
    int DurationMin,
    string Rating,
    string[] Genres,
    MovieStatus Status,
    int ReleaseInDays,
    double Popularity,
    string[] Formats,
    int? LastShowInDays = null);

/// <summary>
/// BasePrice = ราคาโซนธรรมดาก่อนปรับตามวัน/เวลา (ดู SeedSchedule) · OpensAt = รอบแรกของวันเริ่มได้ตั้งแต่กี่โมง
/// BrokenSeats = ที่นั่งชำรุดที่ปิดใช้งานไว้ · ClosedFromDay = ปิดใช้งานตั้งแต่วันไหน (มีแต่รอบย้อนหลัง)
/// </summary>
public sealed record SeedTheatreData(
    string Name,
    string ScreenType,
    int RowsCount,
    int ColsCount,
    int BasePrice,
    (int Hour, int Minute) OpensAt,
    string[]? BrokenSeats = null,
    bool IsActive = true,
    int? ClosedFromDay = null);

/// <summary>
/// ข้อมูลตั้งต้นของ seed: ผู้ใช้ ภาพยนตร์ และโรง (port จาก prisma/seed/catalog.js)
/// วันที่ทุกตัวนับจากวันที่รัน seed (ReleaseInDays = วันฉายวันแรก เทียบกับวันนี้ตามเวลาไทย)
/// รันซ้ำเดือนไหนข้อมูลก็ยังสมเหตุสมผล — หนัง "เร็ว ๆ นี้" ไม่กลายเป็นหนังที่วันเข้าฉายผ่านไปแล้ว
/// </summary>
public static class SeedCatalog
{
    private static string Poster(string slug) => $"https://picsum.photos/seed/{slug}/400/600";

    private static string Backdrop(string slug) => $"https://picsum.photos/seed/{slug}-bd/1280/720";

    /// <summary>ผู้ดูแลสองคน — คิวตรวจสลิปและคิวคืนเงินจะเห็นว่าใครเป็นคนตรวจ/โอนคืน</summary>
    public static readonly SeedPerson[] Admins =
    [
        new("admin", "admin@cinebook.test", "0800000000", "ผู้ดูแลระบบ", 200),
        new("staff", "staff@cinebook.test", "0800000001", "วรรณา ศรีสุข", 90),
    ];

    /// <summary>somchai คือบัญชีตัวอย่างใน README จึงถูกกำหนดให้มีการจองครบทุกแท็บด้วย (ดู SeedScenarios)</summary>
    public static readonly SeedPerson[] Customers =
    [
        // น้ำหนักต่ำ — ใบส่วนใหญ่ของ somchai มาจากสถานการณ์ที่กำหนดไว้แล้ว หน้าการจองของฉันจะได้ไม่ยาวจนไล่ดูไม่ไหว
        new("somchai", "somchai@example.test", "0891234567", "สมชาย ใจดี", 150, 0.4),
        new("somying", "somying@example.test", "0812345671", "สมหญิง รักสงบ", 140, 3),
        new("nattawut", "nattawut@example.test", "0823456712", "ณัฐวุฒิ แสงทอง", 120, 2),
        new("piyanuch", "piyanuch@example.test", "0834567123", "ปิยะนุช วงศ์ใหญ่", 110, 2),
        new("thanakorn", "thanakorn@example.test", "0845671234", "ธนากร บุญมา", 96, 2),
        new("kamonchanok", "kamonchanok@example.test", "0856712345", "กมลชนก ศรีสวัสดิ์", 88, 1.5),
        new("weerapong", "weerapong@example.test", "0867123456", "วีระพงษ์ ทองดี", 75, 1.5),
        new("onuma", "onuma@example.test", "0871234560", "อรอุมา จันทร์เพ็ญ", 64, 1),
        new("panuwat", "panuwat@example.test", "0912345678", "ภาณุวัฒน์ มีสุข", 58, 1),
        new("siriporn", "siriporn@example.test", "0923456781", "ศิริพร แก้วมณี", 51, 1),
        new("chayapon", "chayapon@example.test", "0934567812", "ชยพล ประเสริฐ", 43, 1),
        new("nanthida", "nanthida@example.test", "0945678123", "นันทิดา พรหมมา", 37, 0.8),
        new("malee", "malee@example.test", "0956781234", "มาลี สุขใจ", 30, 0.6),
        new("emily", "emily.carter@example.test", "0967812345", "Emily Carter", 26, 0.8),
        new("kenji", "kenji.tanaka@example.test", "0978123456", "Kenji Tanaka", 22, 0.5),
        // สมัครแล้วยังไม่เคยจอง — หน้าการจองของฉันว่างทุกแท็บ หน้าผู้ใช้ของผู้ดูแลเห็นบัญชีใหม่
        new("paweena", "paweena@example.test", "0612345678", "ปวีณา นาคสวัสดิ์", 2, 0),
    ];

    /// <summary>ชื่อธนาคารตามรายการใน client/src/utils/banks.js (เก็บเป็นชื่อภาษาไทยแบบเดียวกับที่หน้าเว็บส่งมา)</summary>
    public static readonly string[] RefundBanks = ["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ออมสิน"];

    public static readonly SeedMovieData[] Movies =
    [
        new(
            "ฤดูฝนที่หายไป",
            "The Vanished Monsoon",
            "เรื่องราวของช่างภาพสารคดีที่กลับบ้านเกิดในหน้าฝน แล้วพบว่าหมู่บ้านทั้งหมู่บ้านจำเธอไม่ได้ ระหว่างตามหาคำตอบ เธอค่อย ๆ ค้นพบความลับที่ครอบครัวเก็บงำมานานยี่สิบปี",
            "A documentary photographer returns to her hometown during the rainy season to find that no one remembers her. Her search for answers unearths a secret her family buried twenty years ago.",
            Poster("monsoon"), Backdrop("monsoon"), 118, "PG13", ["ดราม่า", "ลึกลับ"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -40, Popularity: 1, Formats: ["2D"]),
        new(
            "ล่าข้ามมิติ",
            "Rift Runner",
            "นักวิ่งส่งของในกรุงเทพฯ ปี 2078 บังเอิญได้ครอบครองอุปกรณ์ที่เปิดรอยแยกระหว่างมิติ เขามีเวลา 12 ชั่วโมงในการส่งของชิ้นสุดท้าย ก่อนที่เมืองทั้งเมืองจะถูกกลืนหายไป",
            "A courier in 2078 Bangkok stumbles upon a device that tears open the space between worlds. He has twelve hours to complete one last delivery before the city collapses into the rift.",
            Poster("rift"), Backdrop("rift"), 132, "PG13", ["ไซไฟ", "แอ็คชั่น"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -26, Popularity: 2.2, Formats: ["2D", "3D", "IMAX", "4DX"]),
        new(
            "บ้านเลขที่ 13",
            "House No. 13",
            "ครอบครัวหนึ่งย้ายเข้าบ้านเช่าราคาถูกผิดปกติในซอยเปลี่ยว คืนแรกที่ย้ายเข้า เสียงเคาะประตูดังขึ้นสิบสามครั้งตรงเวลาเที่ยงคืน และดังต่อเนื่องทุกคืนไม่มีขาด",
            "A family moves into a suspiciously cheap rental house. On the first night, thirteen knocks land on the door at exactly midnight — and every night after that.",
            Poster("house13"), Backdrop("house13"), 105, "N15", ["สยองขวัญ", "ระทึกขวัญ"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -19, Popularity: 1.6, Formats: ["2D", "4DX"]),
        new(
            "รักครั้งสุดท้ายที่เชียงคาน",
            "Last Love in Chiang Khan",
            "ชายหนุ่มผู้สูญเสียความทรงจำระยะสั้นเดินทางไปเชียงคานทุกปีเพื่อตามหาใครบางคนที่เขาจำหน้าไม่ได้ แต่จำความรู้สึกได้ทุกครั้ง",
            "A young man with short-term memory loss travels to Chiang Khan every year, searching for someone whose face he cannot recall but whose presence he always feels.",
            Poster("chiangkhan"), Backdrop("chiangkhan"), 112, "G", ["โรแมนติก", "ดราม่า"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -54, Popularity: 0.8, Formats: ["2D"]),
        new(
            "ปฏิบัติการล่าฝัน",
            "Operation Daydream",
            "พนักงานออฟฟิศสี่คนตัดสินใจลาออกพร้อมกันเพื่อเปิดร้านก๋วยเตี๋ยวเรือ แต่ทำเลที่เลือกดันอยู่ตรงข้ามร้านของอดีตเจ้านาย",
            "Four office workers quit on the same day to open a boat-noodle shop — directly across the street from their former boss.",
            Poster("daydream"), Backdrop("daydream"), 98, "G", ["ตลก", "ฟีลกู๊ด"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -33, Popularity: 1.2, Formats: ["2D"]),
        new(
            "ว่าวกระดาษของมะลิ",
            "Mali's Paper Kite",
            "เด็กหญิงมะลิทำว่าวจากจดหมายเก่าของพ่อที่จากไป ว่าวตัวนั้นพาเธอลอยข้ามทุ่งนาไปสู่ดินแดนที่ทุกถ้อยคำซึ่งไม่เคยได้พูดออกมากลายเป็นนก",
            "Young Mali folds a kite from her late father's old letters. It carries her over the rice fields into a land where every word left unsaid has turned into a bird.",
            Poster("paperkite"), Backdrop("paperkite"), 94, "G", ["แอนิเมชัน", "ครอบครัว"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -12, Popularity: 1.4, Formats: ["2D", "3D"]),
        new(
            "บัญชีเงา",
            "Shadow Ledger",
            "พนักงานบัญชีธรรมดาพบว่าเงินสามพันล้านบาทถูกโยกผ่านบัญชีในชื่อของเธอทุกคืนตอนตีสาม เมื่อเธอเริ่มสืบ คนที่รู้ความลับเดียวกันก็เริ่มหายตัวไปทีละคน",
            "An ordinary accountant discovers that three billion baht moves through an account in her name every night at 3 a.m. Once she starts digging, everyone else who knows the secret begins to disappear.",
            Poster("ledger"), Backdrop("ledger"), 127, "N18", ["อาชญากรรม", "ระทึกขวัญ"], MovieStatus.NOW_SHOWING,
            // เพิ่งเข้าฉายสัปดาห์นี้ — รายงานรายวันเห็นหนังใหม่เริ่มขายกลางช่วง
            ReleaseInDays: -4, Popularity: 1.5, Formats: ["2D", "IMAX"]),
        new(
            "เพลงรักเยาวราช",
            "Yaowarat Serenade",
            "นักร้องร้านอาหารริมถนนเยาวราชกับนักเปียโนคลาสสิกที่เพิ่งตกงาน ต้องร่วมวงกันเพื่อชิงเงินรางวัลประกวดดนตรีที่จะช่วยร้านเก่าแก่ของอาม่าไม่ให้ถูกรื้อ",
            "A street-food singer from Yaowarat and an out-of-work classical pianist team up for a music contest whose prize could save Grandma's old restaurant from demolition.",
            Poster("yaowarat"), Backdrop("yaowarat"), 121, "PG13", ["เพลง", "โรแมนติก"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -22, Popularity: 0.9, Formats: ["2D"]),
        new(
            "ยกสุดท้าย",
            "The Final Round",
            "อดีตนักมวยไทยวัยสี่สิบกลับขึ้นเวทีอีกครั้งเพื่อหาเงินรักษาลูกสาว คู่ชกของเขาคือลูกศิษย์ที่เขาเคยทิ้งไว้กลางทางเมื่อสิบปีก่อน",
            "A forty-year-old former Muay Thai fighter steps back into the ring to pay for his daughter’s treatment. His opponent is the student he walked out on ten years ago.",
            Poster("finalround"), Backdrop("finalround"), 116, "PG13", ["กีฬา", "ดราม่า"], MovieStatus.NOW_SHOWING,
            ReleaseInDays: -9, Popularity: 1.1, Formats: ["2D"]),
        new(
            "ตำนานนาคี ภาค 4",
            "Naga Legend IV",
            "บทสรุปของตำนานพญานาคแห่งลุ่มน้ำโขง เมื่อคำสาบานเมื่อสามร้อยปีก่อนถูกทวงคืนในคืนวันออกพรรษา",
            "The finale of the Mekong naga saga, as a three-hundred-year-old oath comes due on the night of the end of Buddhist Lent.",
            Poster("naga"), Backdrop("naga"), 140, "PG13", ["แฟนตาซี", "ผจญภัย"],
            // หนังภาคต่อที่คนรอ — ยังไม่เปิดขาย (หน้าเว็บไม่ขายบัตรหนัง COMING_SOON) จึงไม่มีรอบ
            MovieStatus.COMING_SOON,
            ReleaseInDays: 8, Popularity: 2, Formats: ["2D", "3D", "IMAX", "4DX"]),
        new(
            "สัญญาณจากดาวอังคาร",
            "Signal from Mars",
            "นักดาราศาสตร์สมัครเล่นบนดอยอินทนนท์รับสัญญาณวิทยุจากดาวอังคาร ซึ่งกลายเป็นเสียงของเธอเองที่กำลังเตือนถึงเรื่องที่ยังไม่เกิดขึ้น",
            "An amateur astronomer on Doi Inthanon picks up a radio signal from Mars — in her own voice, warning her about something that hasn't happened yet.",
            Poster("marssignal"), Backdrop("marssignal"), 109, "PG13", ["ไซไฟ", "ลึกลับ"], MovieStatus.COMING_SOON,
            ReleaseInDays: 12, Popularity: 1, Formats: ["2D", "IMAX"]),
        new(
            "ภารกิจลับของคุณยายวัยเก้าสิบ",
            "Grandma's Secret Mission",
            "คุณยายวัยเก้าสิบแอบหนีออกจากบ้านพักคนชราพร้อมเพื่อนอีกสามคน เพื่อไปทวงสูตรน้ำพริกที่ถูกขโมยไปเมื่อหกสิบปีก่อน",
            "A ninety-year-old grandmother sneaks out of her care home with three friends to reclaim the chili-paste recipe that was stolen from her sixty years ago.",
            Poster("grandma"),
            // ไม่มีรูปพื้นหลัง — หน้ารายละเอียดหนังต้องแสดงได้ทั้งแบบมีและไม่มี
            null,
            101, "G", ["ตลก", "ครอบครัว"], MovieStatus.COMING_SOON,
            ReleaseInDays: 26, Popularity: 1, Formats: ["2D"]),
        new(
            "ทะเลไม่เคยหลับ",
            "The Sleepless Sea",
            "สารคดีติดตามชาวประมงพื้นบ้านฝั่งอันดามันตลอดหนึ่งปี ตั้งแต่มรสุมลูกแรกจนถึงคืนที่ฝูงหมึกกลับมาที่อ่าว",
            "A documentary that follows the small-boat fishers of the Andaman coast for a year, from the first monsoon to the night the squid return to the bay.",
            Poster("sleeplesssea"), Backdrop("sleeplesssea"), 86, "G", ["สารคดี"],
            // เลิกฉายแล้ว — ไม่ขึ้นหน้าแรก แต่ยังอยู่ในรายงานยอดขายย้อนหลังและประวัติการจอง
            MovieStatus.ARCHIVED,
            ReleaseInDays: -60, Popularity: 0.5, Formats: ["2D"], LastShowInDays: -7),
        new(
            "ป้อมสุดท้ายแห่งกรุงศรี",
            "The Last Fort of Ayutthaya",
            "ทหารเลวสิบสองนายได้รับคำสั่งให้รักษาป้อมดินริมแม่น้ำไว้หนึ่งคืน เพื่อซื้อเวลาให้ชาวบ้านหนีออกจากเมือง เรื่องแต่งที่อิงบรรยากาศช่วงปลายกรุงศรีอยุธยา",
            "Twelve foot soldiers are ordered to hold a riverside earthwork for a single night so the townsfolk can escape. A fictional story set in the last days of Ayutthaya.",
            Poster("lastfort"), Backdrop("lastfort"),
            // หนังยาวเกือบสามชั่วโมง — ตารางรอบต้องเว้นที่ให้พอ
            168, "N15", ["ประวัติศาสตร์", "แอ็คชั่น"], MovieStatus.ARCHIVED,
            ReleaseInDays: -70, Popularity: 1, Formats: ["2D", "IMAX"], LastShowInDays: -5),
    ];

    public static readonly SeedTheatreData[] Theatres =
    [
        new("โรงที่ 1", "2D", 8, 12, 180, (10, 0), BrokenSeats: ["C5", "C6"]),
        new("โรงที่ 2", "3D", 7, 14, 220, (10, 30)),
        new("โรงที่ 3 (IMAX)", "IMAX", 10, 16, 300, (11, 0), BrokenSeats: ["A1"]),
        new("โรงที่ 4 (4DX)", "4DX", 6, 10, 380, (11, 30)),
        new("โรงที่ 5", "2D", 12, 18, 160, (10, 15)),
        // ปิดปรับปรุง — ลบไม่ได้เพราะมีประวัติการจอง จึงปิดใช้งานแทน (ลงรอบใหม่ไม่ได้)
        new("โรงที่ 6", "2D", 6, 10, 160, (10, 45), IsActive: false, ClosedFromDay: -4),
    ];
}
