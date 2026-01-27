/**
 * Reset Eve Device Error Counters Script
 * Version: 1.0
 *
 * Description:
 *   Resets all per-device error counters to 0.
 *   This script finds all EveError_* variables and sets them to 0.
 *
 * Usage:
 *   Run this script once from HomeyScript when you want to reset all counters.
 */

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

// Helper function to reset all device error counters
async function resetAllDeviceCounters() {
  const variables = await Homey.logic.getVariables();
  const devices = await Homey.devices.getDevices();
  let resetCount = 0;

  log('🔄 Resetting all Eve device error counters...\n');

  for (const [id, variable] of Object.entries(variables)) {
    if (variable.name.startsWith('EveError_')) {
      const oldValue = variable.value || 0;
      await Homey.logic.updateVariable({ id: id, variable: { value: 0 } });

      // Get device name for better logging
      const deviceId = variable.name.replace('EveError_', '');
      const device = devices[deviceId];
      const deviceName = device ? device.name : deviceId;

      log(`  ${deviceName}: ${oldValue} → 0`);
      resetCount++;
    }
  }

  log(`\n✅ Reset ${resetCount} device error counter(s) to 0`);
  return resetCount;
}

// Run the reset
const count = await resetAllDeviceCounters();
return count;
