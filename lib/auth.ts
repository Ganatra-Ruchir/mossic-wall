// Admin authentication. The password comes from ADMIN_PASSWORD if it is set in
// Vercel; otherwise the first visitor to /admin creates one (stored as a scrypt
// hash in the database). Sessions are HMAC-signed with a random secret that the
// database generates on first run.
import {createHmac, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {getSetting, one} from './db';

export const ADMIN_COOKIE = 'mosaic_admin';
const SESSION_DAYS = 7;

type CookieReader = {cookies: {get(name: string): {value: string} | undefined}};

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyHash(pw: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 'env' = ADMIN_PASSWORD set in Vercel, 'db' = created in the app, 'none' = first run. */
export async function passwordMode(): Promise<'env' | 'db' | 'none'> {
  if (process.env.ADMIN_PASSWORD) return 'env';
  return (await getSetting('admin_password_hash')) ? 'db' : 'none';
}

export async function checkPassword(pw: string): Promise<boolean> {
  if (process.env.ADMIN_PASSWORD) return safeEqual(pw, process.env.ADMIN_PASSWORD);
  const stored = await getSetting('admin_password_hash');
  return !!stored && verifyHash(pw, stored);
}

/** First run only: store the admin password. Returns false if one already exists. */
export async function createPassword(pw: string): Promise<boolean> {
  if (process.env.ADMIN_PASSWORD) return false;
  const row = await one("insert into app_settings(key,value) values('admin_password_hash',$1) on conflict(key) do nothing returning key", [hashPassword(pw)]);
  return !!row;
}

async function secret() {
  const s = process.env.ADMIN_SESSION_SECRET || (await getSetting('session_secret'));
  if (!s) throw new Error('Session secret missing');
  // Changing the password logs everyone out.
  return `${s}:${process.env.ADMIN_PASSWORD ? 'env:' + process.env.ADMIN_PASSWORD : (await getSetting('admin_password_hash')) ?? ''}`;
}

export async function createSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const sig = createHmac('sha256', await secret()).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

export async function isAdmin(req: CookieReader): Promise<boolean> {
  const v = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  try {
    const want = createHmac('sha256', await secret()).update(exp).digest('hex');
    return safeEqual(sig, want);
  } catch {
    return false;
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
