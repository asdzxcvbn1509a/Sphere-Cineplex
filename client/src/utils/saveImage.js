/**
 * บันทึก element บนหน้าเป็นไฟล์รูป PNG (ปุ่ม "บันทึก E-Ticket")
 *
 * modern-screenshot ให้เบราว์เซอร์วาด DOM เองผ่าน SVG foreignObject รูปจึงออกมาตรงกับที่เห็นบนจอ
 * ทั้งฟอนต์ไทยและสีจาก token ของ DS โดยไม่ต้องเขียนโค้ดวาดตั๋วแยกอีกชุดที่ต้องคอยแก้ให้ตรงกัน
 * ฟอนต์จาก Google Fonts จะฝังลงรูปได้ก็ต่อเมื่อ <link> ใน index.html มี crossorigin (อ่าน @font-face ได้)
 */

/** วาดใหญ่ 3 เท่าของบนจอ — ตั๋วกว้าง ~420px ได้รูปราว 1,300px คมพอทั้งบนจอมือถือและตอนให้เครื่องสแกน QR */
const SCALE = 3;
/** ขอบสีพื้นหน้ารอบชิ้นงาน (px บนจอ) — มุมโค้งของตั๋วกลืนไปกับขอบ รูปไม่ดูเหมือนถูกตัดชิดขอบการ์ด */
const FRAME = 24;

const canvasToBlob = (canvas) => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('สร้างไฟล์ PNG ไม่สำเร็จ'));
    }, 'image/png');
  });
};

export const saveElementAsPng = async (element, fileName) => {
  // โหลดไลบรารีตอนกดบันทึก — คนส่วนใหญ่เปิดตั๋วแค่โชว์ QR ไม่ต้องดาวน์โหลดโค้ดส่วนนี้ทุกครั้ง
  const { domToCanvas } = await import('modern-screenshot');

  // ห้ามส่ง backgroundColor ให้ไลบรารี — มันจะเขียนทับพื้นของ element ตัวนอกสุด (!important) การ์ดตั๋วจะไม่มีพื้นกระดาษ
  // ปล่อยมุมโค้งนอกการ์ดโปร่งไว้ แล้วไปวางบนกรอบที่ทาสีพื้นหน้าไว้แล้วแทน
  const content = await domToCanvas(element, { scale: SCALE });

  // สีพื้นหน้า (token page) อ่านจาก body ไม่ต้องเขียนรหัสสีซ้ำในโค้ด
  const background = getComputedStyle(document.body).backgroundColor;
  const frame = FRAME * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = content.width + frame * 2;
  canvas.height = content.height + frame * 2;
  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(content, frame, frame);

  const url = URL.createObjectURL(await canvasToBlob(canvas));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  // Firefox รุ่นเก่ากดลิงก์ที่ไม่ได้อยู่ใน document ไม่ได้
  document.body.append(link);
  link.click();
  link.remove();
  // เบราว์เซอร์เริ่มดาวน์โหลดหลัง click() คืนค่าไปแล้ว ถ้าคืน URL ทันทีไฟล์อาจว่าง
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
