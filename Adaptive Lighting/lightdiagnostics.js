/**
 * AdaptiveLighting Diagnostics
 * Version: 1.4
 *
 * VERSION HISTORY:
 * -------------------------------------------------------------------------
 * 1.4  2026-03-31  Show full device picture including GradualFadeOut state
 *                  - Shows SavedDim, SavedTemp, FadeActiveUntil, SavedManualMode
 *                  - Raw state dump includes both AL state and external variables
 * 1.3  2026-03-31  Per-device state variables (AL_Device_<key>.State)
 *                  - Reads device index from AL_DeviceKeys
 *                  - Reads each device state individually
 *                  - Shows forced profile index when active
 * 1.2  2026-03-31  Read unified device state (fadeEndTime, forcedProfile)
 * 1.1  Initial     Basic diagnostics for manual mode and fade timers
 * -------------------------------------------------------------------------
 *
 * Shows status of all devices tracked by AdaptiveLighting, including:
 * - Current brightness/temperature
 * - Saved settings (from GradualFadeOut)
 * - Active fade timers (per-device state + external)
 * - Manual mode status
 * - Forced profile status
 */

const deviceKeys = JSON.parse(global.get('AL_DeviceKeys') || '[]');
const devices = await Homey.devices.getDevices();

// Read per-device state
function readState(key) {
  try {
    const raw = global.get(`AL_Device_${key}.State`);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// Find device name from short ID
function findDevice(shortId) {
  for (const device of Object.values(devices)) {
    if (device.id.startsWith(shortId)) {
      return device;
    }
  }
  return null;
}

log("═══════════════════════════════════════════════════");
log("       ADAPTIVE LIGHTING DIAGNOSTICS");
log("═══════════════════════════════════════════════════");
log("");

if (deviceKeys.length === 0) {
  log("No devices registered yet.");
  log("Run the script on a device to initialize.");
} else {
  log(`Registered devices: ${deviceKeys.length}`);
  log("");

  let manualCount = 0;
  let forcedCount = 0;

  for (const key of deviceKeys) {
    const state = readState(key);
    const device = findDevice(key);
    const deviceName = device ? device.name : `Unknown (${key})`;

    const manualIcon = state.manual ? "🔴 MANUAL" : "🟢 AUTO";
    const lastProfile = state.lastProfile || "N/A";

    if (state.manual) manualCount++;

    log(`${manualIcon}  ${deviceName}`);
    log(`         Last profile: ${lastProfile}`);

    // Forced profile
    const fp = state.forcedProfile;
    if (fp && fp.index >= 0 && fp.index <= 3) {
      const profileNames = ['Morning', 'Daytime', 'Evening', 'Night'];
      log(`         🔒 Forced profile: ${fp.index} (${profileNames[fp.index]})${fp.profiles ? ' [schedule cached]' : ''}`);
      forcedCount++;
    }

    if (device) {
      // Current values
      const brightness = device.capabilitiesObj?.dim?.value;
      const temp = device.capabilitiesObj?.light_temperature?.value;
      if (brightness !== undefined) {
        const bPct = Math.round(brightness * 100);
        const tPct = temp !== null ? Math.round(temp * 100) : 'N/A';
        log(`         Current values: ${bPct}% / ${tPct}`);
      }

      // Current values
      const now = Date.now();

      // GradualFadeOut / watchdog state (external variables)
      const savedDim = global.get(`${device.id}_SavedDim`);
      const savedTemp = global.get(`${device.id}_SavedTemp`);
      const fadeActiveUntil = global.get(`${device.id}_FadeActiveUntil`) || 0;
      const fadeActive = global.get(`${device.id}_FadeActive`) || false;
      const savedManualMode = global.get(`${device.id}_SavedManualMode`);

      if (savedDim !== null && savedDim !== undefined) {
        const sDim = Math.round(savedDim * 100) + '%';
        const sTemp = savedTemp !== null && savedTemp !== undefined ? Math.round(savedTemp * 100) + '%' : 'N/A';
        log(`         Saved settings: Dim=${sDim}, Temp=${sTemp}${savedManualMode ? ' (was manual)' : ''}`);
      }

      // Fade Status - AL's own transition tracking
      const alFadeEnd = state.fadeEndTime || 0;

      if (now < alFadeEnd) {
        const remaining = Math.round((alFadeEnd - now) / 1000);
        log(`         ⏳ Fade active (AL): ${remaining}s remaining`);
      }

      // Fade Status - external (GradualFadeOut / watchdog)
      if (now < fadeActiveUntil) {
        const remaining = Math.round((fadeActiveUntil - now) / 1000);
        log(`         ⏳ Fade active (Script): ${remaining}s remaining`);
      }
      if (fadeActive) {
        log(`         ⏳ Fade active (legacy flag)`);
      }
    }
    log("");
  }

  log("═══════════════════════════════════════════════════");

  const autoCount = deviceKeys.length - manualCount;
  log(`Summary: ${autoCount} auto, ${manualCount} manual, ${forcedCount} forced`);

  // Raw state objects
  log("");
  log("═══════════════════════════════════════════════════");
  log("       RAW STATE OBJECTS");
  log("═══════════════════════════════════════════════════");
  log("");

  for (const key of deviceKeys) {
    const state = readState(key);
    const device = findDevice(key);
    const deviceName = device ? device.name : `Unknown (${key})`;
    const deviceId = device ? device.id : null;

    // Merge AL state + external GradualFadeOut/watchdog variables
    const fullState = { ...state };
    if (deviceId) {
      fullState._external = {
        savedDim: global.get(`${deviceId}_SavedDim`) ?? null,
        savedTemp: global.get(`${deviceId}_SavedTemp`) ?? null,
        fadeActiveUntil: global.get(`${deviceId}_FadeActiveUntil`) || 0,
        fadeActive: global.get(`${deviceId}_FadeActive`) || false,
        savedManualMode: global.get(`${deviceId}_SavedManualMode`) ?? null
      };
    }

    log(`── ${deviceName} (${key}) ──`);
    log(JSON.stringify(fullState, null, 2));
    log("");
  }
}