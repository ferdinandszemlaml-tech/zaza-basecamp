// Hesla, přihlašovací cookie a jednorázové odkazy.
import crypto from 'node:crypto';
import { HttpError } from './http.mjs';
import { SESSION_DAYS } from './constants.mjs';

const COOKIE = 'bc_session';
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

let dummyHash;
export function verifyPassword(password, stored) {
  // I pro neexistující účet se heslo spočítá, aby délka odpovědi nic neprozradila.
  const target = stored || (dummyHash ??= hashPassword('dummy-password-for-timing'));
  const [alg, saltHex, hashHex] = target.split('$');
  if (alg !== 'scrypt') return false;
  const calc = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64, SCRYPT);
  const expected = Buffer.from(hashHex, 'hex');
  const ok = expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
  return Boolean(stored) && ok;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new HttpError(500, 'Server není nastavený: chybí SESSION_SECRET (aspoň 32 znaků).');
  }
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function sessionCookie(user) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const payload = b64url(JSON.stringify({ u: user.id, v: user.pwv, e: Date.now() + maxAge * 1000 }));
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const [payload, sig] = match.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.e || data.e < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function newToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
