// Gradual Fade Out Script (Reusable)
// Description: Saves current light settings, then starts hardware fade to off
//              Script exits immediately - bulbs handle the fading
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
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

const fadeDuration = 20; // seconds

// Get device ID from argument, or use default (Bathroom 9)
const deviceId = args[0] || "b8591f4d-a493-4de7-9745-c13cd07e033c";

log(`Device ID: ${deviceId} ${args[0] ? '(from argument)' : '(default)'}`);

if (!deviceId) {
  return 'ERROR: No device ID provided. Pass device ID as argument.';
}

// Get the device
let device;
try {
  device = await Homey.devices.getDevice({ id: deviceId });
} catch (error) {
  return `ERROR: Device not found with ID: ${deviceId}`;
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

// Store timestamp when fade will complete (with small buffer for restore window)
const fadeActiveUntil = Date.now() + (fadeDuration * 1000) + 2000; // +2s buffer
global.set(fadeActiveUntilVar, fadeActiveUntil);

log(`Saved: dim=${Math.round(currentBrightness * 100)}%, temp=${currentTemperature !== null ? Math.round(currentTemperature * 100) + '%' : 'N/A'}`);
log(`Fade active until: ${new Date(fadeActiveUntil).toLocaleTimeString()}`);

// If light is already off or very dim, just turn it off
if (currentBrightness <= 0.05) {
  await device.setCapabilityValue('onoff', false);
  global.set(fadeActiveUntilVar, 0); // Clear - no fade needed
  return `${device.name}: Already off or very dim`;
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

// Check if it's a group
const members = await findGroupMembers(device);
const isGroup = members.length > 0;

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

if (isGroup) {
  log(`Group detected with ${members.length} members - applying hardware fade to each`);

  // Start fade on all members simultaneously via flow card
  const fadePromises = members.map(member =>
    fadeViaFlowCard(member)
      .then(() => {
        log(`  ${member.name}: hardware fade started`);
        return { name: member.name, ok: true };
      })
      .catch(e => {
        log(`  Warning: ${member.name} failed: ${e.message}`);
        return { name: member.name, ok: false };
      })
  );

  await Promise.all(fadePromises);

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

log(`Hardware fade started (${fadeDuration}s) - script exiting`);

return `${device.name}: Fading to off over ${fadeDuration}s`;