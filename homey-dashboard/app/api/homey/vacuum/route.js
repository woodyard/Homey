import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Start the robot vacuum in chosen rooms. Which rooms a robot cleans can only be set with its
// flow cards, and OAuth clients cannot run a flow card. So the rooms go into the Logic variable
// "VacuumRooms" (",K,SS," for two rooms, ",all," for every room) and the flow "Vacuum - Rooms"
// is started: it clears the robot's rooms, enables each one the variable names, and starts it.
// Body: { rooms: ['K', 'SS'] } or { rooms: ['all'] }.
const VARIABLE = 'VacuumRooms';
const FLOW = 'vacuum - rooms';
const CODE = /^[A-Za-z0-9]{1,6}$/;

export async function POST(request) {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rooms = Array.isArray(body?.rooms) ? body.rooms : [];
  if (!rooms.length || rooms.length > 20 || !rooms.every((r) => typeof r === 'string' && CODE.test(r))) {
    return NextResponse.json({ error: 'rooms are required' }, { status: 400 });
  }

  try {
    const [vars, advanced, standard] = await Promise.all([
      homeyFetch(session, '/api/manager/logic/variable'),
      homeyFetch(session, '/api/manager/flow/advancedflow'),
      homeyFetch(session, '/api/manager/flow/flow'),
    ]);
    const variable = Object.values(vars || {}).find((v) => v.name === VARIABLE);
    if (!variable) return NextResponse.json({ error: `${VARIABLE} variable not found` }, { status: 404 });
    const named = (list) => Object.values(list || {}).find((f) => String(f.name || '').trim().toLowerCase() === FLOW);
    const advancedFlow = named(advanced);
    const flow = advancedFlow || named(standard);
    if (!flow) return NextResponse.json({ error: 'Vacuum - Rooms flow not found' }, { status: 404 });

    await homeyFetch(session, `/api/manager/logic/variable/${variable.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: `,${rooms.join(',')},` }),
    });
    await homeyFetch(session, `/api/manager/flow/${advancedFlow ? 'advancedflow' : 'flow'}/${flow.id}/trigger`, {
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
