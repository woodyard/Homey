import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // reads coords from the query; upstream calls cached 10 min

// Weather from two independent sources (cross-checked for confidence):
//  - Open-Meteo (no key)              — hourly + daily + current
//  - MET Norway / YR locationforecast — requires an identifying User-Agent + attribution
// Location comes from ?lat/?lon (browser geolocation); defaults to København Ø.
const DEFAULT = { lat: 55.7107, lon: 12.5776, place: 'København Ø' };
const YR_UA = 'homey-dashboard/1.0 (henrik.skovgaard@gmail.com)';

const omUrl = (lat, lon) =>
  'https://api.open-meteo.com/v1/forecast'
  + `?latitude=${lat}&longitude=${lon}`
  + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
  + '&hourly=temperature_2m,precipitation_probability,weather_code,is_day'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max'
  + '&wind_speed_unit=ms&timezone=auto&forecast_days=7';

const yrUrl = (lat, lon) => `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;

function normalizeYr(yr, tz) {
  const ts = yr?.properties?.timeseries || [];
  if (!ts.length) return null;
  const localDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const localHour = (iso) => parseInt(new Date(iso).toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }), 10);

  const first = ts[0];
  const inst = first.data?.instant?.details || {};
  const n1 = first.data?.next_1_hours;
  const current = {
    temp: inst.air_temperature,
    humidity: inst.relative_humidity,
    wind: inst.wind_speed,
    windDir: inst.wind_from_direction,
    precip1h: n1?.details?.precipitation_amount,
    symbol: n1?.summary?.symbol_code || first.data?.next_6_hours?.summary?.symbol_code || null,
  };

  const daily = {};
  const noonDiff = {};
  for (const e of ts) {
    const date = localDate(e.time);
    const temp = e.data?.instant?.details?.air_temperature;
    if (temp != null) {
      if (!daily[date]) daily[date] = { tMax: temp, tMin: temp, symbol: null };
      else { daily[date].tMax = Math.max(daily[date].tMax, temp); daily[date].tMin = Math.min(daily[date].tMin, temp); }
    }
    const sym = e.data?.next_6_hours?.summary?.symbol_code || e.data?.next_1_hours?.summary?.symbol_code;
    if (sym && daily[date]) {
      const diff = Math.abs(localHour(e.time) - 12);
      if (noonDiff[date] == null || diff < noonDiff[date]) { noonDiff[date] = diff; daily[date].symbol = sym; }
    }
  }
  return { current, daily };
}

async function reverseGeocode(lat, lon) {
  try {
    // No fixed zoom: Nominatim's coarse zooms mis-snap some points (e.g. zoom=12 put
    // Østerbro in "Sundbyerne"). Request the full address and pick sensible levels.
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=en`,
      { headers: { 'User-Agent': YR_UA }, next: { revalidate: 86400 } },
    );
    if (!r.ok) return null;
    const a = (await r.json()).address || {};
    const local = a.suburb || a.neighbourhood || a.city_district || a.quarter || null;
    const city = a.city || a.town || a.village || a.municipality || a.county || null;
    let name = city;
    if (local && city && local !== city) name = `${local}, ${city}`;
    else if (local && !city) name = local;
    if (!name) name = a.state || a.country || null;
    if (!name) return null;
    return a.country_code ? `${name}, ${a.country_code.toUpperCase()}` : name;
  } catch { return null; }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const qlat = parseFloat(searchParams.get('lat'));
  const qlon = parseFloat(searchParams.get('lon'));
  const hasCoords = Number.isFinite(qlat) && Number.isFinite(qlon);
  const lat = hasCoords ? Number(qlat.toFixed(4)) : DEFAULT.lat;
  const lon = hasCoords ? Number(qlon.toFixed(4)) : DEFAULT.lon;

  try {
    const [omRes, yrRes] = await Promise.allSettled([
      fetch(omUrl(lat, lon), { next: { revalidate: 600 } }),
      fetch(yrUrl(lat, lon), { headers: { 'User-Agent': YR_UA }, next: { revalidate: 600 } }),
    ]);

    if (omRes.status !== 'fulfilled' || !omRes.value.ok) {
      throw new Error(`Open-Meteo ${omRes.status === 'fulfilled' ? omRes.value.status : 'unreachable'}`);
    }
    const om = await omRes.value.json();

    let yr = null;
    if (yrRes.status === 'fulfilled' && yrRes.value.ok) {
      try { yr = normalizeYr(await yrRes.value.json(), om.timezone || 'Europe/Copenhagen'); } catch { yr = null; }
    }

    let place = DEFAULT.place;
    if (hasCoords) place = (await reverseGeocode(lat, lon)) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

    return NextResponse.json({ place, lat, lon, ...om, yr });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
