process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-please-ignore-0000000000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signActionToken, verifyActionToken } = require('../actionTokens');

test('a freshly signed token verifies for its own task id and action', () => {
  const token = signActionToken(42, 'done');
  assert.equal(verifyActionToken(token, 42, 'done'), true);
});

test('a token is rejected for the wrong task id', () => {
  const token = signActionToken(42, 'done');
  assert.equal(verifyActionToken(token, 43, 'done'), false);
});

test('a token is rejected for the wrong action (scoped, not reusable)', () => {
  const token = signActionToken(42, 'done');
  assert.equal(verifyActionToken(token, 42, 'snooze'), false);
});

test('a tampered token is rejected', () => {
  const token = signActionToken(42, 'done');
  const tampered = token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0');
  assert.equal(verifyActionToken(tampered, 42, 'done'), false);
});

test('missing, malformed, or non-string tokens are rejected without throwing', () => {
  assert.equal(verifyActionToken(undefined, 42, 'done'), false);
  assert.equal(verifyActionToken('', 42, 'done'), false);
  assert.equal(verifyActionToken('not.enough', 42, 'done'), false);
  assert.equal(verifyActionToken('too.many.parts.here', 42, 'done'), false);
  assert.equal(verifyActionToken(12345, 42, 'done'), false);
});

test('tokens for different secrets do not cross-verify', () => {
  const token = signActionToken(42, 'done');
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-completely-different-secret-value';
  try {
    assert.equal(verifyActionToken(token, 42, 'done'), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});
