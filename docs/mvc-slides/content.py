"""โครงข้อมูลเนื้อหาของหนึ่ง endpoint — ตัวข้อมูลจริงอยู่ใน endpoints.py"""

from dataclasses import dataclass, field


@dataclass
class Card:
    """การ์ดจำลองหน้าจอในกล่อง View"""

    rows: list[tuple[str, str]] = field(default_factory=list)
    button: str = ""
    status: str = ""          # ข้อความแถบสถานะด้านบนการ์ดผลลัพธ์ (เว้นว่าง = ไม่มี)
    status_kind: str = "ok"   # ok | info


@dataclass
class View:
    caption: str
    sub: str = ""
    card: Card = field(default_factory=Card)


@dataclass
class Ctrl:
    name: str
    action: str
    bullets: list[str] = field(default_factory=list)


@dataclass
class Model:
    name: str
    bullets: list[str] = field(default_factory=list)


@dataclass
class Db:
    write: str
    read: str


@dataclass
class Endpoint:
    group: str
    method: str
    path: str
    title: str
    actor: str
    flow: str
    view_in: View
    controller: Ctrl
    model: Model
    db: Db
    view_out: View
    summary: list[str]
    note: str = ""


GROUPS = {
    "health": "สถานะระบบ",
    "auth": "บัญชีผู้ใช้และเซสชัน",
    "movies": "ภาพยนตร์",
    "showtimes": "รอบฉายและผังที่นั่ง",
    "bookings": "การจอง",
    "payments": "การชำระเงิน",
    "notifications": "การแจ้งเตือน",
    "admin": "ผู้ดูแลระบบ",
}
