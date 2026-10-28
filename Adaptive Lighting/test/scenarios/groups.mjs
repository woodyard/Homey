// Group and Hue detection from the device driver (AL 2.29.3, GFO 6.17, RSS 4.6, WD 2.16)
import { createEnv, light, motionSensor, setClock, clock, ID, HUE_DRIVER, GROUP_DRIVER } from '../mock.mjs';

const has = (env, text) => env.diag().some((l) => l.includes(text));
const touched = (env, name) => env.commands.some((c) => c.startsWith(`${name} `));

// A group with three Hue bulbs; noHueCap: the bulbs lack button.migrate_v3 (Hue Bridge Pro case)
function group(id, name, bulbNames, { noHueCap = true, dim = 0.8, temp = 0.4 } = {}) {
  return [
    light(id, name, { hue: false, driver: GROUP_DRIVER, dim, temp }),
    ...bulbNames.map((n, i) => light(`${id.slice(0, 8)}-b${i + 1}`, n, { hue: !noHueCap, driver: HUE_DRIVER, dim, temp })),
  ];
}

export const scenarios = {
  async 'a Hue bulb without button.migrate_v3 is still a single light (E9 Loft is turned off)'(t) {
    const env = createEnv([
      light(ID.E9_LOFT, 'E9 Loft', { hue: false, driver: HUE_DRIVER, dim: 0.8 }),
      light(ID.E9_GARDEROBE, 'E9 Garderobe', { hue: false, driver: HUE_DRIVER, dim: 0.5 }),
    ]);
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('gradualfadeout.js', [ID.E9_LOFT]);
    t.equal([env.dev(ID.E9_LOFT).onoff.value, touched(env, 'E9 Garderobe')], [false, false], 'E9 Loft faded and off, E9 Garderobe untouched');
  },

  async 'renamed B9 bulbs are found by name, other lights in the zone are left alone'(t) {
    const env = createEnv([...group(ID.B9_LYS, 'B9 Lys', ['B9 Lys 1', 'B9 Lys 2', 'B9 Lys 3']), light('mirror-light', 'B9 Spejl', { driver: HUE_DRIVER })]);
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('gradualfadeout.js', [ID.B9_LYS]);
    t.check(['B9 Lys 1', 'B9 Lys 2', 'B9 Lys 3'].every((n) => touched(env, n)), 'all three bulbs faded');
    t.equal([touched(env, 'B9 Spejl'), has(env, 'ZONE-FALLBACK')], [false, false], 'mirror light untouched, no zone fallback');
  },

  async 'a group whose driver text looks unexpected still finds its named bulbs'(t) {
    const env = createEnv([
      light(ID.B9_LYS, 'B9 Lys', { hue: false, driver: 'homey:somethingelse:driver', dim: 0.8 }),
      ...['B9 Lys 1', 'B9 Lys 2', 'B9 Lys 3'].map((n, i) => light(`b9-${i}`, n, { driver: HUE_DRIVER, dim: 0.8 })),
    ]);
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('gradualfadeout.js', [ID.B9_LYS]);
    t.check(['B9 Lys 1', 'B9 Lys 2', 'B9 Lys 3'].every((n) => touched(env, n)), 'all three bulbs faded (not the group device alone)');
  },

  async 'Hue from button.migrate_v3 even when the driver text is short'(t) {
    // Kitchen bulbs report driverId "bulb" but still carry button.migrate_v3
    const env = createEnv([
      light(ID.K_BORD, 'K Bord', { hue: false, driver: GROUP_DRIVER, dim: 1.0, temp: 0.4 }),
      ...['K Bord 1', 'K Bord 2', 'K Bord 3'].map((n, i) => light(`kb-${i}`, n, { hue: true, driver: 'bulb', dim: 1.0, temp: 0.4 })),
    ]);
    setClock('2026-10-27T19:56:00+01:00');
    const r = await env.run('adaptivelighting.js', `${ID.K_BORD} check`);
    t.check(r && r.early === true, 'early start still happens', JSON.stringify(r));
  },

  async 'a group without "<group> <n>" bulbs falls back to its zone, and says so'(t) {
    const env = createEnv(group(ID.B9_LYS, 'B9 Lys', ['B9 Wall 1', 'B9 Wall 2', 'B9 Wall 3']));
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('gradualfadeout.js', [ID.B9_LYS]);
    t.check(has(env, 'FADE-ZONE-FALLBACK | B9 Lys | no "B9 Lys <n>" lights — using 3 light(s)'), 'FADE-ZONE-FALLBACK logged');

    const env2 = createEnv(group(ID.B9_LYS, 'B9 Lys', ['B9 Wall 1', 'B9 Wall 2', 'B9 Wall 3']));
    env2.store.set(`${ID.B9_LYS}_FadeActiveUntil`, clock() + 20000);   // fade running, no cached targets
    env2.store.set(`${ID.B9_LYS}_SavedDim`, 0.8);
    await env2.run('restoresavedsettings.js', [ID.B9_LYS]);
    t.check(has(env2, 'RESTORE-ZONE-FALLBACK | B9 Lys'), 'RESTORE-ZONE-FALLBACK logged');
  },

  async 'Room_watchdog logs its zone fallback'(t) {
    setClock('2026-10-27T21:00:00+01:00');
    const longAgo = new Date(clock() - 3600000).toISOString();
    const env = createEnv([
      ...group(ID.B9_LYS, 'B9 Lys', ['B9 Wall 1', 'B9 Wall 2', 'B9 Wall 3']),
      motionSensor('90bc5383-608b-43c9-89a1-f7f7c54d1675', 'B9 Motion', { lastChanged: longAgo }),
      motionSensor('d78e0e15-5a6b-4908-be3c-4e5d3dc1a9d6', 'B9 Eve Motion Bruser', { lastChanged: longAgo }),
    ]);
    await env.run('room_watchdog.js', ['B9']);
    t.check(has(env, 'WATCHDOG-ZONE-FALLBACK | Badeværelse 9'), 'WATCHDOG-ZONE-FALLBACK logged');
  },

  async 'AdaptiveLighting: a group without named bulbs is logged once an hour'(t) {
    const env = createEnv(group(ID.B7_LYS, 'B7 Lys', ['B7 1', 'B7 2', 'B7 3']));
    setClock('2026-10-27T21:00:00+01:00');
    await env.run('adaptivelighting.js', ID.B7_LYS);
    await env.run('adaptivelighting.js', ID.B7_LYS);
    t.equal(env.diag().filter((l) => l.includes('AL-GROUP-NO-MEMBERS | B7 Lys')).length, 1, 'one line for two runs');
  },

  async 'AdaptiveLighting: Hue detected from the driver (early start at a profile change)'(t) {
    // Kitchen Daytime 100%/0.4 → Evening at 20:00; Hue bulbs without button.migrate_v3
    const env = createEnv(group(ID.K_BORD, 'K Bord', ['K Bord 1', 'K Bord 2', 'K Bord 3'], { dim: 1.0, temp: 0.4 }));
    setClock('2026-10-27T19:56:00+01:00');
    const r = await env.run('adaptivelighting.js', `${ID.K_BORD} check`);
    t.check(r && r.early === true && r.profile === 'Evening', 'Evening started early with a long fade', JSON.stringify(r));
  },
};
