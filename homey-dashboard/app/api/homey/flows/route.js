import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

export async function GET() {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  try {
    const [flowsObj, advancedFlowsObj] = await Promise.all([
      homeyFetch(session, '/api/manager/flow/flow'),
      homeyFetch(session, '/api/manager/flow/advancedflow'),
    ]);

    const flows = [
      ...Object.values(flowsObj).map((f) => ({
        id: f.id,
        name: f.name,
        type: 'standard',
        enabled: f.enabled,
        broken: f.broken,
        folder: f.folder || null,
      })),
      ...Object.values(advancedFlowsObj).map((f) => ({
        id: f.id,
        name: f.name,
        type: 'advanced',
        enabled: f.enabled,
        broken: f.broken,
        folder: f.folder || null,
      })),
    ];

    const res = NextResponse.json({ flows });
    persistSession(res, session);
    return res;
  } catch (e) {
    const res = NextResponse.json({ error: String(e.message || e) }, { status: 401 });
    return res;
  }
}
