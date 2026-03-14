// Restore Saved Settings Script (Reusable)
// Description: Restores light brightness and temperature from saved variables
//              Cancels any hardware fade in progress
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 3.7  2026-03-04  Persistent diagnostic logging (AL_DiagnostikLog)
//                  - Logs restore events with timestamp, device, brightness, manual mode
//                  - Shared log variable with GradualFadeOut and AdaptiveLighting
//                  - Helps diagnose unexpected dim-light issues across profile transitions
// 3.6  2026-03-02  Zone-based fallback for group member detection
//                  - Name-based matching fails for B9 ("B9 Lys" vs "B9 Wall 1/2/3")
//                  - Zone fallback finds members in same zone when names don't match
//                  - Matches GradualFadeOut v6.0 group detection logic
//                  - Ensures hardware fade is properly cancelled on all member bulbs
// 3.5  2026-03-02  Preserve manual mode on restore
//                  - Reads _SavedManualMode flag set by GradualFadeOut
//                  - Sets short-lived _ManualRestoreUntil timestamp
//                  - Signals AdaptiveLighting to skip profile application
//                  - Ensures user's manual brightness adjustments survive fade/restore
// 3.4  2026-02-04  Fix race condition with AdaptiveLighting
//                  - Clear fade timestamp BEFORE restoring settings
//                  - Ensures AdaptiveLighting sees cleared flag when triggered by turn-on
// 3.3  2026-01-14  Parallel restore for group members
//                  - All bulbs restore simultaneously
//                  - Uses Promise.all() for parallel execution
//                  - Instant, synchronized restore
// 3.2  2026-01-09  Fix restore skip logic
//                  - Only restore if fade is ACTUALLY active (timestamp not expired)
//                  - Prevents restoring old values from expired fades
//                  - Fixes issue where old saved brightness was restored on motion
// 3.1  2026-01-07  Extend timestamp instead of clearing
//                  - Prevents AdaptiveLighting from overriding restored values
//                  - 3 second buffer allows "light turned on" trigger to complete
//                  - Then timestamp expires and normal operation resumes
// 3.0  2026-01-07  Updated for hardware fade (timestamp-based)
//                  - Uses fadeActiveUntil timestamp instead of boolean
//                  - Timestamp auto-expires (no stale flags)
//                  - Restores to group members for smooth cancel
//                  - No race condition with GradualFadeOut
// 2.1  2024-12-22  Added detailed error handling and logging
// -------------------------------------------------------------------------

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

try {
  // Get device ID from argument, or use default (Bathroom 9)
  const deviceId = args[0] || "b8591f4d-a493-4de7-9745-c13cd07e033c";
  
  log(`Device ID: ${deviceId} ${args[0] ? '(from argument)' : '(default)'}`);

  if (!deviceId) {
    log('ERROR: No device ID provided');
    return 'ERROR: No device ID provided. Pass device ID as argument.';
  }

  log(`Checking restore for device: ${deviceId}`);

  // Get the device
  let device;
  try {
    device = await Homey.devices.getDevice({ id: deviceId });
    log(`Device found: ${device.name}`);
  } catch (error) {
    log(`ERROR: Device not found - ${error.message}`);
    return `ERROR: Device not found with ID: ${deviceId}`;
  }

  // Create unique variable names based on device ID
  const savedDimVar = `${deviceId}_SavedDim`;
  const savedTempVar = `${deviceId}_SavedTemp`;
  const fadeActiveUntilVar = `${deviceId}_FadeActiveUntil`;

  // Check if fade is/was active (timestamp-based)
  const fadeActiveUntil = global.get(fadeActiveUntilVar) || 0;
  const now = Date.now();
  const fadeActive = now < fadeActiveUntil;
  
  if (fadeActiveUntil > 0) {
    const diff = fadeActiveUntil - now;
    if (fadeActive) {
      log(`Fade still active (${Math.round(diff / 1000)}s remaining)`);
    } else {
      log(`Fade expired ${Math.round(-diff / 1000)}s ago`);
    }
  }

  // Skip if no fade is active (regardless of old timestamps)
  if (!fadeActive) {
    if (fadeActiveUntil > 0 && SETTINGS.enableDetailedLogging) {
      log(`Fade expired ${Math.round((now - fadeActiveUntil) / 1000)}s ago - skipping restore`);
    }
    log('No active fade - skipping restore');
    const staleVal = global.get(savedDimVar);
    diagLog(`RESTORE-SKIP | ${device.name} | no active fade (expired ${Math.round((now - fadeActiveUntil) / 1000)}s ago) | stale saved dim=${staleVal !== null ? Math.round(staleVal * 100) + '%' : 'N/A'}`);
    return `${device.name}: No fade in progress, nothing to restore`;
  }

  // Get saved values from global variables
  const savedDim = global.get(savedDimVar);
  const savedTemp = global.get(savedTempVar);

  log(`Saved values: dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'}, temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'}`);

  // Clear fade timestamp - allows AdaptiveLighting to proceed
  global.set(fadeActiveUntilVar, 0);
  log(`Fade timestamp cleared`);

  // If device was in manual mode before fade, signal AdaptiveLighting to preserve it
  const wasManualMode = global.get(`${deviceId}_SavedManualMode`);
  if (wasManualMode) {
    global.set(`${deviceId}_ManualRestoreUntil`, Date.now() + 10000); // 10s window
    global.set(`${deviceId}_SavedManualMode`, null); // Consumed
    log(`Manual mode preserved - AdaptiveLighting will respect restored values`);
  }

  diagLog(`RESTORE | ${device.name} | dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'} temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'} | manual=${!!wasManualMode} | fadeRemaining=${Math.round((fadeActiveUntil - now) / 1000)}s`);

  // Find group members (to cancel hardware fade on each)
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

  // Restore function for a single device
  async function restoreDevice(dev, dim, temp) {
    if (dim !== null && dim !== undefined && dim > 0) {
      await dev.setCapabilityValue('dim', dim);
    }
    if (temp !== null && temp !== undefined) {
      try {
        await dev.setCapabilityValue('light_temperature', temp);
      } catch (e) {
        // Device might not support temperature
      }
    }
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
          log(`  âœ" Restored: ${member.name}`);
          return { success: true, name: member.name };
        })
        .catch(e => {
          log(`  âœ— Failed: ${member.name} - ${e.message}`);
          return { error: true, name: member.name };
        })
    );
    
    await Promise.all(restorePromises);
    
    // Also set the group itself (for UI consistency)
    try {
      await restoreDevice(device, savedDim, savedTemp);
    } catch (e) {
      // Group device might lag behind
    }
    
  } else {
    // Single device
    await restoreDevice(device, savedDim, savedTemp);
    log(`âœ“ Restored brightness to ${Math.round(savedDim * 100)}%`);
  }

  return `${device.name}: Restored to ${Math.round(savedDim * 100)}%${savedTemp !== null ? ` / ${Math.round(savedTemp * 100)}% temp` : ''}`;

} catch (error) {
  log(`UNEXPECTED ERROR: ${error.message}`);
  log(`Stack: ${error.stack}`);
  return `UNEXPECTED ERROR: ${error.message}`;
}