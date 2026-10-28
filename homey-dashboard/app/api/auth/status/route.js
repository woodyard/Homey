import { NextResponse } from 'next/server';
import { readSession } from '../../../../lib/sessionCookie';

export async function GET() {
  const session = readSession();
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    homeyName: session.homeyName,
  });
}
