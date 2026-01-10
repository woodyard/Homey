/**
 * AdaptiveLighting Diagnostics
 * Version: 1.0
 * 
 * Shows status of all devices tracked by AdaptiveLighting
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
      const brightness = device.capabilitiesObj?.dim?.value;
      const temp = device.capabilitiesObj?.light_temperature?.value;
      if (brightness !== undefined) {
        const bPct = Math.round(brightness * 100);
        const tPct = temp !== null ? Math.round(temp * 100) : 'N/A';
        log(`         Aktuelle værdier: ${bPct}% / ${tPct}`);
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