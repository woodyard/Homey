// Mock harness for room_heating.js (HomeyScript).
// Usage: node harness.mjs <script.js> <scenario> [--logs]
// Prints a JSON "trace" (commands, notifications, logic writes, final room state, action)
// so two versions of the script can be diffed on identical scenarios.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [,, scriptPath, scenarioName, ...flags] = process.argv;
const SHOW_LOGS = flags.includes('--logs');
// --count-calls: print how often each Homey API read was made (stderr, not part of the trace)
const COUNT_CALLS = flags.includes('--count-calls');
const calls = {};
const count = (name) => { calls[name] = (calls[name] || 0) + 1; };
// --then-status=<file>: after the heating run, run the status script against the same mocks and print its output
const STATUS_SCRIPT = (flags.find(f => f.startsWith('--then-status=')) || '').slice(14) || null;

// ---------------------------------------------------------------- config ---
const CONFIG_SRC = fs.readFileSync(path.join(__dirname, '..', 'room_heating_config.js'), 'utf8');
// Extract ROOMS and GLOBAL_CONFIG object literals from the config script.
function extractObject(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
}
const ROOMS = new Function(`return ${extractObject(CONFIG_SRC, 'ROOMS')}`)();
const GLOBAL_CONFIG = new Function(`return ${extractObject(CONFIG_SRC, 'GLOBAL_CONFIG')}`)();

// ------------------------------------------------------------ fake clock ---
// Fixed "now" so both script versions see the same time. Weekday, 10:00 DK time.
let NOW_MS = new Date('2026-01-21T09:00:00Z').getTime(); // = 10:00 Europe/Copenhagen (CET)
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW_MS); else super(...a); }
  static now() { return NOW_MS; }
}
const fakeSetTimeout = (fn, ms) => { NOW_MS += ms; queueMicrotask(fn); return 0; };

// ---------------------------------------------------------- fake Homey ---
const trace = { commands: [], notifications: [], logicWrites: [], errors: [] };
const logs = [];
const log = (...a) => { logs.push(a.join(' ')); };

const globals = new Map();
const globalApi = {
  get: (k) => (globals.has(k) ? globals.get(k) : null),
  set: (k, v) => { globals.set(k, v); },
};

const Z = {
  clara: '29f983ac-05a3-484b-93e8-809b28bf3917',
  stueParent: '0f707820-c7e7-4e24-b6ed-28f69ae2bca2',
  stue: '2051734f-89b8-441d-a0c0-00e9b4d4bc3a',
  spisestue: '953678a8-4277-4c21-87c0-b4559c5c882d',
  sv: 'a6a116d6-fe57-437c-a2f2-33cea5506a60',
};
const zones = {
  [Z.clara]: { id: Z.clara, name: 'Claras værelse', parent: null, active: true, activeLastUpdated: new RealDate(NOW_MS - 60000).toISOString() },
  [Z.stueParent]: { id: Z.stueParent, name: 'Stue / Spisestue', parent: null, active: true, activeLastUpdated: new RealDate(NOW_MS - 60000).toISOString() },
  [Z.stue]: { id: Z.stue, name: 'Stue', parent: Z.stueParent, active: true, activeLastUpdated: new RealDate(NOW_MS - 60000).toISOString() },
  [Z.spisestue]: { id: Z.spisestue, name: 'Spisestue', parent: Z.stueParent, active: true, activeLastUpdated: new RealDate(NOW_MS - 60000).toISOString() },
  [Z.sv]: { id: Z.sv, name: 'Soveværelse', parent: null, active: true, activeLastUpdated: new RealDate(NOW_MS - 60000).toISOString() },
};

function cap(value, lastUpdatedMs = NOW_MS - 30000) {
  return { value, lastUpdated: new RealDate(lastUpdatedMs).toISOString() };
}
function mkDevice(d) {
  const dev = { ...d, capabilitiesObj: {} };
  for (const [k, v] of Object.entries(d.caps || {})) dev.capabilitiesObj[k] = (v && typeof v === 'object' && 'value' in v) ? v : cap(v);
  delete dev.caps;
  dev.stuck = false; // when true, commands are accepted but the reported value never changes
  dev.setCapabilityValue = async (capability, value) => {
    trace.commands.push({ device: dev.name, capability, value });
    if (dev.stuck) return;
    if (!dev.capabilitiesObj[capability]) dev.capabilitiesObj[capability] = cap(value);
    dev.capabilitiesObj[capability].value = value;
    dev.capabilitiesObj[capability].lastUpdated = new RealDate(NOW_MS).toISOString();
  };
  return dev;
}

const TADO_HOME = 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c';
const TADO_STUE = '2ca14bef-8a28-43cc-af70-0d0611f5281f';
const TADO_SV = '439be454-0e4e-4835-b51c-a83a1d78e9f1';
const devices = {};
function addDevice(d) { devices[d.id] = mkDevice(d); return devices[d.id]; }

addDevice({ id: 'rad1', name: 'C Radiator 1', zone: Z.clara, class: 'socket', virtualClass: 'heater', caps: { onoff: false } });
addDevice({ id: 'rad2', name: 'C Radiator 2', zone: Z.clara, class: 'socket', virtualClass: 'heater', caps: { onoff: false } });
addDevice({ id: 'cmotion', name: 'C Motion', zone: Z.clara, class: 'sensor', caps: { alarm_motion: false, measure_temperature: 21.0 } });
addDevice({ id: 'cwindow', name: 'C Vindue', zone: Z.clara, class: 'sensor', caps: { alarm_contact: false } });
addDevice({ id: TADO_STUE, name: 'Skovgaard / Stue', zone: Z.stueParent, class: 'thermostat',
  caps: { onoff: true, 'onoff.smart_schedule': false, target_temperature: 22, measure_temperature: 21.0, tado_heating_power: 0, tado_presence_mode: 'home' } });
addDevice({ id: 'stwindow', name: 'ST Vindue', zone: Z.stue, class: 'sensor', caps: { alarm_contact: false } });
addDevice({ id: 'stmotion', name: 'ST Motion', zone: Z.stue, class: 'sensor', caps: { alarm_motion: false, measure_temperature: 21.5 } });
addDevice({ id: TADO_SV, name: 'Skovgaard / Soveværelse', zone: Z.sv, class: 'thermostat',
  caps: { onoff: true, 'onoff.smart_schedule': false, target_temperature: 20, measure_temperature: 19.0, tado_heating_power: 0, tado_presence_mode: 'home' } });
addDevice({ id: TADO_HOME, name: 'Skovgaard', zone: 'home', class: 'other', caps: { tado_presence_mode: 'home', tado_is_anyone_home: true } });

const logicVars = { v1: { id: 'v1', name: 'HeatingEnabled', type: 'boolean', value: true } };

const Homey = {
  devices: {
    getDevice: async ({ id }) => { count(`getDevice`); if (!devices[id]) throw new Error(`Device ${id} not found`); return devices[id]; },
    getDevices: async () => { count('getDevices'); return devices; },
  },
  zones: { getZones: async () => { count('getZones'); return zones; } },
  logic: {
    getVariables: async () => { count('getVariables'); return logicVars; },
    updateVariable: async ({ id, variable }) => { trace.logicWrites.push({ op: 'update', id, value: variable.value }); logicVars[id].value = variable.value; },
    createVariable: async ({ variable }) => { trace.logicWrites.push({ op: 'create', name: variable.name, value: variable.value }); logicVars[variable.name] = { id: variable.name, ...variable }; },
  },
  flow: {
    runFlowCardAction: async ({ args }) => { trace.notifications.push(args.text); },
  },
};

// ------------------------------------------------------------ scenarios ---
globalApi.set('Config.Rooms', JSON.stringify(ROOMS));
globalApi.set('Config.Global', JSON.stringify(GLOBAL_CONFIG));

function setState(zone, patch) {
  const key = `${zone}.Heating.State`;
  const base = {
    mode: 'auto', modeExpires: null, modeDetails: {}, away: false, awaySince: null,
    baseline: { commandedTargetTemp: null, lastSeenTargetTemp: null },
    window: { openSince: null, closedSince: null, timeoutHandled: false },
    inactive: false, notification: { lastKey: null, lastTime: 0 },
  };
  const merged = { ...base, ...patch, baseline: { ...base.baseline, ...(patch.baseline || {}) }, window: { ...base.window, ...(patch.window || {}) } };
  globalApi.set(key, JSON.stringify(merged));
}

const CL = 'Claras værelse', ST = 'Stue / Spisestue', SV = 'Soveværelse';
// A zone with no activity for the last `minutes` (default 4 h)
function unused(zoneId, minutes = 240) { zones[zoneId].active = false; zones[zoneId].activeLastUpdated = new RealDate(NOW_MS - minutes * 60000).toISOString(); }
const scenarios = {
  // ---- Clara (smart plugs)
  clara_auto_cold: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; } },
  clara_auto_warm: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 23.5; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, {}); } },
  clara_auto_ok: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  clara_boost_request: { args: ['Clara', 'boost'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; } },
  clara_boost_request_flowarg: { args: ['clara, boost'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; } },
  clara_boost_active: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  // v10.25.0: smart-plug boost stops at 25°C
  clara_boost_window_opened: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; devices.cwindow.capabilitiesObj.alarm_contact.value = true; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  clara_boost_window_closed: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000, window: { openSince: NOW_MS - 600000 } }); } },
  clara_boost_active_hot: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 25.5; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  clara_boost_expired: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { mode: 'boost', modeExpires: NOW_MS - 1000 }); } },
  clara_pause_request: { args: ['Clara', 'pause'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; } },
  clara_pause_active: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { mode: 'pause', modeExpires: NOW_MS + 20 * 60000 }); } },
  clara_pause_expired: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { mode: 'pause', modeExpires: NOW_MS - 1000 }); } },
  clara_pause_over_boost: { args: ['Clara', 'pause'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  clara_cancel_boost: { args: ['Clara', 'cancel'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  clara_cancel_nothing: { args: ['Clara', 'cancel'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  clara_window_open_new: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices.cwindow.capabilitiesObj.alarm_contact.value = true; setState(CL, {}); } },
  clara_window_open_timeout: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices.cwindow.capabilitiesObj.alarm_contact.value = true; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { window: { openSince: NOW_MS - 120000 } }); } },
  clara_window_closed_long: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { openSince: NOW_MS - 300000, timeoutHandled: true } }); } },
  clara_window_closed_brief: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { openSince: NOW_MS - 20000 } }); } },
  clara_settle_waiting: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { closedSince: NOW_MS - 5 * 60000 } }); } },
  clara_settle_15min: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { closedSince: NOW_MS - 15 * 60000 } }); } },
  clara_settle_done: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { closedSince: NOW_MS - 61 * 60000 } }); } },
  clara_inactive: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.5; zones[Z.clara].active = false; zones[Z.clara].activeLastUpdated = new RealDate(NOW_MS - 45 * 60000).toISOString(); setState(CL, {}); } },
  clara_inactive_already: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.5; zones[Z.clara].active = false; zones[Z.clara].activeLastUpdated = new RealDate(NOW_MS - 45 * 60000).toISOString(); setState(CL, { inactive: true }); } },
  clara_active_again: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.5; setState(CL, { inactive: true }); } },
  clara_away_enter: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, {}); unused(Z.clara); } },
  clara_away_steady: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 18.0; devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; setState(CL, { away: true, awaySince: NOW_MS - 3600000 }); unused(Z.clara); } },
  clara_away_return: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 18.0; setState(CL, { away: true, awaySince: NOW_MS - 3600000 }); } },
  clara_disabled: { args: ['Clara'], setup: () => { logicVars.v1.value = false; } },
  clara_slot_change: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, { schedule: { lastTarget: 20, lastSlotName: 'Night' } }); } },
  clara_notif_dedup: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { notification: { lastKey: 'Heat on', lastTime: NOW_MS - 5 * 60000 } }); } },
  // Holiday today via the SchoolHoliday Logic variable
  clara_holiday: { args: ['Clara'], setup: () => { logicVars.v3 = { id: 'v3', name: 'SchoolHoliday', type: 'boolean', value: true }; devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  // Holiday today from the config ranges (efterårsferie 2026-10-14, a Wednesday)
  clara_holiday_range: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2026-10-14T08:00:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  // Computed public holiday (Langfredag 2027-03-26 falls inside påskeferie; use 2. pinsedag 2027-05-17, a Monday)
  clara_public_holiday: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2027-05-17T08:00:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  // Evening before a weekday public holiday (Wed 2027-05-05 20:30 DK; Thu = Kristi himmelfart) -> late evening slot
  clara_evening_before_holiday: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2027-05-05T18:30:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  clara_evening: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2026-01-21T19:30:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  clara_evening_weekend_tomorrow: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2026-01-23T19:30:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  clara_weekend: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2026-01-24T09:00:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; setState(CL, {}); } },
  unknown_room: { args: ['Kitchen'], setup: () => {} },
  // Run lock (v10.19.0+): another session holds the lock
  clara_run_lock_busy: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; globalApi.set(`${CL}.Heating.RunLock`, JSON.stringify({ sessionId: 'session_other', startedAt: NOW_MS - 10000 })); setState(CL, {}); } },
  clara_run_lock_stale: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; globalApi.set(`${CL}.Heating.RunLock`, JSON.stringify({ sessionId: 'session_other', startedAt: NOW_MS - 300000 })); setState(CL, {}); } },
  // Another room is publishing HeatingStatus: wait for its lock, take it once stale (v10.25.0+)
  clara_status_lock_busy: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; globalApi.set('HeatingStatus.Lock', JSON.stringify({ sessionId: 'session_other', startedAt: NOW_MS - 5000 })); } },
  clara_boost_waits_for_lock: { args: ['Clara', 'boost'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; globalApi.set(`${CL}.Heating.RunLock`, JSON.stringify({ sessionId: 'session_other', startedAt: NOW_MS - 10000 })); setState(CL, {}); } },
  // Verification never succeeds (device accepts command but keeps reporting the old value)
  clara_verify_timeout: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; devices.rad1.stuck = true; setState(CL, {}); } },
  stue_verify_timeout: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 20; devices[TADO_STUE].stuck = true; setState(ST, { baseline: { commandedTargetTemp: 20, lastSeenTargetTemp: 20 } }); } },
  // v10.20.0+ TADO detection model: manual = target changed since last run AND not what was commanded
  stue_slow_device: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 21; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 21 } }); } },
  stue_knob_turned: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_knob_turned_while_slow: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 21 } }); } },
  stue_tado_schedule_resumed: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 20; devices[TADO_STUE].capabilitiesObj['onoff.smart_schedule'].value = true; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_first_run_no_lastseen: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: null } }); } },
  stue_no_reference: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, {}); } },
  stue_knob_while_away: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 19; setState(ST, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); unused(Z.stueParent); } },
  stue_home_return_tado_adjusted: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 20; setState(ST, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); } },
  // Fixed settle delay (v10.21.0+, config 1800s): 31 min settles, 15 min still waits regardless of stability
  clara_settle_31min: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 20.0; setState(CL, { window: { closedSince: NOW_MS - 31 * 60000 } }); } },
  // Settle delay over, but plugs already in the correct state (nothing to send)
  clara_settle_already_correct: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 23.0; setState(CL, { window: { closedSince: NOW_MS - 15 * 60000 } }); } },
  clara_plug_flipped_by_hand: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 23.0; devices.rad1.capabilitiesObj.onoff.value = true; setState(CL, {}); } },
  // TADO applied an earlier command late: the valve now matches the last command, not what was seen last run
  stue_delayed_verify: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 21; setState(ST, { baseline: { commandedTargetTemp: 21, lastSeenTargetTemp: 22 } }); } },

  // ---- Stue (TADO valve)
  stue_auto_ok: { args: ['Stue'], setup: () => { setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_auto_no_baseline: { args: ['Stue'], setup: () => {} },
  stue_auto_target_change: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 20; setState(ST, { baseline: { commandedTargetTemp: 20, lastSeenTargetTemp: 20 } }); } },
  stue_auto_off: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_manual_active: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { mode: 'manual', modeExpires: NOW_MS + 30 * 60000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  stue_manual_smart_schedule_exit: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; devices[TADO_STUE].capabilitiesObj['onoff.smart_schedule'].value = true; setState(ST, { mode: 'manual', modeExpires: NOW_MS + 30 * 60000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  stue_manual_expired: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { mode: 'manual', modeExpires: NOW_MS - 1000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  stue_boost_request: { args: ['Stue', 'boost'], setup: () => { setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_boost_active: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 25; setState(ST, { mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); } },
  stue_boost_expired: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 25; setState(ST, { mode: 'boost', modeExpires: NOW_MS - 1000 }); } },
  stue_pause_request: { args: ['Stue', 'pause'], setup: () => { setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_pause_active: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { mode: 'pause', modeExpires: NOW_MS + 20 * 60000 }); } },
  stue_pause_expired: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { mode: 'pause', modeExpires: NOW_MS - 1000 }); } },
  stue_cancel_manual: { args: ['Stue', 'cancel'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { mode: 'manual', modeExpires: NOW_MS + 30 * 60000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  stue_boost_over_pause: { args: ['Stue', 'boost'], setup: () => { devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { mode: 'pause', modeExpires: NOW_MS + 20 * 60000 }); } },
  stue_window_open_timeout: { args: ['Stue'], setup: () => { devices.stwindow.capabilitiesObj.alarm_contact.value = true; setState(ST, { window: { openSince: NOW_MS - 120000 }, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_window_still_open: { args: ['Stue'], setup: () => { devices.stwindow.capabilitiesObj.alarm_contact.value = true; devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { window: { openSince: NOW_MS - 600000, timeoutHandled: true } }); } },
  stue_settle_waiting: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.onoff.value = false; setState(ST, { window: { closedSince: NOW_MS - 15 * 60000 } }); } },
  stue_inactive: { args: ['Stue'], setup: () => { zones[Z.stueParent].active = false; zones[Z.stueParent].activeLastUpdated = new RealDate(NOW_MS - 100 * 60000).toISOString(); setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_away_enter: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); unused(Z.stueParent); } },
  stue_away_steady: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 17; setState(ST, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); unused(Z.stueParent); } },
  stue_away_return: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 17; setState(ST, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); } },
  stue_evening: { args: ['Stue'], setup: () => { NOW_MS = new RealDate('2026-01-21T21:30:00Z').getTime(); setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_morning: { args: ['Stue'], setup: () => { NOW_MS = new RealDate('2026-01-21T05:00:00Z').getTime(); setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_debug_mode: { args: ['Stue'], setup: () => { logicVars.v2 = { id: 'v2', name: 'HeatingDebugMode', type: 'boolean', value: true }; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_no_temp: { args: ['Stue'], setup: () => { delete devices[TADO_STUE].capabilitiesObj.measure_temperature; delete devices.stmotion.capabilitiesObj.measure_temperature; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  // v10.25.0: inactivity evaluated once per run; effective target uses the slot's effective offset
  stue_manual_active_inactive: { args: ['Stue'], setup: () => { zones[Z.stueParent].active = false; zones[Z.stueParent].activeLastUpdated = new RealDate(NOW_MS - 100 * 60000).toISOString(); devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { inactive: true, mode: 'manual', modeExpires: NOW_MS + 30 * 60000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  stue_inactive_room_default: { args: ['Stue'], setup: () => { NOW_MS = new RealDate('2026-01-21T02:00:00Z').getTime(); zones[Z.stueParent].active = false; zones[Z.stueParent].activeLastUpdated = new RealDate(NOW_MS - 100 * 60000).toISOString(); const r = JSON.parse(globalApi.get('Config.Rooms')); r.Stue.settings.inactivityOffset = 2; globalApi.set('Config.Rooms', JSON.stringify(r)); devices[TADO_STUE].capabilitiesObj.target_temperature.value = 21; setState(ST, { baseline: { commandedTargetTemp: 21, lastSeenTargetTemp: 21 } }); } },
  stue_boost_active_away: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 25; setState(ST, { away: true, awaySince: NOW_MS - 3600000, mode: 'boost', modeExpires: NOW_MS + 20 * 60000 }); unused(Z.stueParent); } },
  stue_manual_expired_inactive: { args: ['Stue'], setup: () => { zones[Z.stueParent].active = false; zones[Z.stueParent].activeLastUpdated = new RealDate(NOW_MS - 100 * 60000).toISOString(); devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { mode: 'manual', modeExpires: NOW_MS - 1000, modeDetails: { type: 'temperature', originalValue: 22 } }); } },
  // v10.25.0: routine changes (heat on/off, schedule, inactivity) notify only with notifyRoutineChanges
  clara_notify_routine: { args: ['Clara'], setup: () => { const g = JSON.parse(globalApi.get('Config.Global')); g.notifyRoutineChanges = true; globalApi.set('Config.Global', JSON.stringify(g)); devices.cmotion.capabilitiesObj.measure_temperature.value = 15.0; } },
  // v10.25.0: reminder when the school holiday list ends within 30 days (last range ends 2027-08-08), once a week
  clara_holiday_list_ending: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2027-07-20T08:00:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; } },
  clara_holiday_list_reminded: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2027-07-20T08:00:00Z').getTime(); devices.cmotion.capabilitiesObj.measure_temperature.value = 22.0; globalApi.set('Heating.HolidayListReminder', JSON.stringify({ lastEnd: '2027-08-08', sentAt: NOW_MS - 86400000 })); } },
  // v10.26.0: activity in the room overrides TADO away; the room falls back to away once unused
  stue_away_room_in_use: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; setState(ST, { tadoAway: true, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_away_recent_activity: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; unused(Z.stueParent, 45); setState(ST, { tadoAway: true, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_away_activity_returns: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 17; setState(ST, { away: true, tadoAway: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); } },
  stue_away_unused_again: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; unused(Z.stueParent, 95); setState(ST, { tadoAway: true, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_knob_while_away_in_use: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { tadoAway: true, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  stue_away_starts_in_use: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; setState(ST, { baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  clara_away_room_in_use: { args: ['Clara'], setup: () => { NOW_MS = new RealDate('2026-01-24T19:00:00Z').getTime(); devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices.cmotion.capabilitiesObj.measure_temperature.value = 20.5; setState(CL, { tadoAway: true }); } },
  // state saved before 10.26 ('away' meant TADO presence, no tadoAway field): tadoAway is taken from it, so the
  // baseline is kept and a knob turned in a room in use during TADO away is still detected as manual
  stue_away_legacy_state: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 23.5; setState(ST, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); const k = ST + '.Heating.State'; const st = JSON.parse(globalApi.get(k)); delete st.tadoAway; globalApi.set(k, JSON.stringify(st)); } },
  // review fixes: a longer timeout in the next slot is not activity (Soveværelse 07:05, away since 06:50, last activity 06:20)
  sv_away_slot_boundary: { args: ['Soveværelse'], setup: () => { NOW_MS = new RealDate('2026-01-21T06:05:00Z').getTime(); devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_SV].capabilitiesObj.target_temperature.value = 15; unused(Z.sv, 45); setState(SV, { away: true, tadoAway: true, awaySince: NOW_MS - 15 * 60000, baseline: { commandedTargetTemp: 15, lastSeenTargetTemp: 15 } }); } },
  // real activity after away started (zone went active and inactive between runs) pauses away
  stue_away_activity_between_runs: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 17; unused(Z.stueParent, 10); setState(ST, { away: true, tadoAway: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); } },
  // after a pause in this TADO away period, going back to away is routine (no notification)
  stue_away_reentry_after_pause: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; unused(Z.stueParent, 95); setState(ST, { tadoAway: true, awayPaused: true, baseline: { commandedTargetTemp: 22, lastSeenTargetTemp: 22 } }); } },
  // activity in an away room with the window open past its timeout: the valve stays off
  stue_away_activity_window_open: { args: ['Stue'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices.stwindow.capabilitiesObj.alarm_contact.value = true; devices[TADO_STUE].capabilitiesObj.onoff.value = false; devices[TADO_STUE].capabilitiesObj.target_temperature.value = 17; setState(ST, { away: true, tadoAway: true, awaySince: NOW_MS - 3600000, window: { openSince: NOW_MS - 1200000, timeoutHandled: true }, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); } },
  // a radiator switched on by hand while the window is open past its timeout is switched off
  clara_window_open_plug_on: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 15.0; devices.cwindow.capabilitiesObj.alarm_contact.value = true; devices.rad1.capabilitiesObj.onoff.value = true; setState(CL, { window: { openSince: NOW_MS - 1200000, timeoutHandled: true } }); } },
  // v10.24.0: away never raises a target (Soveværelse Night is 15, away temperature 17)
  sv_away_night: { args: ['Soveværelse'], setup: () => { NOW_MS = new RealDate('2026-01-21T02:00:00Z').getTime(); devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; devices[TADO_SV].capabilitiesObj.target_temperature.value = 17; setState(SV, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 17, lastSeenTargetTemp: 17 } }); unused(Z.sv); } },
  sv_away_day: { args: ['Soveværelse'], setup: () => { devices[TADO_HOME].capabilitiesObj.tado_presence_mode.value = 'away'; setState(SV, { away: true, awaySince: NOW_MS - 3600000, baseline: { commandedTargetTemp: 20, lastSeenTargetTemp: 20 } }); unused(Z.sv); } },
  // v10.25.1: a sensor counts as silent only when the heating has been on for the whole limit (60 min) without a report;
  // smart plugs are then kept off until it reports; TADO rooms only notify
  clara_sensor_stale: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature = cap(15.0, NOW_MS - 90 * 60000); devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { heatingSince: NOW_MS - 70 * 60000 }); } },
  clara_sensor_stale_heating_short: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature = cap(15.0, NOW_MS - 90 * 60000); devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { heatingSince: NOW_MS - 20 * 60000 }); } },
  clara_sensor_steady_heat_off: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature = cap(22.0, NOW_MS - 180 * 60000); } },
  clara_sensor_stale_already: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature = cap(15.0, NOW_MS - 120 * 60000); devices.rad1.capabilitiesObj.onoff.value = true; devices.rad2.capabilitiesObj.onoff.value = true; setState(CL, { heatingSince: NOW_MS - 100 * 60000, sensorStaleSince: NOW_MS - 30 * 60000 }); } },
  clara_sensor_recovered: { args: ['Clara'], setup: () => { devices.cmotion.capabilitiesObj.measure_temperature.value = 15.0; setState(CL, { sensorStaleSince: NOW_MS - 30 * 60000 }); } },
  stue_sensor_stale: { args: ['Stue'], setup: () => { devices[TADO_STUE].capabilitiesObj.target_temperature.value = 20; devices[TADO_STUE].capabilitiesObj.tado_heating_power.value = 40; devices[TADO_STUE].capabilitiesObj.measure_temperature = cap(21.0, NOW_MS - 90 * 60000); setState(ST, { heatingSince: NOW_MS - 70 * 60000, baseline: { commandedTargetTemp: 20, lastSeenTargetTemp: 20 } }); } },
};

if (!scenarios[scenarioName]) { console.error('Unknown scenario. Available:\n' + Object.keys(scenarios).join('\n')); process.exit(2); }
const sc = scenarios[scenarioName];
const SETUP_NOW_MS = NOW_MS;
sc.setup();
// A scenario that moves the clock should not make every sensor look hours old:
// default capability timestamps (30 s before the original clock) follow the clock.
if (NOW_MS !== SETUP_NOW_MS) {
  const defaultStamp = new RealDate(SETUP_NOW_MS - 30000).toISOString();
  for (const d of Object.values(devices)) for (const c of Object.values(d.capabilitiesObj)) {
    if (c.lastUpdated === defaultStamp) c.lastUpdated = new RealDate(NOW_MS - 30000).toISOString();
  }
}

// ------------------------------------------------------------- run script ---
const src = fs.readFileSync(scriptPath, 'utf8');
const wrapped = `return (async function(Homey, global, log, args, setTimeout, Date) {\n${src}\n})`;
const factory = new Function(wrapped)();
let thrown = null;
try {
  await factory(Homey, globalApi, log, sc.args, fakeSetTimeout, FakeDate);
} catch (e) {
  thrown = e.message;
}

// ---------------------------------------------------------------- output ---
const zoneName = { clara: CL, 'soveværelse': SV }[sc.args[0].split(',')[0].trim().toLowerCase()] || ST;
const finalGlobals = {};
for (const [k, v] of [...globals.entries()].sort()) {
  if (k.startsWith('Config.')) continue;
  if (k.endsWith('.Heating.State')) { finalGlobals[k] = JSON.parse(v); continue; }
  if (k.endsWith('DiagnostikLog')) { finalGlobals[k] = v.trim().split('\n').map(l => l.split('|').slice(1).join('|')); continue; }
  if (k === 'HeatingStatus.Lock') { if (v !== null && !JSON.parse(v).sessionId.includes('other')) finalGlobals.statusLockLeaked = true; continue; }
  if (k.endsWith('.Heating.RunLock')) { if (v !== null && JSON.parse(v).sessionId.startsWith('session_') && !JSON.parse(v).sessionId.includes('other')) finalGlobals.lockLeaked = true; continue; }
  finalGlobals[k] = v;
}
const deviceState = {};
for (const d of Object.values(devices)) {
  const s = {};
  for (const c of ['onoff', 'target_temperature']) if (d.capabilitiesObj[c]) s[c] = d.capabilitiesObj[c].value;
  if (Object.keys(s).length) deviceState[d.name] = s;
}
const out = { scenario: scenarioName, thrown, commands: trace.commands, notifications: trace.notifications, logicWrites: trace.logicWrites.map(w => ({ ...w, value: w.value ? JSON.parse(w.value) : undefined })), deviceState, globals: finalGlobals };
// Strip volatile timestamps from state for diffing (keep presence, not value)
const state = out.globals[`${zoneName}.Heating.State`];
if (state) {
  for (const k of ['awaySince']) if (state[k]) state[k] = 'T';
  if (state.modeExpires) state.modeExpires = Math.round((state.modeExpires - NOW_MS) / 60000) + 'min';
  for (const k of ['openSince', 'closedSince']) if (state.window[k]) state.window[k] = 'T';
  if (state.notification?.lastTime) state.notification.lastTime = 'T';
}
for (const w of out.logicWrites) if (w.value) for (const r of Object.values(w.value)) {
  delete r.updatedAt;
  for (const k of ['modeExpires', 'windowOpenSince', 'windowClosedSince']) if (r[k]) r[k] = 'T';
}
console.log(JSON.stringify(out, null, 2));
if (COUNT_CALLS) console.error(JSON.stringify(calls));
if (SHOW_LOGS) { console.log('\n----- LOGS -----'); console.log(logs.join('\n')); }
if (STATUS_SCRIPT) {
  const statusLogs = [];
  const statusSrc = fs.readFileSync(STATUS_SCRIPT, 'utf8');
  const statusFactory = new Function(`return (async function(Homey, global, log, args, setTimeout, Date) {\n${statusSrc}\n})`)();
  let statusThrown = null;
  try { await statusFactory(Homey, globalApi, (...a) => statusLogs.push(a.join(' ')), [], fakeSetTimeout, FakeDate); }
  catch (e) { statusThrown = e.stack || e.message; }
  console.log('\n----- STATUS SCRIPT -----');
  if (statusThrown) console.log('THROWN: ' + statusThrown);
  console.log(statusLogs.join('\n'));
}
