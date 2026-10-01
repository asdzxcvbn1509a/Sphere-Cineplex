# ตัวสร้างสไลด์ MVC Architecture

สร้างไฟล์ `MVC-Architecture-API.pptx` ที่รากโปรเจกต์ — **70 หน้า** = ปก + สไลด์อธิบาย MVC +
สารบัญ + สไลด์คั่น 8 กลุ่ม + **สไลด์ endpoint 59 หน้า (1 endpoint ต่อ 1 หน้า)**

## วิธีใช้

```bash
python docs/mvc-slides/build.py              # สร้าง .pptx + ภาพตัวอย่างทุกหน้า + ตรวจการจัดวาง
python docs/mvc-slides/build.py --no-png     # สร้างเฉพาะ .pptx
python docs/mvc-slides/build.py --only 7,29  # เรนเดอร์ภาพตัวอย่างเฉพาะบางหน้า
python docs/mvc-slides/verify_pptx.py        # ตรวจไฟล์ที่ได้: จำนวนหน้า ฟอนต์ไทย และโครงสร้าง XML
```

ต้องมี `python-pptx`, `Pillow`, `lxml` และเปิดจากเครื่อง Windows (อ่านไฟล์ฟอนต์จาก `C:\Windows\Fonts`)

## แก้เนื้อหา

แก้ที่ [endpoints.py](endpoints.py) แล้วรัน `build.py` ใหม่ — หนึ่ง `Endpoint` คือหนึ่งสไลด์
โดยมีช่องหลัก ๆ คือ `view_in` (หน้าจอที่ส่งคำขอ), `controller`, `model`, `db`, `view_out`,
`summary` (5 ข้อในกล่องสรุป) และ `note` (บรรทัดหมายเหตุสีแดง)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| [endpoints.py](endpoints.py) | เนื้อหาของทั้ง 59 endpoint |
| [content.py](content.py) | โครงข้อมูลของหนึ่ง endpoint |
| [theme.py](theme.py) | สี ฟอนต์ ขนาดตัวอักษร และพิกัดคอลัมน์ |
| [layout.py](layout.py) | วางเลย์เอาต์ของสไลด์แต่ละชนิด |
| [spec.py](spec.py) | primitive กลาง + การวัดและตัดบรรทัดข้อความ |
| [render_pptx.py](render_pptx.py) | เขียนเป็นไฟล์ .pptx |
| [render_png.py](render_png.py) | เรนเดอร์เป็น PNG ไว้ตรวจงานด้วยตา |
| [check_fit.py](check_fit.py) | ตรวจข้อความล้นกล่องและองค์ประกอบทับกัน |
| [verify_pptx.py](verify_pptx.py) | ตรวจไฟล์ .pptx ที่สร้างเสร็จแล้ว |

`layout.py` วางพิกัดทุกอย่างเป็นนิ้วลงใน primitive ชุดเดียว แล้วทั้งตัวเขียน `.pptx`
และตัวเรนเดอร์ PNG อ่านสเปกชุดเดียวกัน — ภาพตัวอย่างใน `preview/` จึงสะท้อนเลย์เอาต์ของไฟล์จริง

## ข้อควรรู้

- **ฟอนต์**: ใช้ `Leelawadee UI` ซึ่งติดมากับ Windows ทุกเครื่อง เปิดบน macOS อาจถูกแทนด้วยฟอนต์อื่น
- **ลูกศร →**: Leelawadee UI ไม่มี glyph นี้ ตัวสร้างจึงแยก run ให้ใช้ Arial เฉพาะตัวลูกศร
- **ภาษาไทยใน PowerPoint**: ต้องเขียน `<a:cs>` ไม่ใช่แค่ `<a:latin>` และลำดับต้องเป็น latin → ea → cs
  (`verify_pptx.py` ตรวจให้ทั้งสองข้อ)
