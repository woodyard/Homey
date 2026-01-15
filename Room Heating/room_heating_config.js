/**
 * Room Heating Configuration
 *
 * Central configuration for all room heating systems.
 * Run this script to save configuration to global variables.
 * Both heating control and status scripts read from these global variables.
 *
 * Usage:
 *   1. Edit ROOMS configuration below
 *   2. Run this script to save to global variables
 *   3. Heating and status scripts automatically use the saved config
 *
 * Author: Henrik Skovgaard
 * Version: 1.0.3
 * Created: 2025-12-31
 *
 * Version History:
 * 1.0.3 (2026-01-13) - 🤚 Add manualOverrideDuration setting for manual intervention handling
 *   - New setting: manualOverrideDuration (minutes, default 90)
 *   - Allows system to detect and respect manual temperature/switch changes
 *   - After timeout, system automatically reverts to schedule
 *   - Configurable per room (Clara: 90min, Oliver: 90min)
 * 1.0.2 (2026-01-08) - ⏳ Add windowClosedDelay setting for air settle time
 *   - New setting: windowClosedDelay (seconds, default 600 = 10 minutes)
 *   - After window closes, heating waits for air to settle before resuming
 *   - Prevents heating from working harder due to cold air near sensor
 *   - Configurable per room (Clara: 600s, Oliver: 600s)
 * 1.0.1 (2026-01-05) - 🕐 Fix evening slot start times to avoid gaps
 *   - earlyEvening now starts at 20:00 (was 21:00) - matches end of weekday Day slot
 *   - lateEvening now starts at 21:00 (was 22:00) - matches end of weekend Day slot
 *   - Eliminates 1-hour gaps where system would fall back to Night schedule
 *   - Clara: Day ends 20:00, Evening starts 20:00 (school tomorrow) or 21:00 (weekend)
 *   - Oliver: Day ends 20:00, Evening starts 20:00 (school tomorrow) or 21:00 (weekend)
 * 1.0.0 (2025-12-31) - Initial version
 *   - Single source of truth for all room configurations
 *   - Saves to global variables: Config.Rooms (JSON string)
 *   - Eliminates duplicate configuration in heating and status scripts
 */

// ============================================================================
// ROOM CONFIGURATIONS - Edit here and run script to update!
// ============================================================================

const ROOMS = {
    'Clara': {
        zoneName: 'Claras værelse',
        heating: {
            type: 'smart_plug',
            hysteresis: 0.5,  // ±0.25°C margin around target
            devices: [
                '7a22bb22-f50d-44b7-8d24-63fac3aed878',  // C Radiator 1
                '5908b040-b605-4711-936a-6a5f03be68de'   // C Radiator 2
            ]
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '06:00', target: 20, inactivityOffset: 0, name: 'Night' },
                { start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, name: 'School' },
                { start: '14:00', end: '20:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '08:00', target: 20, inactivityOffset: 0, name: 'Night' },
                { start: '08:00', end: '21:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '08:00', target: 20, inactivityOffset: 0, name: 'Night' },
                { start: '08:00', end: '21:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
            ],
            earlyEvening: { start: '20:00', end: '23:59', target: 20, inactivityOffset: 0, name: 'Evening' },
            lateEvening: { start: '21:00', end: '23:59', target: 20, inactivityOffset: 0, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            windowOpenTimeout: 60,
            windowClosedDelay: 600,  // 10 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },
    
    'Oliver': {
        zoneName: 'Olivers værelse',
        heating: {
            type: 'tado_valve',
            devices: ['eee3d502-3cac-41b6-8c02-a55ad2380e77']   // Skovgaard / Oliver
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
            earlyEvening: { start: '20:00', end: '23:59', target: 20, inactivityOffset: 1, name: 'Evening' },
            lateEvening: { start: '21:00', end: '23:59', target: 20, inactivityOffset: 1, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            windowOpenTimeout: 60,
            windowClosedDelay: 600,  // 10 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },
    
    'Soveværelse': {
        zoneName: 'Soveværelse',
        heating: {
            type: 'tado_valve',
            devices: ['439be454-0e4e-4835-b51c-a83a1d78e9f1']   // Skovgaard / Soveværelse
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '07:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '07:00', end: '20:00', target: 21, inactivityOffset: 1, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '21:00', target: 21, inactivityOffset: 1, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '21:00', target: 21, inactivityOffset: 1, name: 'Day' }
            ],
            earlyEvening: { start: '20:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' },
            lateEvening: { start: '21:00', end: '23:59', target: 19, inactivityOffset: 0, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            windowOpenTimeout: 60,
            windowClosedDelay: 600,  // 10 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },

     'Stue': {
        zoneName: 'Stue / Spisestue',
        heating: {
            type: 'tado_valve',
            devices: ['2ca14bef-8a28-43cc-af70-0d0611f5281f']   // Skovgaard / Stue
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '05:00', target: 21, inactivityOffset: 0, name: 'Night' },
                { start: '05:00', end: '07:00', target: 22.5, inactivityOffset: 0, name: 'Morning' },
                { start: '07:00', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '06:00', target: 21, inactivityOffset: 0, name: 'Night' },
                { start: '06:00', end: '08:00', target: 22.5, inactivityOffset: 0, name: 'Morning' },
                { start: '08:00', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '06:00', target: 21, inactivityOffset: 0, name: 'Night' },
                { start: '06:00', end: '08:00', target: 22.5, inactivityOffset: 0, name: 'Morning' },
                { start: '08:00', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            earlyEvening: { start: '22:00', end: '23:59', target: 21, inactivityOffset: 0, name: 'Evening' },
            lateEvening: { start: '22:00', end: '23:59', target: 21, inactivityOffset: 0, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 90,
            windowOpenTimeout: 60,
            windowClosedDelay: 600,  // 10 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    }
   
    // Add more rooms here!
};

// ============================================================================
// Global Configuration (Shared across all rooms)
// ============================================================================

const GLOBAL_CONFIG = {
    tadoHomeId: 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c',
    icalCalendarId: '2ba196bb-b710-4b99-8bb2-72da3987d38c',
    homeyLogicVars: {
        schoolDay: 'IsSchoolDay',
        schoolDayTomorrow: 'IsSchoolDayTomorrow'
    }
};

// ============================================================================
// Save Configuration to Global Variables
// ============================================================================

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          ROOM HEATING CONFIGURATION - SAVE TO GLOBALS        ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

// Save entire ROOMS config as JSON
const roomsJson = JSON.stringify(ROOMS, null, 2);
global.set('Config.Rooms', roomsJson);
log(`✅ Saved ROOMS configuration (${Object.keys(ROOMS).length} rooms)`);

// Save global config
const globalJson = JSON.stringify(GLOBAL_CONFIG, null, 2);
global.set('Config.Global', globalJson);
log(`✅ Saved GLOBAL configuration`);

// Save metadata
global.set('Config.LastUpdate', new Date().toISOString());
global.set('Config.Version', '1.0.3');

log('\n══ CONFIGURED ROOMS ══');
for (const [roomName, roomConfig] of Object.entries(ROOMS)) {
    log(`📍 ${roomName}:`);
    log(`   Zone: ${roomConfig.zoneName}`);
    log(`   Type: ${roomConfig.heating.type}`);
    log(`   Devices: ${roomConfig.heating.devices.length}`);
    log(`   Weekday target: ${roomConfig.schedules.weekday.find(s => s.name === 'Day')?.target}°C`);
    log(`   Weekend target: ${roomConfig.schedules.weekend.find(s => s.name === 'Day')?.target}°C`);
    log(`   TADO away: ${roomConfig.settings.tadoAwayMinTemp}°C`);
    log(`   Inactivity: ${roomConfig.settings.inactivityTimeout} min`);
    log(`   Window open timeout: ${roomConfig.settings.windowOpenTimeout} sec`);
    log(`   Window closed delay: ${roomConfig.settings.windowClosedDelay} sec (${Math.floor(roomConfig.settings.windowClosedDelay / 60)} min)`);
    log(`   Manual override: ${roomConfig.settings.manualOverrideDuration} min`);
    log('');
}

log('══ GLOBAL SETTINGS ══');
log(`TADO Home ID: ${GLOBAL_CONFIG.tadoHomeId}`);
log(`iCal Calendar ID: ${GLOBAL_CONFIG.icalCalendarId}`);
log(`School day var: ${GLOBAL_CONFIG.homeyLogicVars.schoolDay}`);
log('');

log('╔═══════════════════════════════════════════════════════════════╗');
log('║          CONFIGURATION SAVED SUCCESSFULLY                     ║');
log('╚═══════════════════════════════════════════════════════════════╝');
log('');
log('ℹ️  To apply changes:');
log('   1. Edit ROOMS configuration above');
log('   2. Run this script again');
log('   3. Heating and status scripts will use new config automatically');
log('');
log('ℹ️  Global Heating Control:');
log('   Set HeatingEnabled global variable to control all heating:');
log('   - true:  Heating scripts run normally (default)');
log('   - false: Heating scripts skip execution (heating disabled)');
log('');
log('   Example:');
log('   global.set("HeatingEnabled", false)  // Disable all heating');
log('   global.set("HeatingEnabled", true)   // Enable all heating');
log('');