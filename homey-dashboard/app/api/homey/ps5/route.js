import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';
import { extensionEnd, normallyOn, PS5 } from '../../../../lib/ps5';

// Oliver's PS5 plug (lib/ps5.js). The Homey flow "O - PS5" switches it; this route reads its two
// Logic variables and writes the extension.
// GET → { schoolTomorrow, until }
// POST { minutes } → the plug stays on until bedtime + minutes (or now + minutes outside the normal
//   hours, when it is also switched on). POST { cancel: true } → back to the normal schedule;
//   switched off if that has it off now.
async function readVars(session) {
  const vars = Object.values(await homeyFetch(session, '/api/manager/logic/variable') || {});
  return {
    school: vars.find((v) => v.name === PS5.schoolVar) || null,
    until: vars.find((v) => v.name === PS5.untilVar) || null,
  };
}

const stateOf = ({ school, until }) => ({
  schoolTomorrow: school && typeof school.value === 'boolean' ? school.value : null,
  until: until && typeof until.value === 'number' ? until.value : 0,
});

export async function GET() {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  try {
    const vars = await readVars(session);
    if (!vars.until) return NextResponse.json({ error: `${PS5.untilVar} variable not found` }, { status: 404 });
    const res = NextResponse.json(stateOf(vars));
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}

async function setPlug(session, on) {
  await homeyFetch(session, `/api/manager/devices/device/${PS5.deviceId}/capability/onoff`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: on }),
  });
}

export async function POST(request) {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const cancel = body?.cancel === true;
  const minutes = body?.minutes;
  if (!cancel && !(Number.isInteger(minutes) && minutes > 0 && minutes <= PS5.maxMinutes)) {
    return NextResponse.json({ error: `minutes must be 1-${PS5.maxMinutes}` }, { status: 400 });
  }
  try {
    const vars = await readVars(session);
    if (!vars.until) return NextResponse.json({ error: `${PS5.untilVar} variable not found` }, { status: 404 });
    const { schoolTomorrow } = stateOf(vars);
    const now = Date.now();
    const until = cancel ? 0 : extensionEnd({ now, schoolTomorrow, minutes });
    await homeyFetch(session, `/api/manager/logic/variable/${vars.until.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: until }),
    });
    // Outside the normal hours the flow would not switch it on before the next motion, nor off
    // after a cancel before the next set time, so do it here. During the day motion does it.
    if (!normallyOn({ now, schoolTomorrow })) await setPlug(session, !cancel);
    const res = NextResponse.json({ ok: true, schoolTomorrow, until });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
