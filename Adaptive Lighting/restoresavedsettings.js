// Restore Saved Settings Script (Reusable)
// Description: Restores light brightness and temperature from saved variables
//              Cancels any hardware fade in progress
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
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

try {
  // Get device ID from argument
  const deviceId = args[0];

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
    return `${device.name}: No fade in progress, nothing to restore`;
  }

  // Get saved values from global variables
  const savedDim = global.get(savedDimVar);
  const savedTemp = global.get(savedTempVar);

  log(`Saved values: dim=${savedDim !== null ? Math.round(savedDim * 100) + '%' : 'N/A'}, temp=${savedTemp !== null ? Math.round(savedTemp * 100) + '%' : 'N/A'}`);

  // Clear timestamp immediately - allows AdaptiveLighting to update to correct profile
  // Clearing it BEFORE restore ensures that when the light turns on (triggering AL),
  // AL sees the flag as cleared and applies the correct time-based profile.
  global.set(fadeActiveUntilVar, 0);
  log(`Fade timestamp cleared (allows AdaptiveLighting to update)`);

  // Find group members (to cancel hardware fade on each)
  async function findGroupMembers(groupName) {
    const devices = await Homey.devices.getDevices();
    const members = [];
    
    for (const d of Object.values(devices)) {
      if (d.name.startsWith(groupName + ' ') && d.name !== groupName && d.class === 'light') {
        members.push(d);
      }
    }
    
    return members;
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
  const members = await findGroupMembers(device.name);
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