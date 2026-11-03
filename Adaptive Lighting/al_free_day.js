// AL Free Day — flow condition: is today a free day?
//
// For HomeyScript's "Run a script" condition card. Returns true when the day
// AdaptiveLighting's schedule follows is a free day for rooms without school
// holidays: Saturday, Sunday, or a public holiday from Room Heating's calendar
// (Config.Global). A flow can then switch exactly when AL's weekend profiles
// do: B9 and E9 - Light flow set the daytime inactivity timeout at 06:00 when
// this is false and at 07:30 when it is true (Night ends at 06:00 on working
// days, at 07:30 on free days).
//
// Before 12:00 it answers for today, from 12:00 for tomorrow (AL's noon rule).
// School holidays are not counted (only AL's kids' rooms use them). No API
// calls; a missing or unreadable calendar means Saturday/Sunday only, as in AL.
//
// Takes no argument. Anything passed logs FREEDAY-BADARG and throws, so a
// mistyped card shows up as a flow error instead of a silent answer.
// Logs FREEDAY to AL_DiagnostikLog when a holiday (not a plain weekend) makes
// the day free.
//
// Script Name: AL_FreeDay
// Version:     1.0
// Author:      Henrik Skovgaard
//
// Version history: CHANGELOG.md

// Shared with the other Adaptive Lighting scripts: one line per event in
// AL_DiagnostikLog (see GradualFadeOut's header). Max 500 lines retained
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

// ====== FREE DAYS — same block in adaptivelighting.js and al_free_day.js;
// change both together ======
// Weekends and holidays, from the calendar Room Heating keeps
// (room_heating_config.js → global Config.Global, a JSON string):
// schoolHolidays [{ from, to, name }] and publicHolidaysFixed ['MM-DD']; the
// Easter-based public holidays are computed as room_heating.js does. Missing or
// unreadable Config.Global → plain Saturday/Sunday.

let _holidayConfig;  // read once per run
function holidayConfig() {
  if (_holidayConfig !== undefined) return _holidayConfig;
  try {
    const stored = global.get('Config.Global');
    const cfg = typeof stored === 'string' ? JSON.parse(stored) : stored;
    _holidayConfig = cfg && typeof cfg === 'object' ? cfg : null;
  } catch (e) {
    _holidayConfig = null;
  }
  return _holidayConfig;
}

// Log names for Room Heating's fixed free days (other dates: 'Helligdag')
const FIXED_HOLIDAY_NAMES = {
  '01-01': 'Nytårsdag', '06-05': 'Grundlovsdag', '12-24': 'Juleaften',
  '12-25': '1. juledag', '12-26': '2. juledag', '12-31': 'Nytårsaften'
};

/** Easter Sunday as a UTC date (Gregorian, anonymous algorithm — as room_heating.js) */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Danish public holidays that move with Easter: [{ date: 'YYYY-MM-DD', name }] */
function easterBasedHolidays(year) {
  const easter = easterSunday(year).getTime();
  const at = (days, name) => ({ date: new Date(easter + days * 86400000).toISOString().slice(0, 10), name });
  return [at(-3, 'Skærtorsdag'), at(-2, 'Langfredag'), at(1, '2. påskedag'),
    at(39, 'Kristi himmelfartsdag'), at(50, '2. pinsedag')];
}

/**
 * The calendar day the schedule follows: before 12:00 today, from 12:00
 * tomorrow — an evening belongs to the next morning, so Friday evening gets the
 * weekend bedtime and Sunday evening the weekday one. Daytime is identical in
 * every weekday/weekend pair, so the switch at noon is invisible.
 * Date and hour come from one clock reading in Copenhagen time.
 * @returns {{ iso: string, dow: number }} 0 = Sunday
 */
function scheduleDay() {
  const now = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', hourCycle: 'h23'
  }).formatToParts(new Date());
  for (const p of parts) now[p.type] = Number(p.value);
  const offset = now.hour >= 12 ? 1 : 0;
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
  return { iso: date.toISOString().slice(0, 10), dow: date.getUTCDay() };
}

/**
 * Why the schedule day is a free day ('Weekend', a holiday's name), or null.
 * Public holidays count for every room; school holidays only when asked
 * (AL: rooms with schoolHolidays: true — the kids' rooms)
 */
function freeDayReason(includeSchoolHolidays = false) {
  const day = scheduleDay();
  if (day.dow === 0 || day.dow === 6) return 'Weekend';
  const cfg = holidayConfig();
  if (!cfg) return null;
  const monthDay = day.iso.slice(5);
  if (Array.isArray(cfg.publicHolidaysFixed) && cfg.publicHolidaysFixed.includes(monthDay)) {
    return FIXED_HOLIDAY_NAMES[monthDay] || 'Helligdag';
  }
  const easterHoliday = easterBasedHolidays(Number(day.iso.slice(0, 4))).find(h => h.date === day.iso);
  if (easterHoliday) return easterHoliday.name;
  if (includeSchoolHolidays && Array.isArray(cfg.schoolHolidays)) {
    const range = cfg.schoolHolidays.find(r => r && day.iso >= r.from && day.iso <= r.to);
    if (range) return range.name || 'Skoleferie';
  }
  return null;
}
// ====== end of shared FREE DAYS block ======

// ====== ENTRY POINT ======
const passed = (Array.isArray(args) ? args : [args])
  .filter(a => a !== undefined && a !== null && String(a).trim() !== '');
if (passed.length > 0) {
  diagLog(`FREEDAY-BADARG | "${passed.join(',')}" | AL_FreeDay takes no argument`);
  throw new Error(`AL_FreeDay takes no argument (got "${passed.join(',')}") — use the "Run a script" condition card`);
}

const day = scheduleDay();
const reason = freeDayReason();
log(`${day.iso}: ${reason ? `free day (${reason})` : 'working day'}`);
if (reason && reason !== 'Weekend') diagLog(`FREEDAY | ${day.iso} | ${reason}`);
return reason !== null;
