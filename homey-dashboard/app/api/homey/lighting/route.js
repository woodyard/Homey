import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// AdaptiveLighting's own per-light state, published by adaptivelighting.js (2.28+)
// to the Logic text variable "AdaptiveLightingStatus": mode (auto/manual/forced),
// profile and the values it actually applied. Read-only; status is null until the
// script has published once (the UI then falls back to its own guess).
export async function GET() {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  try {
    const vars = await homeyFetch(session, '/api/manager/logic/variable');
    const v = Object.values(vars || {}).find((x) => x.name === 'AdaptiveLightingStatus');
    let status = null;
    if (v && v.value) { try { status = JSON.parse(v.value); } catch { status = null; } }
    const res = NextResponse.json({ status });
    persistSession(res, session);
    return res;
  } catch (e) {
    // Non-2xx so the client keeps its last good status through a passing hiccup
    return NextResponse.json({ status: null, error: String(e.message || e) }, { status: 502 });
  }
}
