import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Diagnostic: for each light, dump the fields that might indicate grouping so we can
// tell group devices from their member bulbs and hide the members on the tiles.
export async function GET() {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }
  try {
    const obj = await homeyFetch(session, '/api/manager/devices/device');
    const all = Object.values(obj || {});
    const sampleKeys = all.length ? Object.keys(all[0]) : [];
    const lights = all
      .filter((d) => d.class === 'light' || (d.capabilitiesObj && d.capabilitiesObj.onoff))
      .map((d) => {
        const groupish = {};
        for (const [k, v] of Object.entries(d)) {
          if (/group|member|child|virtual|flag/i.test(k)) groupish[k] = v;
        }
        return {
          id: d.id,
          name: d.name,
          zoneName: d.zoneName,
          class: d.class,
          virtualClass: d.virtualClass,
          driverId: d.driverId,
          driverUri: d.driverUri,
          capabilities: Object.keys(d.capabilitiesObj || d.capabilities || {}),
          settings: d.settings || null,
          ...groupish,
        };
      });
    const res = NextResponse.json({ count: lights.length, sampleKeys, lights });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 401 });
  }
}
