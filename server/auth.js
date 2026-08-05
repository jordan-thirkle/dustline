// DUSTLINE auth helpers — password hashing (scrypt, built-in crypto) + session tokens.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return test.length === expected.length && timingSafeEqual(test, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}
