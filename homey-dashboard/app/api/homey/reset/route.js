import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Reset a light back to its scheduled ("Auto") settings by triggering the user's
// "light reset" flow (which runs the AdaptiveLighting HomeyScript for that light).
// OAuth Web API clients cannot run HomeyScript directly (app scopes are blocked),
// so we trigger the flow instead — that needs only the homey.flow.start scope.
export async function POST(request) {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const flowId = body?.flowId;
  const advanced = body?.advanced === true;
  if (!flowId || typeof flowId !== 'string') {
    return NextResponse.json({ error: 'flowId is required' }, { status: 400 });
  }

  const path = advanced
    ? `/api/manager/flow/advancedflow/${flowId}/trigger`
    : `/api/manager/flow/flow/${flowId}/trigger`;

  try {
    await homeyFetch(session, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = NextResponse.json({ ok: true });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
