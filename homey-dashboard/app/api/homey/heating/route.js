import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Global heating state via the Homey Logic variable "HeatingEnabled" (set/read by the
// room_heating.js system). Logic variables are both readable and writable over the Web API.
async function findHeatingVar(session) {
  const vars = await homeyFetch(session, '/api/manager/logic/variable');
  return Object.values(vars || {}).find((v) => v.name === 'HeatingEnabled') || null;
}

export async function GET() {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  try {
    const vars = await homeyFetch(session, '/api/manager/logic/variable');
    const list = Object.values(vars || {});
    const he = list.find((v) => v.name === 'HeatingEnabled');
    const hs = list.find((v) => v.name === 'HeatingStatus');
    let status = {};
    if (hs && hs.value) { try { status = JSON.parse(hs.value); } catch { status = {}; } }
    const res = NextResponse.json({ heatingEnabled: he ? he.value : null, status });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ heatingEnabled: null, status: {}, error: String(e.message || e) }, { status: 200 });
  }
}

// Master switch: set HeatingEnabled true/false. Turning it back on is the "on" the
// user has no flow for — done directly here.
export async function POST(request) {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const enabled = body?.enabled === true;
  try {
    const he = await findHeatingVar(session);
    if (!he) return NextResponse.json({ error: 'HeatingEnabled variable not found' }, { status: 404 });
    await homeyFetch(session, `/api/manager/logic/variable/${he.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: enabled }),
    });
    const res = NextResponse.json({ ok: true, heatingEnabled: enabled });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
