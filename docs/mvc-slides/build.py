"""
สร้างเด็ค MVC Architecture ของทุก API

    python docs/mvc-slides/build.py                 # สร้าง .pptx + PNG ทุกหน้า + ตรวจการจัดวาง
    python docs/mvc-slides/build.py --no-png        # สร้างเฉพาะ .pptx
    python docs/mvc-slides/build.py --only 12,40    # เรนเดอร์ PNG เฉพาะบางหน้า
"""

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import check_fit  # noqa: E402
import layout  # noqa: E402
import render_png  # noqa: E402
import render_pptx  # noqa: E402
from content import GROUPS  # noqa: E402
from endpoints import ENDPOINTS, GROUP_NOTE  # noqa: E402
from spec import Deck  # noqa: E402

PROJECT_ROOT = HERE.parent.parent
OUT_PPTX = PROJECT_ROOT / "MVC-Architecture-API.pptx"
PREVIEW_DIR = HERE / "preview"

GROUP_ORDER = ["health", "auth", "movies", "showtimes", "bookings", "payments", "notifications", "admin"]


def grouped():
    buckets = {key: [] for key in GROUP_ORDER}
    for ep in ENDPOINTS:
        buckets[ep.group].append(ep)
    return buckets


def build_deck() -> Deck:
    buckets = grouped()
    total_endpoints = len(ENDPOINTS)
    front = 3  # ปก + MVC ในระบบนี้ + สารบัญ
    total_slides = front + len(GROUP_ORDER) + total_endpoints

    # เลขหน้าเริ่มต้นของแต่ละกลุ่ม (ไว้ใส่ในสารบัญ)
    page = front + 1
    toc_rows = []
    for key in GROUP_ORDER:
        n = len(buckets[key])
        toc_rows.append((GROUPS[key], GROUP_NOTE[key], n, page))
        page += 1 + n

    deck = Deck()
    deck.add(layout.cover_slide("เอกสารประกอบระบบจองตั๋วภาพยนตร์ออนไลน์", total_endpoints))
    deck.add(layout.legend_slide(total_endpoints))
    deck.add(layout.toc_slide(toc_rows))

    index = front
    for key in GROUP_ORDER:
        eps = buckets[key]
        index += 1
        deck.add(layout.divider_slide(key, len(eps), GROUP_NOTE[key]))
        for ep in eps:
            index += 1
            deck.add(layout.endpoint_slide(ep, index, total_slides))

    assert index == total_slides, f"นับสไลด์ไม่ตรง: {index} != {total_slides}"
    return deck


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-png", action="store_true")
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    deck = build_deck()
    print(f"สไลด์ทั้งหมด {len(deck.slides)} หน้า (endpoint {len(ENDPOINTS)} รายการ)")

    issues = check_fit.check_deck(deck)
    print(check_fit.report(issues))

    render_pptx.render_deck(deck, OUT_PPTX)
    print(f"เขียนไฟล์: {OUT_PPTX}")

    if not args.no_png:
        only = [int(v) for v in args.only.split(",") if v.strip()] if args.only else None
        written = render_png.render_deck(deck, PREVIEW_DIR, only=only)
        print(f"ภาพตัวอย่าง {len(written)} ไฟล์ใน {PREVIEW_DIR}")

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
