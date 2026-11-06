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
 * Version: 1.7.0
 * Created: 2025-12-31
 *
 * Version history: CHANGELOG.md
 */

// ============================================================================
// ROOM CONFIGURATIONS - Edit here and run script to update!
// ============================================================================

const ROOMS = {
    'Clara': {
        zoneName: 'Claras værelse',
        heating: {
            type: 'smart_plug',
            hysteresis: 0.5  // ±0.25°C margin around target
        },
        schedules: {
            // School days: Clara is away at efterskole Mon-Fri (2026/27), so the room holds 17.
            // The afternoon slot heats to 21 only when the room is active (Friday homecoming).
            weekday: [
                { start: '00:00', end: '14:00', target: 17, inactivityOffset: 0, name: 'Efterskole' },
                { start: '14:00', end: '20:00', target: 21, inactivityOffset: 4, name: 'Day' }
            ],
            // Optional: replaces weekday on a Friday school day. Friday from 14:00 is weekend.
            friday: [
                { start: '00:00', end: '14:00', target: 17, inactivityOffset: 0, name: 'Efterskole' },
                { start: '14:00', end: '21:00', target: 22.0, inactivityOffset: 2.0, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '08:00', target: 20, inactivityOffset: 0, name: 'Night' },
                { start: '08:00', end: '21:00', target: 22.0, inactivityOffset: 2.0, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '08:00', target: 20, inactivityOffset: 0, name: 'Night' },
                { start: '08:00', end: '21:00', target: 22.0, inactivityOffset: 2.0, name: 'Day' }
            ],
            earlyEvening: { start: '20:00', end: '23:59', target: 20, inactivityOffset: 3, name: 'Evening' },  // Sun-Thu: 17 when empty
            lateEvening: { start: '21:00', end: '23:59', target: 20, inactivityOffset: 0, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            inactivityOffset: 2.0,  // Default temperature reduction when inactive
            windowOpenTimeout: 60,
            windowClosedDelay: 1800,  // 30 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },
    
    'Oliver': {
        zoneName: 'Olivers værelse',
        heating: {
            type: 'tado_valve'
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '08:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '08:00', end: '20:00', target: 22, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '21:00', target: 20.5, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '09:00', target: 18, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '21:00', target: 20.5, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            earlyEvening: { start: '20:00', end: '23:59', target: 19, inactivityOffset: 1, name: 'Evening' },
            lateEvening: { start: '21:00', end: '23:59', target: 19, inactivityOffset: 1, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            inactivityOffset: 1.0,  // Default temperature reduction when inactive
            windowOpenTimeout: 60,
            windowClosedDelay: 1800,  // 30 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },
    
    'Soveværelse': {
        zoneName: 'Soveværelse',
        heating: {
            type: 'tado_valve'
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '07:00', target: 15, inactivityOffset: 0, name: 'Night' },
                { start: '07:00', end: '19:00', target: 20, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '09:00', target: 15, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '19:00', target: 20, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '09:00', target: 15, inactivityOffset: 0, name: 'Night' },
                { start: '09:00', end: '19:00', target: 20, inactivityTimeout: 60, inactivityOffset: 1, name: 'Day' }
            ],
            earlyEvening: { start: '19:00', end: '23:59', target: 15, inactivityOffset: 0, name: 'Evening' },
            lateEvening: { start: '19:00', end: '23:59', target: 15, inactivityOffset: 0, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 30,
            inactivityOffset: 1.0,  // Default temperature reduction when inactive
            windowOpenTimeout: 60,
            windowClosedDelay: 1800,  // 30 minutes for air to settle after window closes
            manualOverrideDuration: 90  // 90 minutes - pause automation when manual intervention detected
        }
    },

     'Stue': {
        zoneName: 'Stue / Spisestue',
        heating: {
            type: 'tado_valve'
        },
        schedules: {
            weekday: [
                { start: '00:00', end: '04:00', target: 21, name: 'Night' },
                { start: '04:00', end: '07:00', target: 22.5, name: 'Morning' },
                { start: '07:00', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            weekend: [
                { start: '00:00', end: '05:00', target: 21, name: 'Night' },
                { start: '05:00', end: '08:30', target: 22.5, name: 'Morning' },
                { start: '08:30', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            holiday: [
                { start: '00:00', end: '05:00', target: 21, name: 'Night' },
                { start: '05:00', end: '08:30', target: 22.5, name: 'Morning' },
                { start: '08:30', end: '22:00', target: 22, inactivityOffset: 1, name: 'Day' }
            ],
            earlyEvening: { start: '22:00', end: '23:59', target: 22, inactivityTimeout: 60, inactivityOffset: 1, name: 'Evening' },
            lateEvening: { start: '22:00', end: '23:59', target: 22, inactivityTimeout: 60, inactivityOffset: 1, name: 'Evening' }
        },
        settings: {
            tadoAwayMinTemp: 17.0,
            inactivityTimeout: 90,
            inactivityOffset: 0,  // Default temperature reduction when inactive
            windowOpenTimeout: 60,
            windowClosedDelay: 1800,  // 30 minutes for air to settle after window closes
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

    // School holidays (inclusive date ranges). Edit once a year from the school's plan.
    // Weekends and the public holidays below are handled automatically; only list the
    // extra days the school is closed. Dates below follow the usual Copenhagen pattern
    // for 2026/27 - CHECK THEM against the school's own calendar.
    schoolHolidays: [
        { from: '2026-10-12', to: '2026-10-16', name: 'Efterårsferie' },
        { from: '2026-12-21', to: '2027-01-01', name: 'Juleferie' },
        { from: '2027-02-15', to: '2027-02-19', name: 'Vinterferie' },
        { from: '2027-03-22', to: '2027-03-29', name: 'Påskeferie' },
        { from: '2027-05-07', to: '2027-05-07', name: 'Fredag efter Kristi himmelfart' },
        { from: '2027-06-26', to: '2027-08-08', name: 'Sommerferie' }
    ],

    // Fixed-date days with no school (MM-DD). Easter-based holidays (skærtorsdag,
    // langfredag, 2. påskedag, Kristi himmelfart, 2. pinsedag) are computed by the script.
    publicHolidaysFixed: ['01-01', '06-05', '12-24', '12-25', '12-26', '12-31'],

    // Boolean Logic variable: set to Yes for an ad hoc "no school today" (sick day etc.).
    // Affects today only; tomorrow is decided by the lists above.
    schoolHolidayVariable: 'SchoolHoliday',

    // false: notify only exceptions (window, away, boost/pause/manual, sensor, schedule
    // reminders). true: also routine changes (heat on/off, schedule steps, inactivity).
    notifyRoutineChanges: false
};

// ============================================================================
// Validate before saving
// ============================================================================
// Errors stop the script before anything is saved. Warnings are saved anyway but listed,
// e.g. an evening slot that starts before the day's last slot ends (the day slot wins).

const errors = [];
const warnings = [];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SLOT_KEYS = ['start', 'end', 'target', 'name', 'inactivityTimeout', 'inactivityOffset', 'windowOpenTimeout', 'windowClosedDelay'];
const SETTING_KEYS = ['tadoAwayMinTemp', 'inactivityTimeout', 'inactivityOffset', 'windowOpenTimeout', 'windowClosedDelay', 'manualOverrideDuration', 'sensorStaleMinutes'];
const DAY_SCHEDULES = ['weekday', 'weekend', 'holiday'];
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// When each day schedule meets each evening slot
const EVENING_CASES = {
    'weekday+earlyEvening': 'a school day before a school day',
    'weekday+lateEvening': 'a Friday or the day before a holiday',
    'weekend+earlyEvening': 'a Sunday before a school day',
    'weekend+lateEvening': 'a Saturday, or a Sunday before a holiday',
    'holiday+earlyEvening': 'the last day of a holiday',
    'holiday+lateEvening': 'a holiday before another day off',
    'friday+lateEvening': 'a Friday school day'
};

function checkSlot(where, slot) {
    if (!slot || typeof slot !== 'object') {
        errors.push(`${where}: missing`);
        return false;
    }
    let ok = true;
    for (const key of ['start', 'end']) {
        if (!TIME_RE.test(slot[key] || '')) {
            errors.push(`${where}: ${key} "${slot[key]}" is not HH:MM`);
            ok = false;
        }
    }
    if (typeof slot.target !== 'number') {
        errors.push(`${where}: target must be a number`);
        ok = false;
    }
    if (!slot.name) {
        warnings.push(`${where}: no name (notifications show "Unknown")`);
    }
    if (ok && toMinutes(slot.start) >= toMinutes(slot.end)) {
        errors.push(`${where}: start ${slot.start} is not before end ${slot.end}`);
        ok = false;
    }
    for (const key of Object.keys(slot)) {
        if (!SLOT_KEYS.includes(key)) warnings.push(`${where}: unknown field "${key}" (ignored)`);
    }
    return ok;
}

for (const [roomName, room] of Object.entries(ROOMS)) {
    if (!room.zoneName) errors.push(`${roomName}: zoneName missing`);
    if (!['smart_plug', 'tado_valve'].includes(room.heating?.type)) {
        errors.push(`${roomName}: heating.type must be 'smart_plug' or 'tado_valve'`);
    }

    const settings = room.settings || {};
    for (const key of ['inactivityTimeout', 'windowOpenTimeout']) {
        if (typeof settings[key] !== 'number') errors.push(`${roomName}: settings.${key} must be a number`);
    }
    for (const key of Object.keys(settings)) {
        if (!SETTING_KEYS.includes(key)) warnings.push(`${roomName}: unknown setting "${key}" (ignored)`);
    }

    const schedules = room.schedules || {};
    const dayOk = {};
    // friday is optional; when present it is checked like the others
    const days = schedules.friday ? [...DAY_SCHEDULES, 'friday'] : DAY_SCHEDULES;
    for (const day of days) {
        const slots = schedules[day];
        if (!Array.isArray(slots) || slots.length === 0) {
            errors.push(`${roomName}: schedules.${day} must be a non-empty list`);
            continue;
        }
        dayOk[day] = slots.every((slot, i) => checkSlot(`${roomName} ${day}[${i}]`, slot));
        if (!dayOk[day]) continue;
        if (slots[0].start !== '00:00') {
            errors.push(`${roomName} ${day}: first slot starts at ${slots[0].start}, not 00:00`);
        }
        for (let i = 1; i < slots.length; i++) {
            if (slots[i].start !== slots[i - 1].end) {
                const kind = toMinutes(slots[i].start) > toMinutes(slots[i - 1].end) ? 'gap' : 'overlap';
                errors.push(`${roomName} ${day}: ${kind} between ${slots[i - 1].name} (ends ${slots[i - 1].end}) and ${slots[i].name} (starts ${slots[i].start})`);
            }
        }
    }

    for (const evening of ['earlyEvening', 'lateEvening']) {
        const slot = schedules[evening];
        if (!checkSlot(`${roomName} ${evening}`, slot)) continue;
        if (slot.end !== '23:59') {
            warnings.push(`${roomName} ${evening}: ends ${slot.end}; the evening slot is the last of the day, so it should end 23:59`);
        }
        for (const day of days) {
            if (!dayOk[day]) continue;
            if (day === 'friday' && evening === 'earlyEvening') continue;  // Saturday is never a school day
            const lastSlot = schedules[day][schedules[day].length - 1];
            const when = EVENING_CASES[`${day}+${evening}`];
            if (toMinutes(slot.start) < toMinutes(lastSlot.end)) {
                warnings.push(`${roomName}: ${evening} starts ${slot.start} but ${day} ${lastSlot.name} runs to ${lastSlot.end} - on ${when} ${lastSlot.name} wins until ${lastSlot.end}`);
            } else if (toMinutes(slot.start) > toMinutes(lastSlot.end) && evening === 'earlyEvening') {
                // lateEvening gaps are closed by extending the day's last slot; earlyEvening gaps are not
                warnings.push(`${roomName}: gap ${lastSlot.end}-${slot.start} between ${day} ${lastSlot.name} and earlyEvening - on ${when} the room falls back to the first slot of the day`);
            }
        }
    }
}

if (!GLOBAL_CONFIG.tadoHomeId) errors.push('GLOBAL_CONFIG.tadoHomeId missing');
for (const [i, range] of (GLOBAL_CONFIG.schoolHolidays || []).entries()) {
    const where = `schoolHolidays[${i}] ${range.name || ''}`.trim();
    if (!DATE_RE.test(range.from || '') || !DATE_RE.test(range.to || '')) {
        errors.push(`${where}: from/to must be YYYY-MM-DD`);
    } else if (range.from > range.to) {
        errors.push(`${where}: from ${range.from} is after to ${range.to}`);
    }
}
for (const day of GLOBAL_CONFIG.publicHolidaysFixed || []) {
    if (!MONTH_DAY_RE.test(day)) errors.push(`publicHolidaysFixed: "${day}" is not MM-DD`);
}

if (warnings.length) {
    log(`⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) log(`   - ${w}`);
    log('');
}
if (errors.length) {
    log(`❌ ${errors.length} error(s) - nothing saved:`);
    for (const e of errors) log(`   - ${e}`);
    throw new Error(`Configuration has ${errors.length} error(s) - nothing saved (see log)`);
}

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
global.set('Config.Version', '1.7.0');

log('\n══ CONFIGURED ROOMS ══');
for (const [roomName, roomConfig] of Object.entries(ROOMS)) {
    log(`📍 ${roomName}:`);
    log(`   Zone: ${roomConfig.zoneName}`);
    log(`   Type: ${roomConfig.heating.type}`);
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
log(`School holidays: ${GLOBAL_CONFIG.schoolHolidays.length} range(s)`);
for (const h of GLOBAL_CONFIG.schoolHolidays) {
    log(`   ${h.from} → ${h.to}  ${h.name}`);
}
log(`No-school override variable: ${GLOBAL_CONFIG.schoolHolidayVariable}`);
log(`Routine notifications: ${GLOBAL_CONFIG.notifyRoutineChanges ? 'on' : 'off (exceptions only)'}`);
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
log('   The Yes/No Logic variable "HeatingEnabled" (Homey > Logic) switches all heating:');
log('   - Yes (or missing): the heating script runs normally');
log('   - No: the heating script skips every run, and the "Heating Master Off" flow');
log('         turns the radiators and TADO valves off every 5 minutes');
log('');