// Dead flags removed (AL 2.29.1, GFO 6.14, RSS 4.4, WD 2.13) and al_cleanup_globals.js
import { createEnv, light, setClock, advance, clock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const CLEANUP = 'al_cleanup_globals.js';
const REAL_RUN = { patch: [['const DRY_RUN = true;', 'const DRY_RUN = false;']] };
const K = ID.K_BORD;
const O = ID.O_LOFT;
const key8 = (id) => id.slice(0, 8);

// A Homey with two existing lights and a mix of current, stale and other scripts' keys
function homeyWithLeftovers() {
  const env = createEnv([light(K, 'K Bord'), light(O, 'O Loft')]);
  const set = (k, v) => env.store.set(k, v);
  // stale
  set(`${K}_FadeActive`, true);
  set(`${O}_ManualRestoreUntil`, 123);
  set(`${K}_SavedManualMode`, false);
  set('AL_DeviceStates', '{}');
  set(`AL_Fade_${key8(K)}`, 1);
  set('OliverRoom_ForcedProfile', -1);
  set('AL_Device_deadbeef.State', '{}');          // device no longer exists
  set(`${O}_SavedManualMode`, null);              // null, as old RestoreSavedSettings left it
  // current AL keys and other scripts' keys — must stay
  set(`AL_Device_${key8(K)}.State`, '{}');
  set(`${K}_SavedDim`, 0.5);
  set('AL_DiagnostikLog', 'x\n');
  set('Stue / Spisestue.Heating.State', '{}');
  set('Config.Rooms', '{}');
  set('AL_DeviceKeys', JSON.stringify([key8(K), 'deadbeef']));
  return env;
}
const KEEP = [`AL_Device_${key8(K)}.State`, `${K}_SavedDim`, 'AL_DiagnostikLog', 'Stue / Spisestue.Heating.State', 'Config.Rooms'];

export const scenarios = {
  async 'a leftover _FadeActive flag no longer blocks check mode'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    setClock('2026-10-27T12:00:00+01:00');
    await env.run(AL, K);
    env.store.set(`${K}_FadeActive`, true);
    advance(16 * 60000);
    const r = await env.run(AL, `${K} check`);
    t.check(r.reason !== 'fade_in_progress', 'check run is not skipped as "fade in progress"', JSON.stringify(r));
  },

  async 'fade and restore no longer write _SavedManualMode / _ManualRestoreUntil'(t) {
    const E9 = ID.E9_LOFT;
    const env = createEnv([light(E9, 'E9 Loft', { dim: 0.8 })]);
    setClock('2026-10-27T21:00:00+01:00');
    env.store.set(`AL_Device_${key8(E9)}.State`, JSON.stringify({ manual: true }));
    env.zoneActive = true; // someone walks in at fade end → HOLD, so the restore has work to do
    await env.run('gradualfadeout.js', [E9]);
    t.check(!env.store.has(`${E9}_SavedManualMode`), 'GradualFadeOut writes no _SavedManualMode');
    t.check(env.diag().some((l) => l.includes('FADE-SAVE | E9 Loft') && l.includes('manual=true')), 'FADE-SAVE still shows manual=true from AL state');

    env.store.set(`${E9}_FadeActiveUntil`, clock() + 10000);
    await env.run('restoresavedsettings.js', [E9]);
    t.check(!env.store.has(`${E9}_ManualRestoreUntil`), 'RestoreSavedSettings writes no _ManualRestoreUntil');
    t.check(env.diag().some((l) => l.includes('RESTORE | E9 Loft') && l.includes('manual=true')), 'RESTORE line shows manual=true from AL state');
  },

  async 'cleanup dry run lists stale keys and changes nothing'(t) {
    const env = homeyWithLeftovers();
    const before = JSON.stringify([...env.store]);
    const r = await env.run(CLEANUP, '');
    t.equal(r, { dryRun: true, stale: 8, indexDrops: 1 }, '8 stale keys (incl. the null one), 1 index entry for a missing device');
    t.equal(JSON.stringify([...env.store]), before, 'store unchanged');
  },

  async 'cleanup removes only Adaptive Lighting leftovers and rebuilds the index'(t) {
    const env = homeyWithLeftovers();
    const r = await env.run(CLEANUP, '', REAL_RUN);
    t.equal(r, { removed: 8, emptied: 0, unchanged: 0, remaining: 0 }, 'all 8 removed in one run');
    t.equal(KEEP.filter((k) => !env.store.has(k)), [], 'current AL keys, Room Heating and Config keys kept');
    t.equal(JSON.parse(env.store.get('AL_DeviceKeys')), [key8(K)], 'AL_DeviceKeys rebuilt without the missing device');
    const again = await env.run(CLEANUP, '', REAL_RUN);
    t.equal(again, { stale: 0 }, 'a second run finds nothing');
  },

  async 'if HomeyScript keeps removed keys listed as null, reruns don’t loop'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    env.emptiedStaysListed = true;
    for (const id of [K, O, ID.E9_LOFT]) env.store.set(`${id}_SavedManualMode`, true);
    const first = await env.run(CLEANUP, '', REAL_RUN);
    t.equal(first, { removed: 0, emptied: 3, unchanged: 0, remaining: 0 }, 'run 1: 3 emptied, nothing left to do');
    env.logs.length = 0;
    const second = await env.run(CLEANUP, '', REAL_RUN);
    t.equal(second.remaining, 0, 'run 2: still nothing left');
    t.check(!env.logs.some((l) => l.includes('run this script again')), 'no endless "run again"');
  },

  async 'cleanup works in batches and refuses an empty device list'(t) {
    const env = createEnv([light(K, 'K Bord')]);
    for (let i = 0; i < 20; i++) env.store.set(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000_FadeActive`, true);
    const first = await env.run(CLEANUP, '', REAL_RUN);
    t.equal([first.removed, first.remaining], [14, 6], 'first run removes 14 of 20');
    const second = await env.run(CLEANUP, '', REAL_RUN);
    t.equal([second.removed, second.remaining], [6, 0], 'second run removes the rest');

    const empty = createEnv([]);
    empty.store.set(`AL_Device_${key8(K)}.State`, '{}');
    let error = null;
    try { await empty.run(CLEANUP, '', REAL_RUN); } catch (e) { error = e.message; }
    t.check(error && error.includes('no devices'), 'no devices from Homey → stops instead of removing every state', error);
    t.check(empty.store.has(`AL_Device_${key8(K)}.State`), 'nothing removed');
  },
};
