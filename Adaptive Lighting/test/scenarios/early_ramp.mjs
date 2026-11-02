// The check poll before a profile change starts the new profile early, with a
// ramp that lands on schedule (AL 2.21.0). Fixed in 2.31.1: the stored boundary
// is exact to the millisecond (it used to be up to 1 s late, so the poll 5 min
// before didn't count as near), and an instant apply during the ramp ends AL's
// ramp marker (the next profile used to wait for the resync)
import { createEnv, light, setClock, advance, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const K = ID.K_BORD;    // kitchen, weekday: Daytime 09-20 100 % / 0.4, Evening 20-23 70 % / 0.6
const at = (iso) => Date.parse(iso);
const eveningApplies = (env) => env.diag().filter((l) => l.includes('AL-APPLY | K Bord | Evening'));

// K Bord turned on at 19:40 plus recordMs. On Homey a run records the schedule
// after the device fetch, so usually later in its second than the next poll's gate
async function kitchenOnAt1940(recordMs) {
  const env = createEnv([light(K, 'K Bord', { dim: 1, temp: 0.4 })]);
  setClock('2026-10-29T19:40:00+01:00');
  advance(recordMs);
  await env.run(AL, K);
  return env;
}

// The flow's 5-minute check, its gate running offsetMs after the minute
async function poll(env, time, offsetMs = 200) {
  setClock(`2026-10-29T${time}+01:00`);
  advance(offsetMs);
  return env.run(AL, `${K} check`);
}

export const scenarios = {
  async 'the stored boundary is the profile start, to the millisecond'(t) {
    const env = await kitchenOnAt1940(900);
    t.equal(env.state(K).nextBoundaryAt, at('2026-10-29T20:00:00+01:00'), 'nextBoundaryAt is 20:00:00.000, not 20:00:00.900');
  },

  async 'the poll 5 min before Evening starts the ramp, however late the last run recorded'(t) {
    for (const [recordMs, gateMs] of [[900, 200], [650, 200], [150, 200], [1200, 100]]) {
      const env = await kitchenOnAt1940(recordMs);
      const when = `(recorded at +${recordMs} ms, gate at +${gateMs} ms)`;
      const quiet = [await poll(env, '19:45:00', gateMs), await poll(env, '19:50:00', gateMs)];
      t.equal(quiet.map((r) => r.reason), ['not_due', 'not_due'], `19:45 and 19:50 are not due ${when}`);
      const ramp = await poll(env, '19:55:00', gateMs);
      t.equal([ramp.early, ramp.profile, ramp.fadeSeconds], [true, 'Evening', 360], `19:55 starts Evening with a 6 min ramp ${when}`);
      t.equal(env.dev(K).dim.value, 0.7, `the light was sent 70 % ${when}`);
      const after = await poll(env, '20:00:00', gateMs);
      t.check(after.skipped === true, `the 20:00 poll leaves the ramp alone ${when}`, JSON.stringify(after));
      t.equal(eveningApplies(env).length, 1, `Evening applied once, early ${when}`);
    }
  },

  async 'a poll that fires a moment early still starts the ramp'(t) {
    const env = await kitchenOnAt1940(900);
    const ramp = await poll(env, '19:55:00', -5);
    t.equal([ramp.early, ramp.profile, ramp.fadeSeconds], [true, 'Evening', 360], 'the poll at 19:54:59.995 starts Evening');
    t.check(eveningApplies(env).some((l) => l.includes('mode=check (early, boundary 20:00')), 'AL-APPLY says early, boundary 20:00', env.diag());
  },

  async 'the slack is 10 s: 9 s early still ramps, 11 s early waits for 20:00'(t) {
    const nineEarly = await poll(await kitchenOnAt1940(900), '19:55:00', -9000);
    t.equal([nineEarly.early, nineEarly.profile, nineEarly.fadeSeconds], [true, 'Evening', 369], 'a poll at 19:54:51 starts Evening (309 s + 60 s)');
    const env = await kitchenOnAt1940(900);
    const elevenEarly = await poll(env, '19:55:00', -11000);
    t.equal(elevenEarly.reason, 'not_due', 'a poll at 19:54:49 is not due');
    const evening = await poll(env, '20:00:00');
    t.equal([evening.profile, env.dev(K).dim.value], ['Evening', 0.7], 'Evening then comes at the 20:00 poll');
  },

  async 'switched off and on during the ramp: the 20:00 poll applies Evening'(t) {
    // Recorded early in its second, so 2.31.0 started this ramp too
    const env = await kitchenOnAt1940(100);
    const ramp = await poll(env, '19:55:00');
    t.equal(ramp.early, true, 'setup: the Evening ramp started at 19:55');
    // 19:57: off and on again — the flow runs AL in normal mode, which applies
    // the profile of the moment (Daytime) at once
    setClock('2026-10-29T19:57:10+01:00');
    const on = await env.run(AL, K);
    t.equal([on.profile, env.dev(K).dim.value], ['Daytime', 1], 'the turn-on applies Daytime');
    t.equal(env.state(K).fadeEndTime, 0, 'the turn-on ended the ramp marker');
    const evening = await poll(env, '20:00:00');
    t.equal([evening.skipped === true, evening.profile], [false, 'Evening'], 'the 20:00 poll applies Evening instead of waiting for the resync');
    t.equal(env.dev(K).dim.value, 0.7, 'K Bord at 70 % from 20:00');
  },

  async 'switched on after 19:55 (no ramp): Evening at the 20:00 poll, as before'(t) {
    // Off from 19:50 to 19:57: the flows only poll a light that is on, so no
    // 19:55 poll and no ramp
    const env = await kitchenOnAt1940(900);
    setClock('2026-10-29T19:57:10+01:00');
    const on = await env.run(AL, K);
    t.equal(on.profile, 'Daytime', 'the turn-on applies Daytime');
    const evening = await poll(env, '20:00:00');
    t.equal([evening.profile, env.dev(K).dim.value], ['Evening', 0.7], 'the 20:00 poll applies Evening');
  },
};
