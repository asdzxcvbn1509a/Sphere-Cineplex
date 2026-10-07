import test from 'node:test';
import assert from 'node:assert/strict';
import { loginKey, loginLookup, normalizeEmail } from './loginIdentifier.js';

test('มี @ = อีเมล ตัดช่องว่างและทำเป็นตัวพิมพ์เล็ก', () => {
  assert.equal(normalizeEmail('  Somchai@Example.TEST '), 'somchai@example.test');
  assert.deepEqual(loginLookup(' Somchai@Example.test'), { email: 'somchai@example.test' });
});

test('เบอร์โทรทุกรูปแบบของเบอร์เดียวกันได้ผลเดียวกัน', () => {
  for (const raw of ['0812345678', '081-234-5678', '081 234 5678', '+66812345678', '66812345678', '(081)2345678']) {
    assert.deepEqual(loginLookup(raw), { phone: '0812345678' }, raw);
    assert.equal(loginKey(raw), 'phone:0812345678', raw);
  }
});

test('กุญแจของอีเมลกับเบอร์ไม่ชนกัน และค่าว่างได้กุญแจว่าง', () => {
  assert.equal(loginKey('A@B.test'), 'email:a@b.test');
  assert.equal(loginLookup('   '), null);
  assert.equal(loginLookup(undefined), null);
  assert.equal(loginKey('---'), '');
});
