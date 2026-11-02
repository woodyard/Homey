// Strict argument checking (AL 2.29.2, GFO 6.15, RSS 4.5, WD 2.14)
import { createEnv, light, setClock, advance, clock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const K = ID.K_BORD;
const lines = (env, tag) => env.diag().filter((l) => l.includes(tag));

export const scenarios = {
  async 'AdaptiveLighting ignores unknown modes, "off" and malformed ids'(t) {
    for (const [arg, why] of [[`${K} chek`, 'unknown mode'], [`${K} off`, 'unknown mode'], ['K-Bord check', 'not a device id']]) {
      const env = createEnv([light(K, 'K Bord', { on: false })]);
      setClock('2026-10-27T12:00:00+01:00');
      const r = await env.run(AL, arg);
      t.equal(r, false, `"${arg}" → run stops`);
      t.equal([env.commands, env.state(K), env.dev(K).onoff.value], [[], null, false], `"${arg}" → no command, no state, light stays off`);
      t.check(lines(env, `AL-BADARG | "${arg}" | ${why}`).length === 1, `"${arg}" → AL-BADARG (${why}) logged`);
    }
  },

  async 'the same bad argument is logged once an hour, not every poll'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    setClock('2026-10-27T12:00:00+01:00');
    for (let i = 0; i < 12; i++) { await env.run(AL, `${K} chek`); advance(5 * 60000); }  // one hour of polls
    t.equal(lines(env, 'AL-BADARG').length, 1, '12 polls in an hour → 1 line');
    await env.run(AL, `${K} chek`);
    t.equal(lines(env, 'AL-BADARG').length, 2, 'the next hour → 1 more');
  },

  async 'a broken lux card logs once an hour although its value changes'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    setClock('2026-10-27T12:00:00+01:00');
    for (let i = 0; i < 12; i++) { await env.run(AL, `${K} lxu ${100 + i}`); advance(5 * 60000); }
    t.equal(lines(env, 'AL-BADARG').length, 1, '12 luminance triggers with different values → 1 line');
  },

  async 'two broken cards are each logged once an hour'(t) {
    const env = createEnv([light(K, 'K Bord'), light(ID.K_LOFT, 'K Loft')]);
    setClock('2026-10-27T12:00:00+01:00');
    for (let i = 0; i < 12; i++) {
      await env.run(AL, `${K} chek`);
      await env.run(AL, `${ID.K_LOFT} chekc`);
      advance(5 * 60000);
    }
    t.equal([lines(env, `"${K} chek"`).length, lines(env, `"${ID.K_LOFT} chekc"`).length], [1, 1], 'one line each, not 24 alternating');
  },

  async 'no argument still uses the default light, and says so'(t) {
    const env = createEnv([light(ID.ST_STANDERLAMPE, 'ST Standerlampe', { hue: false })]);
    setClock('2026-10-27T12:00:00+01:00');
    const r = await env.run(AL, []);
    t.equal(r && r.room, 'ST Standerlampe', 'AL applies to ST Standerlampe');
    t.check(lines(env, 'AL-DEFAULT-ID | no argument').length === 1, 'AL-DEFAULT-ID logged');
  },

  async 'every mode the live flows use still runs'(t) {
    for (const mode of ['', 'check', 'lux 120', 'clear', 'force', 'brighten', 'max', 'dim-down', 'toggle', 'idle', 'wake']) {
      const env = createEnv([light(K, 'K Bord')]);
      setClock('2026-10-27T12:00:00+01:00');
      const r = await env.run(AL, `${K} ${mode}`.trim());
      t.check(r !== false && lines(env, 'BADARG').length === 0, `"${mode || '(normal)'}" accepted`, JSON.stringify(r));
    }
    const env = createEnv([light(ID.O_LOFT, 'O Loft')]);
    const r = await env.run(AL, `${ID.O_LOFT} cycle-profile`);
    t.check(r !== false && lines(env, 'BADARG').length === 0, '"cycle-profile" accepted', JSON.stringify(r));
  },

  async 'GradualFadeOut and RestoreSavedSettings reject malformed ids'(t) {
    const E9 = ID.E9_LOFT;
    const env = createEnv([light(E9, 'E9 Loft', { dim: 0.8 })]);
    setClock('2026-10-27T21:00:00+01:00');
    const r = await env.run('gradualfadeout.js', [`${E9},E9 Garderobe`]);
    t.check(String(r).startsWith('ERROR: bad argument'), 'GradualFadeOut returns an error', String(r));
    t.equal([env.commands, env.store.has(`${E9}_SavedDim`)], [[], false], 'nothing faded or saved — not even the valid id');
    t.check(lines(env, 'FADE-BADARG').some((l) => l.includes('not a device id: E9 Garderobe')), 'FADE-BADARG names the bad part');

    env.store.set(`${E9}_FadeActiveUntil`, clock() + 20000);
    const r2 = await env.run('restoresavedsettings.js', ['E9 Loft']);
    t.check(String(r2).startsWith('ERROR: bad argument'), 'RestoreSavedSettings returns an error', String(r2));
    t.check(lines(env, 'RESTORE-BADARG | "E9 Loft"').length === 1, 'RESTORE-BADARG logged');
  },

  async 'GradualFadeOut with no argument fades the default light and logs it'(t) {
    const env = createEnv([light(ID.B9_LYS, 'B9 Lys', { dim: 0.8 })]);
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('gradualfadeout.js', []);
    t.check(lines(env, 'FADE-DEFAULT-ID').length === 1, 'FADE-DEFAULT-ID logged');
    t.equal(env.dev(ID.B9_LYS).onoff.value, false, 'B9 Lys faded and off');
  },

  async 'Room_watchdog logs an unknown room once per 10 minutes'(t) {
    const env = createEnv([]);
    setClock('2026-10-27T21:00:00+01:00');
    let r;
    for (let i = 0; i < 12; i++) { r = await env.run('room_watchdog.js', ['B8']); advance(60000); }
    t.check(String(r).startsWith('Error: pass room name'), 'returns the usage error');
    t.equal(lines(env, 'WATCHDOG-BADARG | "B8"').length, 2, '12 minutes → 2 lines');
  },

  async 'one broken watchdog card does not hide another'(t) {
    const env = createEnv([light(ID.B9_LYS, 'B9 Lys', { on: false })]);
    setClock('2026-10-27T21:00:00+01:00');
    for (let i = 0; i < 10; i++) {
      await env.run('room_watchdog.js', []);      // emptied card → default B9
      await env.run('room_watchdog.js', ['X1']);  // typo in another card
      advance(60000);
    }
    t.equal([lines(env, 'WATCHDOG-DEFAULT').length, lines(env, 'WATCHDOG-BADARG | "X1"').length], [1, 1], 'both problems logged');
  },
};
