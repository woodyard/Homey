// Gradual Fade Out Script (Reusable)
// Description: Saves current light settings, then starts hardware fade to off
//              Script exits immediately - bulbs handle the fading
//
// Usage: Call with device ID as argument
// Example: Run HomeyScript with argument "1847a2b3-9261-4cb4-882c-14c219e4a4a3"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
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

const fadeDuration = 20; // seconds

// ====== PERSISTENT DIAGNOSTIC LOG ======
// Shared log across GradualFadeOut, RestoreSavedSettings, and AdaptiveLighting.
// All three scripts append to the same global variable: AL_DiagnostikLog
// Format: "DD.MM HH:MM:SS | ACTION | DeviceName | details..."
// Actions logged:
//   FADE-SAVE  (GradualFadeOut)   - brightness/temp saved before fade, manual mode state
//   FADE-SKIP  (GradualFadeOut)   - light already off, no fade needed
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