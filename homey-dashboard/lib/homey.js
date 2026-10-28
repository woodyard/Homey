// Server-side helpers for talking to the Athom Cloud API + a user's Homey.
// Flow (see https://api.developer.homey.app/http-and-socket.io/http-specification):
//   1. OAuth2 with Athom -> access_token + refresh_token
//   2. GET /user/me -> homey's remoteUrl
//   3. POST /delegation/token?audience=homey&homeyId=<id> -> delegation token bound to that Homey
//   4. POST <remoteUrl>/api/manager/users/login -> homey session token
//   5. Call <remoteUrl>/api/manager/... with "Authorization: Bearer <session token>"

import { getBaseUrl } from './config';

const ATHOM_API = 'https://api.athom.com';

class HomeyAuthError extends Error {}

function basicAuthHeader() {
  const id = process.env.ATHOM_CLIENT_ID;
  const secret = process.env.ATHOM_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('ATHOM_CLIENT_ID / ATHOM_CLIENT_SECRET env vars are not set');
  }
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export async function exchangeCodeForToken(code) {
  const res = await fetch(`${ATHOM_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${getBaseUrl()}/api/auth/callback`,
    }),
  });
  if (!res.ok) {
    throw new HomeyAuthError(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function refreshAthomToken(session) {
  const res = await fetch(`${ATHOM_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.athomRefreshToken,
    }),
  });
  if (!res.ok) {
    throw new HomeyAuthError(`athom refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  session.athomAccessToken = data.access_token;
  session.athomRefreshToken = data.refresh_token;
  session.athomExpiresAt = Date.now() + Number(data.expires_in) * 1000;
}

async function ensureAthomToken(session) {
  if (Date.now() < session.athomExpiresAt - 60_000) return;
  await refreshAthomToken(session);
}

export async function fetchAthomUser(accessToken) {
  const res = await fetch(`${ATHOM_API}/user/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new HomeyAuthError(`/user/me failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function loginToHomey(session) {
  // Bind the delegation token to this Homey; Athom will reject unbound requests in future.
  const params = new URLSearchParams({ audience: 'homey', homeyId: session.homeyId });
  const delegRes = await fetch(`${ATHOM_API}/delegation/token?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.athomAccessToken}` },
  });
  if (!delegRes.ok) {
    throw new HomeyAuthError(`delegation token failed: ${delegRes.status} ${await delegRes.text()}`);
  }
  const delegationToken = await delegRes.json();

  const loginRes = await fetch(`${session.homeyRemoteUrl}/api/manager/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: delegationToken }),
  });
  if (!loginRes.ok) {
    throw new HomeyAuthError(`homey login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  session.homeySessionToken = await loginRes.json();
}

/** Build a fresh session object right after the OAuth callback. */
export async function buildSessionFromTokenResponse(tokenData) {
  const session = {
    athomAccessToken: tokenData.access_token,
    athomRefreshToken: tokenData.refresh_token,
    athomExpiresAt: Date.now() + Number(tokenData.expires_in) * 1000,
    homeyId: null,
    homeyName: null,
    homeyRemoteUrl: null,
    homeySessionToken: null,
  };
  const me = await fetchAthomUser(session.athomAccessToken);
  const homey = (me.homeys || [])[0];
  if (!homey || !homey.remoteUrl) {
    throw new HomeyAuthError('No Homey with a remote URL found on this Athom account.');
  }
  session.homeyId = homey._id;
  session.homeyName = homey.name;
  session.homeyRemoteUrl = homey.remoteUrl;
  await loginToHomey(session);
  return session;
}

/**
 * Call a path on the user's Homey, refreshing tokens / re-logging in as needed.
 * Mutates `session` in place; caller is responsible for re-persisting the cookie.
 */
export async function homeyFetch(session, path, opts = {}) {
  await ensureAthomToken(session);

  const doFetch = () =>
    fetch(`${session.homeyRemoteUrl}${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${session.homeySessionToken}`,
      },
    });

  let res = await doFetch();
  if (res.status === 401) {
    await loginToHomey(session);
    res = await doFetch();
  }
  if (!res.ok) {
    throw new HomeyAuthError(`Homey API ${path} failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export { HomeyAuthError };
