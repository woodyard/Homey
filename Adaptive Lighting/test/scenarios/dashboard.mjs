// homey-dashboard/lib/adaptiveLighting.js: badge mode from AL's published status (1.17.0),
// sunrise/sunset as AL computes them (1.18.3)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(path.resolve(HERE, '../../../homey-dashboard/lib/adaptiveLighting.js')).href);

const T0 = new Date('2026-10-27T12:05:00+01:00').getTime();
const entry = { mode: 'auto', profile: 'Daytime', bri: 0.32, temp: 0.59, schedBri: 0.8, factor: 0.4, lux: 250, sunEl: 21.4, at: T0, fadeUntil: 0 };
const status = (id, over = {}, top = {}) => ({ schema: 1, publishedAt: T0 - 60000, lights: { [id]: { ...entry, ...over } }, ...top });
const phase = { brightness: 0.8, temperature: 0.4 }; // the static schedule the old guess compares against
// resolveLightMode remembers how long a difference has lasted per device id, so
// every case uses its own id
const mode = (id, caps, st, now = T0) => {
  const r = lib.resolveLightMode(caps, st, id, phase, now);
  return r.mode + (r.guess ? ' (guess)' : '');
};

export const scenarios = {
  async 'mode comes from the published status'(t) {
    const matches = { onoff: true, dim: 0.32, light_temperature: 0.59 };
    t.equal(mode('a', matches, status('a')), 'auto', 'daylight-scaled light that matches what AL applied → auto');
    t.equal(mode('b', matches, null), 'manual (guess)', '(the old guess called it manual)');
    t.equal(mode('c', { onoff: false, dim: 1 }, status('c', { mode: 'manual' })), 'off', 'off wins over manual');
    t.equal(mode('d', { onoff: true, dim: 1 }, status('d', { mode: 'manual' })), 'manual', 'manual per AL');
    t.equal(mode('e', { onoff: true, dim: 0.35 }, status('e', { mode: 'forced', profile: 'Morning' })), 'forced', 'forced per AL');
    t.equal(mode('f', { onoff: true, dim: 0.6, light_temperature: 0.59 }, status('f', { fadeUntil: T0 + 30000 })), 'auto', 'differs during AL’s own fade → auto');
    t.equal(mode('g', matches, status('g', {}, { publishedAt: T0 - 4 * 3600000 })), 'manual (guess)', 'status older than 3 h → guess');
    t.equal(mode('h', { onoff: true, dim: 0.8, light_temperature: 0.4 }, status('other')), 'auto (guess)', 'light missing from the status → guess');
  },

  async '"Manual?" only after a difference has lasted 30 s'(t) {
    const st = status('drift');
    const changed = { onoff: true, dim: 1.0, light_temperature: 0.59 };
    t.equal(mode('drift', changed, st, T0), 'auto', 't+0 s: still auto');
    t.equal(mode('drift', changed, st, T0 + 15000), 'auto', 't+15 s: still auto');
    t.equal(mode('drift', changed, st, T0 + 31000), 'drift', 't+31 s: Manual?');
    t.equal(mode('drift', { ...changed, dim: 0.32 }, st, T0 + 40000), 'auto', 'back to the applied value → auto');
    t.equal(mode('drift', changed, st, T0 + 45000), 'auto', 'changed again → the 30 s start over');
  },

  async 'an idle light (AL 2.32.0) is auto at its dimmed values; tooltip says idle (1.18.0)'(t) {
    const idle = { mode: 'auto', idle: true, bri: 0.35, temp: 0.9, schedBri: 0.35, factor: undefined, lux: undefined, sunEl: undefined };
    const live = { onoff: true, dim: 0.35, light_temperature: 0.9 };
    t.equal(mode('idle1', live, status('idle1', idle)), 'auto', 'live 35 %/0.9 = what AL applied → auto, not Manual?');
    t.equal(mode('idle2', { ...live, dim: 0.8 }, status('idle2', idle), T0 + 31000), 'auto', '80 % for 0 s → still auto (first sighting)');
    t.equal(mode('idle2', { ...live, dim: 0.8 }, status('idle2', idle), T0 + 62000), 'drift', 'changed by hand for 30 s → Manual?');
    t.equal([lib.isIdle(idle), lib.isIdle(entry), lib.isIdle(null)], [true, false, false], 'isIdle');
    const text = lib.describeLightStatus({ ...idle, profile: 'Daytime', at: T0 });
    t.check(text.includes('idle: dimmed while the room is empty'), 'tooltip mentions idle', text);
    t.check(!lib.describeLightStatus(entry).includes('idle'), 'no idle text for a light that is not idle');
  },

  async "sunrise/sunset are today's København times, as AL 2.32.4 computes them (1.18.3)"(t) {
    // [date, reference sunrise, sunset] — independent calculation, within a minute
    // of the published times; 1.18.2 showed the times of 13 days later
    for (const [date, rise, set] of [['2026-11-03', '07:20', '16:26'], ['2026-09-22', '06:55', '19:09'],
      ['2027-03-22', '06:08', '18:27'], ['2026-06-21', '04:25', '21:58'], ['2026-12-21', '08:37', '15:38']]) {
      const sun = lib.getSunTimes(new Date(`${date}T12:00:00`));
      const toMin = (hm) => hm.split(':').map(Number).reduce((h, m) => h * 60 + m);
      const off = [sun.sunriseMinutes - toMin(rise), sun.sunsetMinutes - toMin(set)];
      t.check(off.every((m) => Math.abs(m) <= 2), `${date}: sunrise ${rise}, sunset ${set} within 2 min`, `off by ${off.join(' / ')} min`);
    }
  },

  async 'tooltip describes what AL applied'(t) {
    const text = lib.describeLightStatus(entry);
    t.check(text.startsWith('Daytime · 32% (80% × 0.4 daylight, 250 lx) · colour 0.59 (sun 21.4°) · set '), 'profile, daylight factor, lux, colour, sun', text);
  },
};
