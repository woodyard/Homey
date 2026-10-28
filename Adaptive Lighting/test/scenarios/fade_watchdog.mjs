// GradualFadeOut 6.13, RestoreSavedSettings 4.3, Room_watchdog 2.12
import { createEnv, light, setClock, advance, clock, ID } from '../mock.mjs';

const GFO = 'gradualfadeout.js';
const RSS = 'restoresavedsettings.js';
const WD = 'room_watchdog.js';

export const scenarios = {
  async 'GradualFadeOut leaves a running fade and its saved values alone'(t) {
    const E9 = ID.E9_LOFT;
    const env = createEnv([light(E9, 'E9 Loft', { dim: 0.3 })]);
    setClock('2026-10-27T21:00:00+01:00');
    env.store.set(`${E9}_FadeActiveUntil`, clock() + 20000); // watchdog fade still running
    env.store.set(`${E9}_SavedDim`, 0.8);
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('fade already in progress'), 'returns "fade already in progress"', String(r));
    t.equal(env.commands, [], 'no commands sent');
    t.equal(env.store.get(`${E9}_SavedDim`), 0.8, 'saved brightness stays 80%');
    t.check(env.diag().some((l) => l.includes('FADE-SKIP | E9 Loft | fade already in progress')), 'FADE-SKIP logged');
  },

  async 'GradualFadeOut fades and turns off when no fade is running'(t) {
    const E9 = ID.E9_LOFT;
    const env = createEnv([light(E9, 'E9 Loft', { dim: 0.8 })]);
    setClock('2026-10-27T21:00:00+01:00');
    env.store.set(`${E9}_FadeActiveUntil`, 0); // an earlier fade was restored (flag zeroed)
    const r = await env.run(GFO, [E9]);
    t.check(String(r).includes('turned off'), 'faded and turned off', String(r));
    t.equal(env.store.get(`${E9}_SavedDim`), 0.8, 'saved 80% for a restore');
    t.equal([env.dev(E9).dim.value, env.dev(E9).onoff.value], [0, false], 'light at 0 and off');
  },

  async 'RestoreSavedSettings logs a partial restore and a missing device'(t) {
    const B9 = ID.B9_LYS;
    const env = createEnv([light(B9, 'B9 Lys', { hue: false }), light('b9w1', 'B9 Wall 1'), light('b9w2', 'B9 Wall 2'), light('b9w3', 'B9 Wall 3')]);
    setClock('2026-10-27T21:00:00+01:00');
    env.store.set(`${B9}_FadeActiveUntil`, clock() + 20000);
    env.store.set(`${B9}_SavedDim`, 0.6);
    env.store.set(`${B9}_SavedTemp`, 0.5);
    env.store.set(`${B9}_FadeTargets`, JSON.stringify({ name: 'B9 Lys', targets: [{ id: 'b9w1', name: 'B9 Wall 1' }, { id: 'b9w2', name: 'B9 Wall 2' }, { id: 'b9w3', name: 'B9 Wall 3' }] }));
    env.unreachable.add('b9w2');
    const r = await env.run(RSS, [B9]);
    t.check(String(r).startsWith('B9 Lys: Restored 2/3'), 'restored 2 of 3', String(r));
    t.check(env.diag().some((l) => l.includes('RESTORE-PARTIAL | B9 Lys | 1/3 failed: B9 Wall 2')), 'RESTORE-PARTIAL names the failed bulb');

    const env2 = createEnv([]);
    env2.store.set(`${B9}_FadeActiveUntil`, clock() + 20000);
    env2.store.set(`${B9}_SavedDim`, 0.6);
    await env2.run(RSS, [B9]);
    t.check(env2.diag().some((l) => l.includes('RESTORE-ERROR | b8591f4d | device not found')), 'RESTORE-ERROR when the device is gone');
  },

  async 'Room_watchdog logs errors at most once per room every 10 min'(t) {
    // B9's light is on but its motion sensors no longer exist (e.g. after re-pairing)
    const env = createEnv([light(ID.B9_LYS, 'B9 Lys')]);
    setClock('2026-10-27T21:00:00+01:00');
    let first;
    for (let i = 0; i < 12; i++) {
      const r = await env.run(WD, ['B9']);
      if (i === 0) first = r;
      advance(60000);
    }
    t.check(String(first).startsWith('B9 Watchdog: ERROR'), 'run returns the error', String(first));
    t.equal(env.diag().filter((l) => l.includes('WATCHDOG-ERROR | Badeværelse 9')).length, 2, '12 failing minutes → 2 log lines');

    env.dev(ID.B9_LYS).onoff.value = false;
    t.equal(await env.run(WD, ['B9']), 'B9 Watchdog: lights off', 'normal path unchanged');
  },

  async 'AdaptiveLighting logs script errors and failed bulbs'(t) {
    const env = createEnv([]);
    setClock('2026-10-27T12:00:00+01:00');
    const r = await env.run('adaptivelighting.js', `${ID.ST_LOFT} force`);
    t.equal(r, false, 'run fails');
    t.check(env.diag().some((l) => l.includes('AL-ERROR | ST Loft | force | Not Found')), 'AL-ERROR names the room and mode');

    const K = ID.K_BORD;
    const env2 = createEnv([light(K, 'K Bord', { hue: false }), light('kb1', 'K Bord 1'), light('kb2', 'K Bord 2'), light('kb3', 'K Bord 3')]);
    env2.unreachable.add('kb2');
    await env2.run('adaptivelighting.js', K);
    t.check(env2.diag().some((l) => l.includes('AL-APPLY-FAIL | K Bord | 1/3 members failed: K Bord 2')), 'AL-APPLY-FAIL names the group member');
  },

  async 'detailed logging no longer breaks check mode'(t) {
    const env = createEnv([light(ID.K_BORD, 'K Bord')]);
    setClock('2026-10-27T12:00:00+01:00');
    const r = await env.run('adaptivelighting.js', `${ID.K_BORD} check`,
      { patch: [['enableDetailedLogging: false', 'enableDetailedLogging: true']] });
    t.check(r && r.profile === 'Daytime', 'check run applies and returns its result', JSON.stringify(r));
    t.check(env.logs.some((l) => l.includes('Temp supported: Yes')), 'detailed log line printed');
  },
};
