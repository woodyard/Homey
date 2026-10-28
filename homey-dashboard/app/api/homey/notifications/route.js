import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';

// Homey Timeline notifications — merged into the Live activity feed.
export async function GET() {
  const session = readSession();
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  try {
    const obj = await homeyFetch(session, '/api/manager/notifications/notification');
    const notifications = Object.values(obj || {})
      .map((n) => ({
        id: n.id,
        excerpt: n.excerpt,
        dateCreated: n.dateCreated,
        ownerName: n.ownerName || null,
      }))
      .sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated))
      .slice(0, 100);

    const res = NextResponse.json({ notifications });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 401 });
  }
}
