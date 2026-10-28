import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getBaseUrl, STATE_COOKIE_NAME } from '../../../../lib/config';
import { exchangeCodeForToken, buildSessionFromTokenResponse } from '../../../../lib/homey';
import { persistSession } from '../../../../lib/sessionCookie';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const expectedState = cookies().get(STATE_COOKIE_NAME)?.value;
  const base = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${base}/?tab=rooms&error=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${base}/?tab=rooms&error=oauth_state_mismatch`);
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const session = await buildSessionFromTokenResponse(tokenData);
    const res = NextResponse.redirect(`${base}/?tab=rooms`);
    res.cookies.set(STATE_COOKIE_NAME, '', { path: '/', maxAge: 0 });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(String(e.message || e))}`);
  }
}
