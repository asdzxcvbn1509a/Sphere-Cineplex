"""
LayoutSpec — ภาษากลางระหว่าง layout กับตัวเรนเดอร์

layout.py วางพิกัดทุกอย่างเป็น "นิ้ว" ลงใน primitive เหล่านี้ แล้ว
render_pptx.py กับ render_png.py อ่านสเปกชุดเดียวกัน
ภาพ PNG ที่เอาไว้ตรวจงานจึงสะท้อนเลย์เอาต์ของไฟล์ .pptx จริง
"""

from dataclasses import dataclass, field
from functools import lru_cache

from PIL import ImageFont

import theme

PT_PER_INCH = 72.0


# ---------- การวัดข้อความ ----------


@lru_cache(maxsize=64)
def _font(name: str, bold: bool, px: int) -> ImageFont.FreeTypeFont:
    path = theme.FONT_FILES[(name, bold)]
    return ImageFont.truetype(path, px)


def font_px(name: str, bold: bool, size_pt: float, scale: float):
    """โหลดฟอนต์ที่ขนาดพิกเซลตาม scale (px ต่อนิ้ว)"""
    px = max(1, round(size_pt / PT_PER_INCH * scale))
    return _font(name, bold, px)


# Leelawadee UI ไม่มี glyph ลูกศร — ตัวที่ขาดให้หยิบจาก Arial ซึ่งมีทุกเครื่อง
FALLBACK_FONT = "Arial"
FALLBACK_CHARS = frozenset("→←↑↓")


def segments(s: str, base_font: str) -> list[tuple[str, str]]:
    """แตกข้อความเป็นช่วง ๆ ตามฟอนต์ที่ต้องใช้ — ช่วงที่เป็นลูกศรจะสลับไปใช้ Arial"""
    out: list[tuple[str, str]] = []
    cur, cur_font = "", ""
    for ch in s:
        font = FALLBACK_FONT if ch in FALLBACK_CHARS else base_font
        if font != cur_font:
            if cur:
                out.append((cur, cur_font))
            cur, cur_font = ch, font
        else:
            cur += ch
    if cur:
        out.append((cur, cur_font))
    return out


def text_width_in(s: str, name: str, bold: bool, size_pt: float) -> float:
    """ความกว้างของข้อความเป็นนิ้ว วัดจากไฟล์ฟอนต์จริง (รวมช่วงที่ใช้ฟอนต์สำรอง)"""
    if not s:
        return 0.0
    # วัดที่ 600 px/inch แล้วหารกลับ เพื่อลดผลจากการปัดขนาดพิกเซล
    total = 0.0
    for chunk, font in segments(s, name):
        total += font_px(font, bold, size_pt, 600.0).getlength(chunk)
    return total / 600.0


def line_height_in(
    size_pt: float, spacing: float = 1.0, name: str = theme.FONT_TH, bold: bool = False
) -> float:
    """
    ความสูงหนึ่งบรรทัด คิดจาก ascent+descent ของไฟล์ฟอนต์จริง
    ไม่ใช่สูตรคูณคงที่ — PowerPoint ก็คิดจาก metric ของฟอนต์เหมือนกัน
    ตัวเลขที่ใช้ตรวจงานจึงใกล้เคียงกับที่ PowerPoint เรนเดอร์จริง
    (สำคัญกับภาษาไทยที่มีสระบนและวรรณยุกต์ซ้อนกันสองชั้น)
    """
    f = font_px(name, bold, size_pt, 600.0)
    ascent, descent = f.getmetrics()
    return (ascent + descent) / 600.0 * spacing


def wrap(s: str, max_w: float, name: str, bold: bool, size_pt: float) -> list[str]:
    """
    ตัดบรรทัดตามช่องว่าง เหมือนที่ PowerPoint ทำ
    คำเดี่ยวที่ยาวเกินกล่อง (เช่นข้อความไทยยาว ๆ ที่ไม่มีเว้นวรรค) จะถูกตัดทีละตัวอักษร
    """
    if not s:
        return [""]
    words = s.split(" ")
    lines: list[str] = []
    cur = ""

    def flush():
        nonlocal cur
        if cur:
            lines.append(cur)
            cur = ""

    for word in words:
        trial = f"{cur} {word}" if cur else word
        if text_width_in(trial, name, bold, size_pt) <= max_w:
            cur = trial
            continue
        flush()
        if text_width_in(word, name, bold, size_pt) <= max_w:
            cur = word
            continue
        # คำเดียวยาวเกินกล่อง — ตัดทีละตัวอักษร
        piece = ""
        for ch in word:
            if text_width_in(piece + ch, name, bold, size_pt) <= max_w:
                piece += ch
            else:
                lines.append(piece)
                piece = ch
        cur = piece
    flush()
    return lines or [""]


# ---------- primitive ----------


@dataclass
class Box:
    """สี่เหลี่ยม (มุมมนได้) ใช้เป็นพื้นหลังของกล่องต่าง ๆ"""

    x: float
    y: float
    w: float
    h: float
    fill: str | None = None
    line: str | None = None
    line_w: float = 1.0        # pt
    radius: float = 0.10       # นิ้ว; 0 = มุมฉาก
    shadow: bool = False
    dash: bool = False


@dataclass
class Para:
    """หนึ่งย่อหน้าในกล่องข้อความ"""

    text: str
    size: float = theme.SZ_BODY
    bold: bool = False
    color: str = theme.INK
    font: str = theme.FONT_TH
    space_before: float = 0.0  # pt
    indent: float = 0.0        # นิ้ว — ระยะย่อหน้าแขวน (บรรทัดต่อเยื้องเข้าเท่ากับจุดนำ)
    align: str = "l"           # l | c | r
    bullet: str = ""           # จุดนำหน้า เช่น "•" หรือ "1." — วาดแยกที่ขอบซ้ายของย่อหน้า
    auto_num: bool = False     # True = ให้ PowerPoint เดินเลขเอง


@dataclass
class Text:
    """กล่องข้อความ — ไม่มีขอบ ไม่มีพื้น มีแต่ย่อหน้า"""

    x: float
    y: float
    w: float
    h: float
    paras: list[Para]
    valign: str = "t"          # t | m | b
    spacing: float = 1.0       # ตัวคูณระยะบรรทัด (1.0 = ระยะธรรมชาติของฟอนต์)


@dataclass
class PlacedLine:
    text: str
    para: Para
    dy: float                  # ระยะจากขอบบนของบล็อกข้อความ
    lh: float
    first: bool                # บรรทัดแรกของย่อหน้า — บรรทัดที่มีจุดนำ


def expand_paras(paras: list[Para]) -> list[Para]:
    """แตก '\\n' ในย่อหน้าออกเป็นย่อหน้าย่อยที่ไม่มีระยะเว้นด้านบน"""
    out: list[Para] = []
    for p in paras:
        chunks = p.text.split("\n")
        for i, chunk in enumerate(chunks):
            out.append(
                Para(
                    chunk,
                    p.size,
                    p.bold,
                    p.color,
                    p.font,
                    p.space_before if i == 0 else 0.0,
                    p.indent,
                    p.align,
                    p.bullet if i == 0 else "",
                    p.auto_num if i == 0 else False,
                )
            )
    return out


def layout_text(t: Text) -> tuple[list[PlacedLine], float]:
    """คำนวณว่าแต่ละบรรทัดตกลงตรงไหน และบล็อกข้อความสูงเท่าไร (นิ้ว)"""
    placed: list[PlacedLine] = []
    dy = 0.0
    paras = expand_paras(t.paras)
    for i, p in enumerate(paras):
        if i > 0:
            dy += p.space_before / PT_PER_INCH
        lh = line_height_in(p.size, t.spacing, p.font, p.bold)
        for k, line in enumerate(wrap(p.text, t.w - p.indent, p.font, p.bold, p.size)):
            placed.append(PlacedLine(line, p, dy, lh, k == 0))
            dy += lh
    return placed, dy


def valign_offset(t: Text, total_h: float) -> float:
    if t.valign == "m":
        return (t.h - total_h) / 2
    if t.valign == "b":
        return t.h - total_h
    return 0.0


@dataclass
class Arrow:
    x1: float
    y1: float
    x2: float
    y2: float
    color: str = theme.MUTED
    width: float = 2.0         # pt


@dataclass
class Badge:
    """วงกลมหมายเลขลำดับบนลูกศร"""

    cx: float
    cy: float
    r: float
    text: str
    fill: str = theme.INK
    color: str = "FFFFFF"
    size: float = theme.SZ_BADGE


@dataclass
class Cylinder:
    """ทรงกระบอกแทนฐานข้อมูล"""

    x: float
    y: float
    w: float
    h: float
    fill: str
    line: str


@dataclass
class Person:
    """ไอคอนคน วาดจากวงกลม + ทรงมน"""

    cx: float
    top: float
    h: float
    color: str


@dataclass
class Slide:
    primitives: list = field(default_factory=list)
    notes: str = ""
    title: str = ""

    def add(self, *items):
        for item in items:
            self.primitives.append(item)
        return self


@dataclass
class Deck:
    slides: list[Slide] = field(default_factory=list)

    def add(self, slide: Slide) -> Slide:
        self.slides.append(slide)
        return slide
