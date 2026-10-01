import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustProxy } from './trustProxy.js';

test('ค่าที่เป็นตัวเลขแปลงเป็นจำนวน hop', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
});

test('true/false แปลงเป็น boolean และค่าว่างถือว่าไม่เชื่อ proxy', () => {
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy(undefined), false);
});

test('ชื่อ/subnet ส่งต่อให้ Express ตามเดิม โดยตัดช่องว่างรอบจุลภาค', () => {
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback,10.0.0.0/8');
});
