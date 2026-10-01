"""
ตรวจงานโดยไม่ต้องเรนเดอร์จริง

วัดข้อความด้วยไฟล์ฟอนต์ตัวเดียวกับที่เขียนลง .pptx แล้วเทียบกับขนาดกล่อง
จับ "ข้อความล้นกล่อง" ซึ่งเป็นข้อบกพร่องที่พบบ่อยที่สุดและผู้อ่านเห็นทันที
"""

from dataclasses import dataclass

import theme
from spec import Badge, Box, Cylinder, Person, Text, layout_text, text_width_in

SLACK = 0.02  # นิ้ว — เผื่อความต่างเล็กน้อยระหว่าง PIL กับ PowerPoint


@dataclass
class Issue:
    slide: int
    kind: str
    detail: str

    def __str__(self) -> str:
        return f"  หน้า {self.slide:>3}  [{self.kind}]  {self.detail}"


def _clip(s: str, n: int = 52) -> str:
    s = s.replace("\n", " / ")
    return s if len(s) <= n else s[: n - 1] + "…"


def check_slide(slide, index: int) -> list[Issue]:
    issues: list[Issue] = []

    for item in slide.primitives:
        if isinstance(item, Text):
            placed, total = layout_text(item)
            if total > item.h + SLACK:
                issues.append(
                    Issue(
                        index,
                        "ข้อความสูงเกินกล่อง",
                        f'"{_clip(item.paras[0].text)}" ต้องการ {total:.2f}" มี {item.h:.2f}"',
                    )
                )
            for pl in placed:
                w = text_width_in(pl.text, pl.para.font, pl.para.bold, pl.para.size)
                if w > item.w - pl.para.indent + SLACK:
                    issues.append(
                        Issue(
                            index,
                            "ข้อความกว้างเกินกล่อง",
                            f'"{_clip(pl.text)}" กว้าง {w:.2f}" มี {item.w:.2f}"',
                        )
                    )
            x1, y1 = item.x, item.y
            x2, y2 = item.x + item.w, item.y + max(total, item.h)
        elif isinstance(item, (Box, Cylinder)):
            x1, y1 = item.x, item.y
            x2, y2 = item.x + item.w, item.y + item.h
        elif isinstance(item, Badge):
            x1, y1 = item.cx - item.r, item.cy - item.r
            x2, y2 = item.cx + item.r, item.cy + item.r
        elif isinstance(item, Person):
            x1, y1 = item.cx - item.h * 0.40, item.top
            x2, y2 = item.cx + item.h * 0.40, item.top + item.h * 1.18
        else:
            continue

        if x1 < -0.01 or y1 < -0.01 or x2 > theme.SLIDE_W + 0.01 or y2 > theme.SLIDE_H + 0.01:
            label = _clip(item.paras[0].text) if isinstance(item, Text) else type(item).__name__
            issues.append(
                Issue(index, "หลุดขอบสไลด์", f"{label} → ({x1:.2f}, {y1:.2f}) ถึง ({x2:.2f}, {y2:.2f})")
            )

    return issues


def _rects(slide):
    """กล่องพื้นหลังหลักของสไลด์ (ไม่รวมกล่องเล็กที่ตั้งใจวางซ้อน)"""
    out = []
    for item in slide.primitives:
        if isinstance(item, Box) and item.w >= 1.0 and item.h >= 0.9:
            out.append(item)
    return out


def _contains(outer: Box, inner: Box) -> bool:
    return (
        inner.x >= outer.x - 0.01
        and inner.y >= outer.y - 0.01
        and inner.x + inner.w <= outer.x + outer.w + 0.01
        and inner.y + inner.h <= outer.y + outer.h + 0.01
    )


def check_overlaps(slide, index: int) -> list[Issue]:
    issues = []
    boxes = _rects(slide)
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            # กล่องเต็มหน้า (พื้นหลังปก/สไลด์คั่น) ไม่ถือว่าทับ
            if a.w > 12.8 or b.w > 12.8:
                continue
            # กล่องที่อยู่ข้างในอีกกล่องหนึ่งพอดี (เช่นการ์ดจำลองในกล่อง View) ตั้งใจให้ซ้อน
            if _contains(a, b) or _contains(b, a):
                continue
            ox = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
            oy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
            if ox > 0.01 and oy > 0.01:
                issues.append(
                    Issue(
                        index,
                        "กล่องทับกัน",
                        f"({a.x:.2f},{a.y:.2f},{a.w:.2f}x{a.h:.2f}) "
                        f"กับ ({b.x:.2f},{b.y:.2f},{b.w:.2f}x{b.h:.2f}) "
                        f"ซ้อน {ox:.2f} x {oy:.2f}",
                    )
                )
    return issues


def check_deck(deck) -> list[Issue]:
    issues: list[Issue] = []
    for i, slide in enumerate(deck.slides, start=1):
        issues += check_slide(slide, i)
        issues += check_overlaps(slide, i)
    return issues


def report(issues: list[Issue]) -> str:
    if not issues:
        return "ตรวจการจัดวาง: ผ่าน — ไม่พบข้อความล้นกล่องหรือองค์ประกอบทับกัน"
    lines = [f"ตรวจการจัดวาง: พบ {len(issues)} รายการ"]
    lines += [str(i) for i in issues]
    return "\n".join(lines)
