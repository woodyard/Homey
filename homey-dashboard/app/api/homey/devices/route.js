import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';
import { buildZonePaths, buildZoneOrders } from '../../../../lib/zones';

export async function GET() {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  try {
    const [devicesObj, zonesObj] = await Promise.all([
      homeyFetch(session, '/api/manager/devices/device'),
      homeyFetch(session, '/api/manager/zones/zone'),
    ]);
    const zonePaths = buildZonePaths(zonesObj);
    const zoneOrders = buildZoneOrders(zonesObj);

    const devices = Object.values(devicesObj)
      // Hide bulbs that are members of a group (they carry `group` = the group's id);
      // the group device represents them on the dashboard.
      .filter((d) => !d.group)
      .map((d) => {
      const capabilities = {};
      const capTimes = {};
      for (const [capId, cap] of Object.entries(d.capabilitiesObj || {})) {
        capabilities[capId] = cap ? cap.value : null;
        // Timestamps for state-duration displays (how long inactive / window open).
        if (cap && cap.lastUpdated && (capId === 'alarm_motion' || capId === 'alarm_contact')) {
          capTimes[capId] = cap.lastUpdated;
        }
      }
      return {
        id: d.id,
        name: d.name,
        class: d.class,
        virtualClass: d.virtualClass || null,
        zoneId: d.zone,
        zonePath: zonePaths[d.zone] || d.zone,
        zoneOrder: zoneOrders[d.zone] || [Infinity],
        available: d.available,
        // "Always on" (energy setting): the device cannot meaningfully be switched off.
        alwaysOn: !!(d.settings && d.settings.energy_alwayson),
        capabilities,
        capTimes,
      };
    });

    // Zone presence state — used to seed the room inactivity timer accurately on load.
    const zones = {};
    for (const [zid, z] of Object.entries(zonesObj || {})) {
      zones[zid] = { active: z.active === true, activeLastUpdated: z.activeLastUpdated || null };
    }

    const res = NextResponse.json({ devices, zones });
    persistSession(res, session);
    return res;
  } catch (e) {
    const res = NextResponse.json({ error: String(e.message || e) }, { status: 401 });
    return res;
  }
}
