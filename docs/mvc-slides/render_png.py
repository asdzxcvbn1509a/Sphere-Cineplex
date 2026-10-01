"""
เรนเดอร์ LayoutSpec เป็นภาพ PNG ด้วย Pillow

เครื่องนี้ไม่มี PowerPoint/LibreOffice จึงเรนเดอร์ภาพเองจากพิกัดชุดเดียวกับที่เขียนลง .pptx
ไว้ใช้ตรวจงานด้วยตา ไม่ใช่ไฟล์ส่งมอบ
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

import theme
from spec import (
    Arrow,
    Badge,
    Box,
    Cylinder,
    Person,
    Slide,
    Text,
    font_px,
    layout_text,
    segments,
    text_width_in,
    valign_offset,
)

SCALE = 120.0  # px ต่อนิ้ว → 1600 x 900


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self, scale: float = SCALE):
        self.s = scale
        self.img = Image.new(
            "RGB", (round(theme.SLIDE_W * scale), round(theme.SLIDE_H * scale)), _rgb(theme.PAGE)
        )
        self.d = ImageDraw.Draw(self.img)

    def p(self, v: float) -> float:
        return v * self.s

    # ---------- primitive ----------

    def box(self, b: Box):
        xy = [self.p(b.x), self.p(b.y), self.p(b.x + b.w), self.p(b.y + b.h)]
        r = max(0, round(self.p(b.radius)))
        kwargs = {
            "fill": _rgb(b.fill) if b.fill else None,
            "outline": _rgb(b.line) if b.line else None,
            "width": max(1, round(b.line_w / 72 * self.s)) if b.line else 0,
        }
        if r > 0:
            self.d.rounded_rectangle(xy, radius=r, **kwargs)
        else:
            self.d.rectangle(xy, **kwargs)

    def _draw_runs(self, x_in: float, y_in: float, s: str, para):
        """วาดข้อความทีละช่วงฟอนต์ เพื่อให้ลูกศรที่ต้องใช้ฟอนต์สำรองออกมาถูกต้อง"""
        x = self.p(x_in)
        y = self.p(y_in)
        for chunk, font_name in segments(s, para.font):
            f = font_px(font_name, para.bold, para.size, self.s)
            self.d.text((x, y), chunk, font=f, fill=_rgb(para.color), anchor="lm")
            x += f.getlength(chunk)

    def text(self, t: Text):
        placed, total = layout_text(t)
        off = valign_offset(t, total)
        for pl in placed:
            p = pl.para
            ay = t.y + off + pl.dy + pl.lh / 2
            line_w = text_width_in(pl.text, p.font, p.bold, p.size)
            if p.align == "c":
                ax = t.x + (t.w - line_w) / 2
            elif p.align == "r":
                ax = t.x + t.w - line_w
            else:
                ax = t.x + p.indent
            self._draw_runs(ax, ay, pl.text, p)
            if pl.first and p.bullet:
                self._draw_runs(t.x, ay, p.bullet, p)

    def arrow(self, a: Arrow):
        w = max(1, round(a.width / 72 * self.s))
        x1, y1, x2, y2 = self.p(a.x1), self.p(a.y1), self.p(a.x2), self.p(a.y2)
        ang = math.atan2(y2 - y1, x2 - x1)
        head = self.p(0.11)
        # ย่นเส้นให้สั้นลงเท่าหัวลูกศร เส้นจะได้ไม่โผล่พ้นปลายแหลม
        bx, by = x2 - head * math.cos(ang), y2 - head * math.sin(ang)
        self.d.line([x1, y1, bx, by], fill=_rgb(a.color), width=w)
        half = head * 0.42
        self.d.polygon(
            [
                (x2, y2),
                (bx - half * math.sin(ang), by + half * math.cos(ang)),
                (bx + half * math.sin(ang), by - half * math.cos(ang)),
            ],
            fill=_rgb(a.color),
        )

    def badge(self, b: Badge):
        xy = [
            self.p(b.cx - b.r),
            self.p(b.cy - b.r),
            self.p(b.cx + b.r),
            self.p(b.cy + b.r),
        ]
        self.d.ellipse(xy, fill=_rgb(b.fill))
        f = font_px(theme.FONT_TH, True, b.size, self.s)
        self.d.text((self.p(b.cx), self.p(b.cy)), b.text, font=f, fill=_rgb(b.color), anchor="mm")

    def cylinder(self, c: Cylinder):
        fill, line = _rgb(c.fill), _rgb(c.line)
        w = max(1, round(1.25 / 72 * self.s))
        e = c.h * 0.26
        x1, x2 = self.p(c.x), self.p(c.x + c.w)
        top, bot = self.p(c.y), self.p(c.y + c.h)
        eh = self.p(e)
        self.d.rectangle([x1, top + eh / 2, x2, bot - eh / 2], fill=fill)
        self.d.ellipse([x1, bot - eh, x2, bot], fill=fill, outline=line, width=w)
        self.d.rectangle([x1, top + eh / 2, x2, bot - eh / 2], fill=fill)
        self.d.line([x1, top + eh / 2, x1, bot - eh / 2], fill=line, width=w)
        self.d.line([x2, top + eh / 2, x2, bot - eh / 2], fill=line, width=w)
        self.d.arc([x1, bot - eh, x2, bot], 0, 180, fill=line, width=w)
        self.d.ellipse([x1, top, x2, top + eh], fill=fill, outline=line, width=w)

    def person(self, p: Person):
        col = _rgb(p.color)
        head_d = p.h * 0.42
        self.d.ellipse(
            [
                self.p(p.cx - head_d / 2),
                self.p(p.top),
                self.p(p.cx + head_d / 2),
                self.p(p.top + head_d),
            ],
            fill=col,
        )
        body_w = p.h * 0.80
        body_top = p.top + head_d + p.h * 0.10
        self.d.rounded_rectangle(
            [
                self.p(p.cx - body_w / 2),
                self.p(body_top),
                self.p(p.cx + body_w / 2),
                self.p(p.top + p.h + p.h * 0.18),
            ],
            radius=round(self.p(p.h * 0.22)),
            fill=col,
        )


DISPATCH = {
    Box: Canvas.box,
    Text: Canvas.text,
    Arrow: Canvas.arrow,
    Badge: Canvas.badge,
    Cylinder: Canvas.cylinder,
    Person: Canvas.person,
}


def render_slide(slide: Slide, scale: float = SCALE) -> Image.Image:
    c = Canvas(scale)
    for item in slide.primitives:
        DISPATCH[type(item)](c, item)
    return c.img


def render_deck(deck, out_dir: Path, only: list[int] | None = None, scale: float = SCALE):
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for i, slide in enumerate(deck.slides, start=1):
        if only and i not in only:
            continue
        path = out_dir / f"slide-{i:03d}.png"
        render_slide(slide, scale).save(path)
        written.append(path)
    return written
