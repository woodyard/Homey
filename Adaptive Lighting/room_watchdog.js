// Room Watchdog - Safety net for lights stuck on after idle timeout
// Description: Periodically checks if lights are stuck on while room is idle.
//              If idle longer than the room's InactivitySeconds, triggers fade to off.
//              Catches cases where the normal zone-inactive → countdown → fade chain fails.
//
// Usage: Pass room name as argument (e.g. "B9" or "E9")
//        Each room's config (devices, sensors, variables) is defined below.
//
// Setup: Create a Homey flow per room:
//        Trigger: "Every 2 minutes"
//        Action:  Run HomeyScript "Room_Watchdog" with argument "B9"
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 2.4  2026-03-31  Read manual mode from per-device state variable
//                  - Reads AL_Device_<key>.State instead of combined AL_DeviceStates
//                  - Faster: only parses one device's state, not the entire blob
// 2.3  2026-03-30  Skip turn-off if fade was cancelled by motion
//                  - After fade wait, checks if _FadeActiveUntil was cleared
//                  - RestoreSavedSettings clears flag on motion → watchdog skips turn-off
//                  - Prevents turning off lights when someone walked in during fade
// 2.2  2026-03-30  Explicitly turn off lights after fade completes
//                  - Waits for fade duration, then sets onoff:false on all targets
//                  - No longer relies on next watchdog cycle to clean up
// 2.1  2026-03-20  Add 60s grace period on top of inactivity threshold
//                  - Prevents watchdog from racing with the normal inactivity flow
//                  - Watchdog now triggers at inactivitySeconds + 60s
// 2.0  2026-03-19  Refactored from B9-only to multi-room support
// 1.0  2026-03-19  Initial version - B9 safety net
// -------------------------------------------------------------------------

// ====== ROOM CONFIGURATIONS ======
const ROOMS = {
  B9: {
    name: "Badeværelse 9",
    // Primary light (used for state save/restore coordination with GradualFadeOut)
    primaryLight: "b8591f4d-a493-4de7-9745-c13cd07e033c", // B9 Lys (group)
    // Motion sensors to check (all must be clear for room to be idle)
    motionSensors: [
      "90bc5383-608b-43c9-89a1-f7f7c54d1675", // B9 Motion
      "d78e0e15-5a6b-4908-be3c-4e5d3dc1a9d6"  // B9 Eve Motion Bruser
    ],
    // Logic variable name for inactivity threshold
    inactivityVar: "B9_InactivitySeconds"
  },
  B7: {
    name: "Badeværelse 7",
    primaryLight: "1ab9ca1f-60ca-44f9-8221-a03e10f005bf", // B7 Lys (group)
    motionSensors: [
      "acc2b15c-2774-4293-922a-c0659df04a41"  // B7 Motion
    ],
    inactivityVar: "B7_InactivitySeconds"
  },
  E9: {
    name: "Entre 9",
    primaryLight: "2656f184-8c87-4434-95a2-fdb3fc36bdd8", // E9 Loft
    // Additional lights to fade (not part of a group)
    extraLights: [
      "e339c184-ea11-4413-bd90-dac726861fd0"  // E9 Garderobe
    ],
    motionSensors: [
      "0da27a1f-ced1-4d02-9193-9438109c5c38"  // E9 Motion
    ],
    inactivityVar: "E9_InactivitySeconds"
  }
};

// ====== SETTINGS ======
const DEFAULT_INACTIVITY = 300;
const FADE_DURATION = 20;
const WATCHDOG_GRACE = 60; // Extra seconds beyond inactivity threshold before watchdog acts
                           // Prevents racing with the normal inactivity flow

// ====== GET ROOM FROM ARGUMENT ======
const roomKey = args[0] || "B9";
if (!roomKey || !ROOMS[roomKey]) {
  return `Error: pass room name as argument (${Object.keys(ROOMS).join(', ')})`;
}
const ROOM = ROOMS[roomKey];
const PREFIX = `${roomKey} Watchdog`;

// ====== PERSISTENT DIAGNOSTIC LOG ======
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

// ====== 1. CHECK IF LIGHTS ARE ON ======
const device = await Homey.devices.getDevice({ id: ROOM.primaryLight });
const lightsOn = device.capabilitiesObj?.onoff?.value === true;

if (!lightsOn) {
  return `${PREFIX}: lights off`;
}

// ====== 2. CHECK MOTION SENSORS ======
let hasMotion = false;
let lastMotionTime = 0;
for (const sensorId of ROOM.motionSensors) {
  const sensor = await Homey.devices.getDevice({ id: sensorId });
  const motionCap = sensor.capabilitiesObj?.alarm_motion;
  if (motionCap?.value) {
    hasMotion = true;
    break;
  }
  const ts = new Date(motionCap?.lastChanged ?? motionCap?.lastUpdated).getTime();
  if (!isNaN(ts) && ts > lastMotionTime) lastMotionTime = ts;
}

if (hasMotion) {
  return `${PREFIX}: motion detected`;
}

// ====== 3. CHECK IF FADE ALREADY IN PROGRESS ======
const fadeActiveUntil = global.get(`${ROOM.primaryLight}_FadeActiveUntil`) || 0;
if (Date.now() < fadeActiveUntil) {
  return `${PREFIX}: fade already in progress`;
}

// ====== 4. READ INACTIVITY THRESHOLD FROM LOGIC VARIABLE ======
let inactivitySeconds = DEFAULT_INACTIVITY;
try {
  const variables = await Homey.logic.getVariables();
  const varEntry = Object.values(variables).find(v => v.name === ROOM.inactivityVar);
  if (varEntry) {
    inactivitySeconds = Number(varEntry.value);
    log(`${PREFIX}: ${ROOM.inactivityVar} = ${inactivitySeconds}`);
  } else {
    log(`${PREFIX}: ${ROOM.inactivityVar} not found, using default ${DEFAULT_INACTIVITY}s`);
  }
} catch (e) {
  log(`${PREFIX}: couldn't read Logic variable: ${e.message}`);
}

// ====== 5. CHECK IF IDLE LONG ENOUGH (based on sensor timestamps) ======
const now = Date.now();

if (lastMotionTime <= 0) {
  return `${PREFIX}: no motion timestamp available`;
}

const idleDuration = (now - lastMotionTime) / 1000;

const watchdogThreshold = inactivitySeconds + WATCHDOG_GRACE;

if (idleDuration < watchdogThreshold) {
  const remaining = Math.round(watchdogThreshold - idleDuration);
  return `${PREFIX}: idle ${Math.round(idleDuration)}s / ${watchdogThreshold}s (${remaining}s left)`;
}

// ====== 6. TRIGGER FADE ======
log(`${PREFIX}: triggering fade (idle ${Math.round(idleDuration)}s > ${watchdogThreshold}s)`);
await Homey.flow.runFlowCardAction({
  uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
  id: 'homey:manager:notifications:create_notification',
  args: { text: `${PREFIX}: lights stuck on, fading after ${Math.round(idleDuration)}s idle` }
});

// Save current state (same as GradualFadeOut)
const currentBrightness = device.capabilitiesObj?.dim?.value || 0;
const currentTemp = device.capabilitiesObj?.light_temperature?.value || null;

global.set(`${ROOM.primaryLight}_SavedDim`, currentBrightness);
if (currentTemp !== null) {
  global.set(`${ROOM.primaryLight}_SavedTemp`, currentTemp);
}

// Set fade-active timestamp (same as GradualFadeOut)
const fadeUntil = Date.now() + (FADE_DURATION * 1000) + 2000;
global.set(`${ROOM.primaryLight}_FadeActiveUntil`, fadeUntil);

// Save manual mode state from AdaptiveLighting per-device state (for RestoreSavedSettings coordination)
const alDeviceKey = ROOM.primaryLight.substring(0, 8);
let wasManualMode = false;
try {
  const alRaw = global.get(`AL_Device_${alDeviceKey}.State`);
  if (alRaw) wasManualMode = JSON.parse(alRaw).manual === true;
} catch (e) { /* parse error — treat as not manual */ }
global.set(`${ROOM.primaryLight}_SavedManualMode`, wasManualMode);

diagLog(`WATCHDOG-FADE | ${ROOM.name} | idle=${Math.round(idleDuration)}s threshold=${watchdogThreshold}s | dim=${Math.round(currentBrightness * 100)}% manual=${wasManualMode}`);

// If already very dim, just turn off
if (currentBrightness <= 0.05) {
  await device.setCapabilityValue('onoff', false);
  global.set(`${ROOM.primaryLight}_FadeActiveUntil`, 0);
  diagLog(`WATCHDOG-SKIP | ${ROOM.name} | already very dim (${Math.round(currentBrightness * 100)}%)`);
  return `${PREFIX}: already dim, turned off`;
}

// ====== FADE LIGHTS ======
async function fadeDevice(targetDevice) {
  const cardId = `homey:device:${targetDevice.id}:dim`;
  await Homey.flow.runFlowCardAction({
    uri: `homey:device:${targetDevice.id}`,
    id: cardId,
    args: { dim: 0 },
    duration: FADE_DURATION
  });
}

// Collect all lights to fade
const allDevices = Object.values(await Homey.devices.getDevices());
let targets = [];

// Check if primary light is a group (find members)
const isGroup = !device.capabilities?.includes('button.migrate_v3');
let members = allDevices.filter(d =>
  d.name.startsWith(device.name + ' ') && d.name !== device.name && d.class === 'light'
);
if (members.length === 0 && isGroup) {
  members = allDevices.filter(d =>
    d.zone === device.zone && d.id !== device.id && d.class === 'light'
      && !(ROOM.extraLights || []).includes(d.id) // don't double-count extra lights
  );
}
targets = members.length > 0 ? members : [device];

// Add extra lights (non-group lights in the same room)
if (ROOM.extraLights) {
  for (const extraId of ROOM.extraLights) {
    const extraDevice = await Homey.devices.getDevice({ id: extraId });
    if (extraDevice.capabilitiesObj?.onoff?.value === true) {
      // Save state for extra lights too
      const extraDim = extraDevice.capabilitiesObj?.dim?.value || 0;
      const extraTemp = extraDevice.capabilitiesObj?.light_temperature?.value || null;
      global.set(`${extraId}_SavedDim`, extraDim);
      if (extraTemp !== null) global.set(`${extraId}_SavedTemp`, extraTemp);
      global.set(`${extraId}_FadeActiveUntil`, fadeUntil);

      const extraAlKey = extraId.substring(0, 8);
      let extraManual = false;
      try {
        const extraAlRaw = global.get(`AL_Device_${extraAlKey}.State`);
        if (extraAlRaw) extraManual = JSON.parse(extraAlRaw).manual === true;
      } catch (e) { /* parse error — treat as not manual */ }
      global.set(`${extraId}_SavedManualMode`, extraManual);

      targets.push(extraDevice);
    }
  }
}

// Fade all targets in parallel
log(`${PREFIX}: fading ${targets.length} lights`);
const results = await Promise.all(targets.map(t =>
  fadeDevice(t)
    .then(() => { log(`  ${t.name}: fade started`); return true; })
    .catch(e => { log(`  ${t.name}: failed: ${e.message}`); return false; })
));
const ok = results.filter(r => r).length;
log(`${PREFIX}: ${ok}/${targets.length} lights fading`);

// Wait for fade to complete, then ensure lights are fully off
await new Promise(resolve => setTimeout(resolve, FADE_DURATION * 1000));

// Check if fade was cancelled (RestoreSavedSettings clears the flag on motion)
const fadeCancelled = (global.get(`${ROOM.primaryLight}_FadeActiveUntil`) || 0) === 0;
if (fadeCancelled) {
  log(`${PREFIX}: fade was cancelled (motion detected) — skipping turn-off`);
  return `${PREFIX}: fade cancelled by restore`;
}

await Promise.all(targets.map(t =>
  t.setCapabilityValue('onoff', false)
    .then(() => log(`  ${t.name}: turned off`))
    .catch(e => log(`  ${t.name}: turn-off failed: ${e.message}`))
));
global.set(`${ROOM.primaryLight}_FadeActiveUntil`, 0);

log(`${PREFIX}: fade complete, lights off`);
return `${PREFIX}: fade + off after ${Math.round(idleDuration)}s idle`;
