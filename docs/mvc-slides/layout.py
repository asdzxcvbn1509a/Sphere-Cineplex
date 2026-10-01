"""
วางเลย์เอาต์ของสไลด์ทุกชนิด — แปลง Endpoint หนึ่งตัวเป็น Slide หนึ่งใบ

เลย์เอาต์ตามรูปตัวอย่าง: View → Controller → Model → Database
ลูกศรหมายเลข ①–⑤ และกล่องสรุปการทำงานที่มุมขวาล่าง
"""

import theme
from content import Endpoint, GROUPS
from spec import (
    Arrow,
    Badge,
    Box,
    Cylinder,
    Para,
    Person,
    Slide,
    Text,
    layout_text,
    line_height_in,
    text_width_in,
    wrap,
)

PAD = theme.PANEL_PAD
BADGE_R = 0.125

# ตำแหน่งแนวตั้งของลูกศรในช่องว่างระหว่างกล่อง (วัดจากขอบบนของแถวบน)
ARROW_FWD_DY = 1.05        # ลูกศรขาไป
ARROW_BACK_DY = 1.92       # ลูกศรขากลับ


# ---------- ชิ้นส่วนที่ใช้ซ้ำ ----------


def _panel(slide, x, y, w, h, layer):
    c = theme.LAYER[layer]
    slide.add(Box(x, y, w, h, fill=c["fill"], line=c["line"], line_w=1.25, radius=0.12))


def _panel_head(slide, x, y, w, num, label, layer):
    """แถบหัวกล่อง: เลขลำดับในวงกลมทึบ + ชื่อชั้น"""
    c = theme.LAYER[layer]
    r = 0.105
    slide.add(Badge(x + PAD + r, y + PAD + r, r, str(num), fill=c["line"], color="FFFFFF", size=9))
    slide.add(
        Text(
            x + PAD + 2 * r + 0.08,
            y + PAD - 0.015,
            w - 2 * PAD - 2 * r - 0.08,
            0.24,
            [Para(label, theme.SZ_PANEL_NUM, True, c["head"])],
            valign="m",
        )
    )


def fit_size(text, w, size, min_size=8.0, bold=False, font=theme.FONT_TH):
    """
    ลดขนาดตัวอักษรลงจนข้อความพอดีหนึ่งบรรทัด — กันข้อความยาวผิดคาดดันจนล้นกล่อง
    ใช้กับหัวข้อที่ออกแบบให้อยู่บรรทัดเดียว เช่น ชื่อหน้าจอและชื่อ Controller
    """
    s = size
    while s > min_size and text_width_in(text, font, bold, s) > w:
        s -= 0.5
    return s


def _heading(slide, x, y, w, text, color=theme.INK):
    """หัวข้อในกล่อง — ออกแบบให้อยู่บรรทัดเดียว ยาวเกินจะย่อขนาดลงให้เอง"""
    slide.add(
        Text(
            x,
            y,
            w,
            0.28,
            [Para(text, fit_size(text, w, theme.SZ_PANEL_TITLE, 9.5, True), True, color)],
            valign="m",
        )
    )


def _mock_card(slide, x, y, w, card, label_w, accent):
    """การ์ดจำลองหน้าจอ — ความสูงของแต่ละแถวยืดตามข้อความที่ตัดบรรทัด"""
    pad = 0.11
    row_h = 0.26
    status_h = 0.32 if card.status else 0.0
    btn_h = 0.38 if card.button else 0.0
    value_w = w - 2 * pad - label_w

    row_heights = []
    for label, value in card.rows:
        need = max(
            block_height([Para(label, theme.SZ_TINY, False)], label_w),
            block_height([Para(value, theme.SZ_TINY, True)], value_w),
        )
        row_heights.append(max(row_h, need + 0.05))

    h = pad * 2 + status_h + sum(row_heights) + btn_h

    slide.add(Box(x, y, w, h, fill="FFFFFF", line=theme.HAIRLINE, line_w=1.0, radius=0.07))

    cy = y + pad
    if card.status:
        ok = card.status_kind == "ok"
        fill = theme.OK_GREEN_FILL if ok else theme.LAYER["view"]["chip"]
        col = theme.OK_GREEN if ok else theme.LAYER["view"]["head"]
        slide.add(Box(x + pad, cy, w - 2 * pad, status_h - 0.05, fill=fill, line=None, radius=0.05))
        slide.add(
            Text(
                x + pad + 0.09,
                cy,
                w - 2 * pad - 0.18,
                status_h - 0.05,
                [Para(card.status, theme.SZ_SMALL, True, col)],
                valign="m",
            )
        )
        cy += status_h

    for (label, value), rh in zip(card.rows, row_heights):
        slide.add(
            Text(
                x + pad,
                cy,
                label_w,
                rh,
                [Para(label, theme.SZ_TINY, False, theme.MUTED)],
                valign="m",
            )
        )
        slide.add(
            Text(
                x + pad + label_w,
                cy,
                value_w,
                rh,
                [Para(value, theme.SZ_TINY, True, theme.INK)],
                valign="m",
            )
        )
        cy += rh

    if card.button:
        bw = min(w - 2 * pad, text_width_in(card.button, theme.FONT_TH, True, theme.SZ_TINY) + 0.55)
        bx = x + (w - bw) / 2
        slide.add(Box(bx, cy + 0.06, bw, 0.28, fill=accent, line=None, radius=0.06))
        slide.add(
            Text(
                bx,
                cy + 0.06,
                bw,
                0.28,
                [Para(card.button, theme.SZ_TINY, True, "FFFFFF", align="c")],
                valign="m",
            )
        )

    return h


def _bullet_paras(items, size, color):
    return [
        Para(
            item,
            size,
            False,
            color,
            space_before=0 if i == 0 else 3.5,
            indent=theme.BULLET_INDENT,
            bullet="•",
        )
        for i, item in enumerate(items)
    ]


def _bullets(slide, x, y, w, h, items, size=theme.SZ_BODY, color=theme.INK):
    slide.add(Text(x, y, w, h, _bullet_paras(items, size, color)))


def block_height(paras, w, spacing=1.0) -> float:
    """ความสูงจริงของบล็อกข้อความ ใช้กำหนดความสูงกล่องให้พอดีกับเนื้อหา"""
    _, total = layout_text(Text(0, 0, w, 99, paras, spacing=spacing))
    return total


def _numbered(slide, x, y, w, h, items, size=theme.SZ_BODY):
    paras = [
        Para(
            item,
            size,
            False,
            theme.INK,
            space_before=0 if i == 0 else 4.0,
            indent=theme.NUM_INDENT,
            bullet=f"{i + 1}.",
            auto_num=True,
        )
        for i, item in enumerate(items)
    ]
    slide.add(Text(x, y, w, h, paras))


def _pill(slide, x, y, method, path):
    """ป้าย METHOD + path — ความกว้างคิดจากความกว้างข้อความจริง"""
    mw = text_width_in(method, theme.FONT_MONO, True, theme.SZ_PILL)
    pw = text_width_in(path, theme.FONT_MONO, False, theme.SZ_PILL)
    w = mw + pw + 0.52
    h = theme.PILL_H
    slide.add(Box(x, y, w, h, fill="F3F4F6", line=theme.HAIRLINE, line_w=1.0, radius=0.08))
    slide.add(
        Text(
            x + 0.16,
            y,
            w - 0.32,
            h,
            [
                Para(
                    f"{method}  {path}",
                    theme.SZ_PILL,
                    True,
                    theme.METHOD_COLOR.get(method, theme.INK),
                    font=theme.FONT_MONO,
                )
            ],
            valign="m",
        )
    )
    return w


def _step_badge(slide, cx, cy, num):
    slide.add(Badge(cx, cy, BADGE_R, str(num), fill=theme.INK, color="FFFFFF"))


def _gap_label(slide, x1, x2, y, text, h=0.42):
    """คำอธิบายสั้น ๆ ในช่องว่างระหว่างกล่อง — ล้นออกนอกช่องได้เล็กน้อยทั้งสองข้าง"""
    slide.add(
        Text(
            x1 - 0.12,
            y,
            (x2 - x1) + 0.24,
            h,
            [Para(text, theme.SZ_TINY, False, theme.MUTED, align="c")],
            valign="t",
        )
    )


# ---------- สไลด์ endpoint ----------


def endpoint_slide(ep: Endpoint, index: int, total: int) -> Slide:
    s = Slide(title=f"{ep.method} {ep.path}")
    y1, h1 = theme.ROW1_Y, theme.ROW1_H
    y2, h2 = theme.ROW2_Y, theme.ROW2_H

    # ----- หัวสไลด์ -----
    title = f"MVC Architecture : {ep.title}"
    s.add(
        Text(
            theme.MARGIN_L,
            theme.TITLE_Y,
            9.9,
            theme.TITLE_H,
            [Para(title, fit_size(title, 9.9, theme.SZ_SLIDE_TITLE, 18, True), True, theme.INK)],
            valign="m",
        )
    )
    chip_w = 1.90
    s.add(
        Box(
            theme.SLIDE_W - theme.MARGIN_R - chip_w,
            theme.TITLE_Y + 0.07,
            chip_w,
            0.38,
            fill=theme.LAYER["summary"]["chip"],
            line=theme.HAIRLINE,
            radius=0.19,
        )
    )
    s.add(
        Text(
            theme.SLIDE_W - theme.MARGIN_R - chip_w,
            theme.TITLE_Y + 0.07,
            chip_w,
            0.38,
            [Para(GROUPS[ep.group], theme.SZ_SMALL, True, theme.MUTED, align="c")],
            valign="m",
        )
    )

    pill_w = _pill(s, theme.MARGIN_L, theme.PILL_Y, ep.method, ep.path)
    flow_x = theme.MARGIN_L + pill_w + 0.26
    s.add(
        Text(
            flow_x,
            theme.PILL_Y,
            theme.SLIDE_W - theme.MARGIN_R - flow_x,
            theme.PILL_H,
            [Para(ep.flow, theme.SZ_FLOW, False, theme.MUTED)],
            valign="m",
        )
    )

    # ----- 1. View (หน้าที่ผู้ใช้ทำ) -----
    x, w = theme.P1_X, theme.P1_W
    _panel(s, x, y1, w, h1, "view")
    _panel_head(s, x, y1, w, 1, "View — หน้าจอที่ส่งคำขอ", "view")
    _heading(s, x + PAD, y1 + 0.40, w - 2 * PAD, ep.view_in.caption)
    if ep.view_in.sub:
        s.add(
            Text(
                x + PAD,
                y1 + 0.66,
                w - 2 * PAD,
                0.22,
                [Para(ep.view_in.sub, theme.SZ_SMALL, False, theme.MUTED)],
                valign="m",
            )
        )
    _mock_card(
        s,
        x + PAD,
        y1 + 0.92,
        w - 2 * PAD,
        ep.view_in.card,
        label_w=0.92,
        accent=theme.LAYER["view"]["line"],
    )

    # ----- 2. Controller -----
    x, w = theme.P2_X, theme.P2_W
    _panel(s, x, y1, w, h1, "controller")
    _panel_head(s, x, y1, w, 2, "Controller — รับคำขอและตัดสินใจ", "controller")
    _heading(s, x + PAD, y1 + 0.40, w - 2 * PAD, ep.controller.name)
    s.add(
        Text(
            x + PAD,
            y1 + 0.66,
            w - 2 * PAD,
            0.22,
            [Para(f"({ep.controller.action})", theme.SZ_SMALL, False, theme.MUTED)],
            valign="m",
        )
    )
    _bullets(s, x + PAD, y1 + 0.94, w - 2 * PAD, h1 - 0.94 - PAD, ep.controller.bullets)

    # ----- 3. Model -----
    x, w = theme.P3_X, theme.P3_W
    _panel(s, x, y1, w, h1, "model")
    _panel_head(s, x, y1, w, 3, "Model — กฎธุรกิจและข้อมูล", "model")
    _heading(s, x + PAD, y1 + 0.40, w - 2 * PAD, ep.model.name)
    _bullets(s, x + PAD, y1 + 0.74, w - 2 * PAD, h1 - 0.74 - PAD, ep.model.bullets)

    # ----- Database -----
    x, w = theme.DB_X, theme.DB_W
    s.add(
        Text(
            x - 0.10,
            y1 + 0.14,
            w + 0.20,
            0.52,
            [Para(ep.db.write, theme.SZ_TINY, True, theme.LAYER["db"]["head"], align="c")],
            valign="t",
        )
    )
    cyl_w = 1.10
    cyl_x = x + (w - cyl_w) / 2
    s.add(Cylinder(cyl_x, y1 + 0.78, cyl_w, 0.98, theme.LAYER["db"]["fill"], theme.LAYER["db"]["line"]))
    s.add(
        Text(
            cyl_x,
            y1 + 1.08,
            cyl_w,
            0.32,
            [Para("Database", theme.SZ_BODY, True, theme.LAYER["db"]["head"], align="c")],
            valign="m",
        )
    )
    s.add(
        Text(
            x - 0.10,
            y1 + 1.98,
            w + 0.20,
            0.52,
            [Para(ep.db.read, theme.SZ_TINY, False, theme.MUTED, align="c")],
            valign="t",
        )
    )

    # ----- ลูกศรแถวบน -----
    g1a, g1b = theme.P1_X + theme.P1_W + 0.07, theme.P2_X - 0.07
    g2a, g2b = theme.P2_X + theme.P2_W + 0.07, theme.P3_X - 0.07
    g3a, g3b = theme.P3_X + theme.P3_W + 0.07, cyl_x - 0.05
    yf, yb = y1 + ARROW_FWD_DY, y1 + ARROW_BACK_DY

    _step_badge(s, (g1a + g1b) / 2, yf - 0.30, 1)
    s.add(Arrow(g1a, yf, g1b, yf))
    _gap_label(s, g1a, g1b, yf + 0.08, "ส่งคำขอ\n(Request)")

    _step_badge(s, (g2a + g2b) / 2, yf - 0.30, 2)
    s.add(Arrow(g2a, yf, g2b, yf))
    _gap_label(s, g2a, g2b, yf + 0.08, "ส่งต่อให้\nModel")

    _gap_label(s, g2a, g2b, yb - 0.34, "คืนผลลัพธ์", h=0.28)
    s.add(Arrow(g2b, yb, g2a, yb))
    _step_badge(s, (g2a + g2b) / 2, yb + 0.30, 3)

    s.add(Arrow(g3a, yf, g3b, yf, color=theme.LAYER["db"]["line"]))
    s.add(Arrow(g3b, yb, g3a, yb, color=theme.LAYER["db"]["line"]))

    # ----- 4. View (หน้าผลลัพธ์) -----
    x, w = theme.P4_X, theme.P4_W
    _panel(s, x, y2, w, h2, "view")
    _panel_head(s, x, y2, w, 4, "View — หน้าจอที่ระบบตอบกลับ", "view")
    _heading(s, x + PAD, y2 + 0.40, w - 2 * PAD, ep.view_out.caption)
    _mock_card(
        s,
        x + PAD,
        y2 + 0.74,
        w - 2 * PAD,
        ep.view_out.card,
        label_w=1.45,
        accent=theme.LAYER["view"]["line"],
    )

    # ลูกศร ④ จาก Controller ลงมาที่หน้าผลลัพธ์
    ctrl_cx = theme.P2_X + theme.P2_W / 2
    s.add(Arrow(ctrl_cx, y1 + h1 + 0.05, ctrl_cx, y2 - 0.05))
    _step_badge(s, ctrl_cx + 0.34, y2 - 0.22, 4)
    s.add(
        Text(
            ctrl_cx + 0.52,
            y2 - 0.37,
            2.40,
            0.30,
            [Para("เลือก View ที่จะแสดงผล", theme.SZ_TINY, False, theme.MUTED)],
            valign="m",
        )
    )

    # ----- ผู้ใช้ -----
    x, w = theme.ACTOR_X, theme.ACTOR_W
    s.add(Person(x + w / 2, y2 + 0.22, 0.72, theme.MUTED))
    s.add(
        Text(
            x - 0.10,
            y2 + 1.12,
            w + 0.20,
            0.28,
            [Para(ep.actor, theme.SZ_PANEL_SUB + 1.5, True, theme.INK, align="c")],
            valign="m",
        )
    )
    arrow_y = y2 + 1.78
    s.add(Arrow(theme.P4_X - 0.06, arrow_y, x + w + 0.06, arrow_y))
    _step_badge(s, (x + w + theme.P4_X) / 2, arrow_y - 0.30, 5)
    s.add(
        Text(
            x - 0.10,
            arrow_y + 0.08,
            w + 0.20,
            0.46,
            [Para("แสดงผลให้ทันที\n(Response)", theme.SZ_TINY, False, theme.MUTED, align="c")],
            valign="t",
        )
    )

    # ----- สรุปการทำงาน -----
    x, w = theme.SUM_X, theme.SUM_W
    c = theme.LAYER["summary"]
    s.add(Box(x, y2, w, h2, fill=c["fill"], line=c["line"], line_w=1.25, radius=0.12))
    s.add(
        Text(
            x + PAD,
            y2 + 0.14,
            w - 2 * PAD,
            0.28,
            [Para("สรุปการทำงาน", theme.SZ_PANEL_TITLE, True, theme.INK)],
            valign="m",
        )
    )
    note_h = 0.0
    if ep.note:
        lines = wrap(f"หมายเหตุ  {ep.note}", w - 2 * PAD - 0.18, theme.FONT_TH, False, theme.SZ_SMALL)
        note_h = len(lines) * line_height_in(theme.SZ_SMALL) + 0.14
    _numbered(s, x + PAD, y2 + 0.48, w - 2 * PAD, h2 - 0.48 - PAD - note_h, ep.summary)
    if ep.note:
        ny = y2 + h2 - PAD - note_h
        s.add(Box(x + PAD, ny, w - 2 * PAD, note_h, fill="FEF2F2", line=None, radius=0.06))
        s.add(
            Text(
                x + PAD + 0.09,
                ny + 0.06,
                w - 2 * PAD - 0.18,
                note_h - 0.12,
                [Para(f"หมายเหตุ  {ep.note}", theme.SZ_SMALL, False, theme.DANGER)],
                valign="t",
            )
        )

    # ----- เลขหน้า -----
    s.add(
        Text(
            theme.SLIDE_W - theme.MARGIN_R - 1.6,
            7.08,
            1.6,
            0.22,
            [Para(f"{index} / {total}", theme.SZ_TINY, False, theme.FAINT, align="r")],
            valign="m",
        )
    )
    return s


# ---------- สไลด์ประกอบ ----------


def cover_slide(subtitle: str, total_endpoints: int) -> Slide:
    s = Slide(title="ปก")
    s.add(Box(0, 0, theme.SLIDE_W, theme.SLIDE_H, fill=theme.CRIMSON, line=None, radius=0))
    s.add(
        Text(
            1.1,
            2.05,
            11.0,
            0.5,
            [Para("CineBook — ระบบจองตั๋วภาพยนตร์", 16, True, "F0C9CF")],
            valign="m",
        )
    )
    s.add(
        Text(
            1.1,
            2.62,
            11.0,
            1.0,
            [Para("MVC Architecture ของทุก API", 46, True, "FFFFFF")],
            valign="m",
        )
    )
    s.add(
        Text(
            1.1,
            3.72,
            11.0,
            0.5,
            [Para(subtitle, 17, False, "EBC6CB")],
            valign="m",
        )
    )
    s.add(
        Text(
            1.1,
            4.60,
            11.0,
            0.9,
            [
                Para(
                    f"{total_endpoints} endpoint · หน้าละ 1 endpoint · "
                    "ไล่เส้นทาง View → Controller → Model → Database",
                    14,
                    False,
                    "E7B9C0",
                )
            ],
            valign="t",
        )
    )
    return s


def legend_slide(total_endpoints: int) -> Slide:
    """สไลด์อธิบายว่าชั้น MVC แต่ละชั้นคืออะไรในระบบนี้ และวิธีอ่านสไลด์ถัดไป"""
    s = Slide(title="MVC ในระบบนี้")
    s.add(
        Text(
            theme.MARGIN_L,
            0.42,
            12.3,
            0.55,
            [Para("MVC ในระบบนี้คืออะไร", 30, True, theme.INK)],
            valign="m",
        )
    )
    s.add(
        Text(
            theme.MARGIN_L,
            1.02,
            12.3,
            0.34,
            [
                Para(
                    "ทุกสไลด์ถัดจากนี้ใช้ผังเดียวกัน เปลี่ยนเฉพาะเนื้อหาในกล่องตาม endpoint นั้น",
                    13,
                    False,
                    theme.MUTED,
                )
            ],
            valign="m",
        )
    )

    cards = [
        (
            "view",
            "View",
            "หน้าจอที่ผู้ใช้เห็น",
            [
                "หน้าเว็บที่ผู้ใช้กรอกข้อมูลและกดปุ่ม",
                "ส่งคำขอไปยัง Controller",
                "รับผลลัพธ์กลับมาแสดงทันที โดยไม่ต้องโหลดหน้าใหม่",
            ],
        ),
        (
            "controller",
            "Controller",
            "ผู้รับคำขอและตัดสินใจ",
            [
                "รับข้อมูลจากฟอร์มและตรวจสิทธิ์ผู้เรียก",
                "ตรวจรูปแบบข้อมูลก่อนส่งต่อ",
                "เรียกใช้ Model แล้วเลือกว่าจะตอบ View แบบไหน",
                "ไม่แตะฐานข้อมูลเอง",
            ],
        ),
        (
            "model",
            "Model",
            "กฎธุรกิจและข้อมูล",
            [
                "รวมกฎของธุรกิจไว้ที่เดียว เช่น การคิดราคา การกันที่นั่งซ้ำ",
                "เป็นชั้นเดียวที่อ่านและเขียนฐานข้อมูล",
                "คืนผลลัพธ์หรือข้อผิดพลาดกลับให้ Controller",
            ],
        ),
        (
            "db",
            "Database",
            "ที่เก็บข้อมูลถาวร",
            [
                "เก็บผู้ใช้ ภาพยนตร์ รอบฉาย ที่นั่ง การจอง และการชำระเงิน",
                "เป็นด่านสุดท้ายที่การันตีว่าที่นั่งหนึ่งที่มีเจ้าของได้คนเดียว",
            ],
        ),
    ]

    steps = [
        "ผู้ใช้กดปุ่มบนหน้าจอ แล้วส่งคำขอไปยัง Controller",
        "Controller ตรวจสิทธิ์และรูปแบบข้อมูล แล้วส่งต่อให้ Model",
        "Model ทำงานกับฐานข้อมูล แล้วคืนผลลัพธ์กลับมา",
        "Controller เลือก View ที่จะแสดงผล",
        "View แสดงผลให้ผู้ใช้ทันที โดยไม่ต้องโหลดหน้าใหม่",
    ]

    # ความสูงของกล่องคิดจากเนื้อหาจริง แล้วจัดทั้งกลุ่มให้อยู่กลางพื้นที่ที่เหลือ
    w, gap = 2.95, 0.18
    bullets_w = w - 2 * PAD
    body_h = max(
        block_height(_bullet_paras(b, theme.SZ_SMALL, theme.INK), bullets_w) for *_, b in cards
    )
    card_h = 0.88 + body_h + 0.20

    sw = (12.33 - 2 * PAD) / 5
    step_w = sw - 2 * BADGE_R - 0.24
    step_h = max(block_height([Para(t, theme.SZ_SMALL)], step_w) for t in steps)
    steps_h = 0.46 + step_h + 0.30

    footer_h = 0.30
    group_h = card_h + 0.34 + steps_h + 0.32 + footer_h
    # เกาะขอบบนเป็นหลัก แล้วดันลงมาเล็กน้อย ที่ว่างส่วนใหญ่จะได้อยู่ด้านล่าง ไม่ใช่คั่นใต้หัวเรื่อง
    top = 1.62 + max(0.0, 7.05 - 1.62 - group_h) * 0.28

    x = theme.MARGIN_L
    for key, name, sub, bullets in cards:
        c = theme.LAYER[key]
        s.add(Box(x, top, w, card_h, fill=c["fill"], line=c["line"], line_w=1.25, radius=0.12))
        s.add(
            Text(x + PAD, top + 0.14, bullets_w, 0.36, [Para(name, 19, True, c["head"])], valign="m")
        )
        s.add(
            Text(
                x + PAD,
                top + 0.52,
                bullets_w,
                0.24,
                [Para(sub, theme.SZ_SMALL, True, theme.MUTED)],
                valign="m",
            )
        )
        _bullets(s, x + PAD, top + 0.88, bullets_w, body_h, bullets, size=theme.SZ_SMALL)
        x += w + gap

    sy = top + card_h + 0.34
    s.add(Box(theme.MARGIN_L, sy, 12.33, steps_h, fill="FAFAFA", line=theme.HAIRLINE, radius=0.12))
    s.add(
        Text(
            theme.MARGIN_L + PAD,
            sy + 0.10,
            12.33 - 2 * PAD,
            0.30,
            [Para("ลำดับการทำงานที่เห็นในทุกสไลด์", theme.SZ_PANEL_TITLE, True, theme.INK)],
            valign="m",
        )
    )
    for i, step in enumerate(steps):
        sx = theme.MARGIN_L + PAD + i * sw
        _step_badge(s, sx + BADGE_R, sy + 0.46 + BADGE_R, i + 1)
        s.add(
            Text(sx + 2 * BADGE_R + 0.10, sy + 0.46, step_w, step_h, [Para(step, theme.SZ_SMALL)])
        )
    s.add(
        Text(
            theme.MARGIN_L,
            sy + steps_h + 0.32,
            12.33,
            footer_h,
            [
                Para(
                    f"รวมทั้งหมด {total_endpoints} endpoint — เรียงตามกลุ่ม: "
                    "สถานะระบบ · บัญชีผู้ใช้ · ภาพยนตร์ · รอบฉาย · การจอง · การชำระเงิน · การแจ้งเตือน · ผู้ดูแลระบบ",
                    theme.SZ_SMALL,
                    False,
                    theme.MUTED,
                )
            ],
            valign="m",
        )
    )
    return s


def toc_slide(counts: list[tuple[str, str, int, int]]) -> Slide:
    """สารบัญ: (ชื่อกลุ่ม, คำอธิบาย, จำนวน endpoint, เลขสไลด์แรกของกลุ่ม)"""
    s = Slide(title="สารบัญ")
    s.add(
        Text(
            theme.MARGIN_L,
            0.42,
            12.3,
            0.55,
            [Para("สารบัญ", 30, True, theme.INK)],
            valign="m",
        )
    )
    s.add(
        Text(
            theme.MARGIN_L,
            1.02,
            12.3,
            0.34,
            [Para("แบ่งตามกลุ่มของ endpoint", 13, False, theme.MUTED)],
            valign="m",
        )
    )

    cols = 2
    cw = (12.33 - 0.30) / cols
    rows = (len(counts) + cols - 1) // cols
    for i, (name, desc, n, page) in enumerate(counts):
        col, row = i // rows, i % rows
        x = theme.MARGIN_L + col * (cw + 0.30)
        y = 1.62 + row * 1.24
        s.add(Box(x, y, cw, 1.08, fill="FAFAFA", line=theme.HAIRLINE, radius=0.10))
        s.add(
            Text(
                x + 0.20,
                y + 0.14,
                cw - 1.70,
                0.34,
                [Para(name, 16, True, theme.INK)],
                valign="m",
            )
        )
        s.add(
            Text(
                x + 0.20,
                y + 0.54,
                cw - 1.70,
                0.36,
                [Para(desc, theme.SZ_SMALL, False, theme.MUTED)],
                valign="t",
            )
        )
        s.add(
            Text(
                x + cw - 1.60,
                y + 0.14,
                1.40,
                0.34,
                [Para(f"{n} endpoint", theme.SZ_SMALL, True, theme.CRIMSON, align="r")],
                valign="m",
            )
        )
        s.add(
            Text(
                x + cw - 1.60,
                y + 0.54,
                1.40,
                0.30,
                [Para(f"เริ่มหน้า {page}", theme.SZ_TINY, False, theme.FAINT, align="r")],
                valign="m",
            )
        )
    return s


def divider_slide(group_key: str, n: int, note: str) -> Slide:
    s = Slide(title=f"กลุ่ม {group_key}")
    s.add(Box(0, 0, theme.SLIDE_W, theme.SLIDE_H, fill=theme.CRIMSON, line=None, radius=0))
    s.add(
        Text(
            1.1,
            2.85,
            11.0,
            0.44,
            [Para(f"/api/{group_key}", 17, True, "E7B9C0", font=theme.FONT_MONO)],
            valign="m",
        )
    )
    s.add(
        Text(
            1.1,
            3.32,
            11.0,
            0.84,
            [Para(GROUPS[group_key], 40, True, "FFFFFF")],
            valign="m",
        )
    )
    s.add(
        Text(
            1.1,
            4.28,
            11.0,
            0.62,
            [Para(f"{n} endpoint · {note}", 14, False, "EBC6CB")],
            valign="t",
        )
    )
    return s
