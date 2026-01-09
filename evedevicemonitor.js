/**
 * Eve Device Monitor Script
 * Version: 1.0
 * 
 * Description:
 *   Checks if Eve devices are available (no exclamation mark).
 *   Returns the count of unavailable devices.
 * 
 * Usage:
 *   Run from Advanced Flow with HomeyScript card.
 *   Use the returned number to determine if errors exist.
 * 
 * Version History:
 *   1.0 - 2024-12-13 - Initial version
 */

const devices = await Homey.devices.getDevices();
let unavailableDevices = [];

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
  "e3906379-8e20-47e2-b569-c6d806875f61"
];

for (const device of Object.values(devices)) {
  if (eveDeviceIds.includes(device.id)) {
    if (!device.available) {
      unavailableDevices.push(device.name);
      log(`❌ UNAVAILABLE: ${device.name}`);
    } else {
      log(`✅ OK: ${device.name}`);
    }
  }
}

// Set a tag with the list of unavailable devices (for notifications)
if (unavailableDevices.length > 0) {
  await tag("unavailable_devices", unavailableDevices.join(", "));
  log(`\n⚠️ ${unavailableDevices.length} device(s) unavailable`);
} else {
  await tag("unavailable_devices", "");
  log(`\n✅ All Eve devices OK`);
}

// Return the count of unavailable devices
return unavailableDevices.length;