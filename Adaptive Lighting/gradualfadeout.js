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

// ====== PERSISTENT DIAGNOSTIC LOG ======
// Shared log across GradualFadeOut, RestoreSavedSettings, and AdaptiveLighting.
// All three scripts append to the same global variable: AL_DiagnostikLog
// Format: "DD.MM HH:MM:SS | ACTION | DeviceName | details..."
// Actions logged:
//   FADE-SAVE  (GradualFadeOut)   - brightness/temp saved before fade, manual mode state
//   FADE-SKIP  (GradualFadeOut)   - light already off, no fade needed
//   FADE-CANCELLED (GradualFadeOut) - fade aborted early because of a restore/cleared flag
//   RESTORE    (RestoreSavedSettings) - brightness/temp restored, manual mode preserved
//   RESTORE-SKIP (RestoreSavedSettings) - fade expired, nothing to restore
//   AL-SKIP-FADE (AdaptiveLighting) - skipped because fade/restore in progress
//   AL-SKIP-MANUAL (AdaptiveLighting) - skipped because ManualRestoreUntil active
//   AL-APPLY   (AdaptiveLighting) - profile applied (brightness/temp/profile name)
// Max 500 lines retained (oldest trimmed). Read via: global.get('AL_DiagnostikLog')
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

// Find group members
// Group devices lack button.migrate_v3; individual Zigbee bulbs have it.
// Strategy 1: Name-based ("SV Loft" → "SV Loft 1/2/3")
// Strategy 2: Zone-based fallback, only if target is a group ("B9 Lys" → "B9 Wall 1/2/3")
async function findGroupMembers(groupDevice) {
  const isGroup = !groupDevice.capabilities?.includes('button.migrate_v3');
  const devices = await Homey.devices.getDevices();
  const allDevices = Object.values(devices);

  // Try name-based first
  const nameMembers = allDevices.filter(d =>
    d.name.startsWith(groupDevice.name + ' ') && d.name !== groupDevice.name && d.class === 'light'
  );
  if (nameMembers.length > 0) {
    log(`Group detected by name pattern (${nameMembers.length} members)`);
    return nameMembers;
  }

  // Zone fallback — only if target device is a group (no button.migrate_v3)
  if (isGroup) {
    const zoneMembers = allDevices.filter(d =>
      d.zone === groupDevice.zone && d.id !== groupDevice.id && d.class === 'light'
    );
    if (zoneMembers.length > 0) {
      log(`Group detected by zone fallback (${zoneMembers.length} members in same zone)`);
      return zoneMembers;
    }
  }

  return [];
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

    // Save current settings to global variables
    global.set(savedDimVar, currentBrightness);
    if (currentTemperature !== null) {
      global.set(savedTempVar, currentTemperature);
    }

    // Store timestamp when fade will complete (with buffer for restore window)
    const fadeStartedAt = Date.now();
    const fadeActiveUntil = fadeStartedAt + ((fadeDuration + restoreBuffer) * 1000);
    global.set(fadeActiveUntilVar, fadeActiveUntil);

    // Save manual mode state from AdaptiveLighting per-device state (for restore coordination)
    const alDeviceKey = deviceId.substring(0, 8);
    let wasManualMode = false;
    try {
      const alRaw = global.get(`AL_Device_${alDeviceKey}.State`);
      if (alRaw) wasManualMode = JSON.parse(alRaw).manual === true;
    } catch (e) { /* parse error — treat as not manual */ }
    global.set(`${deviceId}_SavedManualMode`, wasManualMode);

    log(`Saved: dim=${Math.round(currentBrightness * 100)}%, temp=${currentTemperature !== null ? Math.round(currentTemperature * 100) + '%' : 'N/A'}${wasManualMode ? ' (manual mode)' : ''}`);
    log(`Fade active until: ${new Date(fadeActiveUntil).toLocaleTimeString()}`);
    diagLog(`FADE-SAVE | ${device.name} | dim=${Math.round(currentBrightness * 100)}% temp=${currentTemperature !== null ? Math.round(currentTemperature * 100) + '%' : 'N/A'} | manual=${wasManualMode} | fadeUntil=${new Date(fadeActiveUntil).toLocaleTimeString('da-DK', { timeZone: 'Europe/Copenhagen' })}`);

    // If light is already off or very dim, just turn it off
    if (currentBrightness <= 0.05) {
      await device.setCapabilityValue('onoff', false);
      global.set(fadeActiveUntilVar, 0); // Clear - no fade needed
      diagLog(`FADE-SKIP | ${device.name} | already off/very dim (${Math.round(currentBrightness * 100)}%)`);
      return `${device.name}: Already off or very dim`;
    }

    // Check if it's a group
    const members = await findGroupMembers(device);
    const isGroup = members.length > 0;

    // Determine turn-off targets (members for groups, device itself otherwise)
    const turnOffTargets = isGroup ? members : [device];

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
    // the turn-off and leave the restore window open — the zone-active flow has
    // already queued RestoreSavedSettings, which will restore brightness even if
    // it runs a few seconds from now.
    try {
      const zone = await Homey.zones.getZone({ id: device.zone });
      if (zone?.active === true) {
        log(`Zone active at fade end — leaving restore window open, skipping turn-off`);
        diagLog(`FADE-HOLD | ${device.name} | zone active at fade end — restore will handle`);
        return `${device.name}: zone active, turn-off skipped`;
      }
    } catch (e) { /* zone lookup failed — fall through to turn-off */ }

    await Promise.all(turnOffTargets.map(t =>
      t.setCapabilityValue('onoff', false)
        .then(() => log(`  ${t.name}: turned off`))
        .catch(e => {
          log(`  ${t.name}: turn-off failed: ${e.message}`);
          diagLog(`FADE-ERROR | ${t.name} | turn-off failed: ${e.message}`);
        })
    ));
    global.set(fadeActiveUntilVar, 0);
    diagLog(`FADE-OFF | ${device.name} | off sent to ${turnOffTargets.length} light(s)`);

    // Verify: a lost command or a late Zigbee report can leave/flip Homey's
    // state back to on. Re-check once and resend the off if needed — unless the
    // room became active in the meantime (then the lights are wanted on).
    await wait(3000);
    try {
      const check = await Homey.devices.getDevice({ id: deviceId });
      if (check.capabilitiesObj?.onoff?.value === true) {
        const restoredLate = (global.get(`${deviceId}_RestoredAt`) || 0) >= fadeStartedAt;
        let zoneActiveNow = false;
        try {
          const zone = await Homey.zones.getZone({ id: device.zone });
          zoneActiveNow = zone?.active === true;
        } catch (e) { /* zone lookup failed — treat as inactive */ }
        if (restoredLate || zoneActiveNow) {
          diagLog(`FADE-VERIFY | ${device.name} | back on but room active — leaving on`);
        } else {
          diagLog(`FADE-VERIFY | ${device.name} | still on 3s after off — resending`);
          await Promise.all(turnOffTargets.map(t =>
            t.setCapabilityValue('onoff', false)
              .catch(e => diagLog(`FADE-ERROR | ${t.name} | resend off failed: ${e.message}`))
          ));
        }
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
// in parallel within this one script run (default: Bathroom 9)
const rawArg = args[0] || "b8591f4d-a493-4de7-9745-c13cd07e033c";
const deviceIds = rawArg.split(',').map(s => s.trim()).filter(s => s.length > 0);

if (deviceIds.length === 0) {
  return 'ERROR: No device ID provided. Pass device ID as argument.';
}

log(`Device ID(s): ${deviceIds.join(', ')} ${args[0] ? '(from argument)' : '(default)'}`);

const results = await Promise.all(deviceIds.map(id => processDevice(id)));
return results.join(' | ');
