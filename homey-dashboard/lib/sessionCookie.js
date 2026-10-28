import { cookies } from 'next/headers';
import { encryptJson, decryptJson } from './crypto';
import { COOKIE_NAME } from './config';

const MAX_AGE = 60 * 60 * 24 * 180; // 180 days; Athom refresh tokens are valid ~6 months of inactivity

export function readSession() {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decryptJson(raw);
}

/** Attach an updated, encrypted session cookie to a NextResponse. */
export function persistSession(response, session) {
  response.cookies.set(COOKIE_NAME, encryptJson(session), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
  return response;
}

export function clearSession(response) {
  response.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}
