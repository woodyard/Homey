/**
 * Tado Device Property Inspector
 * 
 * This script provides a comprehensive inspection of a Tado device to find
 * properties related to manual control status and device configuration.
 * 
 * Usage:
 *   1. Update TADO_DEVICE_ID with your Tado device ID
 *   2. Run this script in HomeyScript
 *   3. Review the output to find manual control properties
 * 
 * What to look for:
 *   - overlay settings (indicates manual override)
 *   - control mode properties
 *   - tado_overlay capability
 *   - settings or store objects
 */

// ============================================================================
// CONFIGURATION - Update this with your Tado device ID
// ============================================================================

const TADO_DEVICE_ID = '2ca14bef-8a28-43cc-af70-0d0611f5281f'; // Update with your device ID

// ============================================================================
// Helper Functions
// ============================================================================

function formatValue(value, indent = 0) {
    const prefix = '  '.repeat(indent);
    
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    
    const type = typeof value;
    
    if (type === 'boolean' || type === 'number' || type === 'string') {
        return String(value);
    }
    
    if (type === 'object') {
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            if (value.length > 10) return `[Array with ${value.length} items]`;
            return `[${value.join(', ')}]`;
        }
        
        // Object - show keys
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        if (keys.length > 20) return `{Object with ${keys.length} properties}`;
        return `{${keys.join(', ')}}`;
    }
    
    return String(value);
}

function inspectObject(obj, name, indent = 0, maxDepth = 3) {
    const prefix = '  '.repeat(indent);
    
    if (indent >= maxDepth) {
        log(`${prefix}${name}: [Max depth reached]`);
        return;
    }
    
    if (obj === null || obj === undefined) {
        log(`${prefix}${name}: ${obj}`);
        return;
    }
    
    const type = typeof obj;
    
    if (type !== 'object') {
        log(`${prefix}${name}: ${obj} (${type})`);
        return;
    }
    
    if (Array.isArray(obj)) {
        log(`${prefix}${name}: [Array with ${obj.length} items]`);
        if (obj.length > 0 && obj.length <= 5) {
            obj.forEach((item, index) => {
                inspectObject(item, `[${index}]`, indent + 1, maxDepth);
            });
        }
        return;
    }
    
    // Object
    const keys = Object.keys(obj);
    log(`${prefix}${name}: {Object with ${keys.length} properties}`);
    
    keys.forEach(key => {
        const value = obj[key];
        
        // For nested objects, inspect recursively
        if (value !== null && typeof value === 'object') {
            inspectObject(value, key, indent + 1, maxDepth);
        } else {
            log(`${prefix}  ${key}: ${formatValue(value)}`);
        }
    });
}

// ============================================================================
// Main Inspection
// ============================================================================

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║         TADO DEVICE PROPERTY INSPECTOR                       ║');
log('║         Manual Control Detection                             ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

try {
    // Get the Tado device
    const device = await Homey.devices.getDevice({ id: TADO_DEVICE_ID });
    
    log('══════════════════════════════════════════════════════════════');
    log('SECTION 1: BASIC DEVICE INFORMATION');
    log('══════════════════════════════════════════════════════════════\n');
    
    log(`Device Name:       ${device.name}`);
    log(`Device ID:         ${device.id}`);
    log(`Zone:              ${device.zoneName || device.zone}`);
    log(`Driver ID:         ${device.driverId}`);
    log(`Driver URI:        ${device.driverUri}`);
    log(`Device Class:      ${device.class}`);
    log(`Available:         ${device.available}`);
    log(`Unavailable Msg:   ${device.unavailableMessage || 'N/A'}`);
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 2: CAPABILITIES LIST');
    log('══════════════════════════════════════════════════════════════\n');
    
    if (device.capabilities && device.capabilities.length > 0) {
        device.capabilities.forEach((cap, index) => {
            log(`  ${index + 1}. ${cap}`);
        });
    } else {
        log('  No capabilities array found');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 3: CAPABILITIES DETAILS (Current Values)');
    log('══════════════════════════════════════════════════════════════\n');
    
    if (device.capabilitiesObj) {
        const caps = Object.keys(device.capabilitiesObj).sort();
        
        caps.forEach((capName) => {
            const capObj = device.capabilitiesObj[capName];
            log(`\n📋 ${capName}`);
            log(`   ID:          ${capObj.id}`);
            log(`   Value:       ${capObj.value}`);
            log(`   Type:        ${capObj.type || 'unknown'}`);
            log(`   Title:       ${capObj.title || 'N/A'}`);
            log(`   Units:       ${capObj.units || 'N/A'}`);
            log(`   Getable:     ${capObj.getable}`);
            log(`   Setable:     ${capObj.setable}`);
            
            // Check for additional properties
            const additionalProps = Object.keys(capObj).filter(k => 
                !['id', 'value', 'type', 'title', 'units', 'getable', 'setable', 'desc', 'iconObj', 'lastUpdated'].includes(k)
            );
            
            if (additionalProps.length > 0) {
                log(`   Additional:  ${additionalProps.join(', ')}`);
                additionalProps.forEach(prop => {
                    log(`     - ${prop}: ${formatValue(capObj[prop])}`);
                });
            }
        });
    } else {
        log('No capabilitiesObj found');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 4: MANUAL CONTROL INDICATORS');
    log('══════════════════════════════════════════════════════════════\n');
    
    // Check for overlay-related capabilities (indicates manual control)
    const overlayCapabilities = Object.keys(device.capabilitiesObj || {}).filter(cap => 
        cap.toLowerCase().includes('overlay') || 
        cap.toLowerCase().includes('manual') ||
        cap.toLowerCase().includes('mode')
    );
    
    if (overlayCapabilities.length > 0) {
        log('🔍 Found potential manual control indicators:');
        overlayCapabilities.forEach(cap => {
            const capObj = device.capabilitiesObj[cap];
            log(`\n   ✓ ${cap}`);
            log(`     Current value: ${capObj.value}`);
            log(`     Type: ${capObj.type}`);
            log(`     Title: ${capObj.title || 'N/A'}`);
        });
    } else {
        log('❌ No obvious overlay/manual/mode capabilities found');
        log('   Manual control might be in device settings or store object');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 5: DEVICE SETTINGS');
    log('══════════════════════════════════════════════════════════════\n');
    
    if (device.settings) {
        log('📊 Device Settings Object:');
        inspectObject(device.settings, 'settings', 0, 4);
    } else {
        log('No settings object found');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 6: DEVICE STORE (Internal Data)');
    log('══════════════════════════════════════════════════════════════\n');
    
    if (device.store) {
        log('💾 Device Store Object:');
        inspectObject(device.store, 'store', 0, 4);
    } else {
        log('No store object found');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 7: DEVICE DATA');
    log('══════════════════════════════════════════════════════════════\n');
    
    if (device.data) {
        log('📦 Device Data Object:');
        inspectObject(device.data, 'data', 0, 4);
    } else {
        log('No data object found');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 8: ALL DEVICE PROPERTIES (Top Level)');
    log('══════════════════════════════════════════════════════════════\n');
    
    const allKeys = Object.keys(device).sort();
    log(`Total properties: ${allKeys.length}\n`);
    
    // Categorize properties
    const knownProperties = [
        'id', 'name', 'driverId', 'driverUri', 'zone', 'zoneName', 
        'class', 'capabilities', 'capabilitiesObj', 'available',
        'unavailableMessage', 'settings', 'store', 'data', 'iconObj'
    ];
    
    const unknownProperties = allKeys.filter(k => !knownProperties.includes(k));
    
    if (unknownProperties.length > 0) {
        log('🔍 Unknown/Additional Properties (might contain manual control info):');
        unknownProperties.forEach(key => {
            const value = device[key];
            log(`\n   ${key}:`);
            
            if (value !== null && typeof value === 'object') {
                inspectObject(value, key, 1, 3);
            } else {
                log(`     ${formatValue(value)} (${typeof value})`);
            }
        });
    } else {
        log('✓ No additional properties found beyond standard device properties');
    }
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 9: RAW DEVICE OBJECT (JSON)');
    log('══════════════════════════════════════════════════════════════\n');
    
    log('Full device object as JSON:');
    log(JSON.stringify(device, null, 2));
    
    log('\n══════════════════════════════════════════════════════════════');
    log('SECTION 10: INTERPRETATION GUIDE');
    log('══════════════════════════════════════════════════════════════\n');
    
    log('📖 How to identify manual control status:\n');
    log('1. OVERLAY CAPABILITY:');
    log('   Look for "tado_overlay" or similar capability');
    log('   Value "true" or "MANUAL" typically indicates manual control\n');
    
    log('2. CONTROL MODE:');
    log('   Look for "tado_control_mode" or "mode" capability');
    log('   Values might be: "AUTO", "MANUAL", "SCHEDULE"\n');
    
    log('3. SETTINGS OBJECT:');
    log('   Check device.settings for properties like:');
    log('   - manualControl, overlay, controlMode\n');
    
    log('4. STORE OBJECT:');
    log('   Check device.store for internal state:');
    log('   - overlay, manualOverride, lastManualChange\n');
    
    log('5. TARGET TEMPERATURE COMPARISON:');
    log('   If current target differs from schedule, might indicate manual\n');
    
    log('6. TADO APP/API:');
    log('   The Tado app might show "Manual until next auto change"');
    log('   This corresponds to an overlay being set\n');
    
    log('\n╔═══════════════════════════════════════════════════════════════╗');
    log('║                    INSPECTION COMPLETE                        ║');
    log('╚═══════════════════════════════════════════════════════════════╝\n');
    
    log('💡 NEXT STEPS:');
    log('   1. Review the sections above for manual control indicators');
    log('   2. Look for overlay, mode, or manual-related properties');
    log('   3. Compare with Tado app to see if manual mode is active');
    log('   4. Use Section 9 (JSON) to search for specific keywords');
    log('   5. Check if any capabilities show "MANUAL" as current value\n');
    
} catch (error) {
    log(`\n❌ ERROR: ${error.message}`);
    log(`Stack trace:\n${error.stack}`);
    log('\n💡 Troubleshooting:');
    log('   - Verify TADO_DEVICE_ID is correct');
    log('   - Ensure device is available on Homey');
    log('   - Check if you have permission to access device\n');
}
