/**
 * AdaptiveLighting Diagnostics
 * Version: 1.1
 *
 * Shows status of all devices tracked by AdaptiveLighting, including:
 * - Current brightness/temperature
 * - Saved settings (from GradualFadeOut)
 * - Active fade timers
 * - Manual mode status
 */

const states = JSON.parse(global.get('AL_DeviceStates') || '{}');
const devices = await Homey.devices.getDevices();

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

const keys = Object.keys(states);

if (keys.length === 0) {
  log("Ingen enheder registreret endnu.");
  log("Kør scriptet på en enhed for at initialisere.");
} else {
  log(`Registrerede enheder: ${keys.length}`);
  log("");
  
  for (const key of keys) {
    const state = states[key];
    const device = findDevice(key);
    const deviceName = device ? device.name : `Ukendt (${key})`;
    
    const manualIcon = state.manual ? "🔴 MANUEL" : "🟢 AUTO";
    const lastProfile = state.lastProfile || "N/A";
    
    log(`${manualIcon}  ${deviceName}`);
    log(`         Last profile: ${lastProfile}`);
    
    if (device) {
      // Current values
      const brightness = device.capabilitiesObj?.dim?.value;
      const temp = device.capabilitiesObj?.light_temperature?.value;
      if (brightness !== undefined) {
        const bPct = Math.round(brightness * 100);
        const tPct = temp !== null ? Math.round(temp * 100) : 'N/A';
        log(`         Aktuelle værdier: ${bPct}% / ${tPct}`);
      }

      // Saved Settings
      const savedDim = global.get(`${device.id}_SavedDim`);
      const savedTemp = global.get(`${device.id}_SavedTemp`);
      if (savedDim !== null || savedTemp !== null) { // null or undefined check
        const sDim = savedDim !== null && savedDim !== undefined ? Math.round(savedDim * 100) + '%' : 'N/A';
        const sTemp = savedTemp !== null && savedTemp !== undefined ? Math.round(savedTemp * 100) + '%' : 'N/A';
        log(`         Gemte indstillinger: Dim=${sDim}, Temp=${sTemp}`);
      }

      // Fade Status
      const fadeActiveUntil = global.get(`${device.id}_FadeActiveUntil`) || 0;
      const alFade = global.get(`AL_Fade_${key}`) || 0;
      const now = Date.now();
      
      if (now < fadeActiveUntil) {
        const remaining = Math.round((fadeActiveUntil - now) / 1000);
        log(`         ⏳ Fade active (Script): ${remaining}s remaining`);
      }
      
      if (now < alFade) {
        const remaining = Math.round((alFade - now) / 1000);
        log(`         ⏳ Fade active (AL): ${remaining}s remaining`);
      }
    }
    log("");
  }
}

log("═══════════════════════════════════════════════════");

// Summary
const manualCount = keys.filter(k => states[k].manual).length;
const autoCount = keys.length - manualCount;

log(`Sammenfatning: ${autoCount} auto, ${manualCount} manuel`);