// Room_watchdog 2.17: idle counts from the latest of motion, the turn-on (AL's
// lastApplied via normal) and the E9 door; a light switched on while nobody is
// seen gets UNSEEN_MIN_ON (900 s), capped at UNSEEN_MAX_HOLD (1800 s) from the
// first such turn-on; a flip-back right after an automatic off (GradualFadeOut
// 6.18 / the watchdog's own _AutoOffAt) gets the room's threshold
import { createEnv, light, motionSensor, contactSensor, setClock, clock, ID, HUE_DRIVER, GROUP_DRIVER } from '../mock.mjs';

const WD = 'room_watchdog.js';
const AL = 'adaptivelighting.js';
const GFO = 'gradualfadeout.js';
const B9 = ID.B9_LYS;
const B9_MOTION = '90bc5383-608b-43c9-89a1-f7f7c54d1675';
const B9_EVE = 'd78e0e15-5a6b-4908-be3c-4e5d3dc1a9d6';
const E9 = ID.E9_LOFT;
const GARDEROBE = ID.E9_GARDEROBE;
const E9_MOTION = '0da27a1f-ced1-4d02-9193-9438109c5c38';
const E9_DOOR = '68ef424e-3ab9-4573-8a89-bdce2b4ffe65';

// Copenhagen winter time (+01:00) on 3 Nov 2026, a Tuesday
const ms = (time, day = '03') => Date.parse(`2026-11-${day}T${time}+01:00`);
const iso = (t) => new Date(typeof t === 'string' && !t.includes('T') ? ms(t) : t).toISOString();
const hm = (t) => new Date(t + 3600000).toISOString().slice(11, 16);
const lines = (env, text) => env.diag().filter((l) => l.includes(text));
const faded = (env) => lines(env, 'WATCHDOG-FADE').length > 0;

// Homey virtual group: on when any bulb is on; a value written to it goes to every bulb
function groupModel(group, bulbs) {
  const on = () => bulbs.filter((b) => b.capabilitiesObj.onoff.value === true);
  const mean = (cap) => { const xs = on().map((b) => b.capabilitiesObj[cap].value); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
  const forward = (cap) => ({
    get value() { return cap === 'onoff' ? on().length > 0 : mean(cap); },
    set value(v) { for (const b of bulbs) b.capabilitiesObj[cap].value = v; },
  });
  group.capabilitiesObj = { onoff: forward('onoff'), dim: forward('dim'), light_temperature: forward('light_temperature') };
}

// AdaptiveLighting's record of a turn-on, as its normal run writes it
function alState(env, id, at, { via = 'normal', busyUntil = null } = {}) {
  const state = { manual: false, lastProfile: 'Morning', lastApplied: { at, brightness: 1, temperature: 0.3, via } };
  if (busyUntil) state.busy = { tok: busyUntil };
  env.setState(id, state);
}

// B9 Lys (group of three Hue bulbs) on at 100 %/0.3. alAt: AL's turn-on record
// (null = none); motionAt/eveAt: the sensors' last change; inactivity: B9_InactivitySeconds
function b9Env({ now, alAt = null, motionAt = '06:51:41', eveAt = '06:46:10', inactivity = 120 } = {}) {
  setClock(iso(now));
  const bulbs = [1, 2, 3].map((i) => light(`b9bulb0${i}`, `B9 Lys ${i}`, { hue: false, driver: HUE_DRIVER, dim: 1, temp: 0.3 }));
  const group = light(B9, 'B9 Lys', { hue: false, driver: GROUP_DRIVER });
  groupModel(group, bulbs);
  const motion = motionSensor(B9_MOTION, 'B9 Motion', { lastChanged: iso(motionAt) });
  const eve = motionSensor(B9_EVE, 'B9 Eve Motion Bruser', { lastChanged: iso(eveAt) });
  const env = createEnv([group, ...bulbs, motion, eve]);
  env.vars.v1 = { id: 'v1', name: 'B9_InactivitySeconds', type: 'number', value: inactivity };
  if (alAt) alState(env, B9, typeof alAt === 'string' ? ms(alAt) : alAt);
  // A sensor sees someone (true) or reports "no motion" (false) at time
  env.motion = (sensor, value, time) => {
    const c = (sensor === 'eve' ? eve : motion).capabilitiesObj.alarm_motion;
    c.value = value;
    c.lastChanged = iso(time);
  };
  env.bulbs = bulbs;
  // Count writes of one global key
  env.writes = {};
  const set = env.global.set;
  env.global.set = (k, v) => { env.writes[k] = (env.writes[k] || 0) + 1; return set(k, v); };
  return env;
}

// E9 Loft + E9 Garderobe on, E9 Motion last changed at motionAt, E9 Dør at
// doorAt (door: false = no door device, so reading it fails)
function e9Env({ now, alAt = null, motionAt = '17:00:00', doorAt = '17:00:00', door = true, inactivity = 180 } = {}) {
  setClock(iso(now));
  const devices = [
    light(E9, 'E9 Loft', { dim: 0.7, temp: 0.6, driver: HUE_DRIVER }),
    light(GARDEROBE, 'E9 Garderobe', { dim: 0.5, temp: 0.6, driver: HUE_DRIVER }),
    motionSensor(E9_MOTION, 'E9 Motion', { lastChanged: iso(motionAt) }),
  ];
  if (door) devices.push(contactSensor(E9_DOOR, 'E9 Dør', { lastChanged: iso(doorAt) }));
  const env = createEnv(devices);
  env.vars.v1 = { id: 'v1', name: 'E9_InactivitySeconds', type: 'number', value: inactivity };
  if (alAt) alState(env, E9, ms(alAt));
  env.door = (open, time) => {
    const c = env.devices[E9_DOOR].capabilitiesObj.alarm_contact;
    c.value = open;
    c.lastChanged = iso(time);
  };
  return env;
}

// Run the watchdog at each full minute from..to (inclusive); events: [time, fn]
// run before the first minute at or after them, with the clock at their time.
// Returns { 'HH:MM': result }
async function minutes(env, from, to, room = 'B9', events = []) {
  const out = {};
  const pending = events.map(([time, fn]) => ({ at: ms(time), fn }));
  for (let t = ms(from); t <= ms(to); t += 60000) {
    for (const e of pending.filter((p) => !p.done && p.at <= t)) { setClock(iso(e.at)); await e.fn(); e.done = true; }
    setClock(iso(t));
    out[hm(t)] = String(await env.run(WD, [room]));
  }
  return out;
}

// B9 Motion on 3 Nov after the switch (B9 Eve Motion Bruser stayed silent)
const B9_MOTION_0311 = [
  ['07:26:13', true], ['07:27:23', false], ['07:27:47', true], ['07:28:16', false], ['07:28:54', true],
  ['07:29:48', false], ['07:30:06', true], ['07:30:27', false], ['07:30:40', true], ['07:30:55', false],
];

// 3 Nov 07:23:24: the Hue dimmer switch turns B9 Lys on, its "turned on" flow
// runs AdaptiveLighting (normal). withGFO: the zone-inactive countdown (120 s
// after the last "no motion" at 07:30:55) runs GradualFadeOut at 07:32:57
async function replay0311({ withGFO }) {
  const env = b9Env({ now: '07:23:24' });
  for (const b of env.bulbs) b.capabilitiesObj.onoff.value = false;
  setClock(iso('07:23:24'));
  for (const b of env.bulbs) b.capabilitiesObj.onoff.value = true;   // the switch
  await env.run(AL, B9);                                                 // onoff_true → AL normal
  const events = B9_MOTION_0311.map(([time, value]) => [time, () => env.motion('hue', value, time)]);
  if (withGFO) events.push(['07:32:57', () => env.run(GFO, [B9])]);
  const out = await minutes(env, '07:24:00', '07:34:00', 'B9', events);
  return { env, out };
}

export const scenarios = {
  async '3 Nov replay: B9 Lys switched on at 07:23:24 with nobody seen since 06:51:41 → kept on; seen from 07:26:13 → 180 s from the last motion'(t) {
    const { env, out } = await replay0311({ withGFO: true });
    const al = env.state(B9);
    t.equal([al.lastApplied.via, al.lastApplied.at, Object.keys(al.busy || {}).length], ['normal', ms('07:23:24'), 0], 'AdaptiveLighting recorded the turn-on (via normal, 07:23:24) and released its lease');
    t.equal(out, {
      '07:24': 'B9 Watchdog: idle 36s / 900s (864s left) — on, nobody seen',
      '07:25': 'B9 Watchdog: idle 96s / 900s (804s left) — on, nobody seen',
      '07:26': 'B9 Watchdog: idle 156s / 900s (744s left) — on, nobody seen',
      '07:27': 'B9 Watchdog: motion detected',
      '07:28': 'B9 Watchdog: motion detected',
      '07:29': 'B9 Watchdog: motion detected',
      '07:30': 'B9 Watchdog: idle 12s / 180s (168s left)',
      '07:31': 'B9 Watchdog: idle 5s / 180s (175s left)',
      '07:32': 'B9 Watchdog: idle 65s / 180s (115s left)',
      '07:33': 'B9 Watchdog: lights off',
      '07:34': 'B9 Watchdog: lights off',
    }, 'minute by minute: held while nobody is seen, the room threshold once seen, GradualFadeOut turns it off at 07:32:57');
    t.equal(lines(env, 'WATCHDOG-UNSEEN').map((l) => l.slice(l.indexOf('WATCHDOG'))),
      ['WATCHDOG-UNSEEN | Badeværelse 9 | on 36s, nobody seen since (last motion 32 min before) — no fade before 900s'], 'one WATCHDOG-UNSEEN line');
    t.check(!faded(env) && lines(env, 'FADE-OFF | B9 Lys').length === 1, 'no WATCHDOG-FADE; FADE-OFF from GradualFadeOut', env.diag().join('\n'));

    // Had the countdown failed, the stuck light is still caught at 07:34:00
    const lost = await replay0311({ withGFO: false });
    t.equal([lost.out['07:33'], lines(lost.env, 'WATCHDOG-FADE').length], ['B9 Watchdog: idle 125s / 180s (55s left)', 1], '07:33 held, one fade');
    t.check(lines(lost.env, 'WATCHDOG-FADE | Badeværelse 9 | idle=185s threshold=180s | ').length === 1 && lost.env.dev(B9).onoff.value === false,
      'countdown lost: WATCHDOG-FADE at 07:34:00, 185 s after the last motion, as 2.16', lost.env.diag().join('\n'));
  },

  async 'B9 switched on while nobody is seen, never seen → faded 900 s after the turn-on, day (120 s) and night (60 s)'(t) {
    for (const [label, inactivity, now] of [['day', 120, '09:00:00'], ['night', 60, '23:30:00']]) {
      const onAt = ms(now);
      const env = b9Env({ now, alAt: onAt, inactivity, motionAt: iso(onAt - 3600000), eveAt: iso(onAt - 3600000) });
      const waits = [];
      env.onWait = async (w) => { waits.push(w); };
      const out = {};
      for (let s = 60; s <= 840; s += 60) { setClock(iso(onAt + s * 1000)); out[s] = String(await env.run(WD, ['B9'])); }
      t.check(!faded(env) && out[840] === 'B9 Watchdog: idle 840s / 900s (60s left) — on, nobody seen', `${label}: held for 14 minutes`, JSON.stringify(out));
      t.equal(waits, [], `${label}: no 5 s wait on the hold path`);
      setClock(iso(onAt + 900000));
      const r = String(await env.run(WD, ['B9']));
      t.check(r.includes('fade + off') && env.dev(B9).onoff.value === false, `${label}: faded and off at 900 s`, r);
      t.equal(waits[0], 5000, `${label}: the fade path looks once more after 5 s`);
      t.equal(lines(env, 'WATCHDOG-FADE | Badeværelse 9 | idle=900s threshold=900s (nobody seen since on) |').length, 1, `${label}: WATCHDOG-FADE says nobody was seen`);
      t.equal(lines(env, 'WATCHDOG-UNSEEN | Badeværelse 9 | on 60s, nobody seen since (last motion 60 min before) — no fade before 900s').length, 1, `${label}: one WATCHDOG-UNSEEN line`);
      t.equal(env.writes['AL_WatchdogUnseen_B9'], 1, `${label}: AL_WatchdogUnseen_B9 written once, not every minute`);
    }
  },

  async 'B9 turned on by the zone flow (motion) → 180 s from the later of motion and turn-on, as before'(t) {
    // 21:00:00 motion → zone flow turns on, AL records 21:00:05, "no motion" at 21:00:15
    const env = b9Env({ now: '21:00:15', alAt: '21:00:05', motionAt: '21:00:15' });
    const out = await minutes(env, '21:01:00', '21:03:00');
    t.equal(out['21:03'], 'B9 Watchdog: idle 165s / 180s (15s left)', 'idle from the last motion, 180 s threshold');
    setClock(iso('21:03:15'));
    await env.run(WD, ['B9']);
    t.check(lines(env, 'WATCHDOG-FADE | Badeværelse 9 | idle=180s threshold=180s | ').length === 1, 'faded at 180 s', env.diag().join('\n'));
    t.equal([lines(env, 'WATCHDOG-UNSEEN').length, env.writes['AL_WatchdogUnseen_B9'] || 0], [0, 0], 'no WATCHDOG-UNSEEN, no record');
  },

  async 'slow Homey: AL records the turn-on 50 s after the motion → still seen (SEEN_BEFORE_ON)'(t) {
    const env = b9Env({ now: '21:01:00', alAt: '21:00:55', motionAt: '21:00:05' });
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: idle 5s / 180s (175s left)', 'room threshold, idle from the turn-on');
    const env2 = b9Env({ now: '21:01:00', alAt: '21:00:55', motionAt: '20:59:50' });   // 65 s before
    t.check(String(await env2.run(WD, ['B9'])).endsWith('/ 900s (895s left) — on, nobody seen'), '65 s before the turn-on is not seen');
  },

  async 'switched on unseen, seen 5 min later, then nobody → 180 s from that motion, not 900 s'(t) {
    const env = b9Env({ now: '10:00:00', alAt: '10:00:01', motionAt: '09:00:00', eveAt: '09:00:00' });
    const out = await minutes(env, '10:01:00', '10:08:00', 'B9', [
      ['10:05:00', () => env.motion('hue', true, '10:05:00')],
      ['10:05:20', () => env.motion('hue', false, '10:05:20')],
    ]);
    t.equal([out['10:04'], out['10:06'], out['10:08']], [
      'B9 Watchdog: idle 239s / 900s (661s left) — on, nobody seen',
      'B9 Watchdog: idle 40s / 180s (140s left)',
      'B9 Watchdog: idle 160s / 180s (20s left)',
    ], 'nobody seen → 900 s; seen at 10:05 → the room threshold from the last motion');
    setClock(iso('10:09:00'));
    await env.run(WD, ['B9']);
    t.check(lines(env, 'WATCHDOG-FADE | Badeværelse 9 | idle=220s threshold=180s | ').length === 1, 'countdown lost: faded at 10:09', env.diag().join('\n'));
  },

  async 'AL turn-on still holding its lease → wait for the next minute; a dead lease is ignored; read after getVariables'(t) {
    const env = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    alState(env, B9, ms('19:00:00'), { busyUntil: clock() + 50000 });
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: AdaptiveLighting turn-on in progress', 'lease held → decide next minute');
    t.check(!faded(env), 'not faded');
    setClock(iso('21:01:00'));                                 // the lease ran out, nothing recorded
    await env.run(WD, ['B9']);
    t.check(faded(env), 'next minute: no new turn-on → stuck light faded as before');

    // The lease is taken while the watchdog waits for the Logic variables
    const env2 = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    const getVariables = env2.Homey.logic.getVariables;
    env2.Homey.logic.getVariables = async () => {
      const v = await getVariables();
      alState(env2, B9, ms('19:00:00'), { busyUntil: clock() + 60000 });
      return v;
    };
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: AdaptiveLighting turn-on in progress', 'AL state read after the getVariables await');

    // A lease further ahead than AL's 60 s (the clock stepped back, a corrupt
    // write; AL keeps it in every save) is no lease: the stuck light is faded
    const env3 = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    alState(env3, B9, ms('19:00:00'), { busyUntil: clock() + 6 * 3600000 });
    t.check(String(await env3.run(WD, ['B9'])).includes('fade + off') && faded(env3), 'a lease 6 h ahead is ignored → faded as 2.16');
    const env4 = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    alState(env4, B9, ms('19:00:00'), { busyUntil: clock() + 66000 });
    await env4.run(WD, ['B9']);
    t.check(faded(env4), '66 s ahead: no lease either');
  },

  async 'a turn-on time more than a minute ahead is ignored; within a minute it counts'(t) {
    const env = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    alState(env, B9, ms('21:00:00', '04'));                    // tomorrow
    await env.run(WD, ['B9']);
    t.check(faded(env), 'tomorrow: unknown turn-on → faded as 2.16');
    const env2 = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    alState(env2, B9, ms('21:00:30'));                         // clock 30 s apart
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: idle -30s / 900s (930s left) — on, nobody seen', '30 s ahead: a turn-on, held');
  },

  async 'a record from another AL mode (check, lux, clear) is no turn-on'(t) {
    for (const via of ['check', 'lux', 'clear']) {
      const env = b9Env({ now: '21:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
      alState(env, B9, ms('20:59:30'), { via });
      await env.run(WD, ['B9']);
      t.check(faded(env) && lines(env, 'WATCHDOG-UNSEEN').length === 0, `via ${via}: faded at once, as 2.16`);
    }
  },

  async 'no motion timestamp: turn-on known → faded 900 s after it; both unknown → as 2.16'(t) {
    const env = b9Env({ now: '21:00:00', alAt: '21:00:00' });
    for (const id of [B9_MOTION, B9_EVE]) delete env.dev(id).alarm_motion.lastChanged;
    setClock(iso('21:14:00'));
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: idle 840s / 900s (60s left) — on, nobody seen', 'held at 14 min');
    t.equal(lines(env, 'WATCHDOG-UNSEEN | Badeværelse 9 | on 840s, nobody seen since (no motion timestamp) — no fade before 900s').length, 1, 'WATCHDOG-UNSEEN says there is no motion timestamp');
    setClock(iso('21:15:00'));
    await env.run(WD, ['B9']);
    t.check(faded(env) && env.dev(B9).onoff.value === false, 'faded at 15 min (2.16: never)');
    // The next evening: the record's last motion is still "none", but the
    // automatic off and the time since end that stretch → 900 s again
    for (const b of env.bulbs) { b.capabilitiesObj.onoff.value = true; b.capabilitiesObj.dim.value = 1; }
    alState(env, B9, ms('21:00:00', '04'));
    setClock(iso(ms('21:01:00', '04')));
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: idle 60s / 900s (840s left) — on, nobody seen', 'next day: held 900 s, not capped by yesterday');

    const env2 = b9Env({ now: '21:00:00' });
    for (const id of [B9_MOTION, B9_EVE]) delete env2.dev(id).alarm_motion.lastChanged;
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: no motion timestamp available', 'neither known: as 2.16');
  },

  async 'E9: door opened, lights on, nobody moves → seen; idle from the door\'s last change (240 s)'(t) {
    const env = e9Env({ now: '18:00:03', alAt: '18:00:03', doorAt: '18:00:00' });
    const out = await minutes(env, '18:01:00', '18:05:00', 'E9', [['18:02:00', () => env.door(false, '18:02:00')]]);
    t.equal([out['18:01'], out['18:02'], out['18:05']], [
      'E9 Watchdog: idle 57s / 240s (183s left)',
      'E9 Watchdog: idle 0s / 240s (240s left)',
      'E9 Watchdog: idle 180s / 240s (60s left)',
    ], 'room threshold, counted from the door closing at 18:02');
    setClock(iso('18:06:00'));
    await env.run(WD, ['E9']);
    t.check(lines(env, 'WATCHDOG-FADE | Entre 9 | idle=240s threshold=240s | ').length === 1 && env.dev(GARDEROBE).onoff.value === false, 'faded at 18:06, both lights off', env.diag().join('\n'));
    t.equal(lines(env, 'WATCHDOG-UNSEEN').length + lines(env, 'WATCHDOG-ERROR').length, 0, 'no WATCHDOG-UNSEEN or -ERROR');

    // Switched on with the door untouched for an hour → nobody seen
    const env2 = e9Env({ now: '18:00:03', alAt: '18:00:03' });
    const out2 = await minutes(env2, '18:01:00', '18:15:00', 'E9');
    t.equal(out2['18:15'], 'E9 Watchdog: idle 897s / 900s (3s left) — on, nobody seen', 'door untouched: 900 s');
    setClock(iso('18:16:00'));
    await env2.run(WD, ['E9']);
    t.check(lines(env2, 'WATCHDOG-FADE | Entre 9 | idle=957s threshold=900s (nobody seen since on) |').length === 1, 'then faded');
  },

  async 'E9: door sensor unreadable → not seen (900 s), one WATCHDOG-ERROR per 10 min naming it'(t) {
    const env = e9Env({ now: '18:00:03', alAt: '18:00:03', door: false });
    const out = await minutes(env, '18:01:00', '18:10:00', 'E9');
    t.check(Object.values(out).every((r) => r.endsWith('— on, nobody seen') && r.includes('/ 900s')), 'held as nobody seen, no throw', JSON.stringify(out));
    const errors = lines(env, 'WATCHDOG-ERROR');
    t.equal(errors.length, 1, '10 minutes → one WATCHDOG-ERROR');
    t.check(errors[0]?.includes(`WATCHDOG-ERROR | Entre 9 | door sensor ${E9_DOOR} unreadable (treated as not seen): Not Found`), 'it names the door sensor', errors[0]);
    await minutes(env, '18:11:00', '18:11:00', 'E9');
    t.equal(lines(env, 'WATCHDOG-ERROR').length, 2, 'the next after 10 minutes');
    t.equal(env.global.get('AL_WatchdogErrorAt_E9'), null, "the room's own error timestamp untouched (other errors still logged)");
    setClock(iso('18:15:03'));
    await env.run(WD, ['E9']);
    t.check(lines(env, 'WATCHDOG-FADE | Entre 9 | idle=900s threshold=900s (nobody seen since on) |').length === 1, 'faded 900 s after the turn-on');

    // Readable, but alarm_contact has no change time (re-paired, another driver)
    const env2 = e9Env({ now: '18:00:03', alAt: '18:00:03' });
    delete env2.devices[E9_DOOR].capabilitiesObj.alarm_contact.lastChanged;
    setClock(iso('18:01:00'));
    t.equal(String(await env2.run(WD, ['E9'])), 'E9 Watchdog: idle 57s / 900s (843s left) — on, nobody seen', 'no change time → not seen');
    t.equal(lines(env2, 'WATCHDOG-ERROR').map((l) => l.slice(l.indexOf('WATCHDOG'))),
      [`WATCHDOG-ERROR | Entre 9 | door sensor ${E9_DOOR} unreadable (treated as not seen): E9 Dør alarm_contact has no change time`], 'logged as a door read failure');
  },

  async 'E9: motion saw the turn-on → the door is not read; idle from motion and the turn-on, as 2.16'(t) {
    const env = e9Env({ now: '18:00:03', alAt: '18:00:03', motionAt: '18:00:00', doorAt: '17:00:00' });
    let doorReads = 0;
    const getDevice = env.Homey.devices.getDevice;
    env.Homey.devices.getDevice = async (a) => { if (a.id === E9_DOOR) doorReads++; return getDevice(a); };
    const out = await minutes(env, '18:01:00', '18:03:00', 'E9', [['18:02:00', () => env.door(false, '18:02:00')]]);
    t.equal(out['18:03'], 'E9 Watchdog: idle 177s / 240s (63s left)', 'idle from the turn-on at 18:00:03; the door closing at 18:02 is not read');
    t.equal(doorReads, 0, 'E9 Dør never read while motion has seen the turn-on');
  },

  async 'flip-back after GradualFadeOut\'s off → the room threshold from the turn-on, no UNSEEN line; 4 min later it is a new turn-on'(t) {
    // Zone flow on at 09:50 (motion), last "no motion" 10:00:00, countdown → GFO 10:02:00
    const env = b9Env({ now: '09:50:00', alAt: '09:50:00', motionAt: '10:00:00', eveAt: '09:50:00' });
    setClock(iso('10:02:00'));
    t.check(String(await env.run(GFO, [B9])).includes('Faded and turned off'), 'GradualFadeOut faded and turned B9 Lys off');
    t.equal(env.store.get(`${B9}_AutoOffAt`), ms('10:02:00'), 'GradualFadeOut stamped _AutoOffAt');
    // 10:02:45 a bulb reports on again (late Zigbee report) → "turned on" flow → AL
    setClock(iso('10:02:45'));
    env.bulbs[0].capabilitiesObj.onoff.value = true;
    await env.run(AL, B9);
    t.equal(env.state(B9).lastApplied.at, ms('10:02:45'), 'AL recorded the turn-on');
    const out = await minutes(env, '10:03:00', '10:05:00');
    t.equal(out, {
      '10:03': 'B9 Watchdog: idle 15s / 180s (165s left) — flip-back after auto-off',
      '10:04': 'B9 Watchdog: idle 75s / 180s (105s left) — flip-back after auto-off',
      '10:05': 'B9 Watchdog: idle 135s / 180s (45s left) — flip-back after auto-off',
    }, 'room threshold counted from the turn-on');
    setClock(iso('10:06:00'));
    await env.run(WD, ['B9']);
    t.check(lines(env, 'WATCHDOG-FADE | Badeværelse 9 | idle=195s threshold=180s (flip-back after auto-off) |').length === 1 && env.dev(B9).onoff.value === false, 'faded at 10:06', env.diag().join('\n'));
    t.equal(lines(env, 'WATCHDOG-UNSEEN').length, 0, 'no WATCHDOG-UNSEEN line');
    t.equal(env.writes['AL_WatchdogUnseen_B9'] || 0, 0, 'no stretch record: a flip-back is never capped');

    // Switched on 4 min after an automatic off: not a flip-back
    const env2 = b9Env({ now: '10:06:00', alAt: '10:06:00', motionAt: '10:00:00', eveAt: '09:50:00' });
    env2.store.set(`${B9}_AutoOffAt`, ms('10:02:00'));
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: idle 0s / 900s (900s left) — on, nobody seen', '240 s after the off → nobody seen, 900 s');
  },

  async 'flip-back after the watchdog\'s own off (E9 Loft and E9 Garderobe stamped) → the room threshold from the turn-on'(t) {
    // Zone flow on at 21:00 via motion, last motion 21:00:30, countdown lost
    const env = e9Env({ now: '21:00:02', alAt: '21:00:02', motionAt: '21:00:30', doorAt: '20:59:00' });
    setClock(iso('21:05:00'));
    t.check(String(await env.run(WD, ['E9'])).includes('fade + off') && lines(env, 'WATCHDOG-OFF | Entre 9').length === 1, 'watchdog faded and turned E9 off (seen: 240 s)');
    t.equal([env.store.get(`${E9}_AutoOffAt`), env.store.get(`${GARDEROBE}_AutoOffAt`)], [ms('21:05:00'), ms('21:05:00')], 'both lights stamped at WATCHDOG-OFF');
    // 21:06:00 E9 Loft back on (late report), AL records 21:06:01
    setClock(iso('21:06:01'));
    env.dev(E9).onoff.value = true;
    alState(env, E9, ms('21:06:01'));
    const out = await minutes(env, '21:07:00', '21:10:00', 'E9');
    t.equal([out['21:07'], out['21:10']], [
      'E9 Watchdog: idle 59s / 240s (181s left) — flip-back after auto-off',
      'E9 Watchdog: idle 239s / 240s (1s left) — flip-back after auto-off',
    ], 'held for the room threshold from the turn-on, not 900 s');
    setClock(iso('21:11:00'));
    await env.run(WD, ['E9']);
    t.check(lines(env, 'WATCHDOG-FADE | Entre 9 | idle=299s threshold=240s (flip-back after auto-off) |').length === 1 && env.dev(E9).onoff.value === false, 'faded at 21:11', env.diag().join('\n'));
    t.equal(lines(env, 'WATCHDOG-UNSEEN').length, 0, 'no WATCHDOG-UNSEEN line');
  },

  async 'flapping: the turn-on moves every 10 min, nobody seen → faded 1800 s after the first unseen turn-on; a new motion starts over'(t) {
    const env = b9Env({ now: '10:00:00', alAt: '10:00:00', motionAt: '09:00:00', eveAt: '09:00:00' });
    const onAgain = (time) => [time, () => alState(env, B9, ms(time))];
    const out = await minutes(env, '10:01:00', '10:29:00', 'B9', [onAgain('10:09:30'), onAgain('10:19:30'), onAgain('10:29:30')]);
    t.check(!faded(env), 'held until 10:29', JSON.stringify(out));
    t.equal(out['10:29'], 'B9 Watchdog: idle 570s / 900s (60s left) — on, nobody seen, max 1800s from the first unseen turn-on', 'the cap is nearer than 900 s');
    t.equal(lines(env, 'WATCHDOG-UNSEEN').map((l) => l.slice(l.indexOf('on '))), [
      'on 60s, nobody seen since (last motion 60 min before) — no fade before 900s',
      'on 30s, nobody seen since (last motion 70 min before) — no fade before 900s',
      'on 30s, nobody seen since (last motion 80 min before) — no fade before 630s (first unseen turn-on 20 min before, max 1800s)',
    ], 'one WATCHDOG-UNSEEN line per turn-on, the third capped');
    t.equal(env.writes['AL_WatchdogUnseen_B9'], 3, 'record written once per turn-on, not every minute');
    await minutes(env, '10:30:00', '10:30:00', 'B9', [onAgain('10:29:30')]);
    t.check(lines(env, 'WATCHDOG-FADE | Badeværelse 9 | idle=30s threshold=900s (nobody seen since on) first-on=1800s cap=1800s |').length === 1 && env.dev(B9).onoff.value === false,
      'faded at 10:30, 1800 s after the first unseen turn-on (no cap: 10:44:30)', env.diag().join('\n'));

    // Someone seen at 10:40, the light switched on unseen at 11:00 → a new stretch
    env.motion('hue', true, '10:40:00');
    env.motion('hue', false, '10:40:20');
    for (const b of env.bulbs) b.capabilitiesObj.onoff.value = true;
    alState(env, B9, ms('11:00:00'));
    const out2 = await minutes(env, '11:01:00', '11:14:00');
    t.check(lines(env, 'WATCHDOG-FADE').length === 1 && out2['11:14'] === 'B9 Watchdog: idle 840s / 900s (60s left) — on, nobody seen', 'new stretch: held 900 s again', JSON.stringify(out2));
  },

  async 'flip-back right after the cap fade → the room threshold from the turn-on, never the cap'(t) {
    const env = b9Env({ now: '10:00:00', alAt: '10:00:00', motionAt: '09:00:00', eveAt: '09:00:00' });
    const onAgain = (time) => [time, () => alState(env, B9, ms(time))];
    await minutes(env, '10:01:00', '10:30:00', 'B9', [onAgain('10:09:30'), onAgain('10:19:30'), onAgain('10:29:30')]);
    t.check(lines(env, 'WATCHDOG-OFF').length === 1 && env.store.get(`${B9}_AutoOffAt`) === ms('10:30:00'), 'capped: fade + off at 10:30, stamped');
    // 10:30:40 a late report: the bulbs back on, AL records the turn-on
    for (const b of env.bulbs) { b.capabilitiesObj.onoff.value = true; b.capabilitiesObj.dim.value = 1; }
    alState(env, B9, ms('10:30:40'));
    const out = await minutes(env, '10:31:00', '10:34:00');
    t.equal([out['10:31'], out['10:33'], out['10:34']], [
      'B9 Watchdog: idle 20s / 180s (160s left) — flip-back after auto-off',
      'B9 Watchdog: idle 140s / 180s (40s left) — flip-back after auto-off',
      'B9 Watchdog: fade + off after 200s idle',
    ], 'held 180 s from the turn-on (the cap from 10:00 has passed, and does not apply)');
    t.equal(lines(env, 'WATCHDOG-FADE').slice(-1).map((l) => l.slice(l.indexOf('WATCHDOG'), l.indexOf(' | dim='))),
      ['WATCHDOG-FADE | Badeværelse 9 | idle=200s threshold=180s (flip-back after auto-off)'], 'no first-on/cap note');
  },

  async 'a stretch ends at an automatic off, after UNSEEN_MAX_HOLD, or when the E9 door changed: the next unseen turn-on gets its full 900 s'(t) {
    // The 3 Nov switch press, after an unseen turn-on at 06:55 (the app, or a
    // late report) that was faded at 07:10 — 07:23:24 is within 30 min of 06:55
    const env = b9Env({ now: '06:55:00', alAt: '06:55:00' });
    await minutes(env, '06:56:00', '07:10:00');
    t.equal(env.store.get(`${B9}_AutoOffAt`), ms('07:10:00'), '06:55 turn-on faded and off at 07:10');
    for (const b of env.bulbs) { b.capabilitiesObj.onoff.value = true; b.capabilitiesObj.dim.value = 1; }
    alState(env, B9, ms('07:23:24'));
    const out = await minutes(env, '07:24:00', '07:25:00');
    t.equal(out, {
      '07:24': 'B9 Watchdog: idle 36s / 900s (864s left) — on, nobody seen',
      '07:25': 'B9 Watchdog: idle 96s / 900s (804s left) — on, nobody seen',
    }, 'automatic off in between → a new stretch (was: faded at 07:25, the 06:55 cap)');
    t.equal(lines(env, 'WATCHDOG-UNSEEN').slice(-1).map((l) => l.slice(l.indexOf('on '))),
      ['on 36s, nobody seen since (last motion 32 min before) — no fade before 900s'], 'its UNSEEN line is not capped');

    // Night: 01:00 a short unseen visit, switched off by hand at 01:03 (no
    // automatic off). On again at 01:20 → the same stretch (it can't be told
    // from a bulb dropping out), capped at 01:30; at 03:00 → past the cap, new
    const night = b9Env({ now: '01:00:00', alAt: '01:00:00', motionAt: '00:30:00', eveAt: '00:30:00', inactivity: 60 });
    await minutes(night, '01:01:00', '01:03:00');
    const press = (time) => { for (const b of night.bulbs) b.capabilitiesObj.onoff.value = true; alState(night, B9, ms(time)); };
    for (const b of night.bulbs) b.capabilitiesObj.onoff.value = false;
    press('01:20:00');
    t.equal((await minutes(night, '01:21:00', '01:21:00'))['01:21'], 'B9 Watchdog: idle 60s / 900s (540s left) — on, nobody seen, max 1800s from the first unseen turn-on', '01:20: within 30 min of 01:00 → capped at 01:30');
    for (const b of night.bulbs) b.capabilitiesObj.onoff.value = false;
    press('03:00:00');
    t.equal((await minutes(night, '03:01:00', '03:01:00'))['03:01'], 'B9 Watchdog: idle 60s / 900s (840s left) — on, nobody seen', '03:00: past the 01:00 stretch → 900 s');
    t.equal(JSON.parse(night.store.get('AL_WatchdogUnseen_B9')).firstOnAt, ms('03:00:00'), 'the record starts at 03:00');

    // E9: unseen at 18:00:03; someone opens the door at 18:05 (seen); the
    // lights are switched off and on again unseen at 18:20 — a new stretch
    const e9 = e9Env({ now: '18:00:03', alAt: '18:00:03' });
    await minutes(e9, '18:01:00', '18:01:00', 'E9');
    e9.door(true, '18:05:00');
    e9.door(false, '18:06:00');
    alState(e9, E9, ms('18:20:00'));
    t.equal((await minutes(e9, '18:21:00', '18:21:00', 'E9'))['18:21'], 'E9 Watchdog: idle 60s / 900s (840s left) — on, nobody seen', 'door changed since 18:00:03 → 900 s, not the 18:30 cap');

    // A record whose first turn-on is later than this one (the clock stepped
    // back) is not this stretch
    const back = b9Env({ now: '10:01:00', alAt: '10:00:00', motionAt: '09:00:00', eveAt: '09:00:00' });
    back.store.set('AL_WatchdogUnseen_B9', JSON.stringify({ firstOnAt: ms('10:10:00'), lastMotion: ms('09:00:00'), loggedOnAt: ms('10:10:00') }));
    await back.run(WD, ['B9']);
    t.equal(JSON.parse(back.store.get('AL_WatchdogUnseen_B9')).firstOnAt, ms('10:00:00'), 'a new stretch from 10:00');
  },

  async 'a turn-on from before the last automatic off is no flip-back'(t) {
    // Switched on unseen at 10:00; the armed countdown's GradualFadeOut turns
    // it off at 10:05 (the known limit) and it comes back on without AL
    // recording a turn-on: still the 10:00 turn-on, 900 s, the same stretch
    const env = b9Env({ now: '10:01:00', alAt: '10:00:00', motionAt: '09:00:00', eveAt: '09:00:00' });
    await env.run(WD, ['B9']);
    env.store.set(`${B9}_AutoOffAt`, ms('10:05:00'));
    setClock(iso('10:07:00'));
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: idle 420s / 900s (480s left) — on, nobody seen', 'not a flip-back (that would fade it at once)');
    t.equal([lines(env, 'WATCHDOG-UNSEEN').length, env.writes['AL_WatchdogUnseen_B9']], [1, 1], 'one WATCHDOG-UNSEEN line, record written once');
  },

  async 'the watchdog\'s "already very dim" off is an automatic off too: a late report after it is a flip-back'(t) {
    // E9 with the door left ajar (zone active): 21:00 fade, WATCHDOG-HOLD; 21:01
    // the light is at 0 % → the routine second step turns it off
    const env = e9Env({ now: '21:00:00', alAt: '20:50:00', motionAt: '20:50:00', doorAt: '20:50:00' });
    env.devices[E9_DOOR].capabilitiesObj.alarm_contact.value = true;
    env.zoneActive = true;
    t.equal(String(await env.run(WD, ['E9'])), 'E9 Watchdog: zone active without motion, turn-off skipped', '21:00 faded, turn-off held');
    setClock(iso('21:01:00'));
    t.equal(String(await env.run(WD, ['E9'])), 'E9 Watchdog: already dim, turned off', '21:01 turned off');
    t.equal(env.store.get(`${E9}_AutoOffAt`), ms('21:01:00'), '_AutoOffAt stamped');
    // 21:01:20 a late report: E9 Loft on again, AL records the turn-on
    env.dev(E9).onoff.value = true;
    env.dev(E9).dim.value = 0.7;
    alState(env, E9, ms('21:01:20'));
    setClock(iso('21:02:00'));
    t.equal(String(await env.run(WD, ['E9'])), 'E9 Watchdog: idle 40s / 240s (200s left) — flip-back after auto-off', 'the room threshold, not 900 s');
    t.equal(lines(env, 'WATCHDOG-UNSEEN').length, 0, 'no WATCHDOG-UNSEEN line');
  },

  async '5 s re-check before the fade: a turn-on recorded or started during the wait → no fade, the next minute decides'(t) {
    // Stuck light (nobody for an hour); AL's turn-on run starts during the 5 s wait
    const env = b9Env({ now: '21:00:00', alAt: '19:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    env.onWait = async (msWait) => { if (msWait === 5000) alState(env, B9, ms('19:00:00'), { busyUntil: clock() + 60000 }); };
    t.equal(String(await env.run(WD, ['B9'])), 'B9 Watchdog: turned on just now — decide next minute', 'lease taken during the wait');
    t.check(!faded(env) && env.dev(B9).onoff.value === true, 'not faded');

    // The switch pressed just before the minute: AL records it during the wait
    const env2 = b9Env({ now: '21:00:00', alAt: '19:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
    env2.onWait = async (msWait) => { if (msWait === 5000) { env2.onWait = null; await env2.run(AL, B9); } };
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: turned on just now — decide next minute', 'AL recorded a turn-on during the wait');
    t.check(!faded(env2), 'not faded');
    setClock(iso('21:01:00'));
    t.equal(String(await env2.run(WD, ['B9'])), 'B9 Watchdog: idle 60s / 900s (840s left) — on, nobody seen', 'next minute: a new unseen turn-on, held');
  },

  async '5 s re-check before the fade: motion, an off by hand or a GradualFadeOut fade during the wait → no fade; the fade uses the light as it is after the wait'(t) {
    // A stuck light, nobody for an hour; getDevice returns copies, as Homey's API does
    const stuck = (during) => {
      const env = b9Env({ now: '21:00:00', alAt: '19:00:00', motionAt: '20:00:00', eveAt: '20:00:00' });
      env.deviceListDelayMs = 1;
      env.onWait = async (w) => { if (w === 5000) await during(env); };
      return env;
    };
    const untouched = (env) => !faded(env) && env.cards.length === 0 && !env.store.get(`${B9}_AutoOffAt`);

    // Someone walks in: RestoreSavedSettings finds no fade to cancel yet
    const walkIn = stuck((env) => env.motion('hue', true, '21:00:03'));
    t.equal(String(await walkIn.run(WD, ['B9'])), 'B9 Watchdog: motion just now — decide next minute', 'motion during the wait');
    t.check(untouched(walkIn) && !walkIn.store.get(`${B9}_FadeActiveUntil`) && walkIn.dev(B9).dim.value === 1, 'no fade, no fade window, light untouched', walkIn.diag().join('\n'));
    // ... or came and went: a change newer than the last motion read
    const cameAndWent = stuck((env) => env.motion('eve', false, '21:00:03'));
    t.equal(String(await cameAndWent.run(WD, ['B9'])), 'B9 Watchdog: motion just now — decide next minute', 'a newer motion change during the wait');

    // Switched off with the Hue switch during the wait
    const off = stuck((env) => { for (const b of env.bulbs) b.capabilitiesObj.onoff.value = false; });
    t.equal(String(await off.run(WD, ['B9'])), 'B9 Watchdog: switched off just now', 'off during the wait');
    t.check(untouched(off), 'no dim cards, no WATCHDOG-FADE, no _AutoOffAt (a press within 3 min would be a flip-back)', off.diag().join('\n'));

    // GradualFadeOut's countdown starts its fade during the wait
    const gfo = stuck((env) => env.store.set(`${B9}_FadeActiveUntil`, clock() + 35000));
    t.equal(String(await gfo.run(WD, ['B9'])), 'B9 Watchdog: fade started just now', 'a fade started during the wait');
    t.check(untouched(gfo) && gfo.store.get(`${B9}_FadeActiveUntil`) === clock() + 35000, "no second fade; GradualFadeOut's window left alone");

    // Dimmed by hand during the wait: the fade saves the value after the wait
    const dimmed = stuck((env) => { for (const b of env.bulbs) b.capabilitiesObj.dim.value = 0.5; });
    t.check(String(await dimmed.run(WD, ['B9'])).includes('fade + off'), 'nothing else changed → faded');
    t.equal([dimmed.store.get(`${B9}_SavedDim`), lines(dimmed, 'WATCHDOG-FADE | Badeværelse 9 | idle=3600s threshold=180s | dim=50%').length], [0.5, 1], 'saved and logged at 50 %, not the 100 % read before the wait');
  },

  async 'GradualFadeOut 6.18 stamps _AutoOffAt for each light it switches off: at FADE-OFF and at its very-dim off'(t) {
    setClock(iso('22:00:00'));
    const env = createEnv([light(E9, 'E9 Loft', { dim: 0.7 }), light(GARDEROBE, 'E9 Garderobe', { dim: 0.5 })]);
    env.waitAdvancesClock = true;                                          // the 20 s fade moves the clock
    await env.run(GFO, [`${E9},${GARDEROBE}`]);
    const stamps = [env.global.get(`${E9}_AutoOffAt`), env.global.get(`${GARDEROBE}_AutoOffAt`)];
    t.check(stamps.every((s) => s >= ms('22:00:20') && s <= clock()), 'both stamped at FADE-OFF, after the 20 s fade (not at its start)', JSON.stringify(stamps));
    t.equal(lines(env, 'FADE-OFF').length, 2, 'two FADE-OFF lines');

    // Already off, or a restore during the fade: no automatic off, no stamp
    setClock(iso('22:10:00'));
    const env2 = createEnv([light(E9, 'E9 Loft', { on: false }), light(GARDEROBE, 'E9 Garderobe', { dim: 0.5 })]);
    env2.onWait = async (msWait) => { if (msWait === 20000) env2.store.set(`${GARDEROBE}_RestoredAt`, clock()); };
    await env2.run(GFO, [`${E9},${GARDEROBE}`]);
    t.equal([env2.global.get(`${E9}_AutoOffAt`), env2.global.get(`${GARDEROBE}_AutoOffAt`)], [null, null], 'no stamp when skipped or cancelled');

    // On at ≤5 %: switched off without a fade (FADE-SKIP "already off/very dim") → stamped too
    setClock(iso('22:20:00'));
    const env3 = createEnv([light(E9, 'E9 Loft', { dim: 0.03 })]);
    await env3.run(GFO, [E9]);
    t.check(lines(env3, 'FADE-SKIP | E9 Loft | already off/very dim (3%)').length === 1 && env3.dev(E9).onoff.value === false, 'very dim → turned off', env3.diag().join('\n'));
    t.equal(env3.global.get(`${E9}_AutoOffAt`), ms('22:20:00'), 'stamped');
  },
};
