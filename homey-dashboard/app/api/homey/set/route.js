import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Set capability values on one or more devices (a light's state and colour, a thermostat target,
// a robot vacuum's clean mode, job and its pause / resume / go-home buttons, …).
// Body: { items: [{ deviceId, values: { onoff?, light_mode?, light_hue?, light_saturation?, dim?,
//                                       light_temperature?, windowcoverings_set?, target_temperature? } }] }
// Uses homey.device.control — allowed for OAuth clients (unlike running HomeyScript).
// The values go out in stages, in this order. onoff is first, so what follows takes effect.
// A light's mode, hue, saturation and temperature are one stage and go out together: a bulb's
// driver gathers what arrives at the same moment into one command to the bulb, as it does when
// Homey's own colour picker is used. Sent one after another, each value becomes its own command
// to every bulb of a group, and bulbs then miss some (one bulb red, the others still white).
// A capability that is not on this list is reported back, never dropped in silence.
const CAP_STAGES = [
  ['onoff'],
  ['light_mode', 'light_hue', 'light_saturation', 'light_temperature'],
  ['dim'],
  ['windowcoverings_set'],
  ['target_temperature'],
  ['vacuumcleaner_job_mode.clean_mode'],
  ['vacuumcleaner_job_mode'],
  ['button.operational_state_pause'],
  ['button.operational_state_resume'],
  ['button.operational_state_go_home'],
];
const CAPS = CAP_STAGES.flat();

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
      if (!CAPS.includes(cap)) errors.push(`${cap}: not supported`);
    }
    for (const stage of CAP_STAGES) {
      await Promise.all(stage.filter((cap) => cap in values).map(async (cap) => {
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
      }));
    }
  }

  if (applied === 0 && errors.length) {
    return NextResponse.json({ error: errors[0] }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true, applied, errors });
  persistSession(res, session);
  return res;
}
