/**
 * Test Script - TADO Device Capabilities Inspector
 * 
 * This script inspects a TADO device to show all its capabilities
 * and helps diagnose temperature sensor detection issues.
 * 
 * Usage:
 *   Run this script to see all capabilities of STUE's TADO device
 */

const STUE_TADO_ID = '2ca14bef-8a28-43cc-af70-0d0611f5281f';

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          TADO DEVICE CAPABILITIES INSPECTOR                  ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

try {
    // Get the TADO device
    const device = await Homey.devices.getDevice({ id: STUE_TADO_ID });
    
    log('══ DEVICE INFORMATION ══');
    log(`Name:           ${device.name}`);
    log(`ID:             ${device.id}`);
    log(`Zone:           ${device.zoneName || device.zone}`);
    log(`Driver ID:      ${device.driverId}`);
    log(`Driver URI:     ${device.driverUri}`);
    log(`Class:          ${device.class}`);
    
    log('\n══ ALL CAPABILITIES ══');
    if (device.capabilities && device.capabilities.length > 0) {
        device.capabilities.forEach((cap, index) => {
            log(`${index + 1}. ${cap}`);
        });
    } else {
        log('No capabilities array found');
    }
    
    log('\n══ CAPABILITIES OBJECT ══');
    if (device.capabilitiesObj) {
        const caps = Object.keys(device.capabilitiesObj);
        log(`Total capabilities: ${caps.length}`);
        
        caps.forEach((capName) => {
            const capObj = device.capabilitiesObj[capName];
            log(`\n${capName}:`);
            log(`  ID:          ${capObj.id}`);
            log(`  Value:       ${capObj.value}`);
            log(`  Type:        ${capObj.type || 'unknown'}`);
            log(`  Title:       ${capObj.title || 'N/A'}`);
            log(`  Units:       ${capObj.units || 'N/A'}`);
            log(`  Getable:     ${capObj.getable}`);
            log(`  Setable:     ${capObj.setable}`);
        });
    } else {
        log('No capabilitiesObj found');
    }
    
    log('\n══ TEMPERATURE SENSOR CHECK ══');
    const hasMeasureTemp = device.capabilitiesObj?.measure_temperature;
    
    if (hasMeasureTemp) {
        log('✅ measure_temperature capability FOUND');
        log(`   Current value: ${hasMeasureTemp.value}°C`);
        log(`   ID: ${hasMeasureTemp.id}`);
        log(`   Title: ${hasMeasureTemp.title}`);
    } else {
        log('❌ measure_temperature capability NOT FOUND');
        log('   Available temperature-related capabilities:');
        
        const tempCaps = Object.keys(device.capabilitiesObj || {}).filter(cap => 
            cap.toLowerCase().includes('temp')
        );
        
        if (tempCaps.length > 0) {
            tempCaps.forEach(cap => {
                log(`   - ${cap}: ${device.capabilitiesObj[cap].value}`);
            });
        } else {
            log('   No temperature-related capabilities found');
        }
    }
    
    log('\n══ TARGET TEMPERATURE CHECK ══');
    const hasTargetTemp = device.capabilitiesObj?.target_temperature;
    
    if (hasTargetTemp) {
        log('✅ target_temperature capability FOUND');
        log(`   Current value: ${hasTargetTemp.value}°C`);
    } else {
        log('❌ target_temperature capability NOT FOUND');
    }
    
    log('\n══ TADO-SPECIFIC CAPABILITIES ══');
    const tadoCaps = Object.keys(device.capabilitiesObj || {}).filter(cap => 
        cap.toLowerCase().includes('tado')
    );
    
    if (tadoCaps.length > 0) {
        tadoCaps.forEach(cap => {
            const capObj = device.capabilitiesObj[cap];
            log(`${cap}:`);
            log(`  Value: ${capObj.value}`);
            log(`  Title: ${capObj.title || 'N/A'}`);
        });
    } else {
        log('No TADO-specific capabilities found');
    }
    
    log('\n══ RAW DEVICE OBJECT (for debugging) ══');
    log(JSON.stringify(device, null, 2));
    
    log('\n╔═══════════════════════════════════════════════════════════════╗');
    log('║          INSPECTION COMPLETE                                  ║');
    log('╚═══════════════════════════════════════════════════════════════╝\n');
    
} catch (error) {
    log(`\n❌ ERROR: ${error.message}`);
    log(`Stack: ${error.stack}`);
}
