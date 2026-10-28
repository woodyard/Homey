import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Diagnostic: raw zone info so we can see what to order rooms by.
export async function GET() {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }
  try {
    const obj = await homeyFetch(session, '/api/manager/zones/zone');
    // Preserve the API's own key order as `apiIndex` — it may be the display order.
    const zones = Object.keys(obj).map((id, apiIndex) => ({ apiIndex, ...obj[id] }));
    const sampleKeys = zones.length ? Object.keys(zones[0]) : [];
    const res = NextResponse.json({ count: zones.length, sampleKeys, zones });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 401 });
  }
}
