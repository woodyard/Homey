/**
 * Test Script - STUE Zone Device Filtering Debug
 * 
 * This script debugs why the TADO device isn't being found in zone devices
 * 
 * Usage:
 *   Run this script to see the filtering logic in action
 */

// Stue configuration
const ZONE_NAME = 'Stue';
const TADO_DEVICE_ID = '2ca14bef-8a28-43cc-af70-0d0611f5281f';

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          STUE ZONE DEVICE FILTERING DEBUG                    ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

try {
    // Get zone
    const zones = await Homey.zones.getZones();
    const zone = Object.values(zones).find(z => z.name === ZONE_NAME);
    
    if (!zone) {
        log(`❌ Zone "${ZONE_NAME}" not found!`);
        return;
    }
    
    log('══ ZONE INFORMATION ══');
    log(`Name:           ${zone.name}`);
    log(`ID:             ${zone.id}`);
    
    // Get all devices
    const allDevices = await Homey.devices.getDevices();
    log(`\n══ ALL DEVICES (${Object.keys(allDevices).length} total) ══`);
    
    // Filter to zone devices
    const zoneDevices = Object.values(allDevices).filter(d => d.zone === zone.id);
    log(`\n══ ZONE DEVICES (${zoneDevices.length} in zone) ══`);
    
    zoneDevices.forEach((device, index) => {
        log(`\n${index + 1}. ${device.name}`);
        log(`   ID:           ${device.id}`);
        log(`   Zone ID:      ${device.zone}`);
        log(`   Zone Match:   ${device.zone === zone.id ? '✅' : '❌'}`);
        log(`   Has measure_temp: ${device.capabilitiesObj?.measure_temperature ? '✅' : '❌'}`);
        
        if (device.capabilitiesObj?.measure_temperature) {
            log(`   Temp Value:   ${device.capabilitiesObj.measure_temperature.value}°C`);
        }
        
        // Check if this is the TADO device
        const isTadoDevice = device.id === TADO_DEVICE_ID;
        log(`   Is TADO:      ${isTadoDevice ? '✅ YES' : '❌ No'}`);
    });
    
    log(`\n══ TADO DEVICE FILTERING TEST ══`);
    log(`Looking for device ID: ${TADO_DEVICE_ID}`);
    log(`Room type: tado_valve`);
    
    // Test the filtering logic
    const tadoDevice = zoneDevices.find(d => {
        const idMatch = d.id === TADO_DEVICE_ID;
        const hasTemp = d.capabilitiesObj?.measure_temperature;
        
        log(`\nChecking device: ${d.name}`);
        log(`  ID matches: ${idMatch ? '✅' : '❌'} (${d.id})`);
        log(`  Has temp:   ${hasTemp ? '✅' : '❌'}`);
        log(`  Both pass:  ${idMatch && hasTemp ? '✅ MATCH!' : '❌'}`);
        
        return idMatch && hasTemp;
    });
    
    log(`\n══ RESULT ══`);
    if (tadoDevice) {
        log(`✅ TADO device FOUND: ${tadoDevice.name}`);
        log(`   Temperature: ${tadoDevice.capabilitiesObj.measure_temperature.value}°C`);
    } else {
        log(`❌ TADO device NOT FOUND`);
        log(`   This should not happen!`);
    }
    
    // Now test with array includes (like the real code)
    log(`\n══ ARRAY INCLUDES TEST (like real code) ══`);
    const heatingDevices = [TADO_DEVICE_ID];
    log(`heatingDevices array: [${heatingDevices.join(', ')}]`);
    
    const tadoDeviceArray = zoneDevices.find(d => {
        const includesMatch = heatingDevices.includes(d.id);
        const hasTemp = d.capabilitiesObj?.measure_temperature;
        
        log(`\nChecking: ${d.name}`);
        log(`  includes() result: ${includesMatch ? '✅' : '❌'}`);
        log(`  Has temp:          ${hasTemp ? '✅' : '❌'}`);
        
        return includesMatch && hasTemp;
    });
    
    log(`\n══ ARRAY INCLUDES RESULT ══`);
    if (tadoDeviceArray) {
        log(`✅ TADO device FOUND with array.includes(): ${tadoDeviceArray.name}`);
    } else {
        log(`❌ TADO device NOT FOUND with array.includes()`);
    }
    
    log('\n╔═══════════════════════════════════════════════════════════════╗');
    log('║          DEBUG COMPLETE                                       ║');
    log('╚═══════════════════════════════════════════════════════════════╝\n');
    
} catch (error) {
    log(`\n❌ ERROR: ${error.message}`);
    log(`Stack: ${error.stack}`);
}
