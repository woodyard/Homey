// A check poll that overlaps a GradualFadeOut fade ending (AL 2.31.3). The poll
// reads the light before its slow device list; if RestoreSavedSettings restores
// it, or GradualFadeOut switches it off, before the poll gets to its fade test,
// the half-faded reading must not count as someone changing the light by hand
import { createEnv, light, setClock, advance, clock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const K = ID.K_BORD;    // kitchen: Daytime 09-20 100 %, Evening 20-23 70 %
const FETCH_MS = 50;    // how long getDevices takes on this "busy Homey"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const overrides = (env) => (env.store.get('AL_OverrideLog') || '').split('\n').filter(Boolean);
const logged = (env, text) => env.diag().some((l) => l.includes(text));

// K Bord turned on at 14:00 (Daytime 100 %); at 14:20 a full check is due again
async function kitchenAtDaytime() {
  const env = createEnv([light(K, 'K Bord')]);
  setClock('2026-11-02T14:00:00+01:00');
  await env.run(AL, K);
  setClock('2026-11-02T14:20:00+01:00');
  return env;
}

// Start a check, and while its device list is on its way let `meanwhile` change
// the world (the device read it got first stays as it was)
async function checkDuring(env, meanwhile) {
  env.deviceListDelayMs = FETCH_MS;
  try {
    const run = env.run(AL, `${K} check`);
    await sleep(10);
    meanwhile();
    return await run;
  } finally {
    env.deviceListDelayMs = 0;
  }
}

// After the race K Bord must still be auto, and Evening must still come at 20:01
async function stillAuto(t, env) {
  t.equal(env.state(K).manual, false, 'manual stays false');
  t.equal(overrides(env), [], 'no OVERRIDE line');
  advance(5 * 60000);
  const next = await env.run(AL, `${K} check`);
  t.equal([next.reason ?? 'applied', env.state(K).manual], ['already_correct', false], 'the next poll finds Daytime as it should be');
  setClock('2026-11-02T20:01:00+01:00');
  const evening = await env.run(AL, `${K} check`);
  t.equal([evening.profile, env.dev(K).dim.value], ['Evening', 0.7], 'Evening dims to 70 % at 20:01');
}

export const scenarios = {
  async 'control: the same half-faded reading without a fade is an override'(t) {
    const env = await kitchenAtDaytime();
    env.dev(K).dim.value = 0.3;
    await env.run(AL, `${K} check`);
    t.equal(env.state(K).manual, true, 'a light at 30 % with no fade running is manual');
  },

  async 'RestoreSavedSettings restores during the device fetch → skipped, not manual'(t) {
    const env = await kitchenAtDaytime();
    env.dev(K).dim.value = 0.3;                                   // GradualFadeOut fading
    env.store.set(`${K}_FadeActiveUntil`, clock() + 25000);
    const r = await checkDuring(env, () => {
      env.store.set(`${K}_FadeActiveUntil`, 0);                   // RestoreSavedSettings
      env.store.set(`${K}_RestoredAt`, clock());
      env.dev(K).dim.value = 1.0;
    });
    t.equal(r.reason, 'fade_in_progress', 'skipped: the fade was running when the poll started');
    t.check(logged(env, 'AL-SKIP-FADE | K Bord | currentDim=30% | mode=check'), 'AL-SKIP-FADE logged', env.diag().slice(-3).join(' / '));
    await stillAuto(t, env);
  },

  async 'GradualFadeOut switches off during the device fetch → skipped, not manual'(t) {
    const env = await kitchenAtDaytime();
    env.dev(K).dim.value = 0.02;                                  // end of the fade
    env.store.set(`${K}_FadeActiveUntil`, clock() + 1000);
    const r = await checkDuring(env, () => {
      env.dev(K).onoff.value = false;                             // GradualFadeOut: off, flag zeroed
      env.dev(K).dim.value = 0;
      env.store.set(`${K}_FadeActiveUntil`, 0);
    });
    t.equal(r.reason, 'fade_in_progress', 'skipped: the fade was running when the poll started');
    t.equal(env.state(K).manual, false, 'manual stays false');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    setClock('2026-11-02T15:00:00+01:00');                        // switched on by hand
    env.dev(K).onoff.value = true;
    await env.run(AL, K);
    t.equal([env.state(K).manual, env.dev(K).dim.value], [false, 1], 'turned on again: Daytime 100 %, auto');
  },

  async 'a restore that has not landed yet when the poll starts → skipped, not manual'(t) {
    const env = await kitchenAtDaytime();
    env.dev(K).dim.value = 0.3;                                   // still at the faded level:
    env.store.set(`${K}_FadeActiveUntil`, 0);                     // RestoreSavedSettings cleared the flag
    env.store.set(`${K}_RestoredAt`, clock() - 2000);             // 2 s ago, its commands are on their way
    const r = await env.run(AL, `${K} check`);
    t.equal(r.reason, 'recently_restored', 'skipped: restored 2 s ago');
    t.check(logged(env, 'AL-SKIP-RESTORE | K Bord | currentDim=30% | restored 2s ago | mode=check'), 'AL-SKIP-RESTORE logged', env.diag().slice(-3).join(' / '));
    env.dev(K).dim.value = 1.0;                                   // the restore lands
    await stillAuto(t, env);
  },

  async 'old markers from an earlier fade leave the polls alone; the grace is 30 s'(t) {
    const env = await kitchenAtDaytime();
    env.store.set(`${K}_FadeActiveUntil`, clock() - 3600000);     // a fade that ended an hour ago
    env.store.set(`${K}_RestoredAt`, clock() - 31000);            // restored 31 s ago
    const r = await env.run(AL, `${K} check`);
    t.equal([r.reason, env.state(K).fullRunDue], ['already_correct', false], '14:20 poll runs as usual');
    setClock('2026-11-02T19:55:00+01:00');
    await env.run(AL, `${K} check`);
    setClock('2026-11-02T20:01:00+01:00');
    await env.run(AL, `${K} check`);
    t.equal([env.state(K).lastProfile, env.dev(K).dim.value], ['Evening', 0.7], 'Evening comes as usual');
    t.check(!logged(env, 'AL-SKIP-'), 'no skip lines', env.diag().filter((l) => l.includes('AL-SKIP')).join(' / '));
    setClock('2026-11-02T20:30:00+01:00');
    env.store.set(`${K}_RestoredAt`, clock() - 29000);            // restored 29 s ago
    const late = await env.run(AL, `${K} check`);
    t.equal(late.reason, 'recently_restored', 'a restore 29 s ago still skips');
  },

  async 'a change by hand right after a restore is still caught by the next poll'(t) {
    const env = await kitchenAtDaytime();
    env.store.set(`${K}_FadeActiveUntil`, 0);
    env.store.set(`${K}_RestoredAt`, clock());                    // restored at 14:20:00
    advance(5000);
    env.dev(K).dim.value = 0.6;                                   // dimmed with the switch at 14:20:05
    advance(5000);
    const r = await env.run(AL, `${K} check`);
    t.equal(r.reason, 'recently_restored', '14:20:10 poll inside the 30 s grace skips');
    advance(5 * 60000);
    await env.run(AL, `${K} check`);
    t.equal(env.state(K).manual, true, '14:25:10 poll sees the 60 % and goes manual');
    t.equal(overrides(env).length, 1, 'one OVERRIDE line');
  },
};
