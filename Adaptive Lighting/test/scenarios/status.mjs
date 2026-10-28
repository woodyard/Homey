// AdaptiveLightingStatus publishing (AL 2.28.0+)
import { createEnv, light, luxSensor, setClock, advance, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const kitchen = () => createEnv([light(ID.K_BORD, 'K Bord'), light(ID.K_LOFT, 'K Loft'), light(ID.O_LOFT, 'O Loft')]);
const entry = (env, id) => {
  const l = env.status().lights[id];
  return l ? [l.mode, l.profile, l.bri, l.temp, l.via] : null;
};

export const scenarios = {
  async 'first publish creates the variable; unchanged and gated runs make no call'(t) {
    const env = kitchen();
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, ID.K_BORD);
    t.equal(env.logicCalls, ['get', 'create'], 'first publish looks the variable up, then creates it');
    t.equal(entry(env, ID.K_BORD), ['auto', 'Daytime', 1, 0.4, 'normal'], 'K Bord entry');

    env.logicCalls.length = 0;
    await env.run(AL, ID.K_BORD);
    t.equal(env.logicCalls, [], 'the same turn-on again writes nothing');

    advance(2 * 60000);
    const r = await env.run(AL, `${ID.K_BORD} check`);
    t.equal(r.reason, 'not_due', 'check 2 min later is stopped by the gate');
    t.equal(env.logicCalls, [], 'gated run makes no Logic call');
  },

  async 'manual, clear and forced are published; entries are rebuilt, not merged'(t) {
    const env = kitchen();
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, ID.K_BORD);
    env.logicCalls.length = 0;

    advance(18 * 60000);
    env.dev(ID.K_BORD).dim.value = 0.3;
    const r = await env.run(AL, `${ID.K_BORD} check`);
    t.equal(r.reason, 'manual_adjustment_detected', 'dimmed by hand → manual detected');
    t.equal(entry(env, ID.K_BORD)?.[0], 'manual', 'published as manual');
    t.equal(env.logicCalls, ['update'], 'one update with the cached variable id');

    await env.run(AL, `${ID.K_BORD} clear`);
    t.equal(entry(env, ID.K_BORD), ['auto', 'Daytime', 1, 0.4, 'clear'], 'clear → auto');

    await env.run(AL, `${ID.O_LOFT} cycle-profile`);
    const o = env.status().lights[ID.O_LOFT];
    t.equal([o.mode, o.profile, o.forced], ['forced', 'Morning', 0], 'cycle-profile → forced Morning');
    t.equal(entry(env, ID.K_BORD)?.[0], 'auto', 'K Bord entry still there');
  },

  async 'a failing write keeps the run result, logs once and backs off 10 min'(t) {
    const env = kitchen();
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, ID.K_BORD);
    env.logicCalls.length = 0;

    env.failLogicUpdate = true;
    advance(60000);
    const r = await env.run(AL, ID.O_LOFT);
    t.equal(r.profile, 'Daytime', 'the lighting run still returns its result');
    t.equal(env.logicCalls, ['update', 'get'], 'cached id fails, lookup finds the same variable, no second update');
    const fails = () => env.diag().filter((l) => l.includes('AL-PUBLISH-FAIL')).length;
    t.equal(fails(), 1, 'one AL-PUBLISH-FAIL line');

    env.logicCalls.length = 0;
    advance(2 * 60000);
    await env.run(AL, `${ID.O_LOFT} force`);
    t.equal(env.logicCalls, [], 'no Logic calls during the back-off');
    t.equal(fails(), 1, 'still one AL-PUBLISH-FAIL line');

    env.failLogicUpdate = false;
    advance(9 * 60000);
    env.dev(ID.O_LOFT).dim.value = 0.9;
    await env.run(AL, ID.O_LOFT);
    t.check(env.logicCalls.includes('update'), 'publishes again after the back-off');
  },

  async 'two lights at once on the first publish create one variable'(t) {
    const env = kitchen();
    env.createDelayMs = 20;
    setClock('2026-10-27T12:00:00+01:00');
    await Promise.all([env.run(AL, ID.K_BORD), env.run(AL, ID.K_LOFT)]);
    t.equal(Object.values(env.vars).filter((v) => v.name === 'AdaptiveLightingStatus').length, 1, 'exactly one variable');

    env.createDelayMs = 0;
    advance(16 * 60000);
    await env.run(AL, `${ID.K_LOFT} check`);
    const lights = env.status().lights;
    t.check(lights[ID.K_BORD] && lights[ID.K_LOFT], 'the next publish holds both lights');
  },

  async 'hourly heartbeat'(t) {
    const env = kitchen();
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, ID.K_LOFT);
    env.logicCalls.length = 0;
    advance(61 * 60000);
    await env.run(AL, ID.K_LOFT);
    t.check(env.logicCalls.includes('update'), 'an unchanged full run in a new hour writes');
  },

  async 'daylight- and sun-adjusted light publishes applied and scheduled values'(t) {
    const env = createEnv([light(ID.ST_STANDERLAMPE, 'ST Standerlampe', { hue: false }), luxSensor(ID.ST_MOTION, 'ST Motion', 250)]);
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, ID.ST_STANDERLAMPE);
    const l = env.status().lights[ID.ST_STANDERLAMPE];
    t.equal([l.profile, l.bri, l.temp, l.schedBri, l.schedTemp, l.factor, l.lux, l.sunEl],
      ['Daytime', 0.32, 0.59, 0.8, 0.4, 0.4, 250, 21.4], 'Daytime 80% × 0.4 daylight, colour 0.4 → 0.59 at 21.4° sun');
  },
};
