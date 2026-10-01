import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptPayPayload, crc16ccitt, isValidPayload, parseTlv } from './promptpay.js';

test('crc16ccitt ตรงกับค่าอ้างอิงของ CRC-16/CCITT-FALSE', () => {
  // ค่ามาตรฐานที่ใช้ทดสอบ CRC-16/CCITT-FALSE ของสตริง "123456789" คือ 0x29B1
  assert.equal(crc16ccitt('123456789'), '29B1');
});

test('payload ขึ้นต้นด้วย EMVCo header และปิดท้ายด้วย checksum ที่ถูกต้อง', () => {
  const payload = createPromptPayPayload(360);

  assert.ok(payload.startsWith('000201'), 'ต้องขึ้นต้นด้วย tag 00 = "01" (payload format indicator)');
  assert.ok(isValidPayload(payload), 'checksum ท้าย payload ต้องตรงกับที่คำนวณใหม่');
});

test('payload บรรจุยอดเงิน สกุลเงิน และประเทศครบตามมาตรฐาน', () => {
  const payload = createPromptPayPayload(1250);
  const tags = parseTlv(payload);

  assert.equal(tags['53'], '764', 'สกุลเงินต้องเป็น 764 (THB)');
  assert.equal(tags['58'], 'TH', 'ประเทศต้องเป็น TH');
  assert.equal(tags['54'], '1250.00', 'ยอดเงินต้องอยู่ใน tag 54 แบบทศนิยม 2 ตำแหน่ง');
  assert.ok(tags['29'], 'ต้องมี merchant account information ของ PromptPay');
});

test('ยอดเงินต่างกันทำให้ payload ต่างกัน (QR ผูกกับยอดจริง)', () => {
  assert.notEqual(createPromptPayPayload(100), createPromptPayPayload(200));
});

test('isValidPayload จับ payload ที่ถูกแก้ไขได้', () => {
  const payload = createPromptPayPayload(500);
  const tampered = `${payload.slice(0, -4)}0000`;

  assert.equal(isValidPayload(payload), true);
  assert.equal(isValidPayload(tampered), false);
  assert.equal(isValidPayload(''), false);
  assert.equal(isValidPayload(null), false);
});
