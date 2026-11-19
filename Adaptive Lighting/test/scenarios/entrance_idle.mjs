// Entre 9 evening idle (AL 2.33.0, Room_watchdog 2.20, GradualFadeOut 6.21).
// From Mørkt (sunset-60) until 22:00 E9 - Light flow runs AL "idle" on E9 Loft
// and E9 Garderobe instead of GradualFadeOut: they dim to what the kitchen
// shows (KITCHEN_IDLE, the living room's level, min 20 %), and "wake" brings
// them back. Room_watchdog leaves a light AL holds idle alone until 22:00
// (ROOMS.E9.idleWindow), then fades it off without a notification. A wake
// counts as a turn-on in the shared TURN-ON block
import { createEnv, light, motionSensor, contactSensor, setClock, ID, HUE_DRIVER } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const WD = 'room_watchdog.js';
const E9 = ID.E9_LOFT;        // entrance: Daytime until 20:00 80 %, Evening 20-23 70/0.6 — the kitchen's (weekdays and weekends)
const GARDEROBE = ID.E9_GARDEROBE;
const KB = ID.K_BORD;         // kitchen: Evening 20-23 70/0.6
const E9_MOTION = '0da27a1f-ced1-4d02-9193-9438109c5c38';
const E9_DOOR = '68ef424e-3ab9-4573-8a89-bdce2b4ffe65';

// Monday 2 Nov 2026 (winter time): the stue set is Evening 35/0.9 from
// sunset-60 (15:30) until 21:00, then Night 10/0.9
const ms = (time, day = '02') => Date.parse(`2026-11-${day}T${time}+01:00`);
const at = (time, day = '02') => setClock(new Date(ms(time, day)).toISOString());
const iso = (time, day = '02') => new Date(ms(time, day)).toISOString();
const lines = (env, text) => env.diag().filter((l) => l.includes(text));
const pct = (v) => Math.round(v * 100);
const vals = (env, id) => [pct(env.dev(id).dim.value), pct(env.dev(id).light_temperature.value)];

// E9 Loft, E9 Garderobe and K Bord (single Hue lights here) with E9 Motion and
// E9 Dør; switched on (AL normal) at onAt. Notifications are counted
async function house({ onAt = '20:10:00', motionAt = '20:27:00', doorAt = '20:05:00', day = '02' } = {}) {
  at(onAt, day);
  const env = createEnv([
    light(E9, 'E9 Loft', { driver: HUE_DRIVER }),
    light(GARDEROBE, 'E9 Garderobe', { driver: HUE_DRIVER }),
    light(KB, 'K Bord', { driver: HUE_DRIVER }),
    motionSensor(E9_MOTION, 'E9 Motion', { lastChanged: iso(motionAt, day) }),
    contactSensor(E9_DOOR, 'E9 Dør', { lastChanged: iso(doorAt, day) }),
  ]);
  env.vars.v1 = { id: 'v1', name: 'E9_InactivitySeconds', type: 'number', value: 180 };
  env.notifications = [];
  const run = env.Homey.flow.runFlowCardAction;
  env.Homey.flow.runFlowCardAction = async (a) => {
    if (a.id === 'homey:manager:notifications:create_notification') env.notifications.push(a.args.text);
    return run(a);
  };
  for (const id of [E9, GARDEROBE, KB]) await env.run(AL, id);
  return env;
}

// The E9 countdown runs out in the evening window: AL idle on both lights
async function idleE9(env, time = '20:30:00', day = '02') {
  at(time, day);
  await env.run(AL, `${E9} idle`);
  await env.run(AL, `${GARDEROBE} idle`);
}

// 19 Nov 2026 replay (AL 2.33.1): E9 dimmed for the empty hall at 18:37:42 (Daytime 80 %
// → the living room's Evening 35 %/0.9, 30 s fade, AL's own fade end 18:38:17). The door
// woke it at 18:38:29, and the bulbs still reported 56 %/0.74 and 53 %/0.76 from part-way
// down — Hue reports its state late. AL took that for a change by hand: manual, so motion
// never brought the hall back up and 20:00 never brought Evening
const NOV19 = '19';
async function hallDimmedAt1837() {
  const env = await house({ onAt: '18:30:00', motionAt: '18:30:00', doorAt: '18:29:47', day: NOV19 });
  await idleE9(env, '18:37:42', NOV19);
  return env;
}
function reportsPartWay(env, loft = [0.56, 0.74], garderobe = [0.53, 0.76]) {
  for (const [id, [dim, temp]] of [[E9, loft], [GARDEROBE, garderobe]]) {
    env.dev(id).dim.value = dim;
    env.dev(id).light_temperature.value = temp;
  }
}
// 19 Nov 20:32:57: someone came in, AL switched E9 on at Evening 70 %; last motion
// 20:33:11. The flow's dimming never came, and at 20:38:05 Room_watchdog faded the
// hall off. HomeyScript's "run a script" card is mocked to run the script here;
// env.alRuns lists what the watchdog asked AL for
async function hallOnAt2032({ dark, onAt = '20:32:57', motionAt = '20:33:11', alFails = false } = {}) {
  const env = await house({ onAt, motionAt, doorAt: '20:29:56', day: NOV19 });
  env.vars.v2 = { id: 'v2', name: 'Mørkt', type: 'boolean', value: dark };
  env.alRuns = [];
  const run = env.Homey.flow.runFlowCardAction;
  env.Homey.flow.runFlowCardAction = async (a) => {
    if (a.id === 'homey:app:com.athom.homeyscript:runWithArg') {
      if (alFails) throw new Error('Script not found');
      env.alRuns.push(a.args.argument);
      return env.run(a.args.script.name === 'AdaptiveLighting' ? AL : '?', a.args.argument);
    }
    return run(a);
  };
  return env;
}
const overrides = (env) => String(env.global.get('AL_OverrideLog') || '').split('\n').filter((l) => l.includes('E9 '));

export const scenarios = {
  async '19 Nov replay: a wake 12 s after idle\'s fade, the bulbs still reporting part-way down → a wake, not manual'(t) {
    const env = await hallDimmedAt1837();
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[35, 90], [35, 90]], 'idle at 18:37:42 → 35/0.9');
    t.equal(env.state(E9).fadeEndTime, ms('18:38:17', NOV19), 'AL\'s fade ends 18:38:17 (30 s + 5 s)');

    at('18:38:29', NOV19);
    reportsPartWay(env);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [false, false], 'not manual');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    t.equal([vals(env, E9)[0], vals(env, GARDEROBE)[0]], [80, 80], 'woken to the entrance\'s own Daytime 80 %');
    t.equal(env.state(E9).lastApplied.via, 'wake', 'recorded as a wake');

    // 20:00: Evening comes as on any evening
    at('20:00:30', NOV19);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} check`);
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[70, 60], [70, 60]], '20:00 check → Evening 70/0.6');
  },

  async 'a full check poll in the same seconds, the bulbs still reporting part-way down → no manual, the next poll is quiet'(t) {
    const env = await hallDimmedAt1837();
    at('18:38:25', NOV19);
    reportsPartWay(env);
    // A full run (the hourly resync, or one owed): the cheap gate would skip most polls
    for (const id of [E9, GARDEROBE]) env.setState(id, { ...env.state(id), fullRunDue: true });
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} check`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [false, false], 'not manual');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    t.check(!!env.state(E9).idle, 'still idle');

    // the bulbs have caught up by the next poll
    at('18:43:00', NOV19);
    reportsPartWay(env, [0.35, 0.9], [0.35, 0.9]);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} check`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [false, false], 'still not manual');
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[35, 90], [35, 90]], 'still the idle level');
  },

  async 'an idle run from before 2.33.1 (no start recorded) → the same wake'(t) {
    const env = await hallDimmedAt1837();
    for (const id of [E9, GARDEROBE]) {
      const st = env.state(id);
      env.setState(id, { ...st, idle: { ...st.idle, from: undefined } });
    }
    at('18:38:29', NOV19);
    reportsPartWay(env);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [false, false], 'not manual');
    t.equal([vals(env, E9)[0], vals(env, GARDEROBE)[0]], [80, 80], 'woken to Daytime 80 %');
    t.equal(lines(env, 'on AL\'s fade').length, 2, 'the AL-WAKE lines say what was read');
  },

  async '19 Nov 20:30 replay: the dashboard\'s reset of a dimmed E9 in the empty hall keeps it dimmed, and the watchdog holds it'(t) {
    // As on the evening: manual from the 18:38 wake, dimmed again by idle at 20:22
    const env = await hallDimmedAt1837();
    at('18:38:29', NOV19);
    for (const id of [E9, GARDEROBE]) env.setState(id, { ...env.state(id), manual: true, manualSince: ms('18:38:29', NOV19) });
    at('20:22:16', NOV19);
    await idleE9(env, '20:22:16', NOV19);
    t.equal([env.state(E9).manual, !!env.state(E9).idle], [true, true], 'manual and idle at 20:22, as on the evening');

    // 20:30:05: Manuelt pressed on the dashboard (E9 - Light reset → clear), nobody in the hall
    at('20:30:05', NOV19);
    env.zoneActive = false;
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} clear`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [false, false], 'manual cleared');
    t.check(!!env.state(E9).idle && !!env.state(GARDEROBE).idle, 'still idle');
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[35, 90], [35, 90]], 'the idle level (the living room\'s Evening 35/0.9), not Evening 70 %');
    t.equal(lines(env, 'AL-CLEAR | E9 Loft | room empty').length, 1, 'AL-CLEAR line says the room is empty');

    for (const time of ['20:31:00', '20:45:00', '21:59:00']) {
      at(time, NOV19);
      const r = String(await env.run(WD, ['E9']));
      t.check(r.includes('dimmed by AdaptiveLighting (idle) until 22:00'), `${time}: the watchdog holds it`, r);
    }
    t.equal([env.dev(E9).onoff.value, env.notifications.length], [true, 0], 'still on, no notification');

    // Someone comes: wake → the entrance's own Evening, as any evening
    at('21:10:00', NOV19);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[70, 60], [70, 60]], 'wake → Evening 70/0.6');
  },

  async 'a reset while someone is in the hall ends idle: Evening 70 %'(t) {
    const env = await hallDimmedAt1837();
    at('20:30:05', NOV19);
    env.zoneActive = true;
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} clear`);
    t.equal([env.state(E9).idle, env.state(GARDEROBE).idle], [null, null], 'idle ended');
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[70, 60], [70, 60]], 'Evening 70/0.6');
  },

  async '19 Nov 20:38 replay: no dimming came from the flow → the watchdog asks AL for it instead of switching the hall off'(t) {
    for (const zoneActive of [false, true]) {   // true: the zone never went inactive (a door left open?)
      const env = await hallOnAt2032({ dark: true });
      env.zoneActive = zoneActive;
      at('20:38:05', NOV19);
      const r = String(await env.run(WD, ['E9']));
      const tag = zoneActive ? ' (zone still active)' : '';
      t.check(r.includes('dimmed by AdaptiveLighting (idle) instead of off'), `20:38:05: dimmed, not faded${tag}`, r);
      t.equal(env.alRuns, [`${E9} idle watchdog`, `${GARDEROBE} idle watchdog`], `AL idle asked for both lights${tag}`);
      t.equal([vals(env, E9), vals(env, GARDEROBE)], [[35, 90], [35, 90]], `the idle level, as the kitchen${tag}`);
      t.equal([env.dev(E9).onoff.value, env.dev(GARDEROBE).onoff.value, env.notifications.length], [true, true, 0], `on, no notification${tag}`);
      t.equal([lines(env, 'WATCHDOG-IDLE | Entre 9').length, lines(env, 'WATCHDOG-FADE').length], [1, 0], `WATCHDOG-IDLE, no WATCHDOG-FADE${tag}`);
      at('20:39:00', NOV19);
      const r2 = String(await env.run(WD, ['E9']));
      t.check(r2.includes('dimmed by AdaptiveLighting (idle) until 22:00'), `20:39: held as any idle light${tag}`, r2);
      at('20:45:00', NOV19);
      for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
      t.equal(vals(env, E9), [70, 60], `a wake brings Evening back${tag}`);
    }
  },

  async 'the watchdog still switches off when it is light, after 22:00, or when AL cannot be reached'(t) {
    // Mørkt false (a light afternoon inside 12-22): off, as before
    let env = await hallOnAt2032({ dark: false });
    at('20:38:05', NOV19);
    let r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), 'not dark: faded off', r);
    t.equal([env.alRuns, env.notifications.length], [[], 1], 'no AL idle, the usual notification');

    // After 22:00: off, as before
    env = await hallOnAt2032({ dark: true, onAt: '22:05:00', motionAt: '22:05:10' });
    at('22:10:05', NOV19);
    r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), 'after 22:00: faded off', r);
    t.equal(env.alRuns, [], 'no AL idle after 22:00');

    // The HomeyScript card fails: off, as before, and the reason logged
    env = await hallOnAt2032({ dark: true, alFails: true });
    at('20:38:05', NOV19);
    r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), 'AL unreachable: faded off', r);
    t.equal(lines(env, 'WATCHDOG-ERROR | Entre 9 | AdaptiveLighting idle failed').length, 1, 'WATCHDOG-ERROR names it');
  },

  async 'a real change by hand is still caught: off the fade\'s path, or read after the 60 s'(t) {
    // Brighter than where the fade began (100 % / 0.2): not part of AL's fade
    let env = await hallDimmedAt1837();
    at('18:38:29', NOV19);
    reportsPartWay(env, [1, 0.2], [1, 0.2]);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [true, true], 'off the fade\'s path → manual');
    t.equal(overrides(env).filter((l) => l.includes('src=wake')).length, 2, 'OVERRIDE src=wake for both');

    // Part-way values read 2 min after the fade ended: the bulbs have long caught up — by hand
    env = await hallDimmedAt1837();
    at('18:40:20', NOV19);
    reportsPartWay(env);
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([env.state(E9).manual, env.state(GARDEROBE).manual], [true, true], 'after the 60 s → manual as before');
  },

  async 'E9 Loft and E9 Garderobe idle to the kitchen\'s level and colour: 35 %/0.9 in the evening, 20 %/0.9 after 21:00 (check)'(t) {
    const env = await house();
    t.equal([vals(env, E9), vals(env, GARDEROBE), vals(env, KB)], [[70, 60], [70, 60], [70, 60]], 'turned on at 20:10: entrance and kitchen both Evening 70/0.6');

    await idleE9(env);
    await env.run(AL, `${KB} idle`);
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[35, 90], [35, 90]], 'E9 idle at 20:30 → the living room\'s Evening 35/0.9');
    t.equal(vals(env, E9), vals(env, KB), 'the same as the kitchen');
    t.equal(lines(env, 'AL-IDLE | E9 Loft | Evening → ref Evening').length, 1, 'AL-IDLE line for E9 Loft');

    at('21:05:00');
    for (const id of [E9, GARDEROBE, KB]) await env.run(AL, `${id} check`);
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[20, 90], [20, 90]], 'the 21:05 check: the living room\'s Night is under the 20 % floor → 20/0.9');
    t.equal(vals(env, E9), vals(env, KB), 'still the same as the kitchen');

    at('21:30:00');
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal([vals(env, E9), vals(env, GARDEROBE)], [[70, 60], [70, 60]], 'wake → the entrance\'s own Evening 70/0.6, the same as the kitchen');
    t.equal([env.state(E9).idle, env.state(E9).lastApplied.via], [null, 'wake'], 'idle cleared, recorded as a wake');
  },

  async 'Room_watchdog leaves idle E9 on until 22:00, then fades it off with no notification'(t) {
    const env = await house();
    await idleE9(env);
    for (const time of ['20:40:00', '21:30:00', '21:59:00']) {
      at(time);
      const r = String(await env.run(WD, ['E9']));
      t.check(r.includes('dimmed by AdaptiveLighting (idle) until 22:00'), `${time}: held`, r);
    }
    t.equal([lines(env, 'WATCHDOG-FADE').length, env.notifications.length], [0, 0], 'no fade, no notification before 22:00');

    at('22:00:00');
    const r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), '22:00: faded off', r);
    t.equal(lines(env, 'WATCHDOG-FADE | Entre 9 |').filter((l) => l.includes('(evening idle ended 22:00)')).length, 1, 'WATCHDOG-FADE names the end of the evening');
    t.equal(env.notifications, [], 'the planned end of the evening sends no notification');
    t.equal([env.dev(E9).onoff.value, env.dev(GARDEROBE).onoff.value], [false, false], 'both lights off');
  },

  async 'without idle the watchdog fades E9 as before, with its notification'(t) {
    const env = await house();
    at('20:40:00');
    const r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), 'not idle: faded 13 min after the last motion', r);
    t.equal(env.notifications.length, 1, 'notification sent');
    t.equal(lines(env, 'evening idle ended').length, 0, 'no evening-idle tag');
  },

  async 'idle flag outside the window (morning, after 22:00) does not hold the light'(t) {
    for (const [time, day] of [['07:00:00', '03'], ['22:30:00', '03']]) {
      const env = await house({ onAt: '06:30:00', motionAt: '06:35:00', doorAt: '06:30:00', day: '03' });
      await idleE9(env, '06:40:00', '03');
      t.check(!!env.state(E9).idle, 'E9 Loft idle (an idle run in the morning, by hand)');
      // later that day: only the window decides
      at(time, day);
      const r = String(await env.run(WD, ['E9']));
      t.check(r.includes('fade + off'), `${time}: faded`, r);
      t.equal(env.notifications.length, 0, `${time}: the end of an idle light is planned — no notification`);
    }
  },

  async 'a wake by the door counts as a turn-on: no fade right after it, the room\'s 240 s from the wake'(t) {
    const env = await house();
    await idleE9(env);
    // 20:45: the door opens (zone active), E9 Motion misses the person
    at('20:45:00');
    const door = env.devices[E9_DOOR].capabilitiesObj.alarm_contact;
    door.value = true;
    door.lastChanged = iso('20:45:00');
    for (const id of [E9, GARDEROBE]) await env.run(AL, `${id} wake`);
    t.equal(env.state(E9).lastApplied.at, ms('20:45:00'), 'wake recorded at 20:45');

    at('20:46:00');
    let r = String(await env.run(WD, ['E9']));
    t.check(r.includes('idle 60s / 240s'), '20:46: held (the wake is the turn-on, the door saw it)', r);
    at('20:48:30');
    r = String(await env.run(WD, ['E9']));
    t.check(r.includes('(30s left)'), '20:48:30: still held', r);
    at('20:49:00');
    r = String(await env.run(WD, ['E9']));
    t.check(r.includes('fade + off'), '20:49: faded 240 s after the wake', r);
    t.equal(env.notifications.length, 1, 'not idle any more: the usual notification');
  },
};
