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
    // For the empty-room countdown (lib/emptyRoom.js): Mørkt and the rooms' countdown lengths
    const list = Object.values(vars || {});
    const darkVar = list.find((x) => x.name === 'Mørkt');
    const inactivity = {};
    for (const x of list) if (/_InactivitySeconds$/.test(x.name) && typeof x.value === 'number') inactivity[x.name] = x.value;
    const res = NextResponse.json({
      status,
      vars: { dark: darkVar && typeof darkVar.value === 'boolean' ? darkVar.value : null, inactivity },
    });
    persistSession(res, session);
    return res;
  } catch (e) {
    // Non-2xx so the client keeps its last good status through a passing hiccup
    return NextResponse.json({ status: null, error: String(e.message || e) }, { status: 502 });
  }
}
