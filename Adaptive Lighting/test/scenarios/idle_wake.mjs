// Kitchen idle/wake (AL 2.32.0). "<id> idle" when the kitchen has been empty a
// while after dark, "<id> wake" when someone comes in. Idle follows the living
// room (PROFILES.stue) and only ever goes down until wake; a manual scene keeps
// its colours; nothing is ever switched on. Decisions D1–D8 and fixes C1–C8 of
// the design are named in the scenario titles
import { createEnv, light, setClock, advance, clock, ID, HUE_DRIVER, GROUP_DRIVER } from '../mock.mjs';

const AL = 'adaptivelighting.js';
const GFO = 'gradualfadeout.js';
const RSS = 'restoresavedsettings.js';
const KB = ID.K_BORD;   // kitchen: Morning 06-09 100/0.3, Daytime 09-20 100/0.4, Evening 20-23 70/0.6, Night 23-06 15/0.9
const KL = ID.K_LOFT;
const ZONE = 'koekken-zone';
const FETCH_MS = 50;
// Monday 2 Nov 2026: the stue set has Daytime 80/0.4 until sunset-60 (~15:36),
// Evening 35/0.9 until 21:00, Night 10/0.9, Morning 06:00 35/0.7

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (time, day = '02') => setClock(`2026-11-${day}T${time}+01:00`);
const ms = (time, day = '02') => Date.parse(`2026-11-${day}T${time}+01:00`);
const overrides = (env) => (env.store.get('AL_OverrideLog') || '').split('\n').filter(Boolean);
const lines = (env, text) => env.diag().filter((l) => l.includes(text));
const BULB = { [KB]: ['kbbulb01', 'kbbulb02', 'kbbulb03'], [KL]: ['klbulb01', 'klbulb02', 'klbulb03'] };
const dims = (env, id) => BULB[id].map((b) => env.dev(b).dim.value);
const temps = (env, id) => BULB[id].map((b) => env.dev(b).light_temperature.value);
const ons = (env, id) => BULB[id].map((b) => env.dev(b).onoff.value);
const cardsTo = (env, ids, card) => env.cards.filter((c) => ids.includes(c.id) && (!card || c.card === card));
const r2 = (v) => Math.round(v * 100) / 100;

// A Homey virtual group: on when any bulb is on, dim/temperature the mean of
// the bulbs that are on; a value written to the group goes to every bulb (as
// RestoreSavedSettings' group write does on Homey)
function groupModel(group, bulbs) {
  const on = () => bulbs.filter((b) => b.capabilitiesObj.onoff.value === true);
  const mean = (cap) => { const xs = on().map((b) => b.capabilitiesObj[cap].value); return xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0; };
  const forward = (cap) => ({
    get value() { return cap === 'onoff' ? on().length > 0 : mean(cap); },
    set value(v) { for (const b of bulbs) b.capabilitiesObj[cap].value = v; },
  });
  group.capabilitiesObj = { onoff: forward('onoff'), dim: forward('dim'), light_temperature: forward('light_temperature') };
}

// K Bord and K Loft: virtual groups of three Hue bulbs each, all in the kitchen zone
function kitchen({ dim = 1, temp = 0.4 } = {}) {
  const devices = [];
  for (const [id, name] of [[KB, 'K Bord'], [KL, 'K Loft']]) {
    const bulbs = BULB[id].map((b, i) => light(b, `${name} ${i + 1}`, { driver: HUE_DRIVER, zone: ZONE, dim, temp }));
    const group = light(id, name, { hue: false, driver: GROUP_DRIVER, zone: ZONE });
    groupModel(group, bulbs);
    devices.push(group, ...bulbs);
  }
  return createEnv(devices);
}

// Bulbs set by hand (Hue app / switch), no AL involved
function setBulbs(env, id, values, temp) {
  BULB[id].forEach((b, i) => {
    if (values[i] !== null) env.dev(b).dim.value = values[i];
    if (typeof temp === 'number') env.dev(b).light_temperature.value = temp;
  });
}

// K Bord switched on at `onAt` (the profile of the moment), then idle at `idleAt`
async function idleKitchen(idleAt = '16:00:00', onAt = '14:00:00') {
  const env = kitchen();
  at(onAt);
  await env.run(AL, KB);
  at(idleAt);
  const r = await env.run(AL, `${KB} idle`);
  return { env, r };
}

// K Bord manual with a scene (set by hand at 14:10, seen by the 14:20 check)
async function manualScene(values, { colourBulb3 = false, temp = 0.4 } = {}) {
  const env = kitchen();
  at('14:00:00');
  await env.run(AL, KB);
  if (colourBulb3) {
    const b3 = env.devices.kbbulb03;
    b3.capabilities.push('light_mode', 'light_hue', 'light_saturation');
    Object.assign(b3.capabilitiesObj, { light_mode: { value: 'color' }, light_hue: { value: 0.83 }, light_saturation: { value: 0.9 } });
  }
  at('14:10:00');
  setBulbs(env, KB, values, temp);
  at('14:20:00');
  await env.run(AL, `${KB} check`);
  return env;
}

// Both kitchen lights idle-capped through the night: on at 05:00 (Night), idle
// at 05:10 → stue Night 10/0.9, kept by the ratchet into the morning
async function morningIdle() {
  const env = kitchen({ dim: 0.15, temp: 0.9 });
  at('05:00:00');
  await env.run(AL, KB);
  await env.run(AL, KL);
  at('05:10:00');
  await env.run(AL, `${KB} idle`);
  await env.run(AL, `${KL} idle`);
  return env;
}

// GradualFadeOut "<KL>,<KB>" (Mørkt → false at 08:40 on `day`), with `during`
// run while its 20 s fade is under way
async function gfoMorning(env, during, day = '02') {
  at('08:40:00', day);
  env.onWait = async (msWait) => { if (msWait === 20000 && during) { const d = during; during = null; advance(5000); await d(); } };
  try {
    return await env.run(GFO, [`${KL},${KB}`]);
  } finally {
    env.onWait = null;
  }
}

export const scenarios = {
  // ---------------- arguments and configuration ----------------
  async 'idle/wake are known modes; no idle block → idle_not_enabled (once an hour); wake when not idle costs nothing'(t) {
    const env = createEnv([light(ID.ST_LOFT, 'ST Loft')]);
    at('16:00:00');
    for (let i = 0; i < 12; i++) { const r = await env.run(AL, `${ID.ST_LOFT} idle`); if (i === 0) t.equal(r.reason, 'idle_not_enabled', 'ST Loft (no idle block) → idle_not_enabled'); advance(5 * 60000); }
    t.equal([env.commands, env.logicCalls, env.state(ID.ST_LOFT)], [[], [], null], 'no command, no Logic call, no state');
    t.equal(lines(env, 'AL-IDLE-OFF | "' + ID.ST_LOFT + ' idle" | no idle block for this light').length, 1, 'AL-IDLE-OFF once in an hour of triggers');
    t.equal(lines(env, 'BADARG').length, 0, 'not a bad argument');

    const k = kitchen();
    at('14:00:00');
    await k.run(AL, KB);
    const rev = k.state(KB).rev;
    k.commands.length = 0; k.logicCalls.length = 0;
    const w = await k.run(AL, `${KB} wake`);
    t.equal([w.reason, k.state(KB).rev, k.commands, k.logicCalls, k.state(KB).busy], ['not_idle', rev, [], [], {}], 'wake on a light that is not idle: no save, no command, no Logic call');
  },

  async 'idle twice (both triggers fire) → already_idle, nothing saved'(t) {
    const { env } = await idleKitchen();
    const rev = env.state(KB).rev;
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.reason, env.state(KB).rev], ['already_idle', rev], 'second idle: already_idle, rev unchanged');
  },

  async 'D4: no idle for a forced-profile light, even with an idle block; GFO fade running → idle skips'(t) {
    const env = createEnv([light(ID.O_LOFT, 'O Loft')]);
    at('19:00:00');
    const withBlock = [['    name: "O Loft",\n', '    name: "O Loft",\n    idle: KITCHEN_IDLE,\n']];
    const r = await env.run(AL, `${ID.O_LOFT} idle`, { patch: withBlock });
    t.equal([r.reason, env.commands, env.state(ID.O_LOFT)], ['idle_not_enabled', [], null], 'O Loft (forced profiles) with an idle block patched on → idle_not_enabled, nothing sent or saved');
    t.equal(lines(env, `AL-IDLE-OFF | "${ID.O_LOFT} idle" | forced-profile light — idle not supported`).length, 1, 'AL-IDLE-OFF names the forced-profile exclusion');
    const k = kitchen();
    at('14:00:00');
    await k.run(AL, KB);
    at('16:00:00');
    k.store.set(`${KB}_FadeActiveUntil`, clock() + 20000);
    const f = await k.run(AL, `${KB} idle`);
    t.equal([f.reason, k.state(KB).idle], ['fade_in_progress', null], 'GradualFadeOut fading → fade_in_progress, no flag');
    t.check(lines(k, 'AL-IDLE-SKIP | K Bord | GradualFadeOut fade in progress').length === 1, 'AL-IDLE-SKIP logged');
  },

  async 'C4: idle switched off with a flag stored → check ignores it, never throws; wake still undoes it'(t) {
    const { env } = await idleKitchen();
    const off = [['enableIdle: true ', 'enableIdle: false ']];
    t.equal((await env.run(AL, `${KB} idle`, { patch: off })).reason, 'idle_not_enabled', 'idle with enableIdle false → idle_not_enabled');
    at('16:20:00');
    const r = await env.run(AL, `${KB} check`, { patch: off });
    t.equal([r.profile, dims(env, KB)], ['Daytime', [1, 1, 1]], 'the stored flag is ignored: the check puts Daytime back');
    t.equal([lines(env, 'AL-ERROR').length, env.state(KB).manual], [0, false], 'no AL-ERROR, not manual');
    t.check(!env.status().lights[KB].idle, 'status shows no idle while it is switched off');

    // The room block removed (K Loft's comes first in the file)
    const { env: env2 } = await (async () => {
      const e = kitchen();
      at('14:00:00');
      await e.run(AL, KL);
      at('16:00:00');
      await e.run(AL, `${KL} idle`);
      return { env: e };
    })();
    at('16:20:00');
    const noBlock = [['idle: KITCHEN_IDLE          // Dims', '// idle removed           // Dims']];
    const r2c = await env2.run(AL, `${KL} check`, { patch: noBlock });
    t.equal([r2c.profile, lines(env2, 'AL-ERROR').length], ['Daytime', 0], 'block removed: check runs as without idle');
    at('16:25:00');
    const w = await env2.run(AL, `${KL} wake`, { patch: off });
    t.equal([w.woke, env2.state(KL).idle, dims(env2, KL), lines(env2, 'AL-ERROR').length], [true, null, [1, 1, 1], 0], 'wake with idle switched off still clears the leftover flag (default 1 s fade)');
  },

  // ---------------- auto light: D1, D2, D3, D5 ----------------
  async 'D1/D2: 16:00 Daytime → living room Evening 35/0.9, 30 s fade, only the bulbs'(t) {
    const { env, r } = await idleKitchen();
    t.equal([r.idle, r.from, r.dimmed, r.brightness, r.temperature], [true, 'profile', true, 0.35, 0.9], 'idle result');
    t.equal(dims(env, KB), [0.35, 0.35, 0.35], 'every bulb at 35 %');
    t.equal(temps(env, KB), [0.9, 0.9, 0.9], 'every bulb at 0.9');
    t.check(cardsTo(env, BULB[KB]).every((c) => c.duration === 30) && cardsTo(env, BULB[KB]).length === 6, 'dim and temperature cards with a 30 s duration', JSON.stringify(env.cards));
    t.check(!env.commands.some((c) => c.startsWith('K Bord dim') || c.startsWith('K Bord light_')), 'the group device itself is not written');
    const s = env.state(KB);
    t.equal([s.idle.level, s.idle.bulbs, typeof s.idle.token, s.idle.since], [{ brightness: 0.35, temperature: 0.9 }, null, 'string', ms('16:00:00')], 'idle = { token, since, level, bulbs }');
    t.equal([s.lastProfile, s.lastApplied.brightness, s.lastApplied.temperature, s.lastApplied.via, s.manual], ['Daytime', 0.35, 0.9, 'idle', false], 'lastApplied 35/0.9 via idle, profile still Daytime, auto');
    const fadeEnd = ms('16:00:35');
    t.equal([s.fadeEndTime, ...BULB[KB].map((b) => env.state(b).fadeEndTime)], [fadeEnd, fadeEnd, fadeEnd, fadeEnd], 'fade end on the group and its bulbs');
    t.check(lines(env, 'AL-IDLE | K Bord | Daytime → ref Evening | dim=35% temp=90% | fade 30s').length === 1, 'AL-IDLE line', env.diag().slice(-2).join(' / '));
    const st = env.status().lights[KB];
    t.equal([st.idle, st.mode, st.bri], [true, 'auto', 0.35], 'status: idle, auto, 35 %');
    t.equal(env.state(KL), null, 'K Loft untouched');
  },

  async 'D2: the reference follows the sun — 15:00 stue Daytime 80/0.4, then the poll before sunset-60 ramps to Evening'(t) {
    const { env, r } = await idleKitchen('15:00:00');
    t.equal([r.brightness, r.temperature], [0.8, 0.4], '15:00: stue Daytime 80/0.4 is below kitchen Daytime 100');
    let ramp = null;
    for (let m = 5; m <= 50 && !ramp; m += 5) {
      at(`15:${String(m).padStart(2, '0')}:00`);
      const p = await env.run(AL, `${KB} check`);
      if (p.early) ramp = { at: m, p };
    }
    t.check(ramp && ramp.at >= 25 && ramp.at <= 40, 'a poll shortly before the stue Evening start (sunset-60 > 15:30) ramps early', JSON.stringify(ramp));
    t.equal(dims(env, KB), [0.35, 0.35, 0.35], 'ramped to 35 %');
    const line = lines(env, 'AL-APPLY | K Bord | Daytime | dim=35% temp=90% | mode=check (early, boundary 15:')[0];
    t.check(line && line.includes('| idle ref Evening'), 'AL-APPLY: early, at the stue boundary 15:3x, tagged idle ref Evening', line);
    t.equal([env.state(KB).idle.level, env.state(KB).manual], [{ brightness: 0.35, temperature: 0.9 }, false], 'idle level follows, still auto');
  },

  async 'D3: ratchet through the night — 21:00 → 10 %, stays 10 % at 23:00 and 06:00; polls stay quiet'(t) {
    const { env } = await idleKitchen();
    const seen = {};
    const want = { '20:50': 0.35, '21:05': 0.1, '23:30': 0.1, '06:30': 0.1, '08:30': 0.1, '09:30': 0.1 };
    let applies = 0;
    for (let m = 16 * 60 + 5; m <= (24 + 9) * 60 + 30; m += 5) {
      const day = m >= 24 * 60 ? '03' : '02';
      const hhmm = `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      at(`${hhmm}:00`, day);
      const before = env.commands.length;
      await env.run(AL, `${KB} check`);
      if (env.commands.length > before) applies += 1;
      if (want[hhmm] !== undefined) seen[hhmm] = dims(env, KB)[0];
    }
    t.equal(seen, want, 'K Bord: 35 % until 21:00, then 10 % through 23:00 (kitchen Night), 06:00 (stue/kitchen Morning) and 09:00');
    t.equal(applies, 1, 'one change all night (the ramp into the stue Night at 21:00)');
    t.equal(temps(env, KB), [0.9, 0.9, 0.9], 'temperature 0.9 throughout');
    t.check(lines(env, 'boundary 21:00').some((l) => l.includes('dim=10%')), 'the 20:55 poll ramps into the stue Night (boundary 21:00)', lines(env, 'AL-APPLY').join(' / '));
    t.equal([env.state(KB).manual, overrides(env).length, lines(env, 'AL-SKIP').length], [false, 0, 0], 'never manual, no OVERRIDE, no skip');
    t.equal(env.state(KB).idle.level, { brightness: 0.1, temperature: 0.9 }, 'idle level 10/0.9');
    t.equal(env.state(KB).lastProfile, 'Daytime', 'lastProfile follows the kitchen schedule');
  },

  async 'D3: AL\'s own ramp running UP when idle starts (05:55 Night → Morning 100 %) is replaced'(t) {
    const env = kitchen({ dim: 0.15, temp: 0.9 });
    at('05:00:00');
    await env.run(AL, KB);
    at('05:55:00');
    const ramp = await env.run(AL, `${KB} check`);
    t.equal([ramp.early, ramp.brightness], [true, 1], 'setup: the 05:55 poll ramps to Morning 100 %');
    at('05:57:00');
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.dimmed, dims(env, KB)], [true, [0.1, 0.1, 0.1]], 'idle sends stue Night 10 %, replacing the ramp');
    for (const time of ['06:00:00', '06:05:00', '06:15:00', '06:30:00']) {
      at(time);
      await env.run(AL, `${KB} check`);
    }
    t.equal([dims(env, KB)[0], env.state(KB).manual, overrides(env).length], [0.1, false, 0], 'stays 10 % into Morning, auto, no OVERRIDE');
  },

  async 'D3: idle reads the bulbs part-way up AL\'s own ramp → not a change by hand (auto, no OVERRIDE)'(t) {
    const env = kitchen({ dim: 0.15, temp: 0.9 });
    at('05:00:00');
    await env.run(AL, KB);
    at('05:55:00');
    await env.run(AL, `${KB} check`);                      // ramps to Morning 100/0.3 until 06:00:xx
    setBulbs(env, KB, [0.6, 0.6, 0.6], 0.5);               // part-way up: neither Night nor Morning
    at('05:57:00');
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.from, r.dimmed, dims(env, KB), env.state(KB).manual, overrides(env)], ['profile', true, [0.1, 0.1, 0.1], false, []], 'idle dims to stue Night 10 %, auto, no OVERRIDE src=idle');
  },

  async 'D2: idle shortly before a reference boundary records it → the next poll ramps on time'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('15:24:00');                                        // stue Evening starts at sunset-60 (~15:36)
    const i = await env.run(AL, `${KB} idle`);
    t.equal(i.brightness, 0.8, 'setup: idle at stue Daytime 80 %');
    let ramp = null;
    for (const time of ['15:25:00', '15:30:00', '15:35:00']) {
      at(time);
      const p = await env.run(AL, `${KB} check`);
      if (p.early) { ramp = time; break; }
    }
    t.check(ramp !== null, 'a poll before the stue boundary ramps early (idle\'s own run recorded the reference boundary; no wait for the 15-min resync)', lines(env, 'AL-').slice(-4).join(' / '));
  },

  async 'D3: idle lands while a check\'s ramp commands are in flight → check backs off, idle wins, no false manual'(t) {
    const env = kitchen({ dim: 0.15, temp: 0.9 });
    at('05:00:00');
    await env.run(AL, KB);
    at('05:55:00');
    env.commandDelayMs = 40;
    const check = env.run(AL, `${KB} check`);
    await sleep(15);
    const idle = env.run(AL, `${KB} idle`);
    const [c, i] = await Promise.all([check, idle]);
    env.commandDelayMs = 0;
    t.equal([c.reason, i.dimmed], ['state_changed', true], 'the check stops at its save (AL-SKIP-STALE), idle dims');
    t.equal([dims(env, KB), env.state(KB).lastApplied.brightness, env.state(KB).lastApplied.via], [[0.1, 0.1, 0.1], 0.1, 'idle'], 'bulbs and lastApplied at the idle level');
    at('06:05:00');
    const next = await env.run(AL, `${KB} check`);
    t.equal([next.reason, env.state(KB).manual, overrides(env).length], ['already_correct', false, 0], 'the owed full run finds it correct: no false manual');
  },

  async 'D5: wake at 16:10 → Daytime 100/0.4 with a 1 s fade; C7: run time logged; C5: next poll is a full run'(t) {
    const { env } = await idleKitchen();
    at('16:10:00');
    env.cards.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.woke, w.profile, w.brightness, w.temperature], [true, 'Daytime', 1, 0.4], 'wake applies the kitchen Daytime, uncapped');
    t.equal([dims(env, KB), temps(env, KB)], [[1, 1, 1], [0.4, 0.4, 0.4]], 'bulbs back at 100/0.4');
    t.check(env.cards.length === 6 && env.cards.every((c) => c.duration === 1), '1 s cards', JSON.stringify(env.cards));
    const s = env.state(KB);
    t.equal([s.idle, s.lastApplied.via, s.fadeEndTime, s.manual, s.busy], [null, 'wake', ms('16:10:06'), false, {}], 'idle cleared, via wake, fade end +6 s, lease released');
    const line = lines(env, 'AL-WAKE | K Bord | Daytime | dim=100% temp=40% | fade 1s | idle 10m')[0];
    t.check(line && /\| took \d+\.\ds$/.test(line), 'AL-WAKE line with idle age and run time', line);
    t.check(!env.status().lights[KB].idle, 'status: no idle');
    t.equal(s.fullRunDue, true, 'wake leaves a full run owed');
    at('16:12:00');
    t.equal((await env.run(AL, `${KB} check`)).reason, 'already_correct', 'the 16:12 poll is a full run, not not_due');
  },

  async 'C5: a wake that fails after its first save is repaired by the next poll'(t) {
    const { env } = await idleKitchen();
    at('16:10:00');
    const getDevices = env.Homey.devices.getDevices;
    env.Homey.devices.getDevices = async () => { throw new Error('Homey busy'); };
    const w = await env.run(AL, `${KB} wake`);
    env.Homey.devices.getDevices = getDevices;
    t.equal([w, env.state(KB).idle, dims(env, KB)[0]], [false, null, 0.35], 'setup: the wake failed after clearing idle, light still at 35 %');
    at('16:12:00');
    const p = await env.run(AL, `${KB} check`);
    t.equal([p.profile, dims(env, KB), env.state(KB).manual], ['Daytime', [1, 1, 1], false], 'the 16:12 poll (full run owed) puts Daytime back');
  },

  async 'wake 10 s into idle\'s fade → applied, not an override'(t) {
    const { env } = await idleKitchen();
    setBulbs(env, KB, [0.8, 0.8, 0.8], 0.6);              // half-way down the 30 s fade
    at('16:00:10');
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.profile, dims(env, KB), env.state(KB).manual, overrides(env).length], ['Daytime', [1, 1, 1], false, 0], 'Daytime applied, auto, no OVERRIDE');
  },

  async 'a restore older than restoreGraceSeconds is no "after restore": wake still sees the change by hand'(t) {
    const { env } = await idleKitchen();
    at('16:03:00');
    setBulbs(env, KB, [0.8, 0.8, 0.8], 0.4);
    env.store.set(`${KB}_RestoredAt`, ms('16:02:00'));    // a restore a minute ago (grace 30 s)
    env.commands.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.reason, env.state(KB).manual, env.commands], ['changed_while_idle', true, []], 'manual, nothing sent');
    t.check(!lines(env, 'AL-WAKE').some((l) => l.includes('after restore')), 'not tagged after restore');
  },

  async 'C5/D7: an idle run that died after its commands (lastApplied not recorded) → wake applies the profile, no false manual'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    const kill = [['  const recorded = stillIdle();', "  throw new Error('killed');"]];
    await env.run(AL, `${KB} idle`, { patch: kill }).catch(() => null);
    const s = env.state(KB);
    t.equal([dims(env, KB), s.idle.level.brightness, s.lastApplied.brightness], [[0.35, 0.35, 0.35], 0.35, 1], 'setup: bulbs and idle level at 35 %, lastApplied still Daytime 100 %');
    at('16:05:00');
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.profile, dims(env, KB), env.state(KB).manual, overrides(env)], ['Daytime', [1, 1, 1], false, []], 'wake: Daytime back, auto, no OVERRIDE');
  },

  async 'C1: wake while idle\'s commands are still on their way → no "no change" shortcut'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    env.commandDelayMs = 80;                               // a command lands 80 ms after it is sent
    const idle = env.run(AL, `${KB} idle`);
    await sleep(20);                                       // idle has sent; nothing has landed
    t.equal(dims(env, KB), [1, 1, 1], 'setup: the bulbs still read 100 % when wake starts');
    const w = await env.run(AL, `${KB} wake`);
    const i = await idle;
    env.commandDelayMs = 0;
    t.equal([w.changed, dims(env, KB)], [true, [1, 1, 1]], 'wake re-sends Daytime; the light ends at 100 %');
    t.equal([env.state(KB).idle, env.state(KB).lastApplied.via, i.dimmed], [null, 'wake', true], 'idle cleared, lastApplied via wake (idle\'s own record skipped)');
    t.check(lines(env, 'woken during the commands').length === 1, 'idle logs it was woken during its commands');
  },

  async 'C1/D4: manual wake while idle\'s dim cards are still on their way → each capped bulb back at its scene'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    at('16:00:00');
    env.commandDelayMs = 80;
    const idle = env.run(AL, `${KB} idle`);
    await sleep(20);                                       // idle has sent its dim cards; nothing has landed
    t.equal(dims(env, KB), [0.8, 0.3, 0.6], 'setup: the bulbs still read the scene when wake starts');
    const w = await env.run(AL, `${KB} wake`);
    await idle;
    env.commandDelayMs = 0;
    t.equal([w.restored, dims(env, KB), env.state(KB).manual], [2, [0.8, 0.3, 0.6], true], 'both capped bulbs restored; the scene stays, manual');
  },

  async 'C2: wake during idle\'s slow fetch → idle sends nothing'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    env.cards.length = 0;
    env.deviceListDelayMs = FETCH_MS;
    const idle = env.run(AL, `${KB} idle`);
    await sleep(10);
    const wake = env.run(AL, `${KB} wake`);
    const [i, w] = await Promise.all([idle, wake]);
    env.deviceListDelayMs = 0;
    t.equal(i.reason, 'woken', 'idle: woken');
    t.equal(env.cards.filter((c) => c.value === 0.35).length, 0, 'no dim card from idle at all');
    t.equal([env.state(KB).idle, dims(env, KB), w.woke], [null, [1, 1, 1], true], 'idle cleared, light at Daytime');
    t.check(lines(env, 'AL-IDLE-SKIP | K Bord | woken before dimming').length === 1, 'AL-IDLE-SKIP woken logged');
  },

  async 'C2: wake during idle\'s zone lookup → the guard reads the stored state, no fading flag, no command'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    const getZone = env.Homey.zones.getZone;
    let wake = null;
    env.Homey.zones.getZone = async (a) => { wake = await env.run(AL, `${KB} wake`); return getZone(a); };
    env.cards.length = 0;
    const i = await env.run(AL, `${KB} idle`);
    env.Homey.zones.getZone = getZone;
    t.equal([i.reason, wake.woke], ['woken', true], 'idle: woken (wake slipped in during the zone lookup)');
    t.equal(env.cards.filter((c) => c.value === 0.35 || c.duration === 30).length, 0, 'no idle command');
    t.equal([env.state(KB).fadeEndTime, env.state(KB).idle, dims(env, KB)], [ms('16:00:06'), null, [1, 1, 1]], 'fade end is wake\'s (1 s + 5 s), not idle\'s 35 s');
  },

  async 'idle where nothing changes (reference = own) → no command; wake → "no change"; status still shows idle'(t) {
    const same = [['  profiles: PROFILES.stue\n};', '  profiles: PROFILES.kitchen\n};']];
    const env = kitchen({ dim: 0.7, temp: 0.6 });
    at('20:30:00');
    await env.run(AL, KB, { patch: same });
    env.commands.length = 0; env.logicCalls.length = 0;
    const i = await env.run(AL, `${KB} idle`, { patch: same });
    t.equal([i.dimmed, env.commands], [false, []], 'idle at Evening with an Evening reference: no command');
    t.check(lines(env, 'AL-IDLE | K Bord | Evening | already dim=70% temp=60% — no change').length === 1, 'AL-IDLE no change');
    t.equal([env.status().lights[KB].idle, env.logicCalls.includes('update')], [true, true], 'the idle flag alone is published (signature)');
    at('20:40:00');
    const w = await env.run(AL, `${KB} wake`, { patch: same });
    t.equal([w.changed, env.commands, env.state(KB).idle], [false, [], null], 'wake: no change, no command, idle cleared');
    t.check(lines(env, 'AL-WAKE | K Bord | Evening | no change').length === 1, 'AL-WAKE no change');
    t.check(!env.status().lights[KB].idle, 'status: idle gone');
  },

  // ---------------- D6: never switch anything on ----------------
  async 'D6: idle and wake on an off light: flag cleared, no command'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    for (const b of BULB[KB]) env.dev(b).onoff.value = false;
    at('16:00:00');
    env.commands.length = 0;
    const i = await env.run(AL, `${KB} idle`);
    t.equal([i.reason, env.commands, env.state(KB).idle], ['light_off', [], null], 'idle on an off light: light_off, nothing sent, no flag');

    const { env: e2 } = await idleKitchen();
    for (const b of BULB[KB]) e2.dev(b).onoff.value = false;  // switched off while idle
    at('16:30:00');
    e2.commands.length = 0; e2.cards.length = 0;
    const w = await e2.run(AL, `${KB} wake`);
    t.equal([w.lightOff, e2.state(KB).idle, e2.commands, e2.cards], [true, null, [], []], 'wake on an off idle light: flag cleared, no command at all');
    t.equal(BULB[KB].map((b) => e2.dev(b).onoff.value), [false, false, false], 'bulbs stay off');
    t.check(lines(e2, 'AL-WAKE | K Bord | light off — idle cleared').length === 1, 'AL-WAKE light off logged');
  },

  async 'D6: a bulb that is off inside an on group is never commanded (idle and wake)'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    env.dev('kbbulb02').onoff.value = false;
    at('16:00:00');
    env.commands.length = 0;
    await env.run(AL, `${KB} idle`);
    at('16:10:00');
    await env.run(AL, `${KB} wake`);
    t.check(!env.commands.some((c) => c.startsWith('K Bord 2 ')), 'no command to the off bulb', env.commands.join(', '));
    t.equal([env.dev('kbbulb02').onoff.value, dims(env, KB)], [false, [1, 1, 1]], 'it stays off; the others went 35 % → 100 %');
  },

  async 'D6: manual scene — a bulb off before idle and one switched off while idle are never commanded'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    env.dev('kbbulb01').onoff.value = false;               // off before idle (80 %, above the cap)
    at('16:00:00');
    env.commands.length = 0;
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.from, r.bulbs, Object.keys(env.state(KB).idle.bulbs)], ['manual', 1, ['kbbulb02', 'kbbulb03']], 'idle caps bulb 3 only; bulb 1 not in the snapshot');
    t.check(!env.commands.some((c) => c.startsWith('K Bord 1 ')), 'idle: no command to the off bulb 1', env.commands.join(', '));
    env.dev('kbbulb03').onoff.value = false;               // switched off while idle
    at('16:10:00');
    env.commands.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.restored, env.commands], [0, []], 'wake: nothing to restore (bulb 3 is off), no command');
    t.equal([ons(env, KB), dims(env, KB)], [[false, true, false], [0.8, 0.3, 0.35]], 'they stay off');
  },

  async 'D6: check runs while idle never command a bulb that is off (early ramp and main apply)'(t) {
    for (const polls of [['20:50:00', '20:55:00', '21:05:00'], ['21:05:00']]) {
      const { env } = await idleKitchen();
      env.dev('kbbulb02').onoff.value = false;             // switched off in the Hue app while idle
      env.commands.length = 0;
      for (const time of polls) {
        at(time);
        await env.run(AL, `${KB} check`);
      }
      const how = polls.length > 1 ? '20:55 early ramp' : '21:05 apply';
      t.check(!env.commands.some((c) => c.startsWith('K Bord 2 ')), `${how}: no command to the off bulb`, env.commands.join(', '));
      t.equal([ons(env, KB), dims(env, KB)[0], dims(env, KB)[2]], [[true, false, true], 0.1, 0.1], `${how}: the others at stue Night 10 %, bulb 2 stays off`);
    }
  },

  async 'idle while the zone is already active → nothing dimmed'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    env.zoneActive = true;
    env.commands.length = 0;
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.reason, env.commands, env.state(KB).idle], ['zone_active', [], null], 'zone_active: no command, no flag');
    t.check(lines(env, 'AL-IDLE-SKIP | K Bord | zone active').length === 1, 'AL-IDLE-SKIP zone active');
  },

  // ---------------- D4: manual (held) lights ----------------
  async 'D4: manual scene → per-bulb cap, colour untouched, snapshot of every bulb that is on'(t) {
    const env = await manualScene([0.8, 0.3, 0.6], { colourBulb3: true });
    t.equal(env.state(KB).manual, true, 'setup: K Bord manual (80/30/60 %)');
    const before = env.state(KB);
    at('16:00:00');
    env.commands.length = 0; env.cards.length = 0;
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.from, r.dimmed, r.bulbs], ['manual', true, 2], 'two bulbs above the cap');
    t.equal(dims(env, KB), [0.35, 0.3, 0.35], 'bulbs 1 and 3 capped at 35 %, bulb 2 untouched');
    t.equal(env.cards.map((c) => [c.id, c.card, c.value, c.duration]), [['kbbulb01', 'dim', 0.35, 30], ['kbbulb03', 'dim', 0.35, 30]], 'dim cards only, 30 s');
    t.check(!env.commands.some((c) => /light_(temperature|mode|saturation|hue)/.test(c)), 'no temperature, mode, saturation or hue command', env.commands.join(', '));
    const s = env.state(KB);
    t.equal([s.manual, s.lastProfile, s.lastApplied], [true, before.lastProfile, before.lastApplied], 'still manual; lastProfile/lastApplied untouched');
    t.equal(s.idle.bulbs, {
      kbbulb01: { dim: 0.8, set: 0.35, temp: 0.4, mode: null },
      kbbulb02: { dim: 0.3, set: 0.3, temp: 0.4, mode: null },
      kbbulb03: { dim: 0.6, set: 0.35, temp: 0.4, mode: 'color', hue: 0.83, sat: 0.9 },
    }, 'snapshot: dim, what idle set, temperature, mode (+ hue/saturation for the colour bulb)');
    const st = env.status().lights[KB];
    t.equal([st.mode, st.idle], ['manual', true], 'status: manual, idle');
  },

  async 'D4: wake puts each bulb back exactly (dim only, the group device not written); manual stays'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    at('16:00:00');
    await env.run(AL, `${KB} idle`);
    at('16:10:00');
    env.commands.length = 0; env.cards.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.from, w.restored], ['manual', 2], 'two bulbs restored');
    t.equal(dims(env, KB), [0.8, 0.3, 0.6], 'back at 80/30/60 %');
    t.equal(env.cards.map((c) => [c.id, c.value, c.duration]), [['kbbulb01', 0.8, 1], ['kbbulb03', 0.6, 1]], '1 s dim cards to the changed bulbs');
    t.check(!env.commands.some((c) => c.startsWith('K Bord ') && !/^K Bord \d/.test(c)), 'the group device itself is not written', env.commands.join(', '));
    t.check(!env.commands.some((c) => c.includes('light_temperature')), 'no temperature written (nothing flattened it)');
    t.equal([env.state(KB).manual, env.state(KB).idle], [true, null], 'still manual, idle cleared');
    t.check(lines(env, 'AL-WAKE | K Bord | manual | restored 2/3 bulb(s) (fade 1s)').length === 1, 'AL-WAKE manual line');
  },

  async 'D4: a bulb changed by hand while idle stays as the user left it'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    at('16:00:00');
    await env.run(AL, `${KB} idle`);
    at('16:05:00');
    env.dev('kbbulb01').dim.value = 0.9;
    at('16:10:00');
    await env.run(AL, `${KB} wake`);
    t.equal(dims(env, KB), [0.9, 0.3, 0.6], 'bulb 1 keeps the 90 %, bulb 3 restored');
  },

  async 'D4: group at or below the cap → nothing changes (also 80/10/10, decided on the group)'(t) {
    for (const scene of [[0.3, 0.3, 0.3], [0.8, 0.1, 0.1]]) {
      const env = await manualScene(scene);
      at('16:00:00');
      env.commands.length = 0;
      const r = await env.run(AL, `${KB} idle`);
      t.equal([r.dimmed, env.commands, dims(env, KB)], [false, [], scene], `${scene.map((v) => v * 100).join('/')} %: no command`);
      at('16:10:00');
      const w = await env.run(AL, `${KB} wake`);
      t.equal([w.restored, env.commands], [0, []], `${scene.map((v) => v * 100).join('/')} %: wake has nothing to restore`);
    }
  },

  async 'D4/C3: manual scene at or below the cap, GFO morning fade, wake and RestoreSavedSettings in either order → each bulb back at the scene'(t) {
    for (const order of ['wake first', 'RestoreSavedSettings first']) {
      const env = await manualScene([0.4, 0.2, 0.3]);
      at('16:00:00');
      const i = await env.run(AL, `${KB} idle`);
      t.equal([i.dimmed, env.state(KB).idle.bulbs.kbbulb01], [false, { dim: 0.4, set: 0.4, temp: 0.4, mode: null }], `${order}: group at 30 % ≤ 35 %: no command, every bulb noted`);
      await gfoMorning(env, async () => {
        if (order !== 'wake first') await env.run(RSS, [KB]);
        await env.run(AL, `${KB} wake`);
        if (order === 'wake first') await env.run(RSS, [KB]);
      }, '03');
      t.equal([ons(env, KB), dims(env, KB), env.state(KB).manual], [[true, true, true], [0.4, 0.2, 0.3], true], `${order}: every bulb back at its own dim (not ~0 %, not flattened), still manual`);
    }
  },

  async 'D4/C3: manual scene, GFO morning fade, RestoreSavedSettings then wake → each bulb\'s own dim, temperature only on temperature bulbs, colour back on the colour bulb'(t) {
    const env = await manualScene([0.8, 0.3, 0.6], { colourBulb3: true, temp: 0.4 });
    env.dev('kbbulb02').light_temperature.value = 0.7;
    at('16:00:00');
    await env.run(AL, `${KB} idle`);
    let wakeCommands = [];
    await gfoMorning(env, async () => {
      await env.run(RSS, [KB]);                            // flattens: one dim and temperature on every bulb
      env.dev('kbbulb03').light_hue.value = 0.1;           // as the Hue bridge would show it after the temperature write
      const n = env.commands.length;
      await env.run(AL, `${KB} wake`);
      wakeCommands = env.commands.slice(n);
    }, '03');
    t.equal(dims(env, KB), [0.8, 0.3, 0.6], 'every bulb back at its own dim');
    t.equal(temps(env, KB).slice(0, 2), [0.4, 0.7], 'temperature-mode bulbs get their own temperature back');
    t.check(!wakeCommands.some((c) => c.startsWith('K Bord 3 light_temperature')), 'never a temperature on the colour bulb', wakeCommands.join(', '));
    t.equal([env.dev('kbbulb03').light_hue.value, env.dev('kbbulb03').light_saturation.value], [0.83, 0.9], 'colour bulb: hue and saturation back');
    t.check(lines(env, 'AL-WAKE | K Bord | manual | restored 3/3 bulb(s)').some((l) => l.includes('after restore')), 'AL-WAKE: 3/3 after restore');
    t.equal(env.state(KB).manual, true, 'still manual');
  },

  async 'D4/C3: manual light whose idle died before its bulb snapshot, GFO morning fade, wake first → no takeover, RestoreSavedSettings brings it back'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    at('16:00:00');
    const getDevices = env.Homey.devices.getDevices;
    env.Homey.devices.getDevices = async () => { throw new Error('Homey busy'); };
    await env.run(AL, `${KB} idle`).catch(() => null);
    env.Homey.devices.getDevices = getDevices;
    t.equal([!!env.state(KB).idle, env.state(KB).idle?.bulbs ?? null, env.state(KB).manual], [true, null, true], 'setup: manual, idle flag set, no bulb snapshot');
    // GradualFadeOut on K Bord alone, so the motion lands inside K Bord's own 20 s wait
    let fadeFlagAfterWake = 0;
    at('08:40:00', '03');
    env.onWait = async (msWait) => {
      if (msWait !== 20000 || fadeFlagAfterWake) return;
      advance(5000);
      await env.run(AL, `${KB} wake`);
      fadeFlagAfterWake = env.store.get(`${KB}_FadeActiveUntil`) || 0;
      await env.run(RSS, [KB]);
    };
    const r = await env.run(GFO, [KB]).finally(() => { env.onWait = null; });
    t.check(fadeFlagAfterWake > 0, 'wake left the fade to RestoreSavedSettings (no takeover)', String(fadeFlagAfterWake));
    t.check(ons(env, KB).every(Boolean) && dims(env, KB).every((d) => d >= 0.3), 'every bulb on and restored, not ~0 %', JSON.stringify(dims(env, KB)));
    t.check(String(r).includes('K Bord: Fade cancelled'), 'GradualFadeOut: K Bord fade cancelled by the restore', String(r));
    t.equal(env.state(KB).manual, true, 'still manual');
  },

  async 'D4/C3: manual scene, wake takes over the GFO fade → dims back, no temperature written'(t) {
    const env = await manualScene([0.8, 0.3, 0.6], { colourBulb3: true });
    at('16:00:00');
    await env.run(AL, `${KB} idle`);
    let wakeCommands = [];
    const r = await gfoMorning(env, async () => {
      const n = env.commands.length;
      await env.run(AL, `${KB} wake`);
      wakeCommands = env.commands.slice(n);
    }, '03');
    t.equal(dims(env, KB), [0.8, 0.3, 0.6], 'every bulb back at its own dim');
    t.check(!wakeCommands.some((c) => /light_(temperature|hue|saturation)/.test(c)), 'only dims (GradualFadeOut faded dim only)', wakeCommands.join(', '));
    t.check(String(r).includes('K Bord: Fade cancelled'), 'GradualFadeOut: K Bord fade cancelled', String(r));
    t.check(lines(env, 'AL-WAKE | K Bord | manual').some((l) => l.includes('took over GradualFadeOut fade')), 'AL-WAKE took over the fade');
  },

  async 'D4/D3: manual and idle across 23:00 → manual ends into the idle rule (10 %), idle stays; wake then restores Night, not the scene'(t) {
    const env = await manualScene([0.8, 0.3, 0.6]);
    at('16:00:00');
    await env.run(AL, `${KB} idle`);
    at('23:00:00');
    const p = await env.run(AL, `${KB} check`);
    t.equal([p.profile, dims(env, KB)], ['Night', [0.1, 0.1, 0.1]], '23:00: Night under the idle rule (stue Night 10 %)');
    t.check(lines(env, 'AL-MANUAL-EXPIRED | K Bord').length === 1, 'AL-MANUAL-EXPIRED');
    t.equal([env.state(KB).manual, !!env.state(KB).idle, env.state(KB).idle.level], [false, true, { brightness: 0.1, temperature: 0.9 }], 'auto, still idle, level 10 %');
    at('23:30:00');
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.profile, dims(env, KB)], ['Night', [0.15, 0.15, 0.15]], 'wake: the kitchen Night 15 % (the old scene is not restored)');
  },

  // ---------------- D7: a change by hand while idle ----------------
  async 'D7: check sees another value set by hand while idle → manual, OVERRIDE "| while idle", idle cleared; wake leaves it'(t) {
    const { env } = await idleKitchen();
    at('16:10:00');
    setBulbs(env, KB, [0.8, 0.8, 0.8], 0.4);
    at('16:20:00');
    const r = await env.run(AL, `${KB} check`);
    t.equal([r.reason, env.state(KB).manual, env.state(KB).idle], ['manual_adjustment_detected', true, null], 'manual, idle cleared');
    const o = overrides(env);
    t.check(o.length === 1 && o[0].includes('AL=35%/90') && o[0].includes('src=check') && o[0].endsWith('| while idle'), 'OVERRIDE src=check AL=35%/90 … | while idle', o.join(' / '));
    at('16:30:00');
    t.equal([(await env.run(AL, `${KB} wake`)).reason, dims(env, KB)], ['not_idle', [0.8, 0.8, 0.8]], 'a later wake: not_idle, the 80 % stays');
  },

  async 'D7: check sees the light back at its own profile by hand → a wake: auto, profile recorded, no OVERRIDE'(t) {
    const { env } = await idleKitchen();
    at('16:10:00');
    setBulbs(env, KB, [1, 1, 1], 0.4);
    at('16:20:00');
    const r = await env.run(AL, `${KB} check`);
    const s = env.state(KB);
    t.equal([r.reason, s.manual, s.idle, s.lastApplied.brightness, s.lastApplied.via], ['idle_ended_by_hand', false, null, 1, 'check'], 'idle ended, auto, Daytime recorded');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    t.check(lines(env, 'AL-WAKE | K Bord | Daytime set by hand — idle cleared | mode=check').length === 1, 'AL-WAKE by hand logged');
  },

  async 'D7: wake finds a change by hand no check has seen → manual, OVERRIDE src=wake "| while idle", no command'(t) {
    const { env } = await idleKitchen();
    at('16:03:00');
    setBulbs(env, KB, [0.8, 0.8, 0.8], 0.4);
    env.commands.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.reason, env.state(KB).manual, env.state(KB).idle, env.commands], ['changed_while_idle', true, null, []], 'manual, idle cleared, nothing sent');
    const o = overrides(env);
    t.check(o.length === 1 && o[0].includes('src=wake') && o[0].endsWith('| while idle'), 'OVERRIDE src=wake | while idle', o.join(' / '));
  },

  async 'D7: wake finds it already back at its own profile by hand → treated as a wake, no OVERRIDE'(t) {
    const { env } = await idleKitchen();
    at('16:03:00');
    setBulbs(env, KB, [1, 1, 1], 0.4);
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.woke, env.state(KB).manual, env.state(KB).lastApplied.via, overrides(env)], [true, false, 'wake', []], 'auto, recorded via wake, no OVERRIDE');
  },

  async 'idle finds a change by hand no check had seen → manual (OVERRIDE src=idle) and kept as a scene'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('15:58:00');
    setBulbs(env, KB, [0.6, 0.6, 0.6], 0.4);
    at('16:00:00');
    env.cards.length = 0;
    const r = await env.run(AL, `${KB} idle`);
    t.equal([r.from, env.state(KB).manual, dims(env, KB)], ['manual', true, [0.35, 0.35, 0.35]], 'manual; each bulb capped at 35 %');
    t.check(env.cards.every((c) => c.card === 'dim'), 'dim only (as a scene)');
    t.check(overrides(env).some((l) => l.includes('src=idle')), 'OVERRIDE src=idle', overrides(env).join(' / '));
    at('16:10:00');
    await env.run(AL, `${KB} wake`);
    t.equal([dims(env, KB), env.state(KB).manual], [[0.6, 0.6, 0.6], true], 'wake: back at 60 %, still manual');
  },

  // ---------------- D8: other modes end idle ----------------
  async 'D8: turn-on, clear, force and cycle-profile end idle'(t) {
    for (const mode of ['', 'clear', 'force', 'cycle-profile']) {
      const { env } = await idleKitchen();
      at('16:10:00');
      await env.run(AL, `${KB} ${mode}`.trim());
      t.equal([env.state(KB).idle, !!env.status().lights[KB].idle], [null, false], `"${mode || '(turn-on)'}" clears idle`);
    }
    // A turn-on of an off light with a leftover flag: profile, flag gone
    const { env } = await idleKitchen();
    for (const b of BULB[KB]) env.dev(b).onoff.value = false;
    at('17:00:00');
    for (const b of BULB[KB]) env.dev(b).onoff.value = true;
    await env.run(AL, KB);
    t.equal([dims(env, KB), env.state(KB).idle], [[1, 1, 1], null], 'switched on again: Daytime 100 %, idle gone');
  },

  async 'D8: a turn-on skipped for a restore leaves idle to the wake'(t) {
    const { env } = await idleKitchen();
    at('16:10:00');
    env.store.set(`${KB}_RestoredAt`, clock() - 2000);
    const r = await env.run(AL, KB);
    t.equal([r.reason, !!env.state(KB).idle], ['recently_restored', true], 'skipped turn-on: idle still set');
    at('16:11:00');
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.profile, dims(env, KB)], ['Daytime', [1, 1, 1]], 'the wake still restores');
  },

  // ---------------- overlapping runs ----------------
  async 'a check during idle backs off (AL-SKIP-BUSY); one that started before the wake stops (AL-SKIP-STALE)'(t) {
    const env = kitchen();
    at('14:00:00');
    await env.run(AL, KB);
    at('16:00:00');
    env.deviceListDelayMs = FETCH_MS;
    const idle = env.run(AL, `${KB} idle`);
    await sleep(10);
    const busy = await env.run(AL, `${KB} check`);
    await idle;
    t.equal(busy.reason, 'user_run_active', 'a poll during idle: AL-SKIP-BUSY');
    at('16:20:00');
    const check = env.run(AL, `${KB} check`);       // its device read predates the wake below
    await sleep(10);
    env.deviceListDelayMs = 0;
    await env.run(AL, `${KB} wake`);
    t.equal((await check).reason, 'state_changed', 'a poll that started before the wake: AL-SKIP-STALE');
    at('16:25:00');
    const next = await env.run(AL, `${KB} check`);
    t.equal([next.reason, env.state(KB).manual, overrides(env).length], ['already_correct', false, 0], 'next poll: full run, already correct, no OVERRIDE');
  },

  // ---------------- C3: GradualFadeOut / RestoreSavedSettings ----------------
  async 'C3: morning GFO fades idle lights off: no OVERRIDE, idle stays on the off lights; a turn-on clears it'(t) {
    const env = await morningIdle();
    const r = await gfoMorning(env, null);
    t.check(String(r).includes('K Bord: Faded and turned off') && String(r).includes('K Loft: Faded and turned off'), 'both faded off', String(r));
    t.check(lines(env, 'FADE-SAVE | K Bord | dim=10% temp=90%').length === 1, 'FADE-SAVE at the idle level');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    t.equal([!!env.state(KB).idle, !!env.state(KL).idle], [true, true], 'idle still set on the off lights');
    at('12:00:00');
    for (const b of BULB[KB]) env.dev(b).onoff.value = true;
    await env.run(AL, KB);
    t.equal([env.state(KB).idle, dims(env, KB)], [null, [1, 1, 1]], 'a turn-on: Daytime, idle gone');
  },

  async 'C3: motion during the fade, RestoreSavedSettings then wake → uncapped Morning, fade cancelled, no OVERRIDE'(t) {
    const env = await morningIdle();
    const r = await gfoMorning(env, async () => {
      for (const id of [KB, KL]) await env.run(RSS, [id]);
      for (const id of [KB, KL]) await env.run(AL, `${id} wake`);
    });
    t.equal((String(r).match(/Fade cancelled/g) || []).length, 2, 'GFO: both fades cancelled');
    for (const id of [KB, KL]) {
      t.equal([dims(env, id), temps(env, id), env.state(id).idle], [[1, 1, 1], [0.3, 0.3, 0.3], null], `${id === KB ? 'K Bord' : 'K Loft'}: Morning 100/0.3, idle cleared`);
    }
    t.check(lines(env, 'AL-WAKE | K Bord | Morning').some((l) => l.includes('after restore')), 'wake: after restore');
    t.equal(overrides(env), [], 'no OVERRIDE line');
    at('08:41:10');
    const p = await env.run(AL, `${KB} check`);
    t.equal([p.reason, env.state(KB).manual], ['already_correct', false], 'a check a minute later: already correct');
  },

  async 'C3: wake then RestoreSavedSettings → wake takes over, RSS skips, same end state'(t) {
    const env = await morningIdle();
    const rss = [];
    const r = await gfoMorning(env, async () => {
      for (const id of [KB, KL]) await env.run(AL, `${id} wake`);
      for (const id of [KB, KL]) rss.push(await env.run(RSS, [id]));
    });
    t.equal((String(r).match(/Fade cancelled/g) || []).length, 2, 'GFO: both fades cancelled');
    t.check(rss.every((x) => String(x).startsWith('No active fade')), 'RSS: no active fade, skipped', rss.join(' / '));
    for (const id of [KB, KL]) t.equal([dims(env, id), temps(env, id)], [[1, 1, 1], [0.3, 0.3, 0.3]], 'Morning 100/0.3');
    t.check(lines(env, 'AL-WAKE | K Loft | Morning').some((l) => l.includes('took over GradualFadeOut fade')), 'wake: took over the fade');
    t.equal(overrides(env), [], 'no OVERRIDE line');
  },

  async 'C3: wake and RestoreSavedSettings started together (wake first, slow fetch) → same end state'(t) {
    const env = await morningIdle();
    const r = await gfoMorning(env, async () => {
      env.deviceListDelayMs = FETCH_MS;
      env.commandDelayMs = 10;
      const runs = [];
      for (const id of [KB, KL]) runs.push(env.run(AL, `${id} wake`));
      await sleep(5);
      for (const id of [KB, KL]) runs.push(env.run(RSS, [id]));
      await Promise.all(runs);
      env.deviceListDelayMs = 0;
      env.commandDelayMs = 0;
    });
    t.equal((String(r).match(/Fade cancelled/g) || []).length, 2, 'GFO: both fades cancelled');
    for (const id of [KB, KL]) t.equal(dims(env, id), [1, 1, 1], 'Morning 100 %');
    t.equal(overrides(env), [], 'no OVERRIDE line');
  },

  async 'C3: idle at 35 % (on after 06:00), GFO fade, wake takes over or follows a restore → Morning, auto, no OVERRIDE'(t) {
    for (const order of ['wake takes over', 'RestoreSavedSettings first']) {
      const env = kitchen();
      at('07:00:00');
      await env.run(AL, KB);
      at('07:10:00');
      const i = await env.run(AL, `${KB} idle`);
      t.equal([i.brightness, i.temperature], [0.35, 0.7], `${order}: setup: idle at stue Morning 35/0.7`);
      await gfoMorning(env, async () => {
        if (order !== 'wake takes over') await env.run(RSS, [KB]);
        await env.run(AL, `${KB} wake`);
      });
      t.equal([dims(env, KB), temps(env, KB), env.state(KB).manual, overrides(env)], [[1, 1, 1], [0.3, 0.3, 0.3], false, []], `${order}: Morning 100/0.3, auto, no OVERRIDE`);
      const tag = order === 'wake takes over' ? 'took over GradualFadeOut fade' : 'after restore';
      t.check(lines(env, 'AL-WAKE | K Bord | Morning').some((l) => l.includes(tag)), `${order}: AL-WAKE ${tag}`, lines(env, 'AL-WAKE').join(' / '));
    }
  },

  async 'C3: wake takes over the GFO fade just as it switches off → _RestoredAt put back; GFO\'s switch-on gets Morning'(t) {
    const env = kitchen({ dim: 0.15, temp: 0.9 });
    at('05:00:00');
    await env.run(AL, KB);
    at('05:10:00');
    await env.run(AL, `${KB} idle`);
    at('08:40:00');
    env.waitAdvancesClock = true;
    const { getZone } = env.Homey.zones;
    const { getDevices } = env.Homey.devices;
    let zoneCalls = 0;
    let wake = null;
    env.Homey.zones.getZone = async (a) => {
      zoneCalls += 1;
      const res = await getZone(a);
      if (zoneCalls === 2) {                               // GFO's zone check at fade end, past its cancel check
        env.zoneActive = true;                             // someone comes in
        env.Homey.devices.getDevices = async () => { await sleep(30); return getDevices(); };
        wake = env.run(AL, `${KB} wake`);                  // takes over at once; reads the light after GFO's off
      }
      return res;
    };
    env.onWait = async (msWait) => { if (msWait === 3000) await sleep(150); };
    const g = await env.run(GFO, [KB]);
    const w = await wake;
    env.onWait = null;
    env.Homey.zones.getZone = getZone;
    env.Homey.devices.getDevices = getDevices;
    env.waitAdvancesClock = false;
    t.check(String(g).includes('back on (zone active)'), 'setup: GFO switched the light off, then back on for the active zone', String(g));
    t.equal([w.lightOff, w.woke], [true, true], 'setup: wake took over and found the light off');
    t.equal(env.store.get(`${KB}_RestoredAt`) || 0, 0, 'nothing was restored: _RestoredAt put back');
    const n = await env.run(AL, KB);                       // the "turned on" flow of GFO's switch-on
    t.equal([n.profile, dims(env, KB), temps(env, KB)], ['Morning', [1, 1, 1], [0.3, 0.3, 0.3]], 'AL applies Morning (not AL-SKIP-RESTORE)');
  },

  async 'C3: motion after the off → wake only clears the flag; the lights stay off'(t) {
    const env = await morningIdle();
    await gfoMorning(env, null);
    at('08:40:30');
    env.zoneActive = true;
    env.commands.length = 0;
    const w = await env.run(AL, `${KB} wake`);
    t.equal([w.lightOff, env.state(KB).idle, env.commands], [true, null, []], 'light off — idle cleared, no command');
    t.equal(BULB[KB].map((b) => env.dev(b).onoff.value), [false, false, false], 'K Bord stays off');
  },
};
