// homey-dashboard/lib/adaptiveLighting.js: badge mode from AL's published status (1.17.0)
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

  async 'tooltip describes what AL applied'(t) {
    const text = lib.describeLightStatus(entry);
    t.check(text.startsWith('Daytime · 32% (80% × 0.4 daylight, 250 lx) · colour 0.59 (sun 21.4°) · set '), 'profile, daylight factor, lux, colour, sun', text);
  },
};
