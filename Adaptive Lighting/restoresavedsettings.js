// Restore Saved Settings Script (Reusable)
// Description: Restores light brightness and temperature from saved variables
//              Cancels any hardware fade in progress
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// Version: 4.6 (2026-10-28) — history in CHANGELOG.md

// ====== SCRIPT SETTINGS ======
const SETTINGS = {
  enableDetailedLogging: false
};

// ====== PERSISTENT DIAGNOSTIC LOG ======
// Shared log across GradualFadeOut, RestoreSavedSettings, and AdaptiveLighting.
// All three scripts append to the same global variable: AL_DiagnostikLog
// See GradualFadeOut header comment for full format and action descriptions.
// Max 500 lines retained. Read via: global.get('AL_DiagnostikLog')
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
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

try {
  // Device ID from the argument. No argument = B9 Lys (for test runs in the
  // HomeyScript editor; logged so an empty flow card shows up)
  const DEFAULT_DEVICE_ID = "b8591f4d-a493-4de7-9745-c13cd07e033c"; // B9 Lys
  if (!args[0]) diagLog(`RESTORE-DEFAULT-ID | no argument — using B9 Lys (editor test run?)`);
  const deviceId = String(args[0] || DEFAULT_DEVICE_ID).trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    diagLog(`RESTORE-BADARG | "${deviceId}" | not a device id`);
    return `ERROR: bad argument "${deviceId}" — pass a device id`;
  }

  // Create unique variable names based on device ID
  const savedDimVar = `${deviceId}_SavedDim`;
  const savedTempVar = `${deviceId}_SavedTemp`;
  const fadeActiveUntilVar = `${deviceId}_FadeActiveUntil`;

  // FAST PATH: Check fade timestamp BEFORE fetching device (avoids API call on skip)
  const fadeActiveUntil = global.get(fadeActiveUntilVar) || 0;
  const now = Date.now();
  const fadeActive = now < fadeActiveUntil;

  if (!fadeActive) {
    // No active fade — clean up stale values and exit immediately
    const staleVal = global.get(savedDimVar);
    if (staleVal !== null) {
      global.set(savedDimVar, null);
      global.set(savedTempVar, null);
      global.set(`${deviceId}_FadeTargets`, null);
      // NOTE: do NOT zero _FadeActiveUntil here — it is already expired, and
      // zeroing it races GradualFadeOut/watchdog's post-fade turn-off check
    }
    return `No active fade for ${deviceId.substring(0, 8)}, skipped`;
  }

  // ACTIVE FADE — restore
  log(`Fade active (${Math.round((fadeActiveUntil - now) / 1000)}s remaining) - restoring`);

  // Get saved values from global variables
  const savedDim = global.get(savedDimVar);
  const savedTemp = global.get(savedTempVar);

  log(`Saved values: dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'}, temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'}`);

  // Clear fade timestamp AND mark the restore in the same tick, before any
  // API call: AdaptiveLighting (normal mode) reads both and must never see
  // "flag cleared, no restore" in between
  global.set(fadeActiveUntilVar, 0);
  global.set(`${deviceId}_RestoredAt`, Date.now());
  log(`Fade timestamp cleared`);

  // AdaptiveLighting's manual flag, for the log line only. A restore never
  // changes it; AL's restoreGraceSeconds (via _RestoredAt) keeps a late
  // "turned on" trigger from overriding the restored values
  let wasManualMode = false;
  try {
    const alRaw = global.get(`AL_Device_${deviceId.substring(0, 8)}.State`);
    if (alRaw) wasManualMode = JSON.parse(alRaw).manual === true;
  } catch (e) { /* parse error — treat as not manual */ }

  // FAST PATH: GradualFadeOut/watchdog cached the exact bulbs they faded.
  // Restore those directly by ID — no device fetch, no full device dump.
  let cached = null;
  try {
    const raw = global.get(`${deviceId}_FadeTargets`);
    if (raw) cached = JSON.parse(raw);
  } catch (e) { cached = null; }

  if (cached && Array.isArray(cached.targets) && cached.targets.length > 0) {
    const displayName = cached.name || deviceId.substring(0, 8);
    diagLog(`RESTORE | ${displayName} | dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'} temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'} | manual=${!!wasManualMode} | fadeRemaining=${Math.round((fadeActiveUntil - now) / 1000)}s | targets=${cached.targets.length} (cached)`);

    // Restore one bulb by ID. Dim goes through the flow card with a short
    // duration to override the running hardware fade; temperature in parallel.
    async function restoreById(target, dim, temp) {
      const ops = [];
      if (dim !== null && dim !== undefined && dim > 0) {
        ops.push(
          Homey.flow.runFlowCardAction({
            uri: `homey:device:${target.id}`,
            id: `homey:device:${target.id}:dim`,
            args: { dim },
            duration: 0.5
          }).catch(async () => {
            const dev = await Homey.devices.getDevice({ id: target.id });
            await dev.setCapabilityValue('dim', dim);
          })
        );
      }
      if (temp !== null && temp !== undefined) {
        ops.push(
          Homey.devices.setCapabilityValue({ deviceId: target.id, capabilityId: 'light_temperature', value: temp })
            .catch(() => null) // device might not support temperature
        );
      }
      await Promise.all(ops);
    }

    const results = await Promise.all(cached.targets.map(t =>
      restoreById(t, savedDim, savedTemp)
        .then(() => { log(`  ✓ Restored: ${t.name || t.id}`); return true; })
        .catch(e => { log(`  ✗ Failed: ${t.name || t.id} - ${e.message}`); return false; })
    ));

    // Group device: also set the group itself (UI consistency). Not on the
    // perceived-latency path — the bulbs already have their commands.
    const isGroupTarget = !(cached.targets.length === 1 && cached.targets[0].id === deviceId);
    if (isGroupTarget && savedDim !== null && savedDim > 0) {
      try {
        await Homey.devices.setCapabilityValue({ deviceId, capabilityId: 'dim', value: savedDim });
      } catch (e) { /* group device might lag behind */ }
    }

    const okCount = results.filter(r => r).length;
    if (okCount === 0) {
      diagLog(`RESTORE-ERROR | ${displayName} | all ${cached.targets.length} cached target(s) failed`);
    } else if (okCount < cached.targets.length) {
      const failedNames = cached.targets.filter((t, i) => !results[i]).map(t => t.name || t.id);
      diagLog(`RESTORE-PARTIAL | ${displayName} | ${failedNames.length}/${cached.targets.length} failed: ${failedNames.join(', ')}`);
    }
    return `${displayName}: Restored ${okCount}/${cached.targets.length} to ${Math.round(savedDim * 100)}%${savedTemp !== null ? ` / ${Math.round(savedTemp * 100)}% temp` : ''}`;
  }

  // FALLBACK: no cached targets — discover them the slow way
  let device;
  try {
    device = await Homey.devices.getDevice({ id: deviceId });
  } catch (error) {
    diagLog(`RESTORE-ERROR | ${deviceId.substring(0, 8)} | device not found: ${error.message}`);
    return `ERROR: Device not found with ID: ${deviceId}`;
  }

  diagLog(`RESTORE | ${device.name} | dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'} temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'} | manual=${!!wasManualMode} | fadeRemaining=${Math.round((fadeActiveUntil - now) / 1000)}s | targets=discovered`);

  // Bulbs to restore: a single Hue bulb has none; otherwise bulbs by name, else
  // every light in its zone (logged — a bulb is probably misnamed)
  async function findGroupMembers(groupDevice) {
    if (isHueBulb(groupDevice)) return [];
    const { members, viaZone } = groupMembers(groupDevice, await Homey.devices.getDevices());
    if (viaZone) diagLog(`RESTORE-ZONE-FALLBACK | ${groupDevice.name} | no "${groupDevice.name} <n>" lights — using ${members.length} light(s) in its zone`);
    return members;
  }

  // Restore function for a single device
  // Uses flow card with short duration to cancel any in-progress hardware fade.
  // Plain setCapabilityValue doesn't interrupt a running move_to_level on many bulbs.
  async function restoreDevice(dev, dim, temp) {
    const ops = [];
    if (dim !== null && dim !== undefined && dim > 0) {
      ops.push(
        Homey.flow.runFlowCardAction({
          uri: `homey:device:${dev.id}`,
          id: `homey:device:${dev.id}:dim`,
          args: { dim },
          duration: 0.5
        }).catch(() => dev.setCapabilityValue('dim', dim))
      );
    }
    if (temp !== null && temp !== undefined) {
      // Device might not support temperature — ignore failures
      ops.push(dev.setCapabilityValue('light_temperature', temp).catch(() => null));
    }
    await Promise.all(ops);
  }

  // Check if it's a group
  const members = await findGroupMembers(device);
  const isGroup = members.length > 0;

  if (isGroup) {
    log(`Restoring ${members.length} group members`);
    
    // Restore all members simultaneously
    const restorePromises = members.map(member =>
      restoreDevice(member, savedDim, savedTemp)
        .then(() => {
          log(`  ✓ Restored: ${member.name}`);
          return { success: true, name: member.name };
        })
        .catch(e => {
          log(`  ✗ Failed: ${member.name} - ${e.message}`);
          return { error: true, name: member.name };
        })
    );
    
    const restoreResults = await Promise.all(restorePromises);
    const failedMembers = restoreResults.filter(r => r.error).map(r => r.name);
    if (failedMembers.length === members.length) {
      diagLog(`RESTORE-ERROR | ${device.name} | all ${members.length} member(s) failed`);
    } else if (failedMembers.length > 0) {
      diagLog(`RESTORE-PARTIAL | ${device.name} | ${failedMembers.length}/${members.length} failed: ${failedMembers.join(', ')}`);
    }

    // Also set the group itself (for UI consistency)
    try {
      await restoreDevice(device, savedDim, savedTemp);
    } catch (e) {
      // Group device might lag behind
    }
    
  } else {
    // Single device
    await restoreDevice(device, savedDim, savedTemp);
    log(`✓ Restored brightness to ${Math.round(savedDim * 100)}%`);
  }

  return `${device.name}: Restored to ${Math.round(savedDim * 100)}%${savedTemp !== null ? ` / ${Math.round(savedTemp * 100)}% temp` : ''}`;

} catch (error) {
  log(`UNEXPECTED ERROR: ${error.message}`);
  log(`Stack: ${error.stack}`);
  // Flow runs never show the console — leave a trace in the shared log
  try {
    diagLog(`RESTORE-ERROR | ${String(args[0] || '').substring(0, 8)} | unexpected: ${error.message}`);
  } catch (e) { /* ignore */ }
  return `UNEXPECTED ERROR: ${error.message}`;
}