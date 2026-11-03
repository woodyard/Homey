// Room Watchdog - Safety net for lights stuck on after idle timeout
// Description: Periodically checks if lights are stuck on while room is idle.
//              If idle longer than the room's InactivitySeconds, triggers fade to off.
//              Catches cases where the normal zone-inactive → countdown → fade chain fails.
//              A light switched on while nobody is seen (switch, app, voice) gets
//              15 minutes from the turn-on — the zone never went inactive, so
//              only the watchdog turns it off. A light that keeps coming back
//              on with nobody seen is faded at most 30 minutes after the first
//              such turn-on; one back on right after an automatic off (a
//              flip-back) gets the room's normal timeout.
//
// Usage: Pass room name as argument (e.g. "B9" or "E9")
//        Each room's config (devices, sensors, variables) is defined below.
//
// Setup: Create a Homey flow per room:
//        Trigger:   "Every 1 minute"
//        Condition: zone "all lights are off" (inverted) — some light is on
//        Action:    Run HomeyScript "Room_Watchdog" with argument "B9"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 2.18 2026-11-03  Motion at fade end: restore even when onoff reads off (as
//                  GradualFadeOut 6.19)
//                  - 2.15 left a light that read off alone, as "switched off by
//                    hand". But Homey sets onoff false the moment a dim-to-0
//                    fade starts, so someone who came in could be left at ~0 %
//                  - An off by hand during the fade with motion in the room
//                    now comes back on; press off once more
// 2.17 2026-11-03  A light switched on while nobody is seen gets 15 minutes
//                  - B9, 3 Nov: the Hue dimmer switch turned B9 Lys on at
//                    07:23:24; neither motion sensor had changed since
//                    06:51:41, so the 07:24:00 run logged idle=1939s and faded
//                    the light 36 s after it came on. The person was first seen
//                    at 07:26:13
//                  - Turn-on time: AdaptiveLighting's lastApplied.at when via is
//                    "normal" (B7/B9/E9 run AL only from "turned on") and it is
//                    at most a minute ahead; else unknown. Not onoff.lastChanged
//                    (probably not in HomeyScript's capabilitiesObj) nor
//                    lastUpdated (moves on every same-value report). While AL's
//                    turn-on run holds its lease → decide next minute. A lease
//                    more than 65 s ahead (AL's run 60 s) is ignored: a clock
//                    step or a corrupt state must not block the fade for good
//                  - Idle counts from the latest of the last motion, the turn-on
//                    and (E9) the door's last change
//                  - Seen: turn-on unknown (exactly as 2.16), a motion change
//                    from SEEN_BEFORE_ON (60 s) before the turn-on, or in E9 the
//                    door (E9 Dør) changing then (read only when motion hasn't
//                    seen anyone). A door that can't be read or has no change
//                    time is not seen (WATCHDOG-ERROR naming it, at most every
//                    10 min)
//                  - Not seen: no fade before UNSEEN_MIN_ON (900 s) after the
//                    turn-on (less only under the flapping cap); one
//                    WATCHDOG-UNSEEN line per turn-on, and WATCHDOG-FADE says
//                    "(nobody seen since on)". Seen later → the room's
//                    threshold from that motion, as before
//                  - Flapping cap: a light that keeps coming back on while
//                    nobody is seen is faded at the latest UNSEEN_MAX_HOLD
//                    (1800 s) after the first unseen turn-on of the stretch. A
//                    turn-on continues the stretch only with the same last
//                    motion (E9: door untouched), no automatic off in between,
//                    and within the 1800 s; else it starts a new stretch with
//                    its full 900 s (a night visit faded at 03:15 must not cut
//                    the 07:23 one short). One record per room
//                    (AL_WatchdogUnseen_<room>), written only when it changes
//                  - Flip-back: on within AUTO_OFF_WINDOW (180 s) of
//                    GradualFadeOut's (6.18) or the watchdog's own off
//                    (${id}_AutoOffAt, now stamped at WATCHDOG-OFF and at the
//                    "already very dim" off) — a late Hue/Zigbee report or
//                    someone pressing on right after — gets the room's
//                    threshold from the turn-on, never the flapping cap, no
//                    UNSEEN line, and WATCHDOG-FADE says "(flip-back after
//                    auto-off)"
//                  - No motion timestamp but a turn-on: faded 900 s after it
//                    (was "no motion timestamp available" for ever)
//                  - Before fading: wait 5 s, then read the light, the motion
//                    sensors, a fade in progress and AL's state again. Off,
//                    motion, a fade started (GradualFadeOut) or a turn-on
//                    started or recorded meanwhile → no fade, the next minute
//                    decides; otherwise the fade uses the fresh light values
//                  - Known limit (as before): a countdown already armed by an
//                    earlier zone-inactive transition can still let
//                    GradualFadeOut fade a light switched on unseen
// 2.16 2026-10-28  Group detection from the device driver
//                  - Shared GROUPS block (same as AdaptiveLighting 2.29.3): a
//                    group is Homey's virtual group driver, not "lacks
//                    button.migrate_v3"; the zone fallback (still excluding the
//                    extra lights) is logged as WATCHDOG-ZONE-FALLBACK
// 2.15 2026-10-28  Never leave an occupied room at ~0% (as GradualFadeOut 6.16)
//                  - Motion at fade end: keep the restore window open, wait up
//                    to HOLD_WAIT_SECONDS (10 s) for RestoreSavedSettings, and
//                    restore what it didn't (WATCHDOG-SELF-RESTORE), each light
//                    — primary and extra lights — to its own saved values.
//                    No wait when the zone was already active at fade start
//                    (E9 door open: no zone trigger, so no restore can come).
//                    A light switched off by hand during the fade stays off
//                  - Zone active WITHOUT motion (an open door): no restore,
//                    turn-off skipped as before. A door left ajar keeps the
//                    zone active; restoring would fade and restore every couple
//                    of minutes. A later minute turns the light off
//                  - Verify step: light off 3 s after the off and motion now →
//                    switch it back on (motion only, for the same reason)
// 2.14 2026-10-28  Log missing or unknown room arguments
//                  - An unknown room returned an error string only (invisible
//                    in flow runs); now WATCHDOG-BADARG in AL_DiagnostikLog
//                  - No argument still checks B9 (editor test runs) but logs
//                    WATCHDOG-DEFAULT. Each argument at most once per
//                    ERROR_LOG_INTERVAL (one timestamp per argument in
//                    AL_WatchdogArgWarningAt) — the flow runs every minute
// 2.13 2026-10-28  Stop writing ${id}_SavedManualMode (primary and extra lights)
//                  - Same as GradualFadeOut 6.14: its only reader turned it into
//                    _ManualRestoreUntil, unread since AdaptiveLighting 2.17.0.
//                    WATCHDOG-FADE still shows manual= from AL's state
// 2.12 2026-10-27  Errors reach AL_DiagnostikLog
//                  - The script had no top-level catch: an unknown light or
//                    motion-sensor id (e.g. after re-pairing for the Hue Bridge
//                    Pro) threw on every run and left no trace, silently
//                    disabling that room's safety net
//                  - Main body wrapped in try/catch → WATCHDOG-ERROR | <room> |
//                    <message>, at most once per room per ERROR_LOG_INTERVAL
//                    (10 min; last time in AL_WatchdogErrorAt_<room>)
//                  - The B7/B9/E9 flows now only run the watchdog while some
//                    light in the zone is on (was every minute, ~4,300 runs/day)
// 2.11 2026-10-19  Log overrides to AL_OverrideLog before fading
//                  - Same check as GradualFadeOut v6.12: the primary light's
//                    values vs AdaptiveLighting's lastApplied; a difference
//                    gets one src=watchdog line for preset tuning
// 2.10 2026-09-04  Cache fade targets for a faster restore
//                  - Saves the bulbs being faded in ${deviceId}_FadeTargets
//                    (primary light: its members; each extra light: itself)
//                    so RestoreSavedSettings v4.2 can restore by ID without
//                    fetching any devices — matches GradualFadeOut v6.11
// 2.9  2026-07-06  Fix: setTimeout is not defined in HomeyScript
//                  - The post-fade wait and 3s verify wait used
//                    `new Promise(r => setTimeout(r, ...))`; HomeyScript has
//                    no setTimeout, so the watchdog threw right after starting
//                    the fade and never reached the turn-off — leaving the
//                    backup path as dead as the primary fade
//                  - Switched both waits to the built-in async wait(ms)
// 2.8  2026-07-05  Log the silent "cancelled by restore" exit
//                  - That branch only called log() before, invisible in
//                    AL_DiagnostikLog - now also diagLogs whether the exit
//                    was a real _RestoredAt restore or a bare cleared flag,
//                    so a stalled/raced fade can be told apart from a
//                    genuine motion-triggered cancel
// 2.7  2026-06-10  Turn-off completion logging + verify/resend
//                  - Logs WATCHDOG-OFF when the turn-off actually executes
//                  - 3s later re-checks the primary light: if Homey still
//                    shows it on (lost command or late Zigbee report),
//                    resends off — unless the room became active
// 2.6.1 2026-06-10 Docs: setup comment said "Every 2 minutes" — the actual
//                  flows trigger every 1 minute
// 2.6  2026-06-10  Restore wins: hold turn-off when room is active at fade end
//                  - Motion or zone activity (door) at fade end now skips the
//                    turn-off and LEAVES the fade window open, so the pending
//                    RestoreSavedSettings restores brightness (previously the
//                    flags were zeroed, making the late restore a no-op)
//                  - Restore window buffer extended 2s → 15s (matches
//                    GradualFadeOut v6.6)
// 2.5  2026-06-10  Reliable turn-off + error visibility
//                  - Skip turn-off via _RestoredAt marker instead of flag==0
//                    (expired flags used to be zeroed by restore's stale
//                    cleanup, faking a "restore happened" signal)
//                  - Re-checks motion sensors right before turn-off: a person
//                    returning while the zone stayed active (e.g. door kept it
//                    active) fires no restore, so don't turn off on them
//                  - Fade/turn-off/target-collection failures now logged to
//                    AL_DiagnostikLog (WATCHDOG-ERROR) instead of swallowed
// 2.4  2026-03-31  Read manual mode from per-device state variable
//                  - Reads AL_Device_<key>.State instead of combined AL_DeviceStates
//                  - Faster: only parses one device's state, not the entire blob
// 2.3  2026-03-30  Skip turn-off if fade was cancelled by motion
//                  - After fade wait, checks if _FadeActiveUntil was cleared
//                  - RestoreSavedSettings clears flag on motion → watchdog skips turn-off
//                  - Prevents turning off lights when someone walked in during fade
// 2.2  2026-03-30  Explicitly turn off lights after fade completes
//                  - Waits for fade duration, then sets onoff:false on all targets
//                  - No longer relies on next watchdog cycle to clean up
// 2.1  2026-03-20  Add 60s grace period on top of inactivity threshold
//                  - Prevents watchdog from racing with the normal inactivity flow
//                  - Watchdog now triggers at inactivitySeconds + 60s
// 2.0  2026-03-19  Refactored from B9-only to multi-room support
// 1.0  2026-03-19  Initial version - B9 safety net
// -------------------------------------------------------------------------

// ====== ROOM CONFIGURATIONS ======
const ROOMS = {
  B9: {
    name: "Badeværelse 9",
    // Primary light (used for state save/restore coordination with GradualFadeOut)
    primaryLight: "b8591f4d-a493-4de7-9745-c13cd07e033c", // B9 Lys (group)
    // Motion sensors to check (all must be clear for room to be idle)
    motionSensors: [
      "90bc5383-608b-43c9-89a1-f7f7c54d1675", // B9 Motion
      "d78e0e15-5a6b-4908-be3c-4e5d3dc1a9d6"  // B9 Eve Motion Bruser
    ],
    // Logic variable name for inactivity threshold
    inactivityVar: "B9_InactivitySeconds"
  },
  B7: {
    name: "Badeværelse 7",
    primaryLight: "1ab9ca1f-60ca-44f9-8221-a03e10f005bf", // B7 Lys (group)
    motionSensors: [
      "acc2b15c-2774-4293-922a-c0659df04a41"  // B7 Motion
    ],
    inactivityVar: "B7_InactivitySeconds"
  },
  E9: {
    name: "Entre 9",
    primaryLight: "2656f184-8c87-4434-95a2-fdb3fc36bdd8", // E9 Loft
    // Additional lights to fade (not part of a group)
    extraLights: [
      "e339c184-ea11-4413-bd90-dac726861fd0"  // E9 Garderobe
    ],
    motionSensors: [
      "0da27a1f-ced1-4d02-9193-9438109c5c38"  // E9 Motion
    ],
    // Door contacts in the zone: opening the door makes it active and turns
    // the lights on, so a door change counts as someone seen (and as activity)
    doorSensors: [
      "68ef424e-3ab9-4573-8a89-bdce2b4ffe65"  // E9 Dør
    ],
    inactivityVar: "E9_InactivitySeconds"
  }
};

// ====== SETTINGS ======
const DEFAULT_INACTIVITY = 300;
const FADE_DURATION = 20;
const RESTORE_BUFFER = 15; // Seconds the restore window stays open after the fade
                           // ends — RestoreSavedSettings can run ~10s after the
                           // zone-active trigger under load
const WATCHDOG_GRACE = 60; // Extra seconds beyond inactivity threshold before watchdog acts
                           // Prevents racing with the normal inactivity flow
const HOLD_WAIT_SECONDS = 10; // motion at fade end: how long to wait for
                              // RestoreSavedSettings before restoring here
const SEEN_BEFORE_ON = 60;   // A motion (or door) change this many seconds before the
                             // turn-on still counts as seen: AL records the turn-on a
                             // few seconds after the motion that caused it
const UNSEEN_MIN_ON = 900;   // Switched on while nobody is seen: no fade before this
                             // many seconds after the turn-on (shower, bath)
const UNSEEN_MAX_HOLD = 1800; // ... and none later than this after the first unseen
                              // turn-on of a stretch (a light that keeps coming
                              // back on with nobody seen)
const AUTO_OFF_WINDOW = 180; // On this soon after GradualFadeOut's or the watchdog's
                             // off: a flip-back, not a fresh unseen turn-on
const ERROR_LOG_INTERVAL = 600; // Seconds between WATCHDOG-ERROR lines for the same
                                // room — a permanent error would otherwise write one
                                // line a minute and push everything else out of the log

// ====== GET ROOM FROM ARGUMENT ======
// No argument = B9 (for test runs in the HomeyScript editor). A missing or bad
// argument repeats every minute from the flow, so each one is logged at most
// once per ERROR_LOG_INTERVAL — one timestamp per argument, so a problem in one
// room's card can't hide another's
function diagLogArgLimited(entry) {
  const key = String(args[0] || '');
  const now = Date.now();
  let seen = {};
  try { seen = JSON.parse(global.get('AL_WatchdogArgWarningAt') || '{}'); } catch (e) { /* corrupt — start over */ }
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};
  if (typeof seen[key] === 'number' && now - seen[key] < ERROR_LOG_INTERVAL * 1000) return;
  for (const k of Object.keys(seen)) {
    if (typeof seen[k] !== 'number' || now - seen[k] >= ERROR_LOG_INTERVAL * 1000) delete seen[k];
  }
  seen[key] = now;
  global.set('AL_WatchdogArgWarningAt', JSON.stringify(seen));
  diagLog(entry);
}
const roomKey = String(args[0] || 'B9').trim();
if (!args[0]) diagLogArgLimited(`WATCHDOG-DEFAULT | no argument — using B9 (editor test run?)`);
if (!ROOMS[roomKey]) {
  diagLogArgLimited(`WATCHDOG-BADARG | "${roomKey}" | unknown room (${Object.keys(ROOMS).join(', ')})`);
  return `Error: pass room name as argument (${Object.keys(ROOMS).join(', ')})`;
}
const ROOM = ROOMS[roomKey];
const PREFIX = `${roomKey} Watchdog`;

// ====== PERSISTENT DIAGNOSTIC LOG ======
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

// A WATCHDOG-ERROR line at most once per room per ERROR_LOG_INTERVAL — one
// timestamp per room and source (AL_WatchdogErrorAt_<room>[_<source>]), since
// the flow runs every minute. Never throws
function diagLogErrorLimited(entry, source = '') {
  try {
    const lastErrorKey = `AL_WatchdogErrorAt_${roomKey}${source ? `_${source}` : ''}`;
    if (Date.now() - (global.get(lastErrorKey) || 0) >= ERROR_LOG_INTERVAL * 1000) {
      global.set(lastErrorKey, Date.now());
      diagLog(entry);
    }
  } catch (e) { /* ignore */ }
}

// ====== GROUPS — same block in adaptivelighting.js, gradualfadeout.js,
// restoresavedsettings.js and room_watchdog.js; change all four together ======
// A Homey group uses the virtual group driver, a Hue bulb comes from the
// Philips Hue app. Homey reports the driver in driverId (e.g.
// "homey:virtualdrivergroup:driver", "homey:app:nl.philips.hue:bulb"), and in
// ownerUri/driverUri depending on the API version; all three are read. Only a
// device without any driver info falls back to the old rule (Hue bulbs have
// button.migrate_v3, groups don't), which may not survive a move to the Hue
// Bridge Pro
function driverOf(device) {
  return [device?.driverId, device?.ownerUri, device?.driverUri].filter(Boolean).join(' ').toLowerCase();
}
function isGroupDevice(device) {
  const driver = driverOf(device);
  return driver ? driver.includes('virtualdrivergroup') : !device?.capabilities?.includes('button.migrate_v3');
}
// Either sign is enough: only the Philips Hue app adds button.migrate_v3
function isHueBulb(device) {
  return driverOf(device).includes('nl.philips.hue') || !!device?.capabilities?.includes('button.migrate_v3');
}
// A light's bulbs: lights named "<name> <n>" ("B9 Lys 1") — never for a Hue
// bulb, which is a single light. With zoneFallback, a group (by driver) whose
// bulbs aren't named that way gets every other light in its zone (viaZone: log
// it — a bulb is probably misnamed). Name matching doesn't need the driver, so
// a group whose driver text looks unexpected still finds its bulbs
function groupMembers(device, allDevices, { zoneFallback = true, exclude = [] } = {}) {
  if (isHueBulb(device)) return { members: [], viaZone: false };
  const lights = Object.values(allDevices || {}).filter(d => d.class === 'light' && d.id !== device.id);
  const byName = lights.filter(d => typeof d.name === 'string' && d.name.startsWith(device.name + ' '));
  if (byName.length > 0 || !zoneFallback || !isGroupDevice(device)) return { members: byName, viaZone: false };
  const byZone = lights.filter(d => d.zone === device.zone && !exclude.includes(d.id));
  return { members: byZone, viaZone: byZone.length > 0 };
}
// ====== end of shared GROUPS block ======

// ====== OVERRIDE LOG ======
// One line each time a light is found at values that differ from what
// AdaptiveLighting last applied — an override from a Hue switch, the app, voice
// or a button. Input for tuning the presets; kept apart from AL_DiagnostikLog
// so routine fade/apply noise cannot push it out. Shared with AdaptiveLighting
// (src=check), GradualFadeOut (src=fade) and Room_Watchdog (src=watchdog).
// Max 1000 lines. Read via: log(global.get('AL_OverrideLog'))
// Format: "DD.MM, HH.MM.SS | dag | OVERRIDE | Lampe | Profil | AL=40%/70 | nu=100%/1 | Δdim=+60 Δtemp=-69 | src=fade | 26m efter AL"
const OVERRIDE_DIM_TOLERANCE = 0.10;   // same as AdaptiveLighting's tolerance
const OVERRIDE_TEMP_TOLERANCE = 0.15;  // wider: Hue bulbs clamp warm requests (AL sets 1.00, bulb reads back 0.87)

function overrideLog(deviceId, name, profileName, applied, dim, temp, source, extra = '') {
  const pct = v => (typeof v === 'number' ? Math.round(v * 100) : null);
  // Log each override once: a fade after a restore sees the same values again
  const signature = `${applied.at || 0}|${pct(dim)}|${pct(temp)}`;
  const sigKey = `${deviceId}_OverrideLogged`;
  if (global.get(sigKey) === signature) return;
  global.set(sigKey, signature);

  const nowDate = new Date();
  const stamp = nowDate.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const day = nowDate.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', weekday: 'short' }).replace('.', '');
  const signed = v => (v > 0 ? `+${v}` : `${v}`);
  const tempStr = v => (pct(v) === null ? 'N/A' : pct(v));
  const dTemp = (pct(temp) !== null && pct(applied.temperature) !== null) ? signed(pct(temp) - pct(applied.temperature)) : 'N/A';
  const since = applied.at ? ` | ${Math.round((Date.now() - applied.at) / 60000)}m efter AL` : '';
  const entry = `${stamp} | ${day} | OVERRIDE | ${name} | ${profileName || '?'} | AL=${pct(applied.brightness)}%/${tempStr(applied.temperature)} | nu=${pct(dim)}%/${tempStr(temp)} | Δdim=${signed(pct(dim) - pct(applied.brightness))} Δtemp=${dTemp} | src=${source}${since}${extra}`;

  const logText = global.get('AL_OverrideLog') || '';
  const lines = (logText + entry + '\n').split('\n').filter(l => l.length > 0);
  global.set('AL_OverrideLog', lines.slice(-1000).join('\n') + '\n');
}

// Compare the light's current values with AdaptiveLighting's lastApplied and
// log an override when they differ. Best-effort: never throws.
function checkOverride(deviceId, name, dim, temp, source) {
  try {
    const raw = global.get(`AL_Device_${deviceId.substring(0, 8)}.State`);
    if (!raw) return;
    const state = JSON.parse(raw);
    const applied = state.lastApplied;
    if (!applied || typeof applied.brightness !== 'number') return;
    // AL's own transition (e.g. a 6-minute early fade) still running: the light
    // is between two AL values, not overridden
    if (Date.now() < (state.fadeEndTime || 0)) return;
    const dimOff = Math.abs(dim - applied.brightness) > OVERRIDE_DIM_TOLERANCE;
    const tempOff = typeof temp === 'number' && typeof applied.temperature === 'number'
      && Math.abs(temp - applied.temperature) > OVERRIDE_TEMP_TOLERANCE;
    if (dimOff || tempOff) overrideLog(deviceId, name, state.lastProfile, applied, dim, temp, source);
  } catch (e) { /* override logging is best-effort */ }
}

// ====== TURN-ON TIME ======
// From AdaptiveLighting's state for the primary light. B7/B9/E9 run AL only
// from the light's "turned on" flow (mode normal), so lastApplied {at, via:
// 'normal'} is the last turn-on AL handled. Not Homey's onoff.lastChanged
// (probably not in HomeyScript's capabilitiesObj) nor lastUpdated (moves on
// every same-value report)
// at:   epoch ms; 0 = unknown (no record, another mode, or more than a minute
//       ahead — a bad value must not hold the light for good)
// busy: AL's turn-on run still holds its lease (it hasn't recorded the turn-on
//       yet). AL's leases run 60 s (BUSY_LEASE_MS): one further ahead than
//       that (a clock stepped back, a corrupt write) is no lease — AL keeps it,
//       and it must not block the fade for good either
function turnOnInfo() {
  const now = Date.now();
  let at = 0;
  let busy = false;
  try {
    const raw = global.get(`AL_Device_${ROOM.primaryLight.substring(0, 8)}.State`);
    const state = raw ? JSON.parse(raw) : null;
    const applied = state?.lastApplied;
    if (applied?.via === 'normal' && typeof applied.at === 'number' && applied.at > 0 && applied.at <= now + 60000) {
      at = applied.at;
    }
    busy = Object.values(state?.busy || {}).some(until => typeof until === 'number' && until > now && until <= now + 65000);
  } catch (e) { /* corrupt AL state — turn-on unknown, as before 2.17 */ }
  return { at, busy };
}

// Latest change of the room's door contacts, epoch ms (0 = none readable). A
// contact that can't be read, or has no change time, counts as not seen;
// WATCHDOG-ERROR names it
async function lastDoorChange() {
  let latest = 0;
  for (const id of ROOM.doorSensors || []) {
    try {
      const sensor = await Homey.devices.getDevice({ id });
      const cap = sensor.capabilitiesObj?.alarm_contact;
      if (!cap) throw new Error(`${sensor.name || 'device'} has no alarm_contact`);
      const ts = new Date(cap.lastChanged ?? cap.lastUpdated).getTime();
      if (!(ts > 0)) throw new Error(`${sensor.name || 'device'} alarm_contact has no change time`);
      if (ts > latest) latest = ts;
    } catch (e) {
      diagLogErrorLimited(`WATCHDOG-ERROR | ${ROOM.name} | door sensor ${id} unreadable (treated as not seen): ${e.message}`, 'door');
    }
  }
  return latest;
}

// Motion now, and the sensors' last change (epoch ms, 0 = none)
async function readMotion() {
  let motion = false;
  let last = 0;
  for (const sensorId of ROOM.motionSensors) {
    const sensor = await Homey.devices.getDevice({ id: sensorId });
    const motionCap = sensor.capabilitiesObj?.alarm_motion;
    if (motionCap?.value) {
      motion = true;
      break;
    }
    const ts = new Date(motionCap?.lastChanged ?? motionCap?.lastUpdated).getTime();
    if (!isNaN(ts) && ts > last) last = ts;
  }
  return { motion, last };
}

try {
  // ====== 1. CHECK IF LIGHTS ARE ON ======
  // (let: read again after the 5 s look before a fade)
  let device = await Homey.devices.getDevice({ id: ROOM.primaryLight });
  const lightsOn = device.capabilitiesObj?.onoff?.value === true;

  if (!lightsOn) {
    return `${PREFIX}: lights off`;
  }

  // ====== 2. CHECK MOTION SENSORS ======
  const { motion: hasMotion, last: lastMotionTime } = await readMotion();

  if (hasMotion) {
    return `${PREFIX}: motion detected`;
  }

  // ====== 3. CHECK IF FADE ALREADY IN PROGRESS ======
  const fadeActiveUntil = global.get(`${ROOM.primaryLight}_FadeActiveUntil`) || 0;
  if (Date.now() < fadeActiveUntil) {
    return `${PREFIX}: fade already in progress`;
  }

  // ====== 4. READ INACTIVITY THRESHOLD FROM LOGIC VARIABLE ======
  let inactivitySeconds = DEFAULT_INACTIVITY;
  try {
    const variables = await Homey.logic.getVariables();
    const varEntry = Object.values(variables).find(v => v.name === ROOM.inactivityVar);
    if (varEntry) {
      inactivitySeconds = Number(varEntry.value);
      log(`${PREFIX}: ${ROOM.inactivityVar} = ${inactivitySeconds}`);
    } else {
      log(`${PREFIX}: ${ROOM.inactivityVar} not found, using default ${DEFAULT_INACTIVITY}s`);
    }
  } catch (e) {
    log(`${PREFIX}: couldn't read Logic variable: ${e.message}`);
  }

  // AdaptiveLighting's record of the turn-on — read after the last await
  // above, so a turn-on that started meanwhile is seen. Its turn-on run still
  // holds the lease: the turn-on isn't recorded yet, the next minute decides.
  // (E9's door read below awaits once more; a turn-on during it is caught by
  // the look before a fade, and holding on an older turn-on is safe)
  const turnOn = turnOnInfo();
  if (turnOn.busy) {
    return `${PREFIX}: AdaptiveLighting turn-on in progress`;
  }

  // ====== 5. CHECK IF IDLE LONG ENOUGH (motion, turn-on and door times) ======
  // Idle since the latest of the last motion, the turn-on and (E9) the door.
  // - Seen (a motion change from SEEN_BEFORE_ON before the turn-on, in E9 also
  //   the door; or the turn-on unknown): the room's threshold, as before 2.17
  // - Not seen: switched on by a switch, the app or voice while the sensors
  //   can't see the person — no fade before UNSEEN_MIN_ON
  // - Flip-back (not seen, on within AUTO_OFF_WINDOW of an automatic off): a
  //   late report or someone undoing the off — the room's threshold
  const now = Date.now();
  const onAt = turnOn.at;

  if (lastMotionTime <= 0 && onAt <= 0) {
    return `${PREFIX}: no motion timestamp available`;
  }

  const seenFrom = onAt - SEEN_BEFORE_ON * 1000;
  let seen = onAt <= 0 || lastMotionTime >= seenFrom;
  let doorAt = 0;
  if (!seen && ROOM.doorSensors) {
    doorAt = await lastDoorChange();
    seen = doorAt >= seenFrom;
  }
  const autoOffAt = global.get(`${ROOM.primaryLight}_AutoOffAt`) || 0;
  const flipBack = !seen && autoOffAt > 0 && onAt >= autoOffAt && onAt - autoOffAt <= AUTO_OFF_WINDOW * 1000;
  const unseen = !seen && !flipBack;

  const idleDuration = (now - Math.max(lastMotionTime, onAt, doorAt)) / 1000;

  let watchdogThreshold = inactivitySeconds + WATCHDOG_GRACE;
  if (unseen) watchdogThreshold = Math.max(watchdogThreshold, UNSEEN_MIN_ON);

  // Flapping cap: while nobody is seen, the hold ends UNSEEN_MAX_HOLD after the
  // first unseen turn-on of a stretch, however often the turn-on moves (a bulb
  // dropping out and rejoining). A turn-on continues the stretch only while
  // nobody has been seen since its first turn-on (the same last motion; in E9
  // the door untouched), no automatic off came in between, and it is within
  // UNSEEN_MAX_HOLD of that first turn-on. Any other unseen turn-on starts a
  // new stretch with its full UNSEEN_MIN_ON: a night visit faded at 03:15 must
  // not cut short a switch-on at 07:23. A flip-back is never capped (it gets
  // the room's threshold). Record per room, written only when it changes:
  // { firstOnAt, lastMotion, loggedOnAt (WATCHDOG-UNSEEN) }
  const unseenKey = `AL_WatchdogUnseen_${roomKey}`;
  const storedStretch = global.get(unseenKey) || null;
  let stretch = null;
  if (unseen) {
    let rec = null;
    try { rec = storedStretch ? JSON.parse(storedStretch) : null; } catch (e) { /* corrupt — start over */ }
    const first = typeof rec?.firstOnAt === 'number' && rec.firstOnAt > 0 ? rec.firstOnAt : 0;
    const sameStretch = first > 0 && first <= onAt
      && rec.lastMotion === lastMotionTime
      && doorAt < first - SEEN_BEFORE_ON * 1000
      && !(autoOffAt > first && autoOffAt <= onAt)
      && onAt < first + UNSEEN_MAX_HOLD * 1000;
    stretch = sameStretch ? rec : { firstOnAt: onAt, lastMotion: lastMotionTime, loggedOnAt: 0 };
  }
  const capAt = stretch ? stretch.firstOnAt + UNSEEN_MAX_HOLD * 1000 : Infinity;
  const capped = now >= capAt;
  const holding = idleDuration < watchdogThreshold && !capped;

  // WATCHDOG-UNSEEN once per turn-on: shows how often it happens and whether 900 s fits
  if (holding && unseen && stretch.loggedOnAt !== onAt) {
    stretch.loggedOnAt = onAt;
    const holdFor = Math.round(Math.min(watchdogThreshold, (capAt - onAt) / 1000));
    const last = lastMotionTime > 0 ? `last motion ${Math.round((onAt - lastMotionTime) / 60000)} min before` : 'no motion timestamp';
    const capNote = holdFor < watchdogThreshold ? ` (first unseen turn-on ${Math.round((onAt - stretch.firstOnAt) / 60000)} min before, max ${UNSEEN_MAX_HOLD}s)` : '';
    diagLog(`WATCHDOG-UNSEEN | ${ROOM.name} | on ${Math.max(0, Math.round((now - onAt) / 1000))}s, nobody seen since (${last}) — no fade before ${holdFor}s${capNote}`);
  }
  if (stretch && JSON.stringify(stretch) !== storedStretch) global.set(unseenKey, JSON.stringify(stretch));

  if (holding) {
    let reason = unseen ? ' — on, nobody seen' : flipBack ? ' — flip-back after auto-off' : '';
    if (capAt - now < (watchdogThreshold - idleDuration) * 1000) reason += `, max ${UNSEEN_MAX_HOLD}s from the first unseen turn-on`;
    const remaining = Math.round(Math.min(watchdogThreshold - idleDuration, (capAt - now) / 1000));
    return `${PREFIX}: idle ${Math.round(idleDuration)}s / ${watchdogThreshold}s (${remaining}s left)${reason}`;
  }

  // A switch pressed just before this minute: AL's turn-on run may not have
  // taken its lease or recorded the turn-on yet. Look once more before fading.
  // The 5 s are new in 2.17, so steps 1-3 are repeated too: someone walking in
  // or switching the light off meanwhile, or GradualFadeOut's countdown
  // starting its fade, must not get a fade decided on values from before the
  // wait (RestoreSavedSettings has no fade to cancel yet). AL's state is read
  // last, after the final await
  await wait(5000);
  device = await Homey.devices.getDevice({ id: ROOM.primaryLight });
  if (device.capabilitiesObj?.onoff?.value !== true) {
    return `${PREFIX}: switched off just now`;
  }
  const motionAgain = await readMotion();
  if (motionAgain.motion || motionAgain.last > lastMotionTime) {
    return `${PREFIX}: motion just now — decide next minute`;
  }
  if (Date.now() < (global.get(`${ROOM.primaryLight}_FadeActiveUntil`) || 0)) {
    return `${PREFIX}: fade started just now`;
  }
  const again = turnOnInfo();
  if (again.busy || again.at > onAt) {
    return `${PREFIX}: turned on just now — decide next minute`;
  }

  // ====== 6. TRIGGER FADE ======
  log(`${PREFIX}: triggering fade (idle ${Math.round(idleDuration)}s > ${watchdogThreshold}s)`);
  await Homey.flow.runFlowCardAction({
    uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
    id: 'homey:manager:notifications:create_notification',
    args: { text: `${PREFIX}: lights stuck on, fading after ${Math.round(idleDuration)}s idle` }
  });

  // Save current state (same as GradualFadeOut)
  const currentBrightness = device.capabilitiesObj?.dim?.value || 0;
  const currentTemp = device.capabilitiesObj?.light_temperature?.value || null;

  global.set(`${ROOM.primaryLight}_SavedDim`, currentBrightness);
  if (currentTemp !== null) {
    global.set(`${ROOM.primaryLight}_SavedTemp`, currentTemp);
  }

  // Set fade-active timestamp (same as GradualFadeOut)
  const fadeStartedAt = Date.now();
  const fadeUntil = fadeStartedAt + ((FADE_DURATION + RESTORE_BUFFER) * 1000);
  global.set(`${ROOM.primaryLight}_FadeActiveUntil`, fadeUntil);

  // AdaptiveLighting's manual flag, for the WATCHDOG-FADE line only
  const alDeviceKey = ROOM.primaryLight.substring(0, 8);
  let wasManualMode = false;
  try {
    const alRaw = global.get(`AL_Device_${alDeviceKey}.State`);
    if (alRaw) wasManualMode = JSON.parse(alRaw).manual === true;
  } catch (e) { /* parse error — treat as not manual */ }

  checkOverride(ROOM.primaryLight, device.name, currentBrightness, currentTemp, 'watchdog');

  const why = unseen ? ' (nobody seen since on)' : flipBack ? ' (flip-back after auto-off)' : '';
  const capInfo = capped && idleDuration < watchdogThreshold ? ` first-on=${Math.round((now - stretch.firstOnAt) / 1000)}s cap=${UNSEEN_MAX_HOLD}s` : '';
  diagLog(`WATCHDOG-FADE | ${ROOM.name} | idle=${Math.round(idleDuration)}s threshold=${watchdogThreshold}s${why}${capInfo} | dim=${Math.round(currentBrightness * 100)}% manual=${wasManualMode}`);

  // If already very dim, just turn off
  if (currentBrightness <= 0.05) {
    await device.setCapabilityValue('onoff', false);
    global.set(`${ROOM.primaryLight}_FadeActiveUntil`, 0);
    // An automatic off too (E9: the second step after WATCHDOG-HOLD) — a
    // turn-on soon after is a flip-back (2.17)
    global.set(`${ROOM.primaryLight}_AutoOffAt`, Date.now());
    diagLog(`WATCHDOG-SKIP | ${ROOM.name} | already very dim (${Math.round(currentBrightness * 100)}%)`);
    return `${PREFIX}: already dim, turned off`;
  }

  // ====== FADE LIGHTS ======
  async function fadeDevice(targetDevice) {
    const cardId = `homey:device:${targetDevice.id}:dim`;
    await Homey.flow.runFlowCardAction({
      uri: `homey:device:${targetDevice.id}`,
      id: cardId,
      args: { dim: 0 },
      duration: FADE_DURATION
    });
  }

  // Collect all lights to fade. restorePlan: each faded light with its bulbs and
  // the values saved before the fade, for a self-restore at fade end
  let targets = [];
  const restorePlan = [{ id: ROOM.primaryLight, name: device.name, targets: [device], dim: currentBrightness, temp: currentTemp }];
  try {
    const allDevices = Object.values(await Homey.devices.getDevices());

    // A group's bulbs by name, else every light in its zone except the extra
    // lights (logged — a bulb is probably misnamed); a single light: itself
    const { members, viaZone } = groupMembers(device, allDevices, { exclude: ROOM.extraLights || [] });
    if (viaZone) diagLog(`WATCHDOG-ZONE-FALLBACK | ${ROOM.name} | no "${device.name} <n>" lights — using ${members.length} light(s) in its zone`);
    targets = members.length > 0 ? members : [device];
    restorePlan[0].targets = targets.slice();

    // Cache the primary light's targets so RestoreSavedSettings can restore
    // by ID without any device lookup
    global.set(`${ROOM.primaryLight}_FadeTargets`, JSON.stringify({
      name: device.name,
      targets: targets.map(t => ({ id: t.id, name: t.name }))
    }));

    // Add extra lights (non-group lights in the same room)
    if (ROOM.extraLights) {
      for (const extraId of ROOM.extraLights) {
        const extraDevice = await Homey.devices.getDevice({ id: extraId });
        if (extraDevice.capabilitiesObj?.onoff?.value === true) {
          // Save state for extra lights too
          const extraDim = extraDevice.capabilitiesObj?.dim?.value || 0;
          const extraTemp = extraDevice.capabilitiesObj?.light_temperature?.value || null;
          global.set(`${extraId}_SavedDim`, extraDim);
          if (extraTemp !== null) global.set(`${extraId}_SavedTemp`, extraTemp);
          global.set(`${extraId}_FadeActiveUntil`, fadeUntil);
          global.set(`${extraId}_FadeTargets`, JSON.stringify({
            name: extraDevice.name,
            targets: [{ id: extraDevice.id, name: extraDevice.name }]
          }));

          targets.push(extraDevice);
          restorePlan.push({ id: extraId, name: extraDevice.name, targets: [extraDevice], dim: extraDim, temp: extraTemp });
        }
      }
    }
  } catch (e) {
    diagLog(`WATCHDOG-ERROR | ${ROOM.name} | target collection failed: ${e.message}`);
    if (targets.length === 0) targets = [device]; // fall back to primary light only
  }

  // Zone already active before the fade (only E9: the door keeps it active):
  // motion during the fade then fires no zone trigger, so no RestoreSavedSettings
  // can come — at fade end, restore without waiting for one
  let zoneActiveAtStart = false;
  try {
    zoneActiveAtStart = (await Homey.zones.getZone({ id: device.zone }))?.active === true;
  } catch (e) { /* treat as inactive — wait for a restore as usual */ }

  // Fade all targets in parallel
  log(`${PREFIX}: fading ${targets.length} lights`);
  const results = await Promise.all(targets.map(t =>
    fadeDevice(t)
      .then(() => { log(`  ${t.name}: fade started`); return true; })
      .catch(e => {
        log(`  ${t.name}: failed: ${e.message}`);
        diagLog(`WATCHDOG-ERROR | ${ROOM.name} | fade ${t.name}: ${e.message}`);
        return false;
      })
  ));
  const ok = results.filter(r => r).length;
  log(`${PREFIX}: ${ok}/${targets.length} lights fading`);

  // Wait for fade to complete, then ensure lights are fully off
  // NOTE: HomeyScript has no setTimeout — use the built-in async wait(ms)
  await wait(FADE_DURATION * 1000);

  // Skip turn-off only if a real restore happened (motion returned).
  // _RestoredAt is set by RestoreSavedSettings when it actually restores;
  // flag==0 alone was ambiguous (expired flags used to be zeroed as cleanup).
  const restoredAt = global.get(`${ROOM.primaryLight}_RestoredAt`) || 0;
  const flagCleared = (global.get(`${ROOM.primaryLight}_FadeActiveUntil`) || 0) === 0;
  if (restoredAt >= fadeStartedAt || flagCleared) {
    log(`${PREFIX}: fade was cancelled (motion detected) — skipping turn-off`);
    diagLog(`WATCHDOG-CANCELLED | ${ROOM.name} | realRestore=${restoredAt >= fadeStartedAt} flagCleared=${flagCleared}`);
    return `${PREFIX}: fade cancelled by restore`;
  }

  async function anyMotion() {
    for (const sensorId of ROOM.motionSensors) {
      try {
        const sensor = await Homey.devices.getDevice({ id: sensorId });
        if (sensor.capabilitiesObj?.alarm_motion?.value === true) return true;
      } catch (e) { /* sensor unreachable — ignore */ }
    }
    return false;
  }

  // Restore one faded light here, the way RestoreSavedSettings does: mark the
  // restore first (AdaptiveLighting's restore grace; a late RestoreSavedSettings
  // just skips), then dim via the flow card with a 0.5 s duration (interrupts a
  // running hardware fade) and temperature in parallel
  async function selfRestore(p) {
    global.set(`${p.id}_FadeActiveUntil`, 0);
    global.set(`${p.id}_RestoredAt`, Date.now());
    const done = await Promise.all(p.targets.map(t => {
      const ops = [];
      if (p.dim > 0) {
        ops.push(Homey.flow.runFlowCardAction({
          uri: `homey:device:${t.id}`, id: `homey:device:${t.id}:dim`, args: { dim: p.dim }, duration: 0.5
        }).catch(() => t.setCapabilityValue('dim', p.dim)));
      }
      if (p.temp !== null) ops.push(t.setCapabilityValue('light_temperature', p.temp).catch(() => null));
      return Promise.all(ops).then(() => true).catch(() => false);
    }));
    // Group device too, for the UI (it may lag behind its members)
    if (p.id === ROOM.primaryLight && p.targets[0] !== device && p.dim > 0) {
      try { await device.setCapabilityValue('dim', p.dim); } catch (e) { /* ignore */ }
    }
    return done.filter(Boolean).length;
  }

  // Re-check activity right before turn-off — someone may have walked in during
  // the fade. Skip the turn-off.
  // - Motion (a person): the zone-active flow normally runs RestoreSavedSettings.
  //   Keep its window open and wait up to HOLD_WAIT_SECONDS; restore here what
  //   it didn't — never leave an occupied room at ~0%
  // - Zone active without motion (an open door): don't restore. A door left
  //   ajar keeps the zone active, so restoring would fade and restore the light
  //   every couple of minutes. It stays at ~0% and a later minute turns it off,
  //   as before
  const motionNow = await anyMotion();
  let zoneActiveNow = false;
  if (!motionNow) {
    try {
      const zone = await Homey.zones.getZone({ id: device.zone });
      zoneActiveNow = zone?.active === true;
    } catch (e) { /* zone lookup failed — fall through to turn-off */ }
  }
  if (motionNow) {
    const waitSeconds = zoneActiveAtStart ? 0 : HOLD_WAIT_SECONDS;
    log(`${PREFIX}: motion at fade end — waiting up to ${waitSeconds}s for RestoreSavedSettings`);
    for (const p of restorePlan) global.set(`${p.id}_FadeActiveUntil`, Date.now() + RESTORE_BUFFER * 1000);
    const restored = (p) => (global.get(`${p.id}_RestoredAt`) || 0) >= fadeStartedAt;
    for (let i = 0; i < waitSeconds && !restorePlan.every(restored); i++) await wait(1000);
    const pending = restorePlan.filter(p => !restored(p));
    if (pending.length === 0) {
      diagLog(`WATCHDOG-HOLD | ${ROOM.name} | motion at fade end — restored by RestoreSavedSettings`);
      return `${PREFIX}: motion during fade, restored`;
    }
    for (const p of pending) {
      // Restore even if onoff reads off: Homey sets it off as the dim-to-0
      // fade starts, so off here doesn't mean a person switched it off (2.18)
      const ok = await selfRestore(p);
      diagLog(`WATCHDOG-SELF-RESTORE | ${ROOM.name} | ${p.name}: motion, no restore${waitSeconds ? ` within ${waitSeconds}s` : ' (zone was already active)'} — restored ${Math.round(p.dim * 100)}% to ${ok}/${p.targets.length} light(s)`);
    }
    return `${PREFIX}: motion during fade, restored here`;
  }
  if (zoneActiveNow) {
    diagLog(`WATCHDOG-HOLD | ${ROOM.name} | zone active without motion (door?) — turn-off skipped, not restoring`);
    return `${PREFIX}: zone active without motion, turn-off skipped`;
  }

  await Promise.all(targets.map(t =>
    t.setCapabilityValue('onoff', false)
      .then(() => log(`  ${t.name}: turned off`))
      .catch(e => {
        log(`  ${t.name}: turn-off failed: ${e.message}`);
        diagLog(`WATCHDOG-ERROR | ${ROOM.name} | turn-off ${t.name}: ${e.message}`);
      })
  ));
  global.set(`${ROOM.primaryLight}_FadeActiveUntil`, 0);
  // A turn-on soon after this off is a flip-back (2.17), not a fresh unseen one
  for (const p of restorePlan) global.set(`${p.id}_AutoOffAt`, Date.now());
  diagLog(`WATCHDOG-OFF | ${ROOM.name} | off sent to ${targets.length} light(s)`);

  // Verify: a lost command or a late Zigbee report can leave/flip Homey's
  // state back to on. Re-check once and resend the off if needed — unless the
  // room became active in the meantime (then the lights are wanted on).
  await wait(3000);
  try {
    const check = await Homey.devices.getDevice({ id: ROOM.primaryLight });
    if (check.capabilitiesObj?.onoff?.value === true) {
      const restoredLate = (global.get(`${ROOM.primaryLight}_RestoredAt`) || 0) >= fadeStartedAt;
      let zoneActiveNow = false;
      try {
        const zone = await Homey.zones.getZone({ id: device.zone });
        zoneActiveNow = zone?.active === true;
      } catch (e) { /* zone lookup failed — treat as inactive */ }
      if (restoredLate || zoneActiveNow) {
        diagLog(`WATCHDOG-VERIFY | ${ROOM.name} | back on but room active — leaving on`);
      } else {
        diagLog(`WATCHDOG-VERIFY | ${ROOM.name} | still on 3s after off — resending`);
        await Promise.all(targets.map(t =>
          t.setCapabilityValue('onoff', false)
            .catch(e => diagLog(`WATCHDOG-ERROR | ${ROOM.name} | resend off ${t.name}: ${e.message}`))
        ));
      }
    } else if (await anyMotion()) {
      // Someone came in right as the lights went off. Motion only, not the
      // zone: an open door keeps the zone active and would loop. Switch the
      // light back on — its "turned on" flow runs AdaptiveLighting
      try {
        await check.setCapabilityValue('onoff', true);
      } catch (e) {
        diagLog(`WATCHDOG-ERROR | ${ROOM.name} | off but motion — switching back on failed: ${e.message}`);
        return `${PREFIX}: fade + off, switching back on failed`;
      }
      diagLog(`WATCHDOG-VERIFY | ${ROOM.name} | off but motion — switched back on`);
      return `${PREFIX}: fade + off, back on (motion)`;
    }
  } catch (e) { /* verification is best-effort */ }

  log(`${PREFIX}: fade complete, lights off`);
  return `${PREFIX}: fade + off after ${Math.round(idleDuration)}s idle`;
} catch (error) {
  // Flow runs never show the console, and an unknown device/sensor id (e.g. after
  // re-pairing) throws on every run. Log it, at most once per room per interval
  log(`${PREFIX}: ERROR ${error.message}`);
  diagLogErrorLimited(`WATCHDOG-ERROR | ${ROOM.name} | ${error.message}`);
  return `${PREFIX}: ERROR ${error.message}`;
}
