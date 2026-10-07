import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxySecretMatcher } from './proxySecret.js';

const SECRET = 'a'.repeat(32) + 'b'.repeat(32);

test('ผ่านเฉพาะค่าที่ตรงกับ secret ทุกตัวอักษร', () => {
  const matches = createProxySecretMatcher(SECRET);
  assert.equal(matches(SECRET), true);
  assert.equal(matches(SECRET.slice(0, -1)), false);
  assert.equal(matches(`${SECRET}x`), false);
  assert.equal(matches(''), false);
  assert.equal(matches(undefined), false);
});

test('ยังไม่ได้ตั้ง secret ไม่มีค่าไหนผ่าน — แม้แต่ค่าว่าง', () => {
  for (const secret of [undefined, '']) {
    const matches = createProxySecretMatcher(secret);
    assert.equal(matches(''), false);
    assert.equal(matches(undefined), false);
    assert.equal(matches(SECRET), false);
  }
});
