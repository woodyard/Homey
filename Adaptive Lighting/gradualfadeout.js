// Gradual Fade Out Script (Reusable)
// Description: Saves current light settings, then starts hardware fade to off
//              Script exits immediately - bulbs handle the fading
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
// Multi-device: Pass a comma-separated list to fade several lights from ONE
//               script run, e.g. "id1,id2" - useful for rooms with more than
//               one independent light (avoids running two long-lived scripts
//               in parallel, which increases the odds of them stepping on
//               each other's hardware fade commands)
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 6.19 2026-11-03  Zone active at fade end: restore even when onoff reads off
//                  - 6.16 left a light that read off alone, as "switched off by
//                    hand". But Homey sets onoff false the moment a dim-to-0
//                    fade starts (insights, 3 Nov: B9 07:51, E9 11:31 with
//                    nobody home), and a Hue bulb reports itself on again only
//                    sometimes. So someone who came in could be left at ~0 %
//                  - An off by hand during the fade in an occupied room now
//                    comes back on; press off once more
// 6.18 2026-11-03  Stamp ${deviceId}_AutoOffAt at FADE-OFF
//                  - Room_watchdog 2.17 gives a light switched on while nobody
//                    is seen 15 minutes. A turn-on within 3 minutes of this off
//                    is a late Hue/Zigbee report or someone pressing on right
//                    after it, not a fresh switch-on: the watchdog reads the
//                    stamp and gives it the room's normal timeout instead
//                  - Also at the "already off/very dim" off (FADE-SKIP at
//                    ≤5 %), which switches the light off without a fade
// 6.17 2026-10-28  Group detection from the device driver
//                  - Shared GROUPS block (same as AdaptiveLighting 2.29.3): a
//                    group is Homey's virtual group driver, not "lacks
//                    button.migrate_v3". If that capability disappeared (Hue
//                    Bridge Pro), E9 Loft would have been treated as a group,
//                    its zone fallback would fade E9 Garderobe and E9 Loft
//                    would never be turned off
//                  - A single Hue bulb skips the device-list fetch entirely
//                  - The zone fallback (group without "<group> <n>" bulbs) is
//                    logged as FADE-ZONE-FALLBACK
// 6.16 2026-10-28  Never leave an occupied room at ~0%
//                  - Zone already active before the fade starts (the countdown
//                    fired just as someone moved, so RestoreSavedSettings ran
//                    first and skipped): FADE-ABORT, nothing is dimmed. The
//                    countdown starts again when the room empties
//                  - Zone active at fade end used to return FADE-HOLD at once,
//                    trusting the zone-active flow's RestoreSavedSettings. When
//                    none came (slow, or a flow without the card, as B7 had)
//                    the light stayed at ~0% until the person left. Now the
//                    restore window is kept open and the script waits up to
//                    HOLD_WAIT_SECONDS (10 s); if no restore arrives it
//                    restores the saved brightness/colour itself
//                    (FADE-SELF-RESTORE), as RestoreSavedSettings would — unless
//                    the light was switched off by hand meanwhile (onoff false;
//                    a dim-to-0 fade leaves it true). A restore that does
//                    arrive → FADE-HOLD as before
//                  - Verify step: light off 3 s after the off but zone active
//                    (someone came in between the zone check and the off — the
//                    flow's "turn lights on" saw the lights still on) → switch
//                    it back on; its "turned on" flow runs AdaptiveLighting
//                  - Run time in that rare case: up to ~10 s longer
// 6.15 2026-10-28  Strict argument checking
//                  - Every id in the argument must look like a Homey device id
//                    (UUID); otherwise FADE-BADARG and nothing is faded
//                  - No argument still fades B9 Lys (editor test runs) but logs
//                    FADE-DEFAULT-ID, so an empty flow card shows up
// 6.14 2026-10-28  Stop writing ${deviceId}_SavedManualMode
//                  - RestoreSavedSettings only turned it into _ManualRestoreUntil,
//                    which nothing has read since AdaptiveLighting 2.17.0. The
//                    FADE-SAVE line still shows manual= (read from AL's state)
// 6.13 2026-10-27  Don't start while another fade is running
//                  - If countdown_to_zero fired while a watchdog fade (or an
//                    earlier run) was still dimming the light, the save step
//                    overwrote _SavedDim/_SavedTemp/_FadeTargets with the
//                    half-faded values, and a following restore brought the
//                    light back too dim. Seen as possible in E9, where the door
//                    can hold the zone active after the last motion
//                  - Now: _FadeActiveUntil in the future → FADE-SKIP "fade
//                    already in progress", nothing saved, nothing sent. Same
//                    guard Room_watchdog has had since 2.x. RestoreSavedSettings
//                    zeroes the flag, so a restored fade never blocks
//                  - The override check no longer needs its own mid-fade test
// 6.12 2026-10-19  Log overrides to AL_OverrideLog before fading
//                  - Compares the light's values with AdaptiveLighting's
//                    lastApplied; a difference (dim > 10 points, colour > 15)
//                    is an override — Hue dimmer switch, app, voice, button —
//                    and gets one src=fade line for preset tuning
//                  - Motion rooms (E9/B9/B7) never run AL's check mode, so
//                    switch-off is the only moment their overrides are seen
//                  - Skipped while AL's own transition or a previous fade is
//                    still running (values are in between, not overridden)
// 6.11 2026-09-04  Cache fade targets for a faster restore
//                  - Saves the exact bulbs being faded (id + name) in
//                    ${deviceId}_FadeTargets so RestoreSavedSettings v4.2
//                    can restore by ID without fetching any devices
//                  - Aborts before sending the fade if a restore already
//                    happened during the (slow) member lookup — previously
//                    the fade command was sent anyway and undid the restore
// 6.10 2026-07-06  Fix: setTimeout is not defined in HomeyScript
//                  - The post-fade wait and 3s verify wait used
//                    `new Promise(r => setTimeout(r, ...))`; HomeyScript has
//                    no setTimeout, so every run threw ("setTimeout is not
//                    defined") right after starting the hardware fade — the
//                    light dimmed to 0 but onoff was never set false and
//                    _FadeActiveUntil was left stale (seen as FADE-ERROR in
//                    AL_DiagnostikLog for E9 Loft/Garderobe + B9 Lys)
//                  - Switched both waits to the built-in async wait(ms)
// 6.9  2026-07-05  Multi-device argument + log silent cancel path
//                  - args[0] can now be a comma-separated device ID list;
//                    each device is faded/turned off in parallel within the
//                    SAME script invocation (Promise.all), instead of one
//                    script per device
//                  - Reduces concurrent long-running scripts touching the
//                    same room (e.g. E9 Loft + E9 Garderobe), which lowers
//                    the chance of two independent fade/restore cycles
//                    racing on the same device's hardware transition
//                  - "Cancelled by restore" early-exit now also calls
//                    diagLog() (was log()-only, invisible in
//                    AL_DiagnostikLog) - records whether the exit was a
//                    real _RestoredAt restore or a bare cleared flag, so a
//                    stalled/raced fade can be told apart from a genuine
//                    motion-triggered cancel
// 6.8  2026-06-10  Turn-off completion logging + verify/resend
//                  - Logs FADE-OFF when the turn-off actually executes, so a
//                    dead script run (no FADE-OFF) is distinguishable from a
//                    turn-off that got undone afterwards
//                  - 3s later re-checks the device: if Homey still shows it on
//                    (lost command or late Zigbee report flipping state back)
//                    resends off — unless the zone is active or a restore ran
// 6.7  2026-06-10  Skip fade entirely when the light is already off
//                  - An off light can still report dim>0, so the dim-to-0
//                    flow card could briefly switch it on to "fade" it
//                  - Also avoids saving state and opening a restore window
//                    for a light that was never on
// 6.6  2026-06-10  Restore wins: hold turn-off when zone is active at fade end
//                  - If someone walks in (door/motion) during the fade, skip
//                    the turn-off and LEAVE the fade window open so the
//                    pending RestoreSavedSettings restores brightness
//                  - Restore window buffer extended 2s → 15s: restore often
//                    executes ~10s after the zone-active trigger and used to
//                    miss the window entirely (fast-path skip, no restore)
// 6.5  2026-06-10  Reliable turn-off: check _RestoredAt instead of flag==0
//                  - RestoreSavedSettings' stale-cleanup used to zero an
//                    already-expired _FadeActiveUntil right around wake-up,
//                    mimicking the "restore cancelled me" signal — turn-off
//                    was skipped and lights stuck at mid-fade dim
//                  - Now skips turn-off only if a real restore happened
//                    (_RestoredAt >= fade start) or flag was genuinely cleared
//                  - Turn-off failures now logged to AL_DiagnostikLog
// 6.4  2026-04-19  Explicitly turn off lights after fade completes
//                  - Waits for fade duration, then sets onoff:false on all targets
//                  - Re-checks _FadeActiveUntil: if cleared by RestoreSavedSettings
//                    (motion returned), skips turn-off
//                  - Fixes watchdog firing as backup because normal flow never
//                    actually turned lights off (only set dim=0, onoff stayed true)
// 6.3  2026-03-31  Read manual mode from per-device state variable
//                  - Reads AL_Device_<key>.State instead of combined AL_DeviceStates
//                  - Faster: only parses one device's state, not the entire blob
// 6.2  2026-03-04  Persistent diagnostic logging (AL_DiagnostikLog)
//                  - Logs fade events with timestamp, device, brightness, manual mode
//                  - Shared log variable with RestoreSavedSettings and AdaptiveLighting
//                  - Helps diagnose unexpected dim-light issues across profile transitions
// 6.1  2026-03-02  Save manual mode state for restore coordination
//                  - Reads AdaptiveLighting's manual mode flag before fade
//                  - Stores as _SavedManualMode for restoresavedsettings.js
//                  - Enables preserving user adjustments on motion re-detection
// 6.0  2026-02-25  Fix: use Flow Card action for hardware fade
//                  - setCapabilityValue ignores duration option in HomeyScript
//                  - Group device has duration:false, members have duration:true
//                  - Must target individual members via runFlowCardAction
//                  - URI format: homey:device:ID, not homey:flowcardaction:...
//                  - Zone-based fallback for groups with different member names
//                    (e.g. "B9 Lys" → "B9 Wall 1/2/3")
// 5.2  2026-02-10  Switch to setCapabilityValue with duration (BROKEN)
//                  - More direct control than Flow Card
//                  - Fixes issue where duration was ignored on some devices
// 5.1  2026-01-14  Parallel fade for group members
//                  - All bulbs start fading simultaneously
//                  - Uses Promise.all() for parallel execution
//                  - Smoother, more synchronized fade effect
// 5.0  2026-01-07  Complete rewrite using hardware fade
//                  - Uses Homey flow card with duration (bulb handles fade)
//                  - Script exits immediately (non-blocking)
//                  - Supports groups (applies fade to individual members)
//                  - Uses timestamp instead of boolean for fadeActive
//                  - Timestamp auto-expires (no stale flags)
//                  - Smooth, precise timing regardless of API latency
// 4.1  2026-01-07  Fix race condition with RestoreSavedSettings
// 4.0  2025-12-22  Reusable for any device, accepts device ID as argument
// -------------------------------------------------------------------------

const fadeDuration = 20;     // seconds
const restoreBuffer = 15;    // seconds the restore window stays open after the
                             // fade ends — RestoreSavedSettings can run ~10s
                             // after the zone-active trigger under load
const HOLD_WAIT_SECONDS = 10; // zone active at fade end: how long to wait for
                              // RestoreSavedSettings before restoring here

// ====== PERSISTENT DIAGNOSTIC LOG ======
// Shared log across GradualFadeOut, RestoreSavedSettings, and AdaptiveLighting.
// All three scripts append to the same global variable: AL_DiagnostikLog
// Format: "DD.MM HH:MM:SS | ACTION | DeviceName | details..."
// Actions logged:
//   FADE-SAVE  (GradualFadeOut)   - brightness/temp saved before fade (manual= is AL's flag)
//   FADE-SKIP  (GradualFadeOut)   - light already off, no fade needed
//   FADE-CANCELLED (GradualFadeOut) - fade aborted early because of a restore/cleared flag
//   FADE-ABORT (GradualFadeOut)   - restore ran before the fade command was sent; fade not started
//   FADE-HOLD  (GradualFadeOut)   - zone active at fade end, RestoreSavedSettings restored it
//   FADE-SELF-RESTORE (GradualFadeOut) - zone active, no restore within 10 s → restored here
//   WATCHDOG-SELF-RESTORE (Room_watchdog) - motion at fade end, no restore → restored here
//   RESTORE    (RestoreSavedSettings) - brightness/temp restored (manual= is AL's flag)
//   RESTORE-SKIP (RestoreSavedSettings) - fade expired, nothing to restore
//   RESTORE-ERROR (RestoreSavedSettings) - every bulb failed, device not found, or unexpected error
//   RESTORE-PARTIAL (RestoreSavedSettings) - some bulbs failed to restore (names listed)
//   AL-SKIP-FADE (AdaptiveLighting) - skipped because fade/restore in progress
//   AL-SKIP-RESTORE (AdaptiveLighting) - skipped because a restore just happened (restoreGraceSeconds)
//   AL-APPLY   (AdaptiveLighting) - profile applied (brightness/temp/profile name)
//   AL-APPLY-FAIL (AdaptiveLighting) - a bulb didn't take the brightness (group members listed)
//   AL-VERIFY-FAIL (AdaptiveLighting) - clear/force verification failed after all retries
//   AL-ERROR   (AdaptiveLighting) - script threw (room, mode, message)
// Max 500 lines retained (oldest trimmed). Read via: global.get('AL_DiagnostikLog')
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

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

// A single Hue bulb has no members (no device lookup); otherwise bulbs by name,
// else every light in its zone (logged — a bulb is probably misnamed)
async function findGroupMembers(groupDevice) {
  if (isHueBulb(groupDevice)) return [];
  const { members, viaZone } = groupMembers(groupDevice, await Homey.devices.getDevices());
  if (viaZone) diagLog(`FADE-ZONE-FALLBACK | ${groupDevice.name} | no "${groupDevice.name} <n>" lights — using ${members.length} light(s) in its zone`);
  log(`Group members: ${members.length}${viaZone ? ' (zone fallback)' : ''}`);
  return members;
}

// Hardware fade via Flow Card action (duration:true on individual bulbs)
// Note: Group devices have duration:false, so we always target members individually.
// Single devices that support duration:true are also handled via flow card.
async function fadeViaFlowCard(targetDevice) {
  const cardId = `homey:device:${targetDevice.id}:dim`;
  await Homey.flow.runFlowCardAction({
    uri: `homey:device:${targetDevice.id}`,
    id: cardId,
    args: { dim: 0 },
    duration: fadeDuration
  });
}

// Wait up to HOLD_WAIT_SECONDS for RestoreSavedSettings to restore this light
// (it sets ${deviceId}_RestoredAt). True as soon as it has
async function waitForRestore(deviceId, since) {
  for (let i = 0; i < HOLD_WAIT_SECONDS; i++) {
    if ((global.get(`${deviceId}_RestoredAt`) || 0) >= since) return true;
    await wait(1000);
  }
  return (global.get(`${deviceId}_RestoredAt`) || 0) >= since;
}

// Restore a faded light here, the way RestoreSavedSettings does: mark the
// restore first (so AdaptiveLighting's restore grace applies and a late
// RestoreSavedSettings just skips), then dim via the flow card with a 0.5 s
// duration (interrupts a running hardware fade) and temperature in parallel.
// Returns how many targets took the brightness
async function selfRestore(deviceId, device, targets, dim, temp, isGroup) {
  global.set(`${deviceId}_FadeActiveUntil`, 0);
  global.set(`${deviceId}_RestoredAt`, Date.now());
  const results = await Promise.all(targets.map(t => {
    const ops = [];
    if (dim > 0) {
      ops.push(Homey.flow.runFlowCardAction({
        uri: `homey:device:${t.id}`, id: `homey:device:${t.id}:dim`, args: { dim }, duration: 0.5
      }).catch(() => t.setCapabilityValue('dim', dim)));
    }
    if (temp !== null) ops.push(t.setCapabilityValue('light_temperature', temp).catch(() => null));
    return Promise.all(ops).then(() => true).catch(() => false);
  }));
  // Group device too, for the UI (it may lag behind its members)
  if (isGroup && dim > 0) {
    try { await device.setCapabilityValue('dim', dim); } catch (e) { /* ignore */ }
  }
  return results.filter(Boolean).length;
}

// Fades and turns off a single device. Returns a result string; never throws
// (errors are caught and returned as part of the message so Promise.all over
// multiple devices doesn't abort early on one failure).
async function processDevice(deviceId) {
  try {
    // Get the device
    let device;
    try {
      device = await Homey.devices.getDevice({ id: deviceId });
    } catch (error) {
      return `ERROR: Device not found with ID: ${deviceId}`;
    }

    // Light already off? Nothing to fade — don't save state or open a restore
    // window (an off light can still report dim>0, which would otherwise make
    // the dim-to-0 flow card briefly switch it on)
    if (device.capabilitiesObj?.onoff?.value !== true) {
      diagLog(`FADE-SKIP | ${device.name} | already off`);
      return `${device.name}: Already off`;
    }

    log(`Fading device: ${device.name}`);

    // Get current brightness and temperature
    const currentBrightness = device.capabilitiesObj?.dim?.value || 0;
    const currentTemperature = device.capabilitiesObj?.light_temperature?.value || null;

    // Create unique variable names based on device ID
    const savedDimVar = `${deviceId}_SavedDim`;
    const savedTempVar = `${deviceId}_SavedTemp`;
    const fadeActiveUntilVar = `${deviceId}_FadeActiveUntil`;

    // Another fade (the watchdog's, or an earlier run) is still dimming this
    // light: saving now would store a half-faded brightness for the next
    // restore. Leave that fade and its saved values alone. A restore zeroes
    // the flag, so a fade that was cancelled never blocks a new one
    const previousFadeUntil = global.get(fadeActiveUntilVar) || 0;
    if (Date.now() < previousFadeUntil) {
      diagLog(`FADE-SKIP | ${device.name} | fade already in progress`);
      return `${device.name}: fade already in progress`;
    }

    // Save current settings to global variables
    global.set(savedDimVar, currentBrightness);
    if (currentTemperature !== null) {
      global.set(savedTempVar, currentTemperature);
    }

    // Store timestamp when fade will complete (with buffer for restore window)
    const fadeStartedAt = Date.now();
    const fadeActiveUntil = fadeStartedAt + ((fadeDuration + restoreBuffer) * 1000);
    global.set(fadeActiveUntilVar, fadeActiveUntil);

    // AdaptiveLighting's manual flag, for the FADE-SAVE line only (the fade
    // and restore never change it)
    const alDeviceKey = deviceId.substring(0, 8);
    let wasManualMode = false;
    try {
      const alRaw = global.get(`AL_Device_${alDeviceKey}.State`);
      if (alRaw) wasManualMode = JSON.parse(alRaw).manual === true;
    } catch (e) { /* parse error — treat as not manual */ }

    checkOverride(deviceId, device.name, currentBrightness, currentTemperature, 'fade');

    log(`Saved: dim=${Math.round(currentBrightness * 100)}%, temp=${currentTemperature !== null ? Math.round(currentTemperature * 100) + '%' : 'N/A'}${wasManualMode ? ' (manual mode)' : ''}`);
    log(`Fade active until: ${new Date(fadeActiveUntil).toLocaleTimeString()}`);
    diagLog(`FADE-SAVE | ${device.name} | dim=${Math.round(currentBrightness * 100)}% temp=${currentTemperature !== null ? Math.round(currentTemperature * 100) + '%' : 'N/A'} | manual=${wasManualMode} | fadeUntil=${new Date(fadeActiveUntil).toLocaleTimeString('da-DK', { timeZone: 'Europe/Copenhagen' })}`);

    // If light is already off or very dim, just turn it off
    if (currentBrightness <= 0.05) {
      await device.setCapabilityValue('onoff', false);
      global.set(fadeActiveUntilVar, 0); // Clear - no fade needed
      global.set(`${deviceId}_AutoOffAt`, Date.now()); // Room_watchdog: a turn-on soon after is a flip-back
      diagLog(`FADE-SKIP | ${device.name} | already off/very dim (${Math.round(currentBrightness * 100)}%)`);
      return `${device.name}: Already off or very dim`;
    }

    // Check if it's a group
    const members = await findGroupMembers(device);
    const isGroup = members.length > 0;

    // Determine turn-off targets (members for groups, device itself otherwise)
    const turnOffTargets = isGroup ? members : [device];

    // Cache the exact targets so RestoreSavedSettings can restore by ID
    // without any device lookup (the lookup above is the slow part)
    global.set(`${deviceId}_FadeTargets`, JSON.stringify({
      name: device.name,
      targets: turnOffTargets.map(t => ({ id: t.id, name: t.name }))
    }));

    // A restore may already have run while we were looking up members
    // (someone walked back in right at countdown zero). Don't start a fade
    // that would immediately undo it.
    if ((global.get(`${deviceId}_RestoredAt`) || 0) >= fadeStartedAt) {
      diagLog(`FADE-ABORT | ${device.name} | restore ran during member lookup — fade not started`);
      return `${device.name}: restore ran first, fade aborted`;
    }

    // Zone already active before the fade (the countdown fired just as someone
    // moved): the zone-active flow's RestoreSavedSettings has already run and
    // skipped, and no new zone trigger comes while they stay. Don't dim an
    // occupied room — the countdown starts again when it empties
    try {
      const zoneNow = await Homey.zones.getZone({ id: device.zone });
      if (zoneNow?.active === true) {
        global.set(fadeActiveUntilVar, 0);
        diagLog(`FADE-ABORT | ${device.name} | zone active before fade — not dimming an occupied room`);
        return `${device.name}: zone active, fade not started`;
      }
    } catch (e) { /* zone lookup failed — fade as before */ }

    if (isGroup) {
      log(`Group detected with ${members.length} members - applying hardware fade to each`);

      // Start fade on all members simultaneously via flow card
      await Promise.all(members.map(member =>
        fadeViaFlowCard(member)
          .then(() => log(`  ${member.name}: hardware fade started`))
          .catch(e => log(`  Warning: ${member.name} failed: ${e.message}`))
      ));

    } else {
      // Single device - apply fade via flow card
      log(`Single device - applying hardware fade via flow card`);

      try {
        await fadeViaFlowCard(device);
      } catch (e) {
        log(`Warning: Flow card fade failed: ${e.message}, using instant`);
        await device.setCapabilityValue('dim', 0);
      }
    }

    log(`Hardware fade started (${fadeDuration}s) - awaiting completion to turn off`);

    // Wait for fade to finish, then turn off lights (unless cancelled by restore)
    // NOTE: HomeyScript has no setTimeout — use the built-in async wait(ms)
    await wait(fadeDuration * 1000);

    // Skip turn-off only if a real restore happened (motion returned).
    // _RestoredAt is set by RestoreSavedSettings when it actually restores;
    // flag==0 alone was ambiguous (expired flags used to be zeroed as cleanup).
    const restoredAt = global.get(`${deviceId}_RestoredAt`) || 0;
    const flagCleared = (global.get(fadeActiveUntilVar) || 0) === 0;
    if (restoredAt >= fadeStartedAt || flagCleared) {
      log(`Fade cancelled by restore — skipping turn-off`);
      diagLog(`FADE-CANCELLED | ${device.name} | realRestore=${restoredAt >= fadeStartedAt} flagCleared=${flagCleared}`);
      return `${device.name}: Fade cancelled by motion`;
    }

    // If the zone is active (someone walked in through the door / motion), skip
    // the turn-off. The zone-active flow normally runs RestoreSavedSettings:
    // keep its window open and wait for it. If none comes (the countdown fired
    // just as the zone turned active, so RestoreSavedSettings ran before this
    // fade and skipped), restore the light here — never leave an occupied room
    // at ~0%. Safe from loops: this script runs once per inactive period
    let zoneActive = false;
    try {
      const zone = await Homey.zones.getZone({ id: device.zone });
      zoneActive = zone?.active === true;
    } catch (e) { /* zone lookup failed — fall through to turn-off */ }
    if (zoneActive) {
      log(`Zone active at fade end — waiting up to ${HOLD_WAIT_SECONDS}s for RestoreSavedSettings`);
      global.set(fadeActiveUntilVar, Date.now() + restoreBuffer * 1000);
      if (await waitForRestore(deviceId, fadeStartedAt)) {
        diagLog(`FADE-HOLD | ${device.name} | zone active at fade end — restored by RestoreSavedSettings`);
        return `${device.name}: zone active, restored`;
      }
      // Restore even if onoff reads off: Homey sets it off as the dim-to-0
      // fade starts, so off here doesn't mean a person switched it off (6.19)
      const ok = await selfRestore(deviceId, device, turnOffTargets, currentBrightness, currentTemperature, isGroup);
      diagLog(`FADE-SELF-RESTORE | ${device.name} | zone active, no restore within ${HOLD_WAIT_SECONDS}s — restored ${Math.round(currentBrightness * 100)}% to ${ok}/${turnOffTargets.length} light(s)`);
      return `${device.name}: zone active, restored here`;
    }

    await Promise.all(turnOffTargets.map(t =>
      t.setCapabilityValue('onoff', false)
        .then(() => log(`  ${t.name}: turned off`))
        .catch(e => {
          log(`  ${t.name}: turn-off failed: ${e.message}`);
          diagLog(`FADE-ERROR | ${t.name} | turn-off failed: ${e.message}`);
        })
    ));
    global.set(fadeActiveUntilVar, 0);
    global.set(`${deviceId}_AutoOffAt`, Date.now()); // Room_watchdog: a turn-on soon after is a flip-back
    diagLog(`FADE-OFF | ${device.name} | off sent to ${turnOffTargets.length} light(s)`);

    // Verify: a lost command or a late Zigbee report can leave/flip Homey's
    // state back to on. Re-check once and resend the off if needed — unless the
    // room became active in the meantime (then the lights are wanted on).
    await wait(3000);
    try {
      const check = await Homey.devices.getDevice({ id: deviceId });
      let zoneActiveNow = false;
      try {
        const zone = await Homey.zones.getZone({ id: device.zone });
        zoneActiveNow = zone?.active === true;
      } catch (e) { /* zone lookup failed — treat as inactive */ }
      if (check.capabilitiesObj?.onoff?.value === true) {
        const restoredLate = (global.get(`${deviceId}_RestoredAt`) || 0) >= fadeStartedAt;
        if (restoredLate || zoneActiveNow) {
          diagLog(`FADE-VERIFY | ${device.name} | back on but room active — leaving on`);
        } else {
          diagLog(`FADE-VERIFY | ${device.name} | still on 3s after off — resending`);
          await Promise.all(turnOffTargets.map(t =>
            t.setCapabilityValue('onoff', false)
              .catch(e => diagLog(`FADE-ERROR | ${t.name} | resend off failed: ${e.message}`))
          ));
        }
      } else if (zoneActiveNow) {
        // Someone came in between the zone check and the off: the zone-active
        // flow's "turn lights on" saw the lights still on and did nothing, and
        // the zone won't turn active again while they stay. Switch the light
        // back on — its "turned on" flow runs AdaptiveLighting for the profile
        try {
          await check.setCapabilityValue('onoff', true);
        } catch (e) {
          diagLog(`FADE-ERROR | ${device.name} | off but zone active — switching back on failed: ${e.message}`);
          return `${device.name}: faded and turned off, switching back on failed`;
        }
        diagLog(`FADE-VERIFY | ${device.name} | off but zone active — switched back on`);
        return `${device.name}: faded, turned off, back on (zone active)`;
      }
    } catch (e) { /* verification is best-effort */ }

    return `${device.name}: Faded and turned off`;
  } catch (error) {
    diagLog(`FADE-ERROR | ${deviceId.substring(0, 8)} | unexpected: ${error.message}`);
    return `ERROR (${deviceId}): ${error.message}`;
  }
}

// ====== ENTRY POINT ======
// args[0]: single device ID, or a comma-separated list of device IDs to fade
// in parallel within this one script run. No argument = B9 Lys (for test runs
// in the HomeyScript editor; logged so an empty flow card shows up)
const DEFAULT_DEVICE_ID = "b8591f4d-a493-4de7-9745-c13cd07e033c"; // B9 Lys
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!args[0]) diagLog(`FADE-DEFAULT-ID | no argument — using B9 Lys (editor test run?)`);
const rawArg = String(args[0] || DEFAULT_DEVICE_ID);
const deviceIds = rawArg.split(',').map(s => s.trim()).filter(s => s.length > 0);

const badIds = deviceIds.filter(id => !DEVICE_ID_PATTERN.test(id));
if (deviceIds.length === 0 || badIds.length > 0) {
  const what = deviceIds.length === 0 ? 'no device id' : `not a device id: ${badIds.join(', ')}`;
  diagLog(`FADE-BADARG | "${rawArg}" | ${what}`);
  return `ERROR: bad argument "${rawArg}" (${what}) — pass a device id or a comma-separated list`;
}

log(`Device ID(s): ${deviceIds.join(', ')} ${args[0] ? '(from argument)' : '(default)'}`);

const results = await Promise.all(deviceIds.map(id => processDevice(id)));
return results.join(' | ');
