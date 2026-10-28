import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getBaseUrl, STATE_COOKIE_NAME } from '../../../../lib/config';

export async function GET() {
  const clientId = process.env.ATHOM_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'ATHOM_CLIENT_ID is not configured on the server yet.' },
      { status: 500 },
    );
  }

  const redirectUri = `${getBaseUrl()}/api/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const url = new URL('https://api.athom.com/oauth2/authorise');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
