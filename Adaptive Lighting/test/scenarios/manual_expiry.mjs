// Manual mode ends when the schedule reaches Night (AL 2.29.0+)
import { createEnv, light, setClock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';

// Set the clock, optionally change the light by hand, run AL
async function at(env, iso, arg, handChange) {
  setClock(iso);
  if (handChange) handChange();
  return env.run(AL, arg);
}

export const scenarios = {
  async "Oliver's evening: Evening keeps manual, Night ends it, a Night override sticks"(t) {
    const env = createEnv([light(ID.O_LOFT, 'O Loft')]);
    const O = ID.O_LOFT;
    await at(env, '2026-10-27T16:00:00+01:00', O);
    let r = await at(env, '2026-10-27T16:20:00+01:00', `${O} check`, () => { env.dev(O).dim.value = 0.5; });
    t.equal(r.reason, 'manual_adjustment_detected', 'Hue switch to 50% → manual');
    t.check(env.state(O).manualSince > 0, 'manualSince stamped');

    r = await at(env, '2026-10-27T18:01:00+01:00', `${O} check`);
    t.equal(r.reason, 'manual_mode', 'Evening does not end manual mode');

    r = await at(env, '2026-10-27T20:01:00+01:00', `${O} check`);
    t.equal([r.profile, env.state(O).manual, env.dev(O).dim.value], ['Night', false, 0.05], 'Night ends manual mode and applies 5%');
    t.check(env.diag().some((l) => l.includes('AL-MANUAL-EXPIRED | O Loft | Daytime → Night')), 'AL-MANUAL-EXPIRED logged');
    t.equal(env.status().lights[O].mode, 'auto', 'published as auto');

    r = await at(env, '2026-10-27T20:20:00+01:00', `${O} check`, () => { env.dev(O).dim.value = 0.5; });
    t.equal(r.reason, 'manual_adjustment_detected', 'turned up again during Night → manual');
    r = await at(env, '2026-10-27T20:40:00+01:00', `${O} check`);
    t.equal(r.reason, 'manual_mode', 'override made during Night sticks');
    r = await at(env, '2026-10-28T07:00:00+01:00', `${O} check`);
    t.equal(r.reason, 'manual_mode', 'Morning does not end it');
    r = await at(env, '2026-10-28T20:05:00+01:00', `${O} check`);
    t.equal(env.state(O).manual, false, 'still manual from last night (>12 h) → ends at the next Night');
  },

  async 'manual state from before 2.29 set during Night is left alone'(t) {
    const env = createEnv([light(ID.O_LOFT, 'O Loft')]);
    const O = ID.O_LOFT;
    await at(env, '2026-10-28T20:30:00+01:00', O);
    const s = env.state(O);
    Object.assign(s, { manual: true, manualSince: 0, lastProfile: 'Night' });
    env.store.set(`AL_Device_${O.slice(0, 8)}.State`, JSON.stringify(s));
    const r = await at(env, '2026-10-28T21:00:00+01:00', `${O} check`, () => { env.dev(O).dim.value = 0.6; });
    t.equal(r.reason, 'manual_mode', 'stays manual');
    t.check(env.state(O).manualSince > 0, 'its 12 h clock starts now');
  },

  async 'forced profile is unaffected; kitchen Night at 23:00 ends manual'(t) {
    const env = createEnv([light(ID.O_LOFT, 'O Loft'), light(ID.K_BORD, 'K Bord')]);
    await at(env, '2026-10-29T16:00:00+01:00', ID.O_LOFT);
    await at(env, '2026-10-29T16:01:00+01:00', `${ID.O_LOFT} cycle-profile`);
    let r = await at(env, '2026-10-29T20:05:00+01:00', `${ID.O_LOFT} check`);
    t.equal(r.reason, 'forced_profile_active', 'forced Morning survives Night');

    await at(env, '2026-10-29T17:00:00+01:00', ID.K_BORD);
    await at(env, '2026-10-29T17:20:00+01:00', `${ID.K_BORD} check`, () => { env.dev(ID.K_BORD).dim.value = 0.6; });
    r = await at(env, '2026-10-29T20:05:00+01:00', `${ID.K_BORD} check`);
    t.equal(r.reason, 'manual_mode', 'kitchen Evening keeps manual');
    await at(env, '2026-10-29T23:05:00+01:00', `${ID.K_BORD} check`);
    t.equal([env.state(ID.K_BORD).manual, env.dev(ID.K_BORD).dim.value], [false, 0.15], 'kitchen Night ends manual at 15%');
  },

  async 'dimmed close to Night values in Evening: Night is recorded, a reading light later sticks'(t) {
    const S = ID.ST_STANDERLAMPE; // stue: Evening 35%/0.9, Night 10%/0.9
    const env = createEnv([light(S, 'ST Standerlampe')]);
    await at(env, '2026-10-30T19:00:00+01:00', S);
    await at(env, '2026-10-30T20:30:00+01:00', `${S} check`, () => { env.dev(S).dim.value = 0.15; });
    await at(env, '2026-10-30T21:01:00+01:00', `${S} check`);
    t.equal([env.state(S).manual, env.state(S).lastProfile], [false, 'Night'], '15% was already near 10%, but the expiry run still records Night');
    await at(env, '2026-10-30T21:40:00+01:00', `${S} check`, () => { env.dev(S).dim.value = 0.6; });
    const r = await at(env, '2026-10-30T21:56:00+01:00', `${S} check`);
    t.equal([r.reason, env.dev(S).dim.value], ['manual_mode', 0.6], 'reading light during Night sticks');
  },

  async 'failed apply during expiry leaves the light manual; the next run retries'(t) {
    const O = ID.O_LOFT;
    const env = createEnv([light(O, 'O Loft')]);
    await at(env, '2026-10-31T20:00:00+01:00', O);
    await at(env, '2026-10-31T20:20:00+01:00', `${O} check`, () => { env.dev(O).dim.value = 0.9; });
    env.unreachable.add(O);
    let r = await at(env, '2026-10-31T21:01:00+01:00', `${O} check`);
    t.equal([r, env.state(O).manual], [false, true], 'bulb unreachable → run fails, light stays manual');
    env.unreachable.delete(O);
    await at(env, '2026-10-31T21:16:00+01:00', `${O} check`);
    t.equal([env.state(O).manual, env.dev(O).dim.value], [false, 0.05], 'bulb back → manual ends, Night applied');
  },
};
