// Adaptive-lighting schedule, mirrored from the Homey script "adaptivelighting.js"
// (Adaptive Lighting/adaptivelighting.js). The script is not part of the deployed
// dashboard, so the profile templates + room assignments are copied here for
// visualization. Keep this in sync when the script's PROFILES/ROOM_CONFIG change.
//
// Time syntax:  "HH:MM" | "sunrise"|"sunset" [+/-offsetMinutes] [>minTime] [<maxTime]
// Temperature scale: 0.0 = cool/blue-white, 1.0 = warm/orange. Brightness: 0..1.

// ---- geo (København) for the sunrise/sunset fallback used by the script ----
const LAT = 55.6761;
const LON = 12.5683;

// ---- profile templates (verbatim from the script) ----
const P = {
  standard: [
    { name: 'Morning',  startTime: '06:00', endTime: '09:00', brightness: 0.35, temperature: 0.7 },
    { name: 'Daytime',  startTime: '09:00', endTime: '18:00', brightness: 0.8,  temperature: 0.5 },
    { name: 'Evening',  startTime: '18:00', endTime: '22:00', brightness: 0.30, temperature: 0.7 },
    { name: 'Night',    startTime: '22:00', endTime: '06:00', brightness: 0.15, temperature: 0.9 },
  ],
  filament: [
    { name: 'Morning',  startTime: '06:00',                 endTime: 'sunrise+30>08:00',      brightness: 0.20, temperature: 0.55 },
    { name: 'Daytime',  startTime: 'sunrise+30>08:00',      endTime: 'sunset-60>15:30<19:00', brightness: 0.55, temperature: 0.40 },
    { name: 'Evening',  startTime: 'sunset-60>15:30<19:00', endTime: '21:00',                 brightness: 0.20, temperature: 0.70 },
    { name: 'Night',    startTime: '21:00',                 endTime: '06:00',                 brightness: 0.08, temperature: 0.70 },
  ],
  stue: [
    { name: 'Morning',  startTime: '06:00',                 endTime: 'sunrise+30>08:00',      brightness: 0.35, temperature: 0.7 },
    { name: 'Daytime',  startTime: 'sunrise+30>08:00',      endTime: 'sunset-60>15:30<19:00', brightness: 0.80, temperature: 0.4 },
    { name: 'Evening',  startTime: 'sunset-60>15:30<19:00', endTime: '21:00',                 brightness: 0.35, temperature: 0.9 },
    { name: 'Night',    startTime: '21:00',                 endTime: '06:00',                 brightness: 0.10, temperature: 0.9 },
  ],
  bathroom: [
    { name: 'Morning',  startTime: '06:00', endTime: '09:00', brightness: 1.0,  temperature: 0.3 },
    { name: 'Daytime',  startTime: '09:00', endTime: '21:00', brightness: 0.9,  temperature: 0.4 },
    { name: 'Evening',  startTime: '21:00', endTime: '23:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Night',    startTime: '23:00', endTime: '06:00', brightness: 0.08, temperature: 1.0 },
  ],
  bathroom9: [
    { name: 'Morning',  startTime: '06:00', endTime: '09:00', brightness: 1.0,  temperature: 0.3 },
    { name: 'Daytime',  startTime: '09:00', endTime: '23:00', brightness: 0.9,  temperature: 0.4 },
    { name: 'Evening',  startTime: '23:00', endTime: '00:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Night',    startTime: '00:00', endTime: '06:00', brightness: 0.08, temperature: 1.0 },
  ],
  bedroom: [
    { name: 'Morning',  startTime: '07:00', endTime: '09:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Daytime',  startTime: '09:00', endTime: '20:00', brightness: 0.6,  temperature: 0.5 },
    { name: 'Evening',  startTime: '20:00', endTime: '22:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Night',    startTime: '22:00', endTime: '07:00', brightness: 0.05, temperature: 1.0 },
  ],
  kidsRoom: [
    { name: 'Morning',  startTime: '06:00', endTime: '08:00', brightness: 0.35, temperature: 0.7 },
    { name: 'Daytime',  startTime: '08:00', endTime: '18:00', brightness: 0.8,  temperature: 0.5 },
    { name: 'Evening',  startTime: '18:00', endTime: '20:00', brightness: 0.35, temperature: 0.7 },
    { name: 'Night',    startTime: '20:00', endTime: '06:00', brightness: 0.05, temperature: 1.0 },
  ],
  kitchen: [
    { name: 'Morning',  startTime: '06:00', endTime: '09:00', brightness: 1.0,  temperature: 0.3 },
    { name: 'Daytime',  startTime: '09:00', endTime: '20:00', brightness: 1.0,  temperature: 0.4 },
    { name: 'Evening',  startTime: '20:00', endTime: '23:00', brightness: 0.7,  temperature: 0.6 },
    { name: 'Night',    startTime: '23:00', endTime: '06:00', brightness: 0.15, temperature: 0.9 },
  ],
  entrance: [
    { name: 'Morning',  startTime: '06:00', endTime: '07:00', brightness: 0.40, temperature: 0.7 },
    { name: 'Daytime',  startTime: '07:00', endTime: '18:00', brightness: 0.8,  temperature: 0.5 },
    { name: 'Evening',  startTime: '18:00', endTime: '23:00', brightness: 0.4,  temperature: 0.7 },
    { name: 'Night',    startTime: '23:00', endTime: '06:00', brightness: 0.10, temperature: 1.0 },
  ],
  dining: [
    { name: 'Morning',  startTime: '06:00',            endTime: '09:00',            brightness: 0.35, temperature: 0.7 },
    { name: 'Daytime',  startTime: '09:00',            endTime: 'sunset>17:00<19:00', brightness: 0.7,  temperature: 0.5 },
    { name: 'Evening',  startTime: 'sunset>17:00<19:00', endTime: '22:00',          brightness: 0.35, temperature: 0.75 },
    { name: 'Night',    startTime: '22:00',            endTime: '06:00',            brightness: 0.10, temperature: 0.9 },
  ],
  // weekend variants
  bedroomWeekend: [
    { name: 'Morning',  startTime: '09:00', endTime: '11:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Daytime',  startTime: '11:00', endTime: '20:00', brightness: 0.6,  temperature: 0.5 },
    { name: 'Evening',  startTime: '20:00', endTime: '23:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Night',    startTime: '23:00', endTime: '09:00', brightness: 0.05, temperature: 1.0 },
  ],
  kidsRoomWeekend: [
    { name: 'Morning',  startTime: '07:30', endTime: '10:00', brightness: 0.35, temperature: 0.7 },
    { name: 'Daytime',  startTime: '10:00', endTime: '19:00', brightness: 0.8,  temperature: 0.5 },
    { name: 'Evening',  startTime: '19:00', endTime: '21:00', brightness: 0.35, temperature: 0.7 },
    { name: 'Night',    startTime: '21:00', endTime: '07:30', brightness: 0.05, temperature: 1.0 },
  ],
  bathroom9Weekend: [
    { name: 'Morning',  startTime: '07:30', endTime: '10:00', brightness: 0.6,  temperature: 0.5 },
    { name: 'Daytime',  startTime: '10:00', endTime: '23:00', brightness: 0.9,  temperature: 0.4 },
    { name: 'Evening',  startTime: '23:00', endTime: '00:00', brightness: 0.25, temperature: 0.8 },
    { name: 'Night',    startTime: '00:00', endTime: '07:30', brightness: 0.08, temperature: 1.0 },
  ],
  entranceWeekend: [
    { name: 'Morning',  startTime: '07:30', endTime: '10:00', brightness: 0.35, temperature: 0.8 },
    { name: 'Daytime',  startTime: '10:00', endTime: '18:00', brightness: 0.8,  temperature: 0.5 },
    { name: 'Evening',  startTime: '18:00', endTime: '23:00', brightness: 0.4,  temperature: 0.7 },
    { name: 'Night',    startTime: '23:00', endTime: '07:30', brightness: 0.10, temperature: 1.0 },
  ],
};

// ---- configured lights (from ROOM_CONFIG), grouped by physical area ----
// `id` is the Homey device id — used both to read live state (Auto/Manual) and as
// the argument when resetting via the AdaptiveLighting script.
export const AL_ROOMS = [
  { area: 'Stue',            name: 'ST Loft',            id: 'fd754abf-4397-45f5-9a68-98d7f079fd7b', weekday: P.filament },
  { area: 'Stue',            name: 'ST Standerlampe',    id: '3f4e2391-3be6-44ee-b340-fcc3219853b2', weekday: P.stue },
  { area: 'Spisestue',       name: 'SS Loft',            id: '18b6f5bf-1666-4bf1-92be-d9cb7e6b74c5', weekday: P.dining },
  { area: 'Spisestue',       name: 'SS Bordlampe',       id: '5ccf5881-f665-40f5-bd89-f61e1f926d4c', weekday: P.dining },
  { area: 'Spisestue',       name: 'SS Light Perler',    id: 'cc30f76b-7634-489c-a721-541fdb49d46f', weekday: P.dining },
  { area: 'Soveværelse',     name: 'SV Loft',            id: 'cbbd7c60-dc84-43c7-8f0f-790556fc9b14', weekday: P.bedroom,  weekend: P.bedroomWeekend },
  { area: 'Køkken',          name: 'K Loft',             id: 'f097b38c-cfb0-4b83-8124-59e35f82cd0f', weekday: P.kitchen },
  { area: 'Køkken',          name: 'K Bord',             id: '0e5d845d-d8ea-4db6-8096-663b0a311e07', weekday: P.kitchen },
  { area: 'Badeværelse 9',   name: 'B9 Lys',             id: 'b8591f4d-a493-4de7-9745-c13cd07e033c', weekday: P.bathroom9, weekend: P.bathroom9Weekend },
  { area: 'Badeværelse 7',   name: 'B7 Lys',             id: '1ab9ca1f-60ca-44f9-8221-a03e10f005bf', weekday: P.bathroom },
  { area: 'Entre 9',         name: 'E9 Loft',            id: '2656f184-8c87-4434-95a2-fdb3fc36bdd8', weekday: P.entrance, weekend: P.entranceWeekend },
  { area: 'Entre 9',         name: 'E9 Garderobe',       id: 'e339c184-ea11-4413-bd90-dac726861fd0', weekday: P.entrance, weekend: P.entranceWeekend },
  { area: 'Entre 7',         name: 'E7 Lys',             id: 'b135fbd5-dda4-4957-9cce-6184fa5c731a', weekday: P.entrance },
  { area: 'Olivers værelse', name: 'O Loft',             id: '1e87af68-506e-4c86-8bc9-ffc6a05f3ef0', weekday: P.kidsRoom, weekend: P.kidsRoomWeekend },
  { area: 'Claras værelse',  name: 'C Loft',             id: '9b15cb64-bf61-494d-be49-f3dcd9dfd0bf', weekday: P.kidsRoom, weekend: P.kidsRoomWeekend },
  { area: 'Claras værelse',  name: 'C LightStrip',       id: '5acaab17-7864-4831-b6e2-72bd35588b21', weekday: P.kidsRoom, weekend: P.kidsRoomWeekend },
  { area: 'Claras værelse',  name: 'C Light Svampelampe', id: '4c34d605-334b-4207-b9a3-1796829b0caf', weekday: P.kidsRoom },
  { area: 'Altan',           name: 'A Light Lyskæde',    id: '16a55a55-d67b-4b85-9562-cc4f11e12975', weekday: P.standard },
];

// The AdaptiveLighting HomeyScript (from the flow export). Running it with a device
// id resets that light to its scheduled profile; adding " clear" also clears manual mode.
export const ADAPTIVE_LIGHTING_SCRIPT_ID = 'a6f9d44b-f818-4ca8-b4ec-681c3eceec5e';

// Tolerance the script itself uses when deciding whether a light matches its profile.
export const AL_MATCH_TOLERANCE = 0.10;

// ---- NOAA sunrise/sunset (copied from the script's getSunTimesNOAA) ----
export function getSunTimes(date) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const JD = Math.floor(365.25 * (date.getFullYear() + 4716)) +
             Math.floor(30.6001 * (date.getMonth() + 2)) +
             date.getDate() - 1524.5;
  const JC = (JD - 2451545) / 36525;
  const L0 = (280.46646 + JC * (36000.76983 + 0.0003032 * JC)) % 360;
  const M = 357.52911 + JC * (35999.05029 - 0.0001537 * JC);
  const e = 0.016708634 - JC * (0.000042037 + 0.0000001267 * JC);
  const C = Math.sin(M * rad) * (1.914602 - JC * (0.004817 + 0.000014 * JC)) +
            Math.sin(2 * M * rad) * (0.019993 - 0.000101 * JC) +
            Math.sin(3 * M * rad) * 0.000289;
  const sunLong = L0 + C;
  const obliq = 23.439291 - JC * 0.0130042;
  const declination = Math.asin(Math.sin(obliq * rad) * Math.sin(sunLong * rad)) * deg;
  const y = Math.tan(obliq * rad / 2) ** 2;
  const EoT = 4 * deg * (y * Math.sin(2 * L0 * rad) -
              2 * e * Math.sin(M * rad) +
              4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
              0.5 * y * y * Math.sin(4 * L0 * rad) -
              1.25 * e * e * Math.sin(2 * M * rad));
  const cosHA = (Math.cos(90.833 * rad) / (Math.cos(LAT * rad) * Math.cos(declination * rad))) -
                Math.tan(LAT * rad) * Math.tan(declination * rad);
  if (Math.abs(cosHA) > 1) {
    return { sunriseMinutes: cosHA < -1 ? 0 : 720, sunsetMinutes: cosHA < -1 ? 1439 : 720 };
  }
  const HA = Math.acos(cosHA) * deg;
  const solarNoon = 720 - 4 * LON - EoT;
  const sunriseUTC = solarNoon - HA * 4;
  const sunsetUTC = solarNoon + HA * 4;
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const lastSundayMarch = 31 - new Date(year, 2, 31).getDay();
  const lastSundayOctober = 31 - new Date(year, 9, 31).getDay();
  const isSummerTime = (month > 2 && month < 9) ||
                       (month === 2 && day >= lastSundayMarch) ||
                       (month === 9 && day < lastSundayOctober);
  const tzOffset = isSummerTime ? 120 : 60;
  return {
    sunriseMinutes: Math.round(sunriseUTC + tzOffset),
    sunsetMinutes: Math.round(sunsetUTC + tzOffset),
  };
}

// ---- time expression → minutes since midnight (copied from parseTimeToMinutes) ----
export function parseTimeToMinutes(time, sun) {
  const t = String(time).toLowerCase().trim();
  if (t.startsWith('sunrise') || t.startsWith('sunset')) {
    const base = t.startsWith('sunrise') ? sun.sunriseMinutes : sun.sunsetMinutes;
    const m = t.match(/^(sunrise|sunset)([+-]\d+)?(?:>(\d{1,2}:\d{2}))?(?:<(\d{1,2}:\d{2}))?$/);
    if (!m) return base;
    let result = base + (m[2] ? parseInt(m[2], 10) : 0);
    if (m[3]) { const [h, mi] = m[3].split(':').map(Number); result = Math.max(result, h * 60 + mi); }
    if (m[4]) { const [h, mi] = m[4].split(':').map(Number); result = Math.min(result, h * 60 + mi); }
    return result;
  }
  const [h, mi] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(mi || '0', 10);
}

// ---- resolve a profile set into gap-free segments over a 24h day ----
// Returns [{ name, brightness, temperature, start, end }] where start<end (minutes),
// the wrap-around night segment is split so every segment is a simple [start,end) range.
export function resolveSchedule(profiles, sun) {
  const withStart = profiles.map((p) => ({
    name: p.name,
    brightness: p.brightness,
    temperature: p.temperature,
    start: ((parseTimeToMinutes(p.startTime, sun) % 1440) + 1440) % 1440,
  }));
  withStart.sort((a, b) => a.start - b.start);
  const segments = [];
  for (let i = 0; i < withStart.length; i++) {
    const cur = withStart[i];
    const next = withStart[(i + 1) % withStart.length];
    const end = next.start > cur.start ? next.start : next.start + 1440;
    if (end <= 1440) {
      segments.push({ ...cur, end });
    } else {
      // wraps past midnight → split into [start,1440) and [0, end-1440)
      segments.push({ ...cur, end: 1440 });
      segments.push({ ...cur, start: 0, end: end - 1440 });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// ---- the 4 phases with resolved start/end (end may exceed 1440 when it wraps) ----
export function phaseList(profiles, sun) {
  const arr = profiles
    .map((p) => ({
      name: p.name,
      brightness: p.brightness,
      temperature: p.temperature,
      start: ((parseTimeToMinutes(p.startTime, sun) % 1440) + 1440) % 1440,
    }))
    .sort((a, b) => a.start - b.start);
  return arr.map((p, i) => {
    const next = arr[(i + 1) % arr.length];
    const end = next.start > p.start ? next.start : next.start + 1440;
    return { ...p, end };
  });
}

// is `nowMin` (0..1439) inside this phase, accounting for midnight wrap?
export function isActive(phase, nowMin) {
  return (
    (nowMin >= phase.start && nowMin < phase.end) ||
    (nowMin + 1440 >= phase.start && nowMin + 1440 < phase.end)
  );
}

// the phase active at `nowMin` for a given profile set
export function activePhase(profiles, sun, nowMin) {
  const phases = phaseList(profiles, sun);
  return phases.find((p) => isActive(p, nowMin)) || phases[0];
}

// Classify a light as 'auto' | 'manual' | 'off' | 'unknown' by comparing its live
// dim / light_temperature to the scheduled phase (same heuristic the script uses).
export function classifyMode(caps, phase) {
  if (!caps) return 'unknown';
  if (caps.onoff === false) return 'off';
  const dim = caps.dim;
  const temp = caps.light_temperature;
  if (dim == null && temp == null) return caps.onoff ? 'unknown' : 'off';
  const bOk = dim == null || Math.abs(dim - phase.brightness) <= AL_MATCH_TOLERANCE;
  const tOk = temp == null || Math.abs(temp - phase.temperature) <= AL_MATCH_TOLERANCE;
  return bOk && tOk ? 'auto' : 'manual';
}

// ---- AdaptiveLighting's published status (Logic variable AdaptiveLightingStatus) ----
// The script (2.28+) publishes each light's real state: { v, schema, publishedAt,
// weekend, lights: { <device id>: { name, mode, forced?, profile, bri, temp,
// schedBri, schedTemp, factor?, lux?, sunEl?, via, at, fadeUntil, next, idle? } } }.
// idle (2.32.0): the light is dimmed because its room is empty; mode still says
// auto/manual underneath, and bri/temp are the dimmed values AL applied.
// It writes on change plus an hourly heartbeat while lights are on, so an old
// publishedAt means the script isn't running (or not since the dashboard started).
export const AL_STATUS_SCHEMA = 1;
const AL_STATUS_MAX_AGE_MS = 3 * 3600 * 1000;
// After AL changes a light, the new values reach the dashboard (device poll/SSE)
// before the new status does (15 s poll). A difference only counts as drift once
// it has lasted this long; also covers GradualFadeOut's 20 s fade to off
const AL_DRIFT_GRACE_MS = 30 * 1000;
const driftSince = new Map(); // deviceId → first time the difference was seen

// Mode for one light: { mode, guess, st }.
// mode: 'off' | 'auto' | 'manual' | 'forced' | 'drift' | 'unknown'
//  - off wins: AL keeps a manual flag on an off light until it is next turned on
//  - drift: AL still says auto, but the live values differ from what it applied
//    (it only notices on its next full check, ≤15 min — never in rooms without
//    a check poll), shown as "Manual?"
//  - guess: no usable status for this light → the old schedule comparison
export function resolveLightMode(caps, alStatus, deviceId, phase, now = Date.now()) {
  if (!caps) return { mode: 'unknown', guess: false, st: null };
  if (caps.onoff === false) return { mode: 'off', guess: false, st: null };
  const fresh = alStatus && alStatus.schema === AL_STATUS_SCHEMA
    && now - (alStatus.publishedAt || 0) <= AL_STATUS_MAX_AGE_MS;
  const st = fresh ? (alStatus.lights || {})[deviceId] || null : null;
  if (!st) {
    const mode = phase ? classifyMode(caps, phase) : 'unknown';
    return { mode, guess: mode === 'auto' || mode === 'manual', st: null };
  }
  if (st.mode !== 'auto') { driftSince.delete(deviceId); return { mode: st.mode, guess: false, st }; }
  // Same comparison AL makes against its last applied values; skipped while
  // AL's own transition is still running (the bulb is between two values)
  let differs = false;
  if (now >= (st.fadeUntil || 0) && typeof st.bri === 'number') {
    const dimOff = caps.dim != null && Math.abs(caps.dim - st.bri) > AL_MATCH_TOLERANCE;
    const tempOff = caps.light_temperature != null && typeof st.temp === 'number'
      && Math.abs(caps.light_temperature - st.temp) > AL_MATCH_TOLERANCE;
    differs = dimOff || tempOff;
  }
  if (!differs) { driftSince.delete(deviceId); return { mode: 'auto', guess: false, st }; }
  if (!driftSince.has(deviceId)) driftSince.set(deviceId, now);
  return { mode: now - driftSince.get(deviceId) >= AL_DRIFT_GRACE_MS ? 'drift' : 'auto', guess: false, st };
}

// AL has dimmed this light because its room is empty (AdaptiveLighting idle).
// Shown as " · idle" after the mode label; not for an off light
export function isIdle(st) {
  return !!st && st.idle === true;
}

// One-line description of what AL did, for tooltips:
// "Daytime · 32% (80% × 0.4 daylight, 250 lx) · colour 0.59 (sun 21.4°) · set 12:05"
export function describeLightStatus(st) {
  if (!st) return '';
  const pct = (v) => `${Math.round(v * 100)}%`;
  const parts = [st.profile || '?'];
  if (typeof st.bri === 'number') {
    let b = pct(st.bri);
    if (typeof st.factor === 'number' && typeof st.schedBri === 'number') {
      b += ` (${pct(st.schedBri)} × ${st.factor} daylight${typeof st.lux === 'number' ? `, ${st.lux} lx` : ''})`;
    }
    parts.push(b);
  }
  if (typeof st.temp === 'number') {
    parts.push(`colour ${st.temp}${typeof st.sunEl === 'number' ? ` (sun ${st.sunEl}°)` : ''}`);
  }
  if (st.mode === 'forced') parts.push('forced profile');
  if (isIdle(st)) parts.push('idle: dimmed while the room is empty');
  if (st.at) {
    parts.push(`set ${new Date(st.at).toLocaleTimeString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' })}`);
  }
  return parts.join(' · ');
}

// ---- temperature (0 cool .. 1 warm) → approximate light color ----
export function tempColor(t) {
  const cool = [214, 230, 255]; // #d6e6ff
  const warm = [255, 148, 54];  // #ff9436
  const r = Math.round(cool[0] + (warm[0] - cool[0]) * t);
  const g = Math.round(cool[1] + (warm[1] - cool[1]) * t);
  const b = Math.round(cool[2] + (warm[2] - cool[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function fmtMinutes(m) {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  const mi = mm % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// current time-of-day in minutes, in Europe/Copenhagen
export function copenhagenMinutesNow() {
  const s = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Copenhagen', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const [h, mi] = s.split(':').map(Number);
  return (h % 24) * 60 + mi;
}

// is "today" (Copenhagen) a weekend?
export function isWeekendNow() {
  const wd = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short' });
  return wd === 'Sat' || wd === 'Sun';
}

// do the lights run their weekend profiles right now? Mirrors the script's
// isWeekendSchedule(): before 12:00 today decides, from 12:00 tomorrow, so
// Friday evening is weekend and Sunday evening weekday. Heating keeps isWeekendNow().
export function isWeekendScheduleNow() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = days.indexOf(new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short' }));
  const day = copenhagenMinutesNow() >= 12 * 60 ? (today + 1) % 7 : today;
  return day === 0 || day === 6;
}
