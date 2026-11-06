// Room-heating config, mirrored from the Homey script "room_heating_config.js".
// Shared by the Heating tab and the Rooms 2.0 tab. Keep in sync when the script's
// config changes.

// Heating rooms. tado valves expose full thermostat data; Clara is a smart-plug
// room (radiator plugs + a temperature sensor).
export const HEATING_ROOMS = [
  { key: 'Stue', label: 'Stue', zone: 'Stue / Spisestue', thermostatId: '2ca14bef-8a28-43cc-af70-0d0611f5281f', manualDuration: 90 },
  { key: 'Sovevaerelse', label: 'Soveværelse', zone: 'Soveværelse', thermostatId: '439be454-0e4e-4835-b51c-a83a1d78e9f1', manualDuration: 90 },
  { key: 'Oliver', label: 'Olivers værelse', zone: 'Olivers værelse', thermostatId: 'eee3d502-3cac-41b6-8c02-a55ad2380e77', manualDuration: 90 },
  { key: 'Clara', label: 'Claras værelse', zone: 'Claras værelse', plugIds: ['bd2ddb09-f0f8-49be-8d3e-011d65a9fdd1', '577bbf99-0934-4495-85b6-c80747ab617d'], manualDuration: 90, targetFlow: 'C - Heating Target' },
];

// Target range of the +/- buttons, for valves and plug rooms alike.
export const TARGET_MIN = 5;
export const TARGET_MAX = 25;

export const HEATING_ACTIONS = [
  { key: 'boost', label: '🔥 Boost', match: /boost/i },
  { key: 'pause', label: '⏸ Pause', match: /pause/i },
  { key: 'reset', label: '↺ Reset', match: /cancel|reset|resume/i },
];

export const HM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Schedules mirrored from room_heating_config.js.
// Slot = [start, end, target, name, offset?, timeout?]. offset/timeout default to the
// room's `def` / `timeout` (inactivityOffset / inactivityTimeout from the config).
// `friday` replaces weekday on a Friday. `evening` is the config's earlyEvening;
// `lateEvening` runs when tomorrow is no school day, if it differs.
export const HEATING_SCHEDULES = {
  Stue: { def: 0, timeout: 90,
    weekday: [['00:00', '04:00', 21, 'Night'], ['04:00', '07:00', 22.5, 'Morning'], ['07:00', '22:00', 22, 'Day', 1]],
    weekend: [['00:00', '05:00', 21, 'Night'], ['05:00', '08:30', 22.5, 'Morning'], ['08:30', '22:00', 22, 'Day', 1]],
    evening: ['22:00', '23:59', 22, 'Evening', 1, 60] },
  Sovevaerelse: { def: 1, timeout: 30,
    weekday: [['00:00', '07:00', 15, 'Night', 0], ['07:00', '19:00', 20, 'Day', 1, 60]],
    weekend: [['00:00', '09:00', 15, 'Night', 0], ['09:00', '19:00', 20, 'Day', 1, 60]],
    evening: ['19:00', '23:59', 15, 'Evening', 0] },
  Oliver: { def: 1, timeout: 30,
    weekday: [['00:00', '08:00', 18, 'Night', 0], ['08:00', '20:00', 22, 'Day', 1, 60]],
    weekend: [['00:00', '09:00', 18, 'Night', 0], ['09:00', '21:00', 20.5, 'Day', 1, 60]],
    evening: ['20:00', '23:59', 19, 'Evening', 1],
    lateEvening: ['21:00', '23:59', 19, 'Evening', 1] },
  Clara: { def: 2, timeout: 30,
    weekday: [['00:00', '14:00', 17, 'Efterskole', 0], ['14:00', '20:00', 21, 'Day', 4]],
    friday: [['00:00', '14:00', 17, 'Efterskole', 0], ['14:00', '21:00', 22, 'Day', 2]],
    weekend: [['00:00', '08:00', 20, 'Night', 0], ['08:00', '21:00', 22, 'Day', 2]],
    evening: ['20:00', '23:59', 20, 'Evening', 3],
    lateEvening: ['21:00', '23:59', 20, 'Evening', 0] },
};

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short' });

// Day of the week in Copenhagen right now. 0 = Sunday.
export function copenhagenDayNow() {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayFmt.format(new Date()));
}

// Resolve a room's full-day schedule into ordered, gap-free, NON-OVERLAPPING slots:
// [{ start, end, target, name, offset, timeout }] with start<end in minutes (end ≤ 1440).
// Slots in the config may overlap (e.g. Clara's Day 08–21 vs Evening 20–23:59); the
// room_heating script picks the FIRST matching slot (evening is appended last), so
// overlaps are resolved with that same priority. Friday and Saturday have no school
// tomorrow, so they get the late evening; as in the script, the day's last slot then
// runs on to where that evening starts. Holidays are not known here.
export function heatingDaySlots(roomKey, weekend, day = copenhagenDayNow()) {
  const sc = HEATING_SCHEDULES[roomKey];
  if (!sc) return [];
  const friday = day === 5 && !weekend;
  const noSchoolTomorrow = day === 5 || day === 6;
  const evening = (noSchoolTomorrow && sc.lateEvening) || sc.evening;
  const raw = [...(friday && sc.friday ? sc.friday : weekend ? sc.weekend : sc.weekday)];
  const last = raw[raw.length - 1];
  if (noSchoolTomorrow && HM(evening[0]) > HM(last[1])) raw[raw.length - 1] = [last[0], evening[0], ...last.slice(2)];
  raw.push(evening);
  const prio = raw.map((s) => {
    const start = HM(s[0]);
    let end = HM(s[1]);
    if (end <= start || end === 1439) end = 1440;
    return {
      start, end, target: s[2], name: s[3],
      offset: s[4] != null ? s[4] : sc.def,
      timeout: s[5] != null ? s[5] : sc.timeout,
    };
  });
  const bounds = [...new Set(prio.flatMap((s) => [s.start, s.end]).concat([0, 1440]))]
    .filter((b) => b >= 0 && b <= 1440)
    .sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const win = prio.find((s) => mid >= s.start && mid < s.end);
    if (!win) continue;
    const last = segs[segs.length - 1];
    if (last && last.src === win && last.end === a) last.end = b;
    else segs.push({ start: a, end: b, target: win.target, name: win.name, offset: win.offset, timeout: win.timeout, src: win });
  }
  return segs.map(({ src, ...s }) => s);
}

// The slot active at `nowMin` for a room (weekday/weekend resolved by caller).
export function heatingSlot(roomKey, weekend, nowMin) {
  for (const s of heatingDaySlots(roomKey, weekend)) {
    if (nowMin >= s.start && nowMin < s.end) return s;
  }
  return null;
}

// Best-guess the Homey flow for a room + action by name-token scoring.
export function guessHeatFlow(room, action, flows) {
  const tokens = [room.label, ...room.label.split(/\s+/), room.key].map((s) => s.toLowerCase());
  let best = null;
  let bestScore = 0;
  for (const f of flows) {
    const n = f.name.toLowerCase();
    if (!action.match.test(n)) continue;
    let score = 0;
    for (const t of tokens) if (t && n.includes(t)) score += t.length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore > 0 ? best : null;
}
