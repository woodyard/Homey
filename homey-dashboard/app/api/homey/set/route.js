import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Set capability values on one or more devices (a light's state and colour, a thermostat target, …).
// Body: { items: [{ deviceId, values: { onoff?, light_mode?, light_hue?, light_saturation?, dim?,
//                                       light_temperature?, windowcoverings_set?, target_temperature? } }] }
// Uses homey.device.control — allowed for OAuth clients (unlike running HomeyScript).
// onoff/light_mode are applied first, so the colour or temperature that follows takes effect.
// A capability that is not on this list is reported back, never dropped in silence.
const CAP_ORDER = [
  'onoff', 'light_mode', 'light_hue', 'light_saturation', 'dim', 'light_temperature',
  'windowcoverings_set', 'target_temperature',
];

export async function POST(request) {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: 'items are required' }, { status: 400 });
  }

  const errors = [];
  let applied = 0;
  for (const item of items) {
    const deviceId = item?.deviceId;
    const values = item?.values || {};
    if (!deviceId || typeof deviceId !== 'string') continue;
    for (const cap of Object.keys(values)) {
      if (!CAP_ORDER.includes(cap)) errors.push(`${cap}: not supported`);
    }
    for (const cap of CAP_ORDER) {
      if (!(cap in values)) continue;
      try {
        await homeyFetch(session, `/api/manager/devices/device/${deviceId}/capability/${cap}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: values[cap] }),
        });
        applied += 1;
      } catch (e) {
        errors.push(`${cap}: ${String(e.message || e)}`);
      }
    }
  }

  if (applied === 0 && errors.length) {
    return NextResponse.json({ error: errors[0] }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true, applied, errors });
  persistSession(res, session);
  return res;
}
