// Gradual Fade Out Script (Reusable)
// Description: Saves current light settings, then starts hardware fade to off
//              Script exits immediately - bulbs handle the fading
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 5.0  2026-01-07  Complete rewrite using hardware fade
//                  - Uses Homey flow card with duration (bulb handles fade)
//                  - Script exits immediately (non-blocking)
//                  - Supports groups (applies fade to individual members)
//                  - Uses timestamp instead of boolean for fadeActive
//                  - Timestamp auto-expires (no stale flags)
//                  - Smooth, precise timing regardless of API latency
// 4.1  2026-01-07  Fix race condition with RestoreSavedSettings
// 4.0  2024-12-22  Reusable for any device, accepts device ID as argument
// -------------------------------------------------------------------------

const fadeDuration = 20; // seconds

// Get device ID from argument
const deviceId = args[0];

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
async function findGroupMembers(groupName) {
  const devices = await Homey.devices.getDevices();
  const members = [];
  
  for (const d of Object.values(devices)) {
    // Match "GroupName X/Y" pattern
    if (d.name.startsWith(groupName + ' ') && d.name !== groupName && d.class === 'light') {
      members.push(d);
    }
  }
  
  return members;
}

// Check if it's a group
const members = await findGroupMembers(device.name);
const isGroup = members.length > 0;

if (isGroup) {
  log(`Group detected with ${members.length} members - applying hardware fade to each`);
  
  // Apply fade to each member
  for (const member of members) {
    try {
      await Homey.flow.runFlowCardAction({
        uri: `homey:flowcardaction:homey:device:${member.id}:dim`,
        id: `homey:device:${member.id}:dim`,
        args: { dim: 0 },
        duration: fadeDuration
      });
    } catch (e) {
      log(`Warning: Could not start fade on ${member.name}: ${e.message}`);
    }
  }
  
} else {
  // Single device - apply fade directly
  log(`Single device - applying hardware fade`);
  
  try {
    await Homey.flow.runFlowCardAction({
      uri: `homey:flowcardaction:homey:device:${deviceId}:dim`,
      id: `homey:device:${deviceId}:dim`,
      args: { dim: 0 },
      duration: fadeDuration
    });
  } catch (e) {
    // Fallback: try setting dim directly (no fade)
    log(`Warning: Hardware fade failed, using instant: ${e.message}`);
    await device.setCapabilityValue('dim', 0);
  }
}

log(`Hardware fade started (${fadeDuration}s) - script exiting`);

return `${device.name}: Fading to off over ${fadeDuration}s`;