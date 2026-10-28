import { NextResponse } from 'next/server';
import { getBaseUrl } from '../../../../lib/config';
import { clearSession } from '../../../../lib/sessionCookie';

export async function GET() {
  const res = NextResponse.redirect(`${getBaseUrl()}/`);
  clearSession(res);
  return res;
}
