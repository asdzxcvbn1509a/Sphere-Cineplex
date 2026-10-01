"""สี ฟอนต์ และขนาดมาตรฐานของเด็ค — แก้ที่นี่ที่เดียว มีผลทั้ง .pptx และ PNG ตัวอย่าง"""

# ---------- ขนาดสไลด์ (นิ้ว) ----------
SLIDE_W = 13.333
SLIDE_H = 7.5

# ---------- ฟอนต์ ----------
# Leelawadee UI ติดมากับ Windows ทุกเครื่อง จึงปลอดภัยที่สุดสำหรับไฟล์ที่ต้องส่งต่อ
FONT_TH = "Leelawadee UI"
FONT_MONO = "Consolas"
FONT_SYM = "Arial"      # ฟอนต์สำรองสำหรับลูกศร ซึ่ง Leelawadee UI ไม่มี glyph

FONT_FILES = {
    (FONT_TH, False): r"C:\Windows\Fonts\LeelawUI.ttf",
    (FONT_TH, True): r"C:\Windows\Fonts\LeelaUIb.ttf",
    (FONT_MONO, False): r"C:\Windows\Fonts\consola.ttf",
    (FONT_MONO, True): r"C:\Windows\Fonts\consolab.ttf",
    (FONT_SYM, False): r"C:\Windows\Fonts\arial.ttf",
    (FONT_SYM, True): r"C:\Windows\Fonts\arialbd.ttf",
}

# ---------- สี ----------
INK = "1F2937"          # ข้อความหลัก
MUTED = "6B7280"        # ข้อความรอง
FAINT = "9CA3AF"
PAGE = "FFFFFF"
HAIRLINE = "E5E7EB"

CRIMSON = "7F1D2B"      # โทนโรงหนัง — ใช้กับปกและสไลด์คั่นกลุ่ม
CRIMSON_SOFT = "A8324A"
DANGER = "B42318"       # บรรทัดหมายเหตุ

# สีประจำชั้น MVC — เข้ารหัสสีเหมือนรูปตัวอย่าง เพื่อให้จำได้ว่าสีไหนคือชั้นไหน
LAYER = {
    "view": {"line": "4F46E5", "fill": "EEF0FD", "head": "3730A3", "chip": "E0E3FA"},
    "controller": {"line": "047857", "fill": "E8F5EF", "head": "065F46", "chip": "D7EDE3"},
    "model": {"line": "B45309", "fill": "FDF1E1", "head": "92400E", "chip": "FAE5C8"},
    "db": {"line": "6D28D9", "fill": "F1EBFC", "head": "5B21B6", "chip": "E6DBFA"},
    "summary": {"line": "D1D5DB", "fill": "FAFAFA", "head": INK, "chip": "F3F4F6"},
}

OK_GREEN = "15803D"
OK_GREEN_FILL = "DCFCE7"

# สีป้ายของ HTTP method
METHOD_COLOR = {
    "GET": "1D4ED8",
    "POST": "047857",
    "PATCH": "B45309",
    "DELETE": "B42318",
}

# ---------- ขนาดตัวอักษร (pt) ----------
SZ_SLIDE_TITLE = 25
SZ_PILL = 13
SZ_FLOW = 11.5
SZ_PANEL_NUM = 10
SZ_PANEL_TITLE = 13.5
SZ_PANEL_SUB = 10
SZ_BODY = 10
SZ_SMALL = 9
SZ_TINY = 8.5
SZ_BADGE = 10.5

# ---------- ผังหน้า (นิ้ว) ----------
MARGIN_L = 0.50
MARGIN_R = 0.50
CONTENT_W = SLIDE_W - MARGIN_L - MARGIN_R

TITLE_Y = 0.30
TITLE_H = 0.52
PILL_Y = 0.92
PILL_H = 0.36

ROW1_Y = 1.50
ROW1_H = 2.72
ROW2_Y = 4.64
ROW2_H = 2.42

# คอลัมน์แถวบน — ช่องว่างระหว่างกล่องคือที่อยู่ของลูกศรกับหมายเลขลำดับ
P1_X, P1_W = 0.50, 2.78          # View (หน้าที่ผู้ใช้ทำ)
P2_X, P2_W = 3.88, 3.00          # Controller
P3_X, P3_W = 7.48, 3.05          # Model
DB_X, DB_W = 11.05, 1.78         # Database

# คอลัมน์แถวล่าง
ACTOR_X, ACTOR_W = 0.50, 1.15
P4_X, P4_W = 2.05, 4.83          # View (หน้าผลลัพธ์) — ขอบขวาตรงกับ Controller
SUM_X, SUM_W = 7.48, 5.35        # สรุปการทำงาน — ซ้ายตรงกับ Model ขวาตรงกับ Database

BULLET_INDENT = 0.17             # ระยะย่อหน้าแขวนของหัวข้อย่อย
NUM_INDENT = 0.24                # ระยะย่อหน้าแขวนของรายการมีหมายเลข

PANEL_PAD = 0.16                 # ระยะขอบในของกล่อง
