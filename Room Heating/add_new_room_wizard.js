/**
 * Add New Room Wizard
 * 
 * Interactive script to gather information for adding a new room to the heating control system.
 * Run this script and it will show you available zones, devices, and help you configure a new room.
 * 
 * Author: Henrik Skovgaard
 * Version: 1.0.0
 * Created: 2026-01-13
 */

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          ADD NEW ROOM - CONFIGURATION WIZARD                 ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

log('This wizard will help you gather the information needed to add a new room.');
log('Follow the steps below and copy the generated configuration at the end.\n');

// ============================================================================
// STEP 1: Show Available Zones
// ============================================================================

log('══ STEP 1: AVAILABLE ZONES ══\n');
log('These are all the zones in your Homey system:');
log('Pick the zone where the new room is located.\n');

const zones = await Homey.zones.getZones();
const zoneList = Object.values(zones).map(z => ({ id: z.id, name: z.name }));

zoneList.forEach((zone, index) => {
    log(`  ${index + 1}. ${zone.name} (ID: ${zone.id})`);
});

log('\n📝 NOTE: Copy the zone name exactly as shown above.');
log('   Example: "Stuen", "Køkkenet", etc.\n');

// ============================================================================
// STEP 2: Show Available Heating Devices
// ============================================================================

log('══ STEP 2: AVAILABLE HEATING DEVICES ══\n');
log('Choose your heating control method:\n');

const allDevices = await Homey.devices.getDevices();
const deviceList = Object.values(allDevices);

// Find smart plugs (devices with onoff capability, likely used for radiators)
const smartPlugs = deviceList.filter(d => 
    d.capabilitiesObj?.onoff && 
    (d.name.toLowerCase().includes('radiator') || 
     d.name.toLowerCase().includes('varme') ||
     d.driverUri?.includes('socket') ||
     d.driverUri?.includes('plug'))
);

// Find TADO valves
const tadoValves = deviceList.filter(d => 
    d.capabilitiesObj?.target_temperature && 
    d.capabilitiesObj?.tado_heating_power
);

log('A) SMART PLUGS (for electric radiators):');
if (smartPlugs.length > 0) {
    smartPlugs.forEach((device, index) => {
        const zone = zones[device.zone];
        log(`  ${index + 1}. ${device.name}`);
        log(`     Zone: ${zone ? zone.name : 'Unknown'}`);
        log(`     ID: ${device.id}`);
        log(`     State: ${device.capabilitiesObj.onoff.value ? 'ON' : 'OFF'}`);
        log('');
    });
} else {
    log('  (No smart plugs found)\n');
}

log('B) TADO VALVES (for radiator valves):');
if (tadoValves.length > 0) {
    tadoValves.forEach((device, index) => {
        const zone = zones[device.zone];
        log(`  ${index + 1}. ${device.name}`);
        log(`     Zone: ${zone ? zone.name : 'Unknown'}`);
        log(`     ID: ${device.id}`);
        log(`     Target: ${device.capabilitiesObj.target_temperature.value}°C`);
        log('');
    });
} else {
    log('  (No TADO valves found)\n');
}

log('📝 NOTE: Copy the device ID(s) for your heating devices.');
log('   - For smart plugs: You can use multiple IDs (one per radiator)');
log('   - For TADO valves: Use only one ID\n');

// ============================================================================
// STEP 3: Show Zone Devices (Temperature, Motion, Window Sensors)
// ============================================================================

log('══ STEP 3: SENSORS IN EACH ZONE ══\n');
log('These sensors help the automation work properly.\n');
log('For each zone, the following sensors are available:\n');

for (const [zoneId, zone] of Object.entries(zones)) {
    const zoneDevices = deviceList.filter(d => d.zone === zoneId);
    
    if (zoneDevices.length === 0) continue;
    
    log(`📍 ${zone.name}:`);
    
    // Temperature sensors
    const tempSensors = zoneDevices.filter(d => d.capabilitiesObj?.measure_temperature);
    if (tempSensors.length > 0) {
        log('  🌡️  Temperature sensors:');
        tempSensors.forEach(s => {
            const temp = s.capabilitiesObj.measure_temperature.value;
            log(`     - ${s.name} (${temp}°C)`);
        });
    }
    
    // Motion sensors
    const motionSensors = zoneDevices.filter(d => d.capabilitiesObj?.alarm_motion);
    if (motionSensors.length > 0) {
        log('  🚶 Motion sensors:');
        motionSensors.forEach(s => {
            const motion = s.capabilitiesObj.alarm_motion.value;
            log(`     - ${s.name} (${motion ? 'MOTION' : 'No motion'})`);
        });
    }
    
    // Window sensors
    const windowSensors = zoneDevices.filter(d => d.capabilitiesObj?.alarm_contact);
    if (windowSensors.length > 0) {
        log('  🪟 Window sensors:');
        windowSensors.forEach(s => {
            const open = s.capabilitiesObj.alarm_contact.value;
            log(`     - ${s.name} (${open ? 'OPEN' : 'CLOSED'})`);
        });
    }
    
    // Heating devices in this zone
    const heatingInZone = zoneDevices.filter(d => 
        smartPlugs.includes(d) || tadoValves.includes(d)
    );
    if (heatingInZone.length > 0) {
        log('  🔥 Heating devices:');
        heatingInZone.forEach(h => {
            log(`     - ${h.name}`);
        });
    }
    
    log('');
}

log('📝 NOTE: Your zone should have:');
log('   ✓ At least one temperature sensor (required)');
log('   ✓ Motion sensor (optional, for inactivity detection)');
log('   ✓ Window sensor (optional, for window open detection)\n');

// ============================================================================
// STEP 4: Configuration Template
// ============================================================================

log('══ STEP 4: CONFIGURATION TEMPLATE ══\n');
log('Use this template to add your new room to room_heating_config.js:\n');
log('Copy the configuration below and fill in the values with information from above.\n');

log('─'.repeat(63));
log(`
'YourRoomName': {
    zoneName: 'Your Zone Name',  // From STEP 1
    heating: {
        type: 'smart_plug',  // OR 'tado_valve' - choose one
        hysteresis: 0.5,  // Only for smart_plug (±0.25°C margin)
        devices: [
            'device-id-1',  // From STEP 2
            'device-id-2'   // Add more for smart_plug, only one for tado_valve
        ]
    },
    schedules: {
        weekday: [
            { start: '00:00', end: '07:00', target: 19, inactivityOffset: 0, name: 'Night' },
            { start: '07:00', end: '20:00', target: 21, inactivityOffset: 1, name: 'Day' }
        ],
        weekend: [
            { start: '00:00', end: '09:00', target: 19, inactivityOffset: 0, name: 'Night' },
            { start: '09:00', end: '21:00', target: 21, inactivityOffset: 1, name: 'Day' }
        ],
        holiday: [
            { start: '00:00', end: '09:00', target: 19, inactivityOffset: 0, name: 'Night' },
            { start: '09:00', end: '21:00', target: 21, inactivityOffset: 1, name: 'Day' }
        ],
        earlyEvening: { start: '20:00', end: '23:59', target: 20, inactivityOffset: 0, name: 'Evening' },
        lateEvening: { start: '21:00', end: '23:59', target: 20, inactivityOffset: 0, name: 'Evening' }
    },
    settings: {
        tadoAwayMinTemp: 18.0,     // Minimum temp when away (or null to turn off)
        inactivityTimeout: 20,      // Minutes before reducing temp when inactive
        windowOpenTimeout: 60,      // Seconds before turning off when window open
        windowClosedDelay: 600,     // Seconds to wait for air to settle after window closes
        manualOverrideDuration: 90  // Minutes to pause automation after manual change
    }
}
`);
log('─'.repeat(63));

// ============================================================================
// STEP 5: Instructions
// ============================================================================

log('\n══ STEP 5: HOW TO ADD YOUR NEW ROOM ══\n');

log('1. Open room_heating_config.js in the editor');
log('2. Find the ROOMS object (around line 44)');
log('3. Add a comma after the last room (after Oliver\'s closing })');
log('4. Paste your configuration from STEP 4');
log('5. Replace the placeholder values with actual data from STEPS 1-3');
log('6. Save the file');
log('7. Run room_heating_config.js to update the configuration');
log('8. Test your new room with: await run(\'YourRoomName\')');

log('\n══ CONFIGURATION FIELD EXPLANATIONS ══\n');

log('📍 Room Name:');
log('   - Use a simple, unique name (e.g., \'Bedroom\', \'Office\')');
log('   - This is how you\'ll call the room in scripts\n');

log('🏠 Zone Name:');
log('   - Must match exactly a zone name from STEP 1');
log('   - The script will find sensors automatically in this zone\n');

log('🔥 Heating Type:');
log('   - smart_plug: For electric radiators controlled by smart plugs');
log('   - tado_valve: For TADO smart radiator valves\n');

log('🎯 Hysteresis (smart_plug only):');
log('   - Creates a temperature range around target');
log('   - 0.5 means ±0.25°C (target 20°C → heat between 19.75-20.25°C)');
log('   - Prevents rapid on/off cycling\n');

log('📅 Schedules:');
log('   - weekday: Monday-Friday (school/work days)');
log('   - weekend: Saturday-Sunday');
log('   - holiday: Weekday holidays (no school)');
log('   - earlyEvening: Used when school tomorrow (20:00-23:59)');
log('   - lateEvening: Used when no school tomorrow (21:00-23:59)\n');

log('🌡️  Schedule Fields:');
log('   - start/end: Time in HH:MM format');
log('   - target: Desired temperature in °C');
log('   - inactivityOffset: °C to reduce when room inactive (0 = no reduction)');
log('   - name: Display name for this period\n');

log('⚙️  Settings:');
log('   - tadoAwayMinTemp: Temperature when away (null = turn off completely)');
log('   - inactivityTimeout: Minutes of no motion before reducing temp');
log('   - windowOpenTimeout: Seconds window can be open before turning off heat');
log('   - windowClosedDelay: Seconds to wait for air mixing after window closes');
log('   - manualOverrideDuration: Minutes to respect manual temperature changes\n');

log('══ EXAMPLE: Adding a Living Room with Smart Plugs ══\n');
log('─'.repeat(63));
log(`
'LivingRoom': {
    zoneName: 'Stuen',
    heating: {
        type: 'smart_plug',
        hysteresis: 0.5,
        devices: [
            'abc123-radiator-1-id',
            'def456-radiator-2-id'
        ]
    },
    schedules: {
        weekday: [
            { start: '00:00', end: '06:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '06:00', end: '22:00', target: 21, inactivityOffset: 2, name: 'Day' }
        ],
        weekend: [
            { start: '00:00', end: '08:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '08:00', end: '23:00', target: 21, inactivityOffset: 2, name: 'Day' }
        ],
        holiday: [
            { start: '00:00', end: '08:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '08:00', end: '23:00', target: 21, inactivityOffset: 2, name: 'Day' }
        ],
        earlyEvening: { start: '22:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' },
        lateEvening: { start: '23:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' }
    },
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,
        windowOpenTimeout: 120,
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    }
}
`);
log('─'.repeat(63));

log('\n══ EXAMPLE: Adding a Bedroom with TADO Valve ══\n');
log('─'.repeat(63));
log(`
'Bedroom': {
    zoneName: 'Soveværelse',
    heating: {
        type: 'tado_valve',
        devices: ['xyz789-tado-valve-id']
    },
    schedules: {
        weekday: [
            { start: '00:00', end: '07:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '07:00', end: '21:00', target: 20, inactivityOffset: 1, name: 'Day' }
        ],
        weekend: [
            { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '09:00', end: '22:00', target: 20, inactivityOffset: 1, name: 'Day' }
        ],
        holiday: [
            { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '09:00', end: '22:00', target: 20, inactivityOffset: 1, name: 'Day' }
        ],
        earlyEvening: { start: '21:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' },
        lateEvening: { start: '22:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' }
    },
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,
        windowOpenTimeout: 60,
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    }
}
`);
log('─'.repeat(63));

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          WIZARD COMPLETE - READY TO ADD NEW ROOM             ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

log('✅ All information has been displayed above');
log('📝 Follow STEP 5 to add your configuration');
log('🚀 After adding, run: await run(\'YourRoomName\') to test\n');

log('💡 TIPS:');
log('   - Start with conservative temperature targets');
log('   - Test window sensors work correctly');
log('   - Monitor the first 24 hours for adjustments');
log('   - Use room_heating_status.js to check status\n');

log('🆘 NEED HELP?');
log('   - Review existing room configurations (Clara, Oliver)');
log('   - Check that sensors are in the correct zone');
log('   - Verify device IDs are correct');
log('   - Run room_heating_status.js to see current system state\n');
