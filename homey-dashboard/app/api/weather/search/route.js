import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// City search for the weather location picker (Open-Meteo geocoding, no key).
export async function GET(request) {
  const q = new URL(request.url).searchParams.get('q');
  if (!q || !q.trim()) return NextResponse.json({ results: [] });
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=en&format=json`,
      { next: { revalidate: 86400 } },
    );
    if (!r.ok) throw new Error(`geocoding ${r.status}`);
    const j = await r.json();
    const results = (j.results || []).map((x) => ({
      name: x.name,
      admin1: x.admin1 || null,
      country: x.country || null,
      countryCode: x.country_code || null,
      lat: x.latitude,
      lon: x.longitude,
    }));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ results: [], error: String(e.message || e) }, { status: 502 });
  }
}
