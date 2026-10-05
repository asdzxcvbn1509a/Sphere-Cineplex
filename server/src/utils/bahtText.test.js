import test from 'node:test';
import assert from 'node:assert/strict';
import { bahtText, bahtTextEn } from './bahtText.js';

test('bahtText อ่านหลักสิบตามหลักภาษาไทย (สิบ / ยี่สิบ / เอ็ด)', () => {
  assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
  assert.equal(bahtText(1), 'หนึ่งบาทถ้วน');
  assert.equal(bahtText(10), 'สิบบาทถ้วน');
  assert.equal(bahtText(11), 'สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(20), 'ยี่สิบบาทถ้วน');
  assert.equal(bahtText(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  assert.equal(bahtText(560), 'ห้าร้อยหกสิบบาทถ้วน');
  assert.equal(bahtText(1001), 'หนึ่งพันเอ็ดบาทถ้วน');
});

test('bahtText อ่านหลักล้านแบบเวียนซ้ำ และหลักหน่วยหลังหลักล้านเป็น "เอ็ด"', () => {
  assert.equal(bahtText(1_000_000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(bahtText(1_000_001), 'หนึ่งล้านเอ็ดบาทถ้วน');
  assert.equal(bahtText(11_000_000), 'สิบเอ็ดล้านบาทถ้วน');
  assert.equal(bahtText(21_000_021), 'ยี่สิบเอ็ดล้านยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(1_234_567), 'หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน');
  assert.equal(bahtText(1_000_000_000_000), 'หนึ่งล้านล้านบาทถ้วน');
});

test('bahtTextEn อ่านเป็นภาษาอังกฤษแบบใบเสร็จสองภาษา', () => {
  assert.equal(bahtTextEn(0), 'Zero Baht Only');
  assert.equal(bahtTextEn(1), 'One Baht Only');
  assert.equal(bahtTextEn(11), 'Eleven Baht Only');
  assert.equal(bahtTextEn(21), 'Twenty-One Baht Only');
  assert.equal(bahtTextEn(101), 'One Hundred One Baht Only');
  assert.equal(bahtTextEn(560), 'Five Hundred Sixty Baht Only');
  assert.equal(bahtTextEn(1001), 'One Thousand One Baht Only');
  assert.equal(bahtTextEn(1_000_001), 'One Million One Baht Only');
  assert.equal(
    bahtTextEn(1_234_567),
    'One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Baht Only',
  );
});

test('รับเฉพาะจำนวนเต็มบาทที่ไม่ติดลบ — ระบบเก็บเงินเป็นบาทเต็มเสมอ ค่าอื่นแปลว่ามีอะไรผิดมาก่อนแล้ว', () => {
  for (const bad of [-1, 1.5, Number.NaN, '560', null]) {
    assert.throws(() => bahtText(bad), RangeError);
    assert.throws(() => bahtTextEn(bad), RangeError);
  }
});
