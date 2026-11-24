// Oliver's PS5 plug, run by the Homey flow "O - PS5" (Setup Snapshot README, 2026-11-24).
// The flow owns the switching; the dashboard shows it and writes the extension. What the flow
// does (change both together):
//  - Motion on O Eve Motion turns the plug on from 08:00 until bedtime.
//  - Bedtime is 22:00 when there is school tomorrow, else 23:30. The flow publishes which one in
//    the Logic yes/no variable O_PS5_SkoleIMorgen at 00:01 and 12:00, from Room Heating's
//    calendar (weekends, school holidays, public holidays).
//  - O_PS5_Forlaenget (number, epoch ms, 0 = none): the plug is not switched off before then.
//    The flow skips bedtime while it is set, checks every minute, and when it has passed sets it
//    to 0 and switches the plug off unless the normal schedule still has it on (08:00–bedtime).
// All times are Copenhagen time, also when the server runs in UTC (Vercel).

export const PS5 = {
  deviceId: '82106f80-a6bb-4360-b5fa-e35a4855722e',
  schoolVar: 'O_PS5_SkoleIMorgen',
  untilVar: 'O_PS5_Forlaenget',
  onFrom: 8 * 60, // minutes since midnight
  bedtimeSchool: 22 * 60,
  bedtimeFree: 23 * 60 + 30,
  steps: [30, 60, 90, 120], // minutes the dashboard offers
  maxMinutes: 240,
};

const TZ = 'Europe/Copenhagen';
const MIN = 60000;
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  second: 'numeric', hourCycle: 'h23',
});

function parts(ms) {
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p;
}

// Epoch ms of a Copenhagen wall-clock time on the given date (handles summer time).
function zoned(y, m, d, minutes) {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(t);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += wall - seen;
  }
  return t;
}

/** Bedtime in minutes since midnight. Unknown (null) counts as school, as the flow starts out. */
export const bedtimeMinutes = (schoolTomorrow) => (schoolTomorrow === false ? PS5.bedtimeFree : PS5.bedtimeSchool);

/** The normal on-window of the Copenhagen day that `ms` falls on: { from, to } in epoch ms. */
function windowOf(ms, schoolTomorrow) {
  const p = parts(ms);
  return {
    from: zoned(p.year, p.month, p.day, PS5.onFrom),
    to: zoned(p.year, p.month, p.day, bedtimeMinutes(schoolTomorrow)),
  };
}

const inWindow = (ms, w) => ms >= w.from && ms < w.to;

// The flow's switch-offs without an extension: bedtime, and 23:30 every day.
function setOffTimes(ms, schoolTomorrow) {
  const p = parts(ms);
  return [bedtimeMinutes(schoolTomorrow), PS5.bedtimeFree].map((m) => zoned(p.year, p.month, p.day, m));
}

/**
 * What the flow will do: { bedtime, extended, offAt, inWindow }.
 *  - bedtime: tonight's switch-off (epoch ms)
 *  - extended: the extension end when it lies ahead, else null
 *  - offAt: when the plug, if it is on, is switched off next. Without an extension: bedtime, or
 *    23:30 for a plug switched on by hand after bedtime, or the next evening after 23:30
 *    (nothing switches it off overnight). With one: its end, or bedtime if it ends in the day.
 *  - inWindow: motion turns it on now
 * `until` is O_PS5_Forlaenget; the next day's bedtime is taken to be like today's.
 */
export function ps5Plan({ now, schoolTomorrow, until }) {
  const w = windowOf(now, schoolTomorrow);
  const extended = typeof until === 'number' && until > now ? until : null;
  let offAt;
  if (extended) {
    // When the extension ends, the normal schedule takes over again
    const after = windowOf(extended, schoolTomorrow);
    offAt = inWindow(extended, after) ? after.to : extended;
  } else {
    offAt = [...setOffTimes(now, schoolTomorrow), ...setOffTimes(now + 24 * 3600 * 1000, schoolTomorrow)]
      .find((t) => t > now);
  }
  return { bedtime: w.to, extended, offAt, inWindow: inWindow(now, w) || !!extended };
}

/**
 * The extension end for "+N min": N minutes past bedtime while the normal schedule has the plug
 * on, else N minutes from now. Setting, not adding, so a doubled tap does not count twice.
 * Rounded up to a whole minute: the flow checks once a minute.
 */
export function extensionEnd({ now, schoolTomorrow, minutes }) {
  const w = windowOf(now, schoolTomorrow);
  const base = inWindow(now, w) ? w.to : now;
  return Math.ceil((base + minutes * MIN) / MIN) * MIN;
}

/** Whether the normal schedule (without an extension) has the plug on at `now`. */
export function normallyOn({ now, schoolTomorrow }) {
  return inWindow(now, windowOf(now, schoolTomorrow));
}
