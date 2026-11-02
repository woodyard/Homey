// Two AL runs for the same light at the same time (AL 2.31.0): a turn-on, clear
// or cycle-profile run and a check or lux poll. The poll must never undo what
// the other run did, nor decide from device values that predate its commands
import { createEnv, light, luxSensor, setClock, advance, clock, ID, HUE_DRIVER, GROUP_DRIVER } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const K = ID.K_BORD;    // kitchen: Daytime 09-20 100 %, Evening 20-23 70 %
const O = ID.O_LOFT;    // forced profiles; kids: Evening 18-20 35 %, Night 20-06 5 %
const ST = ID.ST_STANDERLAMPE; // lux-managed (ST Motion)
const FETCH_MS = 50;    // how long getDevices takes on this "busy Homey"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (iso) => Date.parse(iso);
const overrides = (env) => (env.store.get('AL_OverrideLog') || '').split('\n').filter(Boolean);
const logged = (env, text) => env.diag().some((l) => l.includes(text));

// Start `first`, then `second` gapMs later, while getDevices is slow (and, with
// commandDelayMs, commands take that long to reach the bulb)
async function overlap(env, first, second, { gapMs = 10, commandDelayMs = 0 } = {}) {
  env.deviceListDelayMs = FETCH_MS;
  env.commandDelayMs = commandDelayMs;
  try {
    const a = env.run(AL, first);
    await sleep(gapMs);
    const b = env.run(AL, second);
    return await Promise.all([a, b]);
  } finally {
    env.deviceListDelayMs = 0;
    env.commandDelayMs = 0;
  }
}

// K Bord dimmed by hand to 60 % (manual), switched off, and on again at 19:00
// at the 60 % it remembers
async function kitchenLeftManual(lightOptions = {}) {
  const env = createEnv([light(K, 'K Bord', lightOptions)]);
  setClock('2026-10-27T17:00:00+01:00');
  await env.run(AL, K);
  setClock('2026-10-27T17:20:00+01:00');
  env.dev(K).dim.value = 0.6;
  await env.run(AL, `${K} check`);
  env.dev(K).onoff.value = false;
  setClock('2026-10-27T19:00:00+01:00');
  env.dev(K).onoff.value = true;
  return env;
}

// ST Standerlampe turned on at 12:00 at 30 lx: Daytime 80 %
async function stueAtDaytime() {
  const env = createEnv([light(ST, 'ST Standerlampe'), luxSensor(ID.ST_MOTION, 'ST Motion', 30)]);
  setClock('2026-10-27T12:00:00+01:00');
  await env.run(AL, ST);
  return env;
}

// The level a lux run gives at 12:15 for this reading, with nothing overlapping
async function luxReference(lux) {
  const env = await stueAtDaytime();
  env.dev(ID.ST_MOTION).measure_luminance.value = lux;
  setClock('2026-10-27T12:15:00+01:00');
  await env.run(AL, `${ST} lux ${lux}`);
  return env.dev(ST).dim.value;
}

// After the race K Bord must be auto at Daytime, and Evening must still come at 20:01
async function kitchenRecovered(t, env, overridesBefore) {
  t.equal(env.state(K).manual, false, 'manual stays cleared');
  t.equal(env.status().lights[K].mode, 'auto', 'dashboard shows auto');
  t.equal(overrides(env).length, overridesBefore, 'no OVERRIDE line');
  t.equal(env.state(K).busy, {}, 'no lease left behind');
  setClock('2026-10-27T20:01:00+01:00');
  const evening = await env.run(AL, `${K} check`);
  t.equal([evening.profile, env.dev(K).dim.value], ['Evening', 0.7], 'Evening dims to 70 % at 20:01');
}

export const scenarios = {
  async 'a check poll that starts during a turn-on backs off'(t) {
    const env = await kitchenLeftManual();
    t.equal(env.state(K).manual, true, 'setup: K Bord is manual');
    const before = overrides(env).length;

    const [on, check] = await overlap(env, K, `${K} check`);
    t.equal([on.profile, env.dev(K).dim.value], ['Daytime', 1], 'the turn-on applies Daytime 100 %');
    t.equal(check.reason, 'user_run_active', 'the check poll backs off at its gate');
    t.check(logged(env, 'AL-SKIP-BUSY | K Bord | mode=check'), 'AL-SKIP-BUSY logged', env.diag().join('\n'));
    t.equal(env.state(K).lastApplied.at, at('2026-10-27T19:00:00+01:00'), 'lastApplied is the turn-on\'s (19:00), not the 17:00 one');
    await kitchenRecovered(t, env, before);
  },

  async 'a check poll that starts after a turn-on cleared manual, before its command lands'(t) {
    // The poll's device values still show 60 %: deciding from them would set
    // manual again (the turn-on's later saves don't touch manual)
    const env = await kitchenLeftManual();
    const before = overrides(env).length;
    const [on, check] = await overlap(env, K, `${K} check`, { gapMs: FETCH_MS + 10, commandDelayMs: 100 });
    t.equal(on.profile, 'Daytime', 'the turn-on applies Daytime');
    t.equal(check.reason, 'user_run_active', 'the check poll backs off at its gate');
    await kitchenRecovered(t, env, before);
  },

  async 'a check poll already waiting when a turn-on starts stops at its first save'(t) {
    const env = await kitchenLeftManual();
    const before = overrides(env).length;
    const [check, on] = await overlap(env, `${K} check`, K);
    t.equal(on.profile, 'Daytime', 'the turn-on applies Daytime');
    t.equal(check.reason, 'state_changed', 'the check poll stops');
    t.check(logged(env, 'AL-SKIP-STALE | K Bord | mode=check'), 'AL-SKIP-STALE logged', env.diag().join('\n'));
    t.equal(env.state(K).fullRunDue, true, 'the next poll owes a full run');

    // 19:05: no boundary near, no resync due — the owed full run still happens
    setClock('2026-10-27T19:05:00+01:00');
    const next = await env.run(AL, `${K} check`);
    t.equal([next.reason, env.state(K).fullRunDue], ['already_correct', false], '19:05 check is a full run and clears the flag');
    setClock('2026-10-27T19:10:00+01:00');
    t.equal((await env.run(AL, `${K} check`)).reason, 'not_due', '19:10 check is gated again');
    await kitchenRecovered(t, env, before);
  },

  async 'a check poll during a clear backs off'(t) {
    const env = await kitchenLeftManual();
    const before = overrides(env).length;
    const [clear, check] = await overlap(env, `${K} clear`, `${K} check`, { commandDelayMs: 40 });
    t.equal([clear.profile, clear.verified], ['Daytime', true], 'the clear applies Daytime');
    t.equal(check.reason, 'user_run_active', 'the check poll backs off');
    t.equal(env.state(K).lastApplied.via, 'clear', 'lastApplied is the clear\'s');
    await kitchenRecovered(t, env, before);
  },

  async 'a cycle-profile at 20:01 while a check poll would fade to Night: the button wins'(t) {
    const env = createEnv([light(O, 'O Loft')]);
    setClock('2026-10-27T19:40:00+01:00');
    await env.run(AL, O);                                   // Evening 35 %
    setClock('2026-10-27T20:01:00+01:00');

    const [cycle, check] = await overlap(env, `${O} cycle-profile`, `${O} check`, { commandDelayMs: 40 });
    t.equal(cycle.profile, 'Morning', 'the button forces Morning');
    t.equal(check.reason, 'user_run_active', 'the check poll backs off');
    t.equal([env.dev(O).dim.value, env.dev(O).light_temperature.value], [0.35, 0.7], 'the light shows Morning, not Night');
    t.equal([env.state(O).forcedProfile.index, env.status().lights[O].mode], [0, 'forced'], 'forced Morning, on the dashboard too');

    setClock('2026-10-27T20:30:00+01:00');
    const later = await env.run(AL, `${O} check`);
    t.equal(later.reason, 'forced_profile_active', '20:30 check: forced profile active');
    t.equal([env.dev(O).dim.value, env.state(O).manual, overrides(env).length], [0.35, false, 0], 'still Morning, not manual, no OVERRIDE line');
  },

  async 'two cycle-profile presses close together step through two profiles'(t) {
    const env = createEnv([light(O, 'O Loft')]);
    setClock('2026-10-27T16:00:00+01:00');
    await env.run(AL, O);
    setClock('2026-10-27T16:20:00+01:00');
    // The second press starts before the first has saved, and fetches after it has
    const [first, second] = await overlap(env, `${O} cycle-profile`, `${O} cycle-profile`);
    t.equal([first.profile, second.profile], ['Morning', 'Daytime'], 'Morning, then Daytime');
    t.equal([env.state(O).forcedProfile.index, env.dev(O).dim.value], [1, 0.8], 'forced Daytime 80 %');
  },

  async 'a lux run during a turn-on backs off'(t) {
    const env = createEnv([light(ST, 'ST Standerlampe')]);
    setClock('2026-10-27T13:00:00+01:00');
    await env.run(AL, ST);
    setClock('2026-10-27T13:30:00+01:00');

    const [on, lux] = await overlap(env, ST, `${ST} lux`);
    t.equal(on.skipped, false, 'the turn-on applies');
    t.equal(lux.reason, 'user_run_active', 'the lux run backs off');
    t.check(logged(env, 'AL-SKIP-BUSY | ST Standerlampe | mode=lux'), 'AL-SKIP-BUSY logged', env.diag().join('\n'));
    t.equal(env.state(ST).fullRunDue, true, 'the next poll owes a full run');
  },

  async 'a check and a lux run at once: the winner\'s fade is recorded, the loser backs off'(t) {
    const expected = await luxReference(400);
    for (const [first, second] of [['lux 400', 'check'], ['check', 'lux 400']]) {
      const env = await stueAtDaytime();
      env.dev(ID.ST_MOTION).measure_luminance.value = 400;   // the sun comes out
      setClock('2026-10-27T12:15:00+01:00');                 // the check's resync is due
      // The loser's fetch returns while the winner's fade commands are on their way
      const [a, b] = await overlap(env, `${ST} ${first}`, `${ST} ${second}`, { gapMs: 1, commandDelayMs: 40 });
      const label = `${first} first`;
      t.equal([a.profile, b.reason], ['Daytime', 'state_changed'], `${label}: it rescales, the other backs off`);
      t.equal([env.dev(ST).dim.value, env.state(ST).lastApplied.brightness], [expected, expected], `${label}: the new level is recorded`);
      t.equal([env.diag().filter((l) => l.includes('AL-APPLY')).length, env.diag().filter((l) => l.includes('AL-SKIP-STALE')).length], [2, 1], `${label}: one AL-APPLY for the fade, one AL-SKIP-STALE`);

      // Clouds again: the lux gate compares with what was really applied
      env.dev(ID.ST_MOTION).measure_luminance.value = 30;
      setClock('2026-10-27T12:25:00+01:00');
      await env.run(AL, `${ST} lux 30`);
      t.equal(env.dev(ST).dim.value, 0.8, `${label}: lux 30 brings Daytime 80 % back`);
      setClock('2026-10-27T12:35:00+01:00');
      await env.run(AL, `${ST} check`);
      t.equal([env.state(ST).manual, overrides(env).length], [false, 0], `${label}: not manual, no OVERRIDE line`);
    }
  },

  async 'a lux run that loses to a check\'s fade: the next poll applies its reading'(t) {
    const at200 = await luxReference(200);
    const at400 = await luxReference(400);
    const env = await stueAtDaytime();
    setClock('2026-10-27T12:15:00+01:00');
    env.deviceListDelayMs = FETCH_MS;
    env.dev(ID.ST_MOTION).measure_luminance.value = 200;
    const check = env.run(AL, `${ST} check`);              // has fetched lux 200
    env.dev(ID.ST_MOTION).measure_luminance.value = 400;
    const lux = env.run(AL, `${ST} lux 400`);              // has fetched lux 400
    const [c, l] = await Promise.all([check, lux]);
    env.deviceListDelayMs = 0;
    t.equal([c.profile, l.reason], ['Daytime', 'state_changed'], 'the check rescales for 200 lx, the lux run backs off');
    t.equal(env.dev(ST).dim.value, at200, 'at the 200 lx level for now');

    setClock('2026-10-27T12:15:30+01:00');                 // inside the check's 60 s fade
    const during = await env.run(AL, `${ST} check`);
    t.equal([during.reason, env.state(ST).fullRunDue], ['fade_in_progress', true], 'a poll during the fade decides nothing and still owes the full run');

    setClock('2026-10-27T12:20:00+01:00');                 // not due by the clock alone
    const next = await env.run(AL, `${ST} check`);
    t.equal([next.profile, env.dev(ST).dim.value], ['Daytime', at400], '12:20 check is a full run and applies 400 lx');
  },

  async 'a check that changes nothing doesn\'t make a lux run back off'(t) {
    const at400 = await luxReference(400);
    const env = await stueAtDaytime();
    setClock('2026-10-27T12:15:00+01:00');
    env.deviceListDelayMs = FETCH_MS;
    const check = env.run(AL, `${ST} check`);              // has fetched lux 30
    env.dev(ID.ST_MOTION).measure_luminance.value = 400;
    const lux = env.run(AL, `${ST} lux 400`);
    const [c, l] = await Promise.all([check, lux]);
    env.deviceListDelayMs = 0;
    t.equal([c.reason, l.profile], ['already_correct', 'Daytime'], 'the check finds 80 % right for 30 lx, the lux run rescales');
    t.equal(env.dev(ST).dim.value, at400, 'at the 400 lx level at once');
    t.check(!logged(env, 'AL-SKIP-'), 'no back-off');
  },

  async 'a clear finishes and keeps what a turn-on saved while it was verifying'(t) {
    const env = await kitchenLeftManual();
    setClock('2026-10-27T19:57:00+01:00');
    let inner = null;
    let check = null;
    env.onWait = async () => {
      if (inner) return;
      inner = 'running';
      advance(30000);                                      // 19:57:30, inside the clear's lease
      inner = await env.run(AL, K);                        // e.g. the zone's "turn on" card
      check = await env.run(AL, `${K} check`);             // the clear still holds its lease
    };
    const clear = await env.run(AL, `${K} clear`);
    env.onWait = null;
    t.equal(inner.profile, 'Daytime', 'the turn-on ran during the clear\'s verification');
    t.equal(check.reason, 'user_run_active', 'a poll after it still backs off (the clear\'s lease)');
    t.equal([clear.profile, clear.verified], ['Daytime', true], 'the clear still finishes');
    t.equal([env.state(K).lastApplied.via, env.state(K).manual], ['clear', false], 'the clear\'s state is saved');
    t.equal(env.state(K).lastFullCheckAt, at('2026-10-27T19:57:30+01:00'), 'the turn-on\'s full-run time is kept, not the clear\'s older one');
    t.equal(env.state(K).busy, {}, 'both leases released');
  },

  async 'a lease left by a run that never finished blocks polls for a minute at most'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    setClock('2026-10-27T17:00:00+01:00');
    await env.run(AL, K);
    const key = `AL_Device_${K.slice(0, 8)}.State`;
    const state = JSON.parse(env.store.get(key));
    state.busy = { killed: clock() + 60000 };               // its finally never ran
    env.store.set(key, JSON.stringify(state));

    setClock('2026-10-27T17:00:30+01:00');
    t.equal((await env.run(AL, `${K} check`)).reason, 'user_run_active', '30 s later: the poll backs off');
    setClock('2026-10-27T17:01:01+01:00');
    t.equal((await env.run(AL, `${K} check`)).reason, 'already_correct', '61 s later: the lease has run out, full run');
    await env.run(AL, K);
    t.equal(env.state(K).busy, {}, 'the next turn-on drops the dead lease');
  },

  async 'saves still reach every field: AL\'s own fade end, the group\'s bulbs'(t) {
    const bulbs = ['K Bord 1', 'K Bord 2', 'K Bord 3'].map((n, i) => light(`bulb000${i + 1}-k`, n, { driver: HUE_DRIVER }));
    // The mock's group device doesn't follow its bulbs: start it at Daytime's values
    const env = createEnv([light(K, 'K Bord', { hue: false, driver: GROUP_DRIVER, dim: 1, temp: 0.4 }), ...bulbs]);
    for (const b of bulbs) env.store.set(`AL_Device_${b.id.slice(0, 8)}.State`, JSON.stringify({ manual: true }));
    setClock('2026-10-27T19:00:00+01:00');
    await env.run(AL, K);
    t.equal(bulbs.map((b) => env.state(b.id).manual), [false, false, false], 'the turn-on clears manual on every bulb');

    setClock('2026-10-27T20:01:00+01:00');
    const evening = await env.run(AL, `${K} check`);
    const fadeEnd = at('2026-10-27T20:02:05+01:00');        // 60 s fade + 5 s
    t.equal(evening.profile, 'Evening', '20:01 check fades to Evening');
    t.equal([env.state(K).fadeEndTime, ...bulbs.map((b) => env.state(b.id).fadeEndTime)], [fadeEnd, fadeEnd, fadeEnd, fadeEnd], 'the fade end is saved on the group and every bulb');
  },

  async 'runs one after another never back off'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    setClock('2026-10-27T17:00:00+01:00');
    await env.run(AL, K);
    const rev = env.state(K).rev;
    t.check(rev >= 3, 'the turn-on\'s lease, manual and profile saves count', `rev ${rev}`);
    for (const time of ['17:20', '17:40', '18:00']) {
      setClock(`2026-10-27T${time}:00+01:00`);
      const r = await env.run(AL, `${K} check`);
      t.equal(r.reason, 'already_correct', `${time} check: already correct`);
    }
    t.check(!logged(env, 'AL-SKIP-'), 'no AL-SKIP-BUSY/STALE line');
    t.equal([env.state(K).busy, env.state(K).fullRunDue], [{}, false], 'no lease, no full run owed');
    t.equal(env.state(K).rev, rev, 'checks that only record their schedule leave rev alone');
    await env.run(AL, `${K} brighten`);
    t.equal(env.state(K).rev, rev, 'a button run (brighten) takes no lease and saves nothing');
  },
};
