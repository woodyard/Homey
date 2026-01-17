/**
 * Eve Device Monitor Script
 * Version: 4.1
 *
 * Description:
 *   Checks if Eve devices are available (no exclamation mark).
 *   Directly updates the EveErrorCount Homey Logic variable.
 *   Tracks per-device error counts that persist between reboots.
 *   Sends notifications for errors and recovery.
 *
 * Behavior:
 *   - If errors found: sends notification, increments EveErrorCount and per-device counters
 *   - If no errors but had previous errors: sends recovery notification, resets counter
 *   - If no errors and no previous errors: does nothing
 *
 * Prerequisites:
 *   Create two Homey Logic variables manually:
 *   - EveErrorCount (Number)
 *   - EveLastError (Number)
 *   Per-device error counters are created automatically.
 *
 * Usage:
 *   Run from Advanced Flow with HomeyScript card every 2 minutes.
 *   The script handles error counting and notifications internally.
 *   The flow only needs to handle the reboot logic (when EveErrorCount > 5).
 *
 * Version History:
 *   1.0 - 2025-12-13 - Initial version (return count only)
 *   2.0 - 2025-12-13 - Directly manages Better Logic variable
 *   3.0 - 2025-12-13 - Added recovery notification when errors clear
 *   3.1 - 2025-12-13 - Script sends notifications directly
 *   3.2 - 2025-12-13 - Fixed Better Logic API calls (apiGet/apiPut syntax)
 *   3.3 - 2025-12-13 - Fixed for new HomeyScript API (.get/.put with path)
 *   3.4 - 2025-12-13 - Fixed notifications API (new URI format)
 *   3.5 - 2025-12-15 - Added error count number to notification message
 *   3.6 - 2025-12-17 - Added Eve device 5a27ff62-6e13-4902-aa6f-33c4eb988f0c
 *   3.7 - 2025-12-17 - Changed interval from 5 to 2 minutes
 *   3.8 - 2025-12-22 - Added EveLastError output to console
 *   3.9 - 2026-01-03 - Migrated from Better Logic to HomeyScript global variables
 *   4.0 - 2026-01-03 - Migrated to Homey Logic variables (for flow triggers)
 *   4.1 - 2026-01-17 - Added per-device persistent error counters
 */

const devices = await Homey.devices.getDevices();
let unavailableDevices = [];
let unavailableDeviceDetails = []; // Store both id and name

// Eve device IDs - update this list if you add/remove devices
const eveDeviceIds = [
  "825d3d61-b4b8-49e5-854b-5126758808b6",
  "e1e82d85-465a-413e-a20a-5577bce02730",
  "42685dd3-4cf3-4305-9a2f-f5af853e4a0c",
  "5b3581b4-a525-4746-8307-b1a5e3b13f04",
  "90e264af-01ca-4c26-a189-93fc4ce5a326",
  "02561b2b-977f-41c2-a09a-da71ac2fe602",
  "eb4218c2-ed7c-450d-9552-9c600a236756",
  "eab575b2-86d9-4880-b6b7-b5e19dc1fbd7",
  "fd3cbe60-2d32-4384-93ab-adcbfa63798d",
  "39450196-823f-4816-9c3a-85a2436fa035",
  "18f57e55-ca0d-40e3-87f2-561bab945ae0",
  "e3906379-8e20-47e2-b569-c6d806875f61",
  "5a27ff62-6e13-4902-aa6f-33c4eb988f0c"
];

// Helper function to send notification
async function notify(text) {
  await Homey.flow.runFlowCardAction({
    uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
    id: "homey:manager:notifications:create_notification",
    args: { text: text }
  });
}

// Helper function to get Homey Logic variable by name
async function getLogicVariable(name) {
  const variables = await Homey.logic.getVariables();
  for (const [id, variable] of Object.entries(variables)) {
    if (variable.name === name) {
      return { id, ...variable };
    }
  }
  return null;
}

// Helper function to set Homey Logic variable by name
async function setLogicVariable(name, value) {
  const variable = await getLogicVariable(name);
  if (variable) {
    await Homey.logic.updateVariable({ id: variable.id, variable: { value: value } });
    return true;
  }
  log(`⚠️ Variable "${name}" not found in Homey Logic`);
  return false;
}

// Helper function to get or create a per-device error counter
async function getOrCreateDeviceCounter(deviceId, deviceName) {
  const varName = `EveError_${deviceId}`;
  let variable = await getLogicVariable(varName);
  
  if (!variable) {
    // Create the variable if it doesn't exist
    try {
      await Homey.logic.createVariable({
        variable: {
          name: varName,
          type: 'number',
          value: 0,
          title: `Eve Error Counter: ${deviceName}`
        }
      });
      log(`📝 Created counter variable: ${varName}`);
      variable = await getLogicVariable(varName);
    } catch (error) {
      log(`⚠️ Failed to create variable ${varName}: ${error.message}`);
      return null;
    }
  }
  
  return variable;
}

// Helper function to increment device error counter
async function incrementDeviceCounter(deviceId, deviceName) {
  const variable = await getOrCreateDeviceCounter(deviceId, deviceName);
  if (variable) {
    const newValue = (variable.value || 0) + 1;
    await Homey.logic.updateVariable({ id: variable.id, variable: { value: newValue } });
    return newValue;
  }
  return null;
}

// Helper function to get all device error counters
async function getAllDeviceCounters() {
  const variables = await Homey.logic.getVariables();
  const counters = {};
  
  for (const [id, variable] of Object.entries(variables)) {
    if (variable.name.startsWith('EveError_')) {
      counters[variable.name] = variable.value || 0;
    }
  }
  
  return counters;
}

// Check each Eve device
for (const device of Object.values(devices)) {
  if (eveDeviceIds.includes(device.id)) {
    if (!device.available) {
      unavailableDevices.push(device.name);
      unavailableDeviceDetails.push({ id: device.id, name: device.name });
      log(`❌ UNAVAILABLE: ${device.name}`);
    } else {
      log(`✅ OK: ${device.name}`);
    }
  }
}

// Get current error count from Homey Logic
const errorCountVar = await getLogicVariable('EveErrorCount');
const currentValue = errorCountVar ? errorCountVar.value : 0;
log(`Current EveErrorCount: ${currentValue}`);

// Get last error timestamp
const lastErrorVar = await getLogicVariable('EveLastError');
if (lastErrorVar && lastErrorVar.value) {
  const lastErrorDate = new Date(lastErrorVar.value);
  log(`EveLastError: ${lastErrorDate.toLocaleString()}`);
} else {
  log(`EveLastError: Never`);
}

if (unavailableDevices.length > 0) {
  // Errors found
  const newValue = currentValue + 1;
  
  await setLogicVariable('EveErrorCount', newValue);
  log(`\n⚠️ ${unavailableDevices.length} device(s) unavailable`);
  log(`EveErrorCount incremented to ${newValue}`);
  
  // Increment per-device error counters
  log(`\nIncrementing per-device error counters:`);
  for (const deviceInfo of unavailableDeviceDetails) {
    const deviceCounter = await incrementDeviceCounter(deviceInfo.id, deviceInfo.name);
    if (deviceCounter !== null) {
      log(`  ${deviceInfo.name}: ${deviceCounter} errors`);
    }
  }
  
  // Send error notification with error count
  await notify(`EVE: Error ${newValue} - ${unavailableDevices.join(", ")}`);
  
  // Store timestamp
  await setLogicVariable('EveLastError', Date.now());
  
  // Set tag with unavailable device names
  await tag("unavailable_devices", unavailableDevices.join(", "));
  
  // Output all device counters before script ends
  log(`\n📊 Per-Device Error Counters (Total):`);
  const allCounters = await getAllDeviceCounters();
  for (const [varName, count] of Object.entries(allCounters)) {
    const deviceId = varName.replace('EveError_', '');
    const device = devices[deviceId];
    const deviceName = device ? device.name : deviceId;
    log(`  ${deviceName}: ${count}`);
  }
  
  return unavailableDevices.length;
  
} else {
  // No errors
  if (currentValue > 0) {
    // Recovered from previous errors
    log(`\n✅ All Eve devices OK - Recovered from ${currentValue} error(s)`);
    
    // Send recovery notification
    await notify("EVE: Recovered from error");
    
    // Reset counter
    await setLogicVariable('EveErrorCount', 0);
    log(`EveErrorCount reset to 0`);
    
    // Output all device counters before script ends
    log(`\n📊 Per-Device Error Counters (Total):`);
    const allCounters = await getAllDeviceCounters();
    for (const [varName, count] of Object.entries(allCounters)) {
      const deviceId = varName.replace('EveError_', '');
      const device = devices[deviceId];
      const deviceName = device ? device.name : deviceId;
      log(`  ${deviceName}: ${count}`);
    }
    
    return -1; // Indicates recovery
    
  } else {
    // All OK, no previous errors
    log(`\n✅ All Eve devices OK`);
    
    // Output all device counters before script ends
    log(`\n📊 Per-Device Error Counters (Total):`);
    const allCounters = await getAllDeviceCounters();
    for (const [varName, count] of Object.entries(allCounters)) {
      const deviceId = varName.replace('EveError_', '');
      const device = devices[deviceId];
      const deviceName = device ? device.name : deviceId;
      log(`  ${deviceName}: ${count}`);
    }
    
    return 0;
  }
}