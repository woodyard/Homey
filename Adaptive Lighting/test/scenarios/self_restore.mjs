// Never leave an occupied room at ~0% (GradualFadeOut 6.16/6.19, Room_watchdog 2.15/2.18)
import { createEnv, light, motionSensor, setClock, clock, ID } from '../mock.mjs';

const GFO = 'gradualfadeout.js';
const RSS = 'restoresavedsettings.js';
const WD = 'room_watchdog.js';
const E9 = ID.E9_LOFT;
const GARDEROBE = ID.E9_GARDEROBE;
const E9_MOTION = '0da27a1f-ced1-4d02-9193-9438109c5c38';
const has = (env, text) => env.diag().some((l) => l.includes(text));
const count = (env, text) => env.commands.filter((c) => c.includes(text)).length;

function e9Env() {
  const env = createEnv([light(E9, 'E9 Loft', { dim: 0.8, temp: 0.6 })]);
  env.waitAdvancesClock = true;
  setClock('2026-10-27T21:00:00+01:00');
  return env;
}

// E9 for the watchdog: both lights on, no motion for an hour (past the 360 s threshold)
function e9WatchdogEnv() {
  setClock('2026-10-27T21:00:00+01:00');
  const sensor = motionSensor(E9_MOTION, 'E9 Motion', { lastChanged: new Date(clock() - 3600000).toISOString() });
  const env = createEnv([light(E9, 'E9 Loft', { dim: 0.7, temp: 0.6 }), light(GARDEROBE, 'E9 Garderobe', { dim: 0.5, temp: 0.6 }), sensor]);
  env.waitAdvancesClock = true;
  return { env, motion: (on) => { sensor.capabilitiesObj.alarm_motion.value = on; } };
}

export const scenarios = {
  async 'GradualFadeOut: zone already active before the fade → nothing is dimmed'(t) {
    const env = e9Env();
    env.zoneActive = true;  // the countdown fired just as someone moved
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('fade not started'), 'returns "fade not started"', String(r));
    t.equal([env.commands, env.dev(E9).dim.value, env.store.get(`${E9}_FadeActiveUntil`)], [[], 0.8, 0], 'no command, still 80%, window closed');
    t.check(has(env, 'FADE-ABORT | E9 Loft | zone active before fade'), 'FADE-ABORT logged');
  },

  async 'GradualFadeOut: zone active at fade end and no restore → restores itself'(t) {
    const env = e9Env();
    env.onWait = async (ms) => { if (ms === 20000) env.zoneActive = true; };  // someone comes in during the fade
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('restored here'), 'returns "restored here"', String(r));
    t.equal([env.dev(E9).dim.value, env.dev(E9).light_temperature.value, env.dev(E9).onoff.value], [0.8, 0.6, true], 'back at the saved 80% / 0.6, still on');
    t.check(env.store.get(`${E9}_RestoredAt`) > 0 && env.store.get(`${E9}_FadeActiveUntil`) === 0, 'restore marked for AdaptiveLighting, window closed');
    t.check(has(env, 'FADE-SELF-RESTORE | E9 Loft'), 'FADE-SELF-RESTORE logged');
  },

  async 'GradualFadeOut: a restore arriving during the wait → nothing done twice'(t) {
    const env = e9Env();
    let waited = 0;
    let restoreRan = false;
    env.onWait = async (ms) => {
      waited += ms;
      if (ms === 20000) env.zoneActive = true;
      if (!restoreRan && waited >= 23000) { restoreRan = true; await env.run(RSS, [E9]); } // 3 s into the hold
    };
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('zone active, restored') && !String(r).includes('here'), 'returns "restored" (by RestoreSavedSettings)', String(r));
    t.equal(count(env, 'E9 Loft dim=0.8'), 1, 'brightness restored once');
    t.check(has(env, 'FADE-HOLD | E9 Loft | zone active at fade end — restored by RestoreSavedSettings') && !has(env, 'FADE-SELF-RESTORE'), 'FADE-HOLD, no self-restore');
  },

  async 'GradualFadeOut 6.19: onoff off from the fade itself (Homey, 3 Nov) → still restored'(t) {
    const env = e9Env();
    env.dimCardSetsOnoff = true;  // the dim-to-0 card reports the light off at once
    env.onWait = async (ms) => { if (ms === 20000) env.zoneActive = true; };
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('restored here'), 'returns "restored here"', String(r));
    t.equal([env.dev(E9).dim.value, env.dev(E9).onoff.value], [0.8, true], 'back on at the saved 80%');
    t.check(has(env, 'FADE-SELF-RESTORE | E9 Loft') && !has(env, 'switched off during the fade'), 'FADE-SELF-RESTORE, not taken for an off by hand');
  },

  async 'GradualFadeOut 6.19: switched off by hand during the fade, zone active → restored (press off again)'(t) {
    const env = e9Env();
    env.dimCardSetsOnoff = true;
    env.onWait = async (ms) => {
      if (ms === 20000) { env.zoneActive = true; env.dev(E9).onoff.value = false; }  // Hue switch Off
    };
    await env.run(GFO, [E9]);
    t.equal([env.dev(E9).dim.value, env.dev(E9).onoff.value], [0.8, true], 'back on at the saved 80%');
  },

  async 'GradualFadeOut: a failed switch-back-on is logged'(t) {
    const env = e9Env();
    env.onWait = async (ms) => { if (ms === 3000) { env.zoneActive = true; env.unreachable.add(E9); } };
    await env.run(GFO, [E9]);
    t.check(has(env, 'FADE-ERROR | E9 Loft | off but zone active — switching back on failed'), 'FADE-ERROR logged');
  },

  async 'GradualFadeOut: someone comes in right after the off → switched back on'(t) {
    const env = e9Env();
    env.onWait = async (ms) => { if (ms === 3000) env.zoneActive = true; };  // during the 3 s verify wait
    const r = await env.run(GFO, [E9]);
    t.equal(env.dev(E9).onoff.value, true, 'light back on (its "turned on" flow runs AdaptiveLighting)');
    t.check(has(env, 'FADE-VERIFY | E9 Loft | off but zone active — switched back on'), 'FADE-VERIFY logged', String(r));
  },

  async 'Room_watchdog: motion at fade end and no restore → restores both E9 lights'(t) {
    const { env, motion } = e9WatchdogEnv();
    env.onWait = async (ms) => { if (ms === 20000) motion(true); };  // someone moves during the fade
    const r = await env.run(WD, ['E9']);
    t.check(String(r).includes('restored here'), 'returns "restored here"', String(r));
    t.equal([env.dev(E9).dim.value, env.dev(GARDEROBE).dim.value], [0.7, 0.5], 'each light back at its own saved brightness');
    t.equal(env.diag().filter((l) => l.includes('WATCHDOG-SELF-RESTORE')).length, 2, 'one WATCHDOG-SELF-RESTORE line per light');
  },

  async 'Room_watchdog 2.18: onoff off from the fade itself (Homey, 3 Nov) → both E9 lights still restored'(t) {
    const { env, motion } = e9WatchdogEnv();
    env.dimCardSetsOnoff = true;  // the dim-to-0 cards report both lights off at once
    env.onWait = async (ms) => { if (ms === 20000) motion(true); };
    await env.run(WD, ['E9']);
    t.equal([env.dev(E9).dim.value, env.dev(E9).onoff.value, env.dev(GARDEROBE).dim.value, env.dev(GARDEROBE).onoff.value],
      [0.7, true, 0.5, true], 'both back on at their saved brightness');
    t.equal(env.diag().filter((l) => l.includes('WATCHDOG-SELF-RESTORE')).length, 2, 'one WATCHDOG-SELF-RESTORE line per light');
  },

  async 'Room_watchdog: door already open at fade start → restores without waiting'(t) {
    const { env, motion } = e9WatchdogEnv();
    env.zoneActive = true;  // front door open before the fade
    let oneSecondWaits = 0;
    env.onWait = async (ms) => { if (ms === 20000) motion(true); if (ms === 1000) oneSecondWaits += 1; };
    await env.run(WD, ['E9']);
    t.equal([oneSecondWaits, env.dev(E9).dim.value], [0, 0.7], 'no 10 s wait, restored straight away');
    t.check(has(env, 'zone was already active'), 'log says why');
  },

  async 'Room_watchdog: zone active without motion (door) → no restore'(t) {
    const { env } = e9WatchdogEnv();
    env.onWait = async (ms) => { if (ms === 20000) env.zoneActive = true; };  // door opens, nobody moves
    await env.run(WD, ['E9']);
    t.equal(env.dev(E9).dim.value, 0, 'light stays faded (a later minute turns it off)');
    t.check(has(env, 'zone active without motion (door?)') && !has(env, 'SELF-RESTORE'), 'WATCHDOG-HOLD without restore');
  },

  async 'Room_watchdog: motion right after the off → switched back on'(t) {
    const { env, motion } = e9WatchdogEnv();
    env.onWait = async (ms) => { if (ms === 3000) motion(true); };
    await env.run(WD, ['E9']);
    t.equal(env.dev(E9).onoff.value, true, 'E9 Loft back on');
    t.check(has(env, 'WATCHDOG-VERIFY | Entre 9 | off but motion — switched back on'), 'WATCHDOG-VERIFY logged');
  },
};
