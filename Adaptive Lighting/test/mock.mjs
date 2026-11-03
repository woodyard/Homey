// Offline mocks for running the Adaptive Lighting HomeyScripts under Node.
//
// A script file is run the way HomeyScript runs it: its body inside an async
// function with the globals args, Homey, global, log and wait. setTimeout and
// setInterval are shadowed with functions that throw, because HomeyScript has
// neither (that bug crashed three scripts in 2026).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const RealDate = Date;

// Directory the scripts are loaded from — run.mjs --scripts=<dir> points it at
// another copy (e.g. a baseline version)
let scriptDir = path.resolve(HERE, '..');
export function setScriptDir(dir) { scriptDir = path.resolve(dir); sourceCache.clear(); }
export function scriptPath(name) { return path.join(scriptDir, name); }
export function scriptFiles() { return fs.readdirSync(scriptDir).filter((f) => f.endsWith('.js')).sort(); }

// Line endings as LF: a Windows checkout (core.autocrlf) has CRLF, and the
// tests' { patch } targets are written with \n
const sourceCache = new Map();
function source(name) {
  if (!sourceCache.has(name)) sourceCache.set(name, fs.readFileSync(scriptPath(name), 'utf8').replace(/\r\n/g, '\n'));
  return sourceCache.get(name);
}

// ---- clock: every new Date() / Date.now() inside the scripts reads this ----
let now = RealDate.now();
class FakeDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
}
// ISO with offset, e.g. '2026-10-27T12:00:00+01:00' (Copenhagen winter time)
export function setClock(iso) { now = new RealDate(iso).getTime(); }
export function advance(ms) { now += ms; }
export function clock() { return now; }
export function installClock() { globalThis.Date = FakeDate; }
export function restoreClock() { globalThis.Date = RealDate; }

const homeyScriptMissing = (name) => () => { throw new Error(`${name} is not defined (HomeyScript has no ${name})`); };

// ---- devices ----
// A light whose capability values change when commands reach it.
// hue: true adds button.migrate_v3, which the scripts use to tell single Hue
// bulbs from Homey groups
// driver: sets driverId as Homey reports it, e.g. 'homey:app:nl.philips.hue:bulb'
// or 'homey:virtualdrivergroup:driver' (without it the scripts fall back to
// button.migrate_v3)
export const HUE_DRIVER = 'homey:app:nl.philips.hue:bulb';
export const GROUP_DRIVER = 'homey:virtualdrivergroup:driver';
export function light(id, name, { on = true, dim = 0.5, temp = 0.5, hue = true, zone = 'zone', noTemp = false, driver = null } = {}) {
  const capabilitiesObj = { onoff: { value: on }, dim: { value: dim } };
  if (!noTemp) capabilitiesObj.light_temperature = { value: temp };
  const capabilities = Object.keys(capabilitiesObj).concat(hue ? ['button.migrate_v3'] : []);
  return { id, name, class: 'light', zone, capabilities, capabilitiesObj, ...(driver ? { driverId: driver } : {}) };
}

export function motionSensor(id, name, { motion = false, lastChanged = null } = {}) {
  return {
    id, name, class: 'sensor', zone: 'zone', capabilities: ['alarm_motion'],
    capabilitiesObj: { alarm_motion: { value: motion, lastChanged: lastChanged || new RealDate(now).toISOString() } },
  };
}

// A door contact (alarm_contact true = open), e.g. E9 Dør
export function contactSensor(id, name, { open = false, lastChanged = null } = {}) {
  return {
    id, name, class: 'sensor', zone: 'zone', capabilities: ['alarm_contact'],
    capabilitiesObj: { alarm_contact: { value: open, lastChanged: lastChanged || new RealDate(now).toISOString() } },
  };
}

export function luxSensor(id, name, lux) {
  return { id, name, class: 'sensor', zone: 'zone', capabilities: ['measure_luminance'], capabilitiesObj: { measure_luminance: { value: lux } } };
}

// ---- environment: one Homey + one global store, shared by every script run ----
export function createEnv(devices = []) {
  const env = {
    devices: {},
    store: new Map(),
    vars: {},              // Logic variables by id
    logicCalls: [],        // 'get' | 'update' | 'create', in order
    commands: [],          // device commands, e.g. 'K Bord dim=1'
    cards: [],             // dim/temperature flow cards: { id, card, value, duration }
                           // (their values also land in commands)
    unreachable: new Set(),// device ids whose commands throw
    zoneActive: false,
    failLogicUpdate: false,
    createDelayMs: 0,      // > 0 makes createVariable slow, so parallel runs overlap
    deviceListDelayMs: 0,  // > 0: getDevices (the slow call on a busy Homey) answers
                           // after this many real ms, and getDevice/getDevices return
                           // copies of the devices as they were when asked, as
                           // Homey's API does — two runs for one light then overlap
    dimCardSetsOnoff: false, // true: a dim card sets onoff (dim > 0), as Homey does at a fade start
    commandDelayMs: 0,     // > 0: a device command lands (value changes) this many
                           // real ms after it is sent, as on a real bulb
    waitAdvancesClock: false, // true: wait(ms) moves the clock forward by ms
    onWait: null,          // async (ms) => {} called on every wait() — lets a test
                           // make something happen during a fade (motion, a restore)
    logs: [],
  };
  for (const d of devices) env.devices[d.id] = d;

  const setCap = async (deviceId, cap, value) => {
    const d = env.devices[deviceId];
    if (!d) throw new Error(`Not Found: Device with ID ${deviceId}`);
    if (env.unreachable.has(deviceId)) throw new Error(`${d.name} unreachable`);
    if (!d.capabilitiesObj[cap]) throw new Error(`${d.name} has no ${cap}`);
    if (env.commandDelayMs) await new Promise((r) => setTimeout(r, env.commandDelayMs));
    d.capabilitiesObj[cap].value = value;
    env.commands.push(`${d.name} ${cap}=${value}`);
  };
  // getDevice returns the live object, with setCapabilityValue bound to it
  const withMethods = (d) => {
    if (!d.setCapabilityValue) d.setCapabilityValue = (cap, value) => setCap(d.id, cap, value);
    return d;
  };
  // With deviceListDelayMs: the device as it is now; its commands still reach the live device
  const snapshot = (d) => ({
    ...d,
    capabilities: [...d.capabilities],
    capabilitiesObj: JSON.parse(JSON.stringify(d.capabilitiesObj)),
    setCapabilityValue: (cap, value) => setCap(d.id, cap, value),
  });

  // set(key, undefined) removes the key; env.emptiedStaysListed = true makes it
  // stay listed with value null instead (HomeyScript may keep emptied keys)
  env.emptiedStaysListed = false;
  env.global = {
    get: (k) => (env.store.has(k) ? env.store.get(k) : null),
    set: (k, v) => {
      if (v !== undefined) env.store.set(k, v);
      else if (env.emptiedStaysListed) env.store.set(k, null);
      else env.store.delete(k);
    },
    keys: () => [...env.store.keys()],
  };

  env.Homey = {
    devices: {
      getDevice: async ({ id }) => {
        const d = env.devices[id];
        if (!d) throw new Error(`Not Found: Device with ID ${id}`);
        return env.deviceListDelayMs ? snapshot(d) : withMethods(d);
      },
      getDevices: async () => {
        if (env.deviceListDelayMs) {
          const copies = Object.fromEntries(Object.entries(env.devices).map(([id, d]) => [id, snapshot(d)]));
          await new Promise((r) => setTimeout(r, env.deviceListDelayMs));
          return copies;
        }
        for (const d of Object.values(env.devices)) withMethods(d);
        return env.devices;
      },
      setCapabilityValue: async ({ deviceId, capabilityId, value }) => setCap(deviceId, capabilityId, value),
    },
    flow: {
      // Device dim/temperature cards (with duration) and the notification card
      runFlowCardAction: async (a) => {
        const m = /^homey:device:([^:]+):(dim|temperature)$/.exec(a.id || '');
        if (!m) return;
        const [, id, card] = m;
        env.cards.push({ id, card, value: card === 'dim' ? a.args.dim : a.args.temperature, duration: a.duration });
        if (env.unreachable.has(id)) throw new Error('unreachable');
        if (card === 'dim') {
          await setCap(id, 'dim', a.args.dim);
          // With dimCardSetsOnoff, as on Homey: the dim card switches the light
          // on, and a dim to 0 (a fade) reports it off at once (insights, 3 Nov).
          // A Hue bulb then often reports itself on again mid-fade — off by
          // default, which is that later state
          const onoff = env.devices[id].capabilitiesObj.onoff;
          if (env.dimCardSetsOnoff && onoff) onoff.value = a.args.dim > 0;
        } else await setCap(id, 'light_temperature', a.args.temperature);
      },
    },
    zones: { getZone: async ({ id }) => ({ id, active: env.zoneActive }) },
    geolocation: { getOptionLocation: async () => ({}) }, // AL falls back to its NOAA sun times
    notifications: { createNotification: async () => {} },
    logic: {
      getVariables: async () => { env.logicCalls.push('get'); return JSON.parse(JSON.stringify(env.vars)); },
      updateVariable: async ({ id, variable }) => {
        env.logicCalls.push('update');
        if (env.failLogicUpdate) throw new Error('Homey busy');
        if (!env.vars[id]) throw new Error('Not Found');
        Object.assign(env.vars[id], variable);
      },
      createVariable: async ({ variable }) => {
        env.logicCalls.push('create');
        if (env.createDelayMs) await new Promise((r) => setTimeout(r, env.createDelayMs));
        const id = `var-${Object.keys(env.vars).length + 1}`;
        env.vars[id] = { id, ...variable };
        return env.vars[id];
      },
    },
  };

  // Run one script file with one argument, as a flow's "Run script with argument"
  // card does. opts.patch: [[from, to], ...] text replacements in the source
  // (e.g. switch a setting on); a missing `from` is an error, not a silent no-op
  env.run = (script, arg, opts = {}) => {
    let src = source(script);
    for (const [from, to] of opts.patch || []) {
      if (!src.includes(from)) throw new Error(`patch target not found in ${script}: ${from}`);
      src = src.replace(from, to);
    }
    const fn = new AsyncFunction('args', 'Homey', 'global', 'log', 'wait', 'setTimeout', 'setInterval', src);
    const wait = async (ms) => {
      if (env.waitAdvancesClock) advance(ms);
      if (env.onWait) await env.onWait(ms);
    };
    return fn(arg, env.Homey, env.global, (...a) => env.logs.push(a.join(' ')), wait,
      homeyScriptMissing('setTimeout'), homeyScriptMissing('setInterval'));
  };

  // ---- inspection helpers ----
  env.state = (deviceId) => JSON.parse(env.store.get(`AL_Device_${deviceId.slice(0, 8)}.State`) || 'null');
  // Store an AL device state without running AdaptiveLighting, e.g.
  // { lastApplied: { at, brightness, via: 'normal' }, busy: { token: until } }
  env.setState = (deviceId, state) => env.store.set(`AL_Device_${deviceId.slice(0, 8)}.State`, JSON.stringify(state));
  env.diag = () => (env.store.get('AL_DiagnostikLog') || '').split('\n').filter(Boolean);
  env.status = () => {
    const v = Object.values(env.vars).find((x) => x.name === 'AdaptiveLightingStatus');
    return v ? JSON.parse(v.value) : null;
  };
  env.dev = (id) => env.devices[id].capabilitiesObj;
  return env;
}

// Device ids used by the scripts' own configuration
export const ID = {
  ST_LOFT: 'fd754abf-4397-45f5-9a68-98d7f079fd7b',
  ST_STANDERLAMPE: '3f4e2391-3be6-44ee-b340-fcc3219853b2',
  ST_MOTION: 'b88fc1cd-cd4f-447e-960b-03fb51951ca4',
  SV_LOFT: 'cbbd7c60-dc84-43c7-8f0f-790556fc9b14',
  SS_LOFT: '18b6f5bf-1666-4bf1-92be-d9cb7e6b74c5',
  K_BORD: '0e5d845d-d8ea-4db6-8096-663b0a311e07',
  K_LOFT: 'f097b38c-cfb0-4b83-8124-59e35f82cd0f',
  O_LOFT: '1e87af68-506e-4c86-8bc9-ffc6a05f3ef0',
  C_LOFT: '9b15cb64-bf61-494d-be49-f3dcd9dfd0bf',
  C_LIGHTSTRIP: '5acaab17-7864-4831-b6e2-72bd35588b21',
  B9_LYS: 'b8591f4d-a493-4de7-9745-c13cd07e033c',
  B7_LYS: '1ab9ca1f-60ca-44f9-8221-a03e10f005bf',
  E9_LOFT: '2656f184-8c87-4434-95a2-fdb3fc36bdd8',
  E9_GARDEROBE: 'e339c184-ea11-4413-bd90-dac726861fd0',
};
