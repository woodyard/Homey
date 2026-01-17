/**
 * Generic Room Heating Control (Zone-Based, Multi-Room)
 *
 * Universal heating control for multiple rooms - select room via argument!
 *
 * Usage in HomeyScript:
 *   await run('Clara')            // Run for Clara's room
 *   await run('Oliver')           // Run for Oliver's room
 *   await run('clara', 'boost')   // Boost heating - max heat for 1 hour (case-insensitive)
 *   await run('clara', 'pause')   // Pause heating - force OFF for 1 hour (case-insensitive)
 *   await run('Clara', 'cancel')  // Cancel active boost, pause, or manual override
 *
 * Or in Advanced Flow:
 *   Use "Run a script" action with argument:
 *   - "Clara"          → Normal heating
 *   - "clara, boost"   → Boost mode - max heat for 1 hour (comma-separated)
 *   - "clara, pause"   → Pause mode - force OFF for 1 hour (comma-separated)
 *   - "Clara, cancel"  → Cancel boost, pause, or manual override
 *
 * Features:
 * - Single script for ALL rooms
 * - Configure all rooms in ROOMS object
 * - Pass room name as argument to select which room
 * - Auto-detects sensors via zones
 * - Supports both smart_plug and tado_valve
 * - Target-based temperature control with automatic hysteresis
 * - Manual intervention detection - respects manual changes for 90 minutes
 *
 * Author: Henrik Skovgaard
 * Version: 10.8.0
 * Created: 2025-12-31
 * Based on: Clara Heating v6.4.6
 *
 * Recent Changes (see CHANGELOG.txt for complete version history):
 * 10.8.3  (2026-01-17) - 🐛 Fix: TADO target calculation from scratch on air settle
 * 10.8.2  (2026-01-17) - 🐛 Fix: TADO set to wrong target after air settle
 * 10.8.1  (2026-01-17) - 🐛 Fix: Air settled notification not sent
 * 10.8.0  (2026-01-17) - 🎛️ Unified slot-override architecture
 * 10.7.0  (2026-01-17) - ⏱️ Per-slot inactivity timeout support
 * 10.6.13 (2026-01-16) - 🐛 Fix: Schedule gap when Day ends before lateEvening starts
 * 10.6.12 (2026-01-16) - 🔕 Suppress "air settled" notifications in away mode
 * 10.6.11 (2026-01-15) - 🐛 Fix: Window settle delay only for long openings
 * 10.6.10 (2026-01-15) - 🐛 Fix: Prevent immediate double notifications
 * 10.6.9  (2026-01-15) - 🔍 Search child zones for sensors
 * 10.6.8  (2026-01-15) - 📊 Use TADO temperature sensor by ID
 * 10.6.7  (2026-01-14) - 🐛 Fix: Away mode transition before manual detection
 * 10.6.6  (2026-01-14) - 🐛 Fix: False manual override arriving home
 * 10.6.5  (2026-01-14) - 🐛 Fix: Grace period reset causing false positives
 * 10.6.0  (2026-01-13) - 🤚 Manual intervention detection
 * 10.5.0  (2026-01-12) - ⏸️ Pause heating mode
 * 10.4.0  (2026-01-08) - 🚀 Boost heating mode
 * 10.3.11 (2026-01-08) - ⏳ Window closed delay for air to settle
 * 10.0.0  (2025-12-31) - 🔧 Configuration via global variables
 * 8.0.0   (2025-12-31) - 🎯 Target-based temperature control
 * 7.0.0   (2025-12-31) - 🌟 Zone-based generic implementation
 */


// ============================================================================
// Load Configuration from Global Variables
// ============================================================================

function loadConfiguration() {
    const roomsJson = global.get('Config.Rooms');
    const globalJson = global.get('Config.Global');
    
    if (!roomsJson) {
        throw new Error('❌ Configuration not found! Please run room-heating-config.js first to save configuration.');
    }
    
    const ROOMS = JSON.parse(roomsJson);
    const GLOBAL_CONFIG = globalJson ? JSON.parse(globalJson) : null;
    
    return { ROOMS, GLOBAL_CONFIG };
}

// Load configuration
const { ROOMS, GLOBAL_CONFIG } = loadConfiguration();

// ============================================================================
// Get room configuration from argument
// ============================================================================

let roomArgRaw, boostArg;

// Handle different argument formats:
// - HomeyScript: run('Clara', 'boost')  → args = ['Clara', 'boost']
// - Flow: "Clara, boost"                → args = ['Clara, boost']
if (args?.[0]?.includes(',')) {
    // Flow format: Split comma-separated string
    const parts = args[0].split(',').map(s => s.trim());
    roomArgRaw = parts[0];
    boostArg = parts[1];
    log(`📝 Parsed Flow arguments: room="${roomArgRaw}", action="${boostArg}"`);
} else {
    // HomeyScript format: Separate arguments
    roomArgRaw = args?.[0] || 'Stue';
    boostArg = args?.[1];
}

// Find room name (case-insensitive)
const roomArg = Object.keys(ROOMS).find(key => key.toLowerCase() === roomArgRaw.toLowerCase());

if (!roomArg) {
    const availableRooms = Object.keys(ROOMS).join(', ');
    throw new Error(`Unknown room: "${roomArgRaw}". Available rooms: ${availableRooms}`);
}

const ROOM = ROOMS[roomArg];
log(`🏠 Running heating control for: ${roomArg} (${ROOM.zoneName})`);

// Check for boost/pause/cancel request
const requestBoost = boostArg === 'boost';
const requestPause = boostArg === 'pause';
const requestCancel = boostArg === 'cancel';

if (requestBoost) {
    log(`🚀 Boost heating requested via argument`);
}

if (requestPause) {
    log(`⏸️ Pause heating requested via argument`);
}

if (requestCancel) {
    log(`🛑 Cancel override requested via argument`);
}

// ============================================================================
// Global Configuration (Shared) - from config script
// ============================================================================

const TADO_HOME_ID = GLOBAL_CONFIG?.tadoHomeId || 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c';
const ICALCALENDAR_DEVICE_ID = GLOBAL_CONFIG?.icalCalendarId || '2ba196bb-b710-4b99-8bb2-72da3987d38c';
const HOMEY_LOGIC_SCHOOLDAY_VAR = GLOBAL_CONFIG?.homeyLogicVars?.schoolDay || 'IsSchoolDay';
const HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR = GLOBAL_CONFIG?.homeyLogicVars?.schoolDayTomorrow || 'IsSchoolDayTomorrow';


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get effective setting value with slot override support
 * @param {Object} slot - Current time slot
 * @param {string} settingName - Name of setting to retrieve
 * @param {any} roomDefault - Room-level default value
 * @returns {any} Slot value if defined, otherwise room default
 */
function getEffectiveSetting(slot, settingName, roomDefault) {
    const slotValue = slot[settingName];
    return slotValue !== undefined ? slotValue : roomDefault;
}

/**
 * Get setting source indicator for logging/display
 * @param {Object} slot - Current time slot
 * @param {string} settingName - Name of setting
 * @returns {string} 'slot override' or 'room default'
 */
function getSettingSource(slot, settingName) {
    return slot[settingName] !== undefined ? 'slot override' : 'room default';
}

function getDanishLocalTime() {
    const now = new Date();
    const danishTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
    return danishTime;
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function getCurrentTimeSlot(schedule, currentTime) {
    const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    
    for (const slot of schedule) {
        const startMinutes = timeToMinutes(slot.start);
        const endMinutes = timeToMinutes(slot.end);
        
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
            return slot;
        }
    }
    
    const lastSlot = schedule[schedule.length - 1];
    const lastEndMinutes = timeToMinutes(lastSlot.end);
    if (currentMinutes === lastEndMinutes) {
        return lastSlot;
    }
    
    return schedule[0];
}

async function getCompleteSchedule(baseSchedule) {
    const schoolDayTomorrow = await isSchoolDayTomorrow();
    const eveningSlot = schoolDayTomorrow ? ROOM.schedules.earlyEvening : ROOM.schedules.lateEvening;
    
    log(`🌙 Evening Slot: ${eveningSlot.start}-${eveningSlot.end} (${schoolDayTomorrow ? 'School tomorrow' : 'Weekend/holiday tomorrow'})`);
    
    // If evening slot starts later than the last base schedule slot ends, extend the last slot
    // to prevent gaps (e.g., weekday Day ends 20:00, but lateEvening starts 21:00 on holiday)
    const lastSlot = baseSchedule[baseSchedule.length - 1];
    const lastSlotEnd = timeToMinutes(lastSlot.end);
    const eveningStart = timeToMinutes(eveningSlot.start);
    
    if (!schoolDayTomorrow && eveningStart > lastSlotEnd) {
        const extendedSchedule = [...baseSchedule];
        extendedSchedule[extendedSchedule.length - 1] = { ...lastSlot, end: eveningSlot.start };
        log(`📅 Extended last slot to ${eveningSlot.start} to match evening start (preventing gap)`);
        return [...extendedSchedule, eveningSlot];
    }
    
    return [...baseSchedule, eveningSlot];
}

function formatDateTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function getNextScheduleChange(schedule, currentSlot) {
    const now = getDanishLocalTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // Find current slot index
    const currentIndex = schedule.findIndex(s =>
        s.start === currentSlot.start && s.end === currentSlot.end
    );
    
    if (currentIndex === -1) return null;
    
    // If not last slot, next change is at end of current slot
    if (currentIndex < schedule.length - 1) {
        const nextSlot = schedule[currentIndex + 1];
        return `${currentSlot.end} → ${nextSlot.target}°C (${nextSlot.name})`;
    }
    
    // Last slot - next change is first slot tomorrow
    // Need to determine what schedule type tomorrow will use
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowIsWeekend = isWeekend(tomorrow);
    
    let tomorrowSchedule;
    if (tomorrowIsWeekend) {
        tomorrowSchedule = ROOM.schedules.weekend;
    } else {
        // Check if tomorrow is a school day or holiday
        const schoolDayTomorrow = await isSchoolDayTomorrow();
        tomorrowSchedule = schoolDayTomorrow ? ROOM.schedules.weekday : ROOM.schedules.holiday;
    }
    
    const firstSlot = tomorrowSchedule[0];
    return `${currentSlot.end} → ${firstSlot.target}°C (${firstSlot.name})`;
}

// ============================================================================
// Boost & Pause Heating Functions
// ============================================================================

const BOOST_DURATION_MINUTES = 60;
const BOOST_TEMPERATURE_TADO = 25;
const PAUSE_DURATION_MINUTES = 60;
const MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES = 7; // 7 minutes - must exceed script interval (typically 5 min)

function activateBoostMode() {
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, true);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, BOOST_DURATION_MINUTES);
    
    log(`\n🚀 BOOST MODE ACTIVATED`);
    log(`Duration: ${BOOST_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    
    addChange(`🚀 Boost activated`);
    addChange(`${BOOST_DURATION_MINUTES} min`);
}

function cancelBoostMode() {
    const wasActive = global.get(`${ROOM.zoneName}.Heating.BoostMode`);
    
    // Clear boost mode variables
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, false);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, null);
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, null);
    
    if (wasActive) {
        log(`\n🛑 BOOST MODE CANCELLED`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        log(`Resuming normal schedule operation`);
        
        addChange(`🛑 Boost cancelled`);
        addChange(`Resumed schedule`);
        return true;
    } else {
        log(`\nℹ️ No active boost to cancel`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        return false;
    }
}

function cancelAllOverrideModes() {
    const boostCancelled = cancelBoostMode();
    const pauseCancelled = cancelPauseMode();
    const manualCancelled = cancelManualOverrideMode();
    
    if (boostCancelled || pauseCancelled || manualCancelled) {
        log(`\n✅ Override mode(s) cancelled - resuming normal schedule`);
        return true;
    } else {
        log(`\nℹ️ No active override modes to cancel`);
        return false;
    }
}

function checkBoostMode() {
    const boostActive = global.get(`${ROOM.zoneName}.Heating.BoostMode`);
    
    if (!boostActive) {
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const boostStartTime = global.get(`${ROOM.zoneName}.Heating.BoostStartTime`);
    const boostDuration = global.get(`${ROOM.zoneName}.Heating.BoostDuration`) || BOOST_DURATION_MINUTES;
    
    if (!boostStartTime) {
        // Boost flag set but no start time - clear it
        global.set(`${ROOM.zoneName}.Heating.BoostMode`, false);
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const minutesElapsed = (Date.now() - boostStartTime) / 1000 / 60;
    const remainingMinutes = Math.max(0, boostDuration - minutesElapsed);
    
    if (minutesElapsed >= boostDuration) {
        // Boost expired - clear it
        log(`\n⏱️ BOOST MODE EXPIRED`);
        log(`Duration: ${boostDuration} minutes elapsed`);
        
        global.set(`${ROOM.zoneName}.Heating.BoostMode`, false);
        global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, null);
        global.set(`${ROOM.zoneName}.Heating.BoostDuration`, null);
        
        addChange(`⏱️ Boost ended`);
        addChange(`Resumed schedule`);
        
        return { active: false, expired: true, remainingMinutes: 0 };
    }
    
    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMinutes) };
}

async function controlHeatingBoost() {
    log(`\n--- BOOST HEATING CONTROL ---`);
    log(`Boost mode: ACTIVE - overriding all normal logic`);
    
    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Turning ON all radiators`);
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                if (!currentState) {
                    await device.setCapabilityValue('onoff', true);
                    log(`🔌 ${device.name}: ON`);
                } else {
                    log(`✓ ${device.name}: already ON`);
                }
            } catch (error) {
                log(`❌ Error controlling ${deviceId}: ${error.message}`);
            }
        }
        
        return 'boost_heating';
        
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Setting to ${BOOST_TEMPERATURE_TADO}°C boost temperature`);
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            
            if (currentOnOff !== true) {
                await device.setCapabilityValue('onoff', true);
                log(`🔥 TADO turned ON`);
            }
            
            if (currentTarget !== BOOST_TEMPERATURE_TADO) {
                await device.setCapabilityValue('target_temperature', BOOST_TEMPERATURE_TADO);
                log(`🎯 TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C`);
            } else {
                log(`✓ TADO already at boost temperature`);
            }
            
            return 'boost_tado';
        } catch (error) {
            log(`❌ Error controlling TADO: ${error.message}`);
            return 'boost_error';
        }
    }
    
    return 'boost_unknown_type';
}

// ============================================================================
// Pause Heating Functions
// ============================================================================

function activatePauseMode() {
    global.set(`${ROOM.zoneName}.Heating.PauseMode`, true);
    global.set(`${ROOM.zoneName}.Heating.PauseStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.PauseDuration`, PAUSE_DURATION_MINUTES);
    
    log(`\n⏸️ PAUSE MODE ACTIVATED`);
    log(`Duration: ${PAUSE_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    
    addChange(`⏸️ Pause activated`);
    addChange(`${PAUSE_DURATION_MINUTES} min`);
}

function cancelPauseMode() {
    const wasActive = global.get(`${ROOM.zoneName}.Heating.PauseMode`);
    
    // Clear pause mode variables
    global.set(`${ROOM.zoneName}.Heating.PauseMode`, false);
    global.set(`${ROOM.zoneName}.Heating.PauseStartTime`, null);
    global.set(`${ROOM.zoneName}.Heating.PauseDuration`, null);
    
    if (wasActive) {
        log(`\n🔄 PAUSE MODE CANCELLED`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        log(`Resuming normal schedule operation`);
        
        addChange(`🔄 Pause cancelled`);
        addChange(`Resumed schedule`);
        return true;
    } else {
        log(`\nℹ️ No active pause to cancel`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        return false;
    }
}

function checkPauseMode() {
    const pauseActive = global.get(`${ROOM.zoneName}.Heating.PauseMode`);
    
    if (!pauseActive) {
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const pauseStartTime = global.get(`${ROOM.zoneName}.Heating.PauseStartTime`);
    const pauseDuration = global.get(`${ROOM.zoneName}.Heating.PauseDuration`) || PAUSE_DURATION_MINUTES;
    
    if (!pauseStartTime) {
        // Pause flag set but no start time - clear it
        global.set(`${ROOM.zoneName}.Heating.PauseMode`, false);
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const minutesElapsed = (Date.now() - pauseStartTime) / 1000 / 60;
    const remainingMinutes = Math.max(0, pauseDuration - minutesElapsed);
    
    if (minutesElapsed >= pauseDuration) {
        // Pause expired - clear it
        log(`\n⏱️ PAUSE MODE EXPIRED`);
        log(`Duration: ${pauseDuration} minutes elapsed`);
        
        global.set(`${ROOM.zoneName}.Heating.PauseMode`, false);
        global.set(`${ROOM.zoneName}.Heating.PauseStartTime`, null);
        global.set(`${ROOM.zoneName}.Heating.PauseDuration`, null);
        
        addChange(`⏱️ Pause ended`);
        addChange(`Resumed schedule`);
        
        return { active: false, expired: true, remainingMinutes: 0 };
    }
    
    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMinutes) };
}

async function controlHeatingPause() {
    log(`\n--- PAUSE HEATING CONTROL ---`);
    log(`Pause mode: ACTIVE - turning off all heating`);
    
    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Turning OFF all radiators`);
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                if (currentState) {
                    await device.setCapabilityValue('onoff', false);
                    log(`🔌 ${device.name}: OFF`);
                } else {
                    log(`✓ ${device.name}: already OFF`);
                }
            } catch (error) {
                log(`❌ Error controlling ${deviceId}: ${error.message}`);
            }
        }
        
        return 'pause_heating';
        
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Turning OFF completely`);
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            
            if (currentOnOff !== false) {
                await device.setCapabilityValue('onoff', false);
                log(`🔥 TADO turned OFF`);
            } else {
                log(`✓ TADO already OFF`);
            }
            
            return 'pause_tado';
        } catch (error) {
            log(`❌ Error controlling TADO: ${error.message}`);
            return 'pause_error';
        }
    }
    
    return 'pause_unknown_type';
}

// ============================================================================
// Manual Override Mode Functions
// ============================================================================

function activateManualOverrideMode(overrideType, originalValue, currentValue) {
    const duration = ROOM.settings.manualOverrideDuration || 90;
    
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, true);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideDuration`, duration);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideType`, overrideType);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideOriginalValue`, originalValue);
    
    log(`\n🤚 MANUAL OVERRIDE MODE ACTIVATED`);
    log(`Duration: ${duration} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    log(`Type: ${overrideType} change detected`);
    if (overrideType === 'temperature') {
        log(`Changed: ${originalValue}°C → ${currentValue}°C`);
    } else {
        log(`Switch state changed manually`);
    }
    
    addChange(`🤚 Manual override`);
    addChange(`${duration} min`);
}

function cancelManualOverrideMode() {
    const wasActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    // Clear manual override mode variables
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`, null);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideDuration`, null);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideType`, null);
    global.set(`${ROOM.zoneName}.Heating.ManualOverrideOriginalValue`, null);
    
    if (wasActive) {
        log(`\n🔄 MANUAL OVERRIDE MODE CANCELLED`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        log(`Resuming normal schedule operation`);
        
        addChange(`🔄 Override cancelled`);
        addChange(`Resumed schedule`);
        return true;
    } else {
        log(`\nℹ️ No active manual override to cancel`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        return false;
    }
}

function checkManualOverrideMode() {
    const overrideActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    if (!overrideActive) {
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const overrideStartTime = global.get(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`);
    const overrideDuration = global.get(`${ROOM.zoneName}.Heating.ManualOverrideDuration`) || 90;
    
    if (!overrideStartTime) {
        // Override flag set but no start time - clear it
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
        return { active: false, expired: false, remainingMinutes: 0 };
    }
    
    const minutesElapsed = (Date.now() - overrideStartTime) / 1000 / 60;
    const remainingMinutes = Math.max(0, overrideDuration - minutesElapsed);
    
    if (minutesElapsed >= overrideDuration) {
        // Override expired - clear it
        log(`\n⏱️ MANUAL OVERRIDE MODE EXPIRED`);
        log(`Duration: ${overrideDuration} minutes elapsed`);
        
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideDuration`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideType`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideOriginalValue`, null);
        
        addChange(`⏱️ Override ended`);
        addChange(`Resumed schedule`);
        
        return { active: false, expired: true, remainingMinutes: 0 };
    }
    
    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMinutes) };
}

async function detectManualIntervention() {
    // Grace period check - don't detect changes within 7 minutes of last ACTUAL automation change
    // LastAutomationChangeTime is only updated when system makes physical changes (not on every run)
    // This prevents false positives from system's own temperature adjustments (schedule, inactivity, away mode)
    const lastChangeTime = global.get(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`) || 0;
    const minutesSinceLastChange = (Date.now() - lastChangeTime) / 1000 / 60;
    
    if (minutesSinceLastChange < MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES) {
        return { detected: false };
    }
    
    if (ROOM.heating.type === 'tado_valve') {
        // TADO: Detect temperature changes
        const expectedTarget = global.get(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`);
        
        if (expectedTarget === null || expectedTarget === undefined) {
            // First run - no expected value yet
            return { detected: false };
        }
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            const currentOnOff = device.capabilitiesObj.onoff.value;
            
            // Check if TADO is in away mode (don't treat away mode changes as manual)
            const tadoAway = await isTadoAway();
            if (tadoAway) {
                // In away mode, TADO may change temperature automatically
                return { detected: false };
            }
            
            // Check for intervention (0.3°C tolerance for TADO rounding)
            const tempDifference = Math.abs(currentTarget - expectedTarget);
            
            if (tempDifference > 0.3) {
                log(`\n🤚 MANUAL INTERVENTION DETECTED (TADO)`);
                log(`Expected: ${expectedTarget}°C, Found: ${currentTarget}°C`);
                log(`Difference: ${tempDifference.toFixed(1)}°C`);
                
                return {
                    detected: true,
                    type: 'temperature',
                    originalValue: expectedTarget,
                    currentValue: currentTarget
                };
            }
            
            return { detected: false };
            
        } catch (error) {
            log(`⚠️ Error detecting manual intervention: ${error.message}`);
            return { detected: false };
        }
        
    } else if (ROOM.heating.type === 'smart_plug') {
        // Smart plugs: Detect switch changes
        const expectedOnOff = global.get(`${ROOM.zoneName}.Heating.ExpectedOnOff`);
        
        if (expectedOnOff === null || expectedOnOff === undefined) {
            // First run - no expected value yet
            return { detected: false };
        }
        
        try {
            const currentStates = [];
            let anyDifferent = false;
            
            for (const deviceId of ROOM.heating.devices) {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                currentStates.push({ id: deviceId, name: device.name, state: currentState });
                
                if (currentState !== expectedOnOff) {
                    anyDifferent = true;
                    log(`\n🤚 MANUAL INTERVENTION DETECTED (SMART PLUG)`);
                    log(`Device: ${device.name}`);
                    log(`Expected: ${expectedOnOff ? 'ON' : 'OFF'}, Found: ${currentState ? 'ON' : 'OFF'}`);
                }
            }
            
            if (anyDifferent) {
                return {
                    detected: true,
                    type: 'switch',
                    originalValue: expectedOnOff,
                    currentValue: currentStates
                };
            }
            
            return { detected: false };
            
        } catch (error) {
            log(`⚠️ Error detecting manual intervention: ${error.message}`);
            return { detected: false };
        }
    }
    
    return { detected: false };
}

async function handleManualOverride() {
    log(`\n--- MANUAL OVERRIDE CONTROL ---`);
    log(`Manual override: ACTIVE - respecting user's manual changes`);
    log(`Automation paused - no commands will be sent`);
    
    // Just read current state for logging, but don't change anything
    const heatingOn = await getHeatingStatus();
    
    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Current state preserved (automation paused)`);
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                log(`✓ ${device.name}: ${currentState ? 'ON' : 'OFF'} (manual)`);
            } catch (error) {
                log(`❌ Error reading ${deviceId}: ${error.message}`);
            }
        }
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Current settings preserved (automation paused)`);
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            const heatingPower = device.capabilitiesObj.tado_heating_power?.value || 0;
            log(`✓ TADO target: ${currentTarget}°C (manual)`);
            log(`✓ Heating power: ${heatingPower}%`);
        } catch (error) {
            log(`❌ Error reading TADO: ${error.message}`);
        }
    }
    
    return 'manual_override_active';
}

// ============================================================================
// Zone-Based Device Functions
// ============================================================================

async function getZoneByName(zoneName) {
    const zones = await Homey.zones.getZones();
    return Object.values(zones).find(z => z.name === zoneName);
}

async function getZoneAndChildDevices(zone) {
    // Get devices from this zone and all child zones
    const devices = await Homey.devices.getDevices();
    const zones = await Homey.zones.getZones();
    
    // Find all child zones (zones where parent === this zone's id)
    const childZones = Object.values(zones).filter(z => z.parent === zone.id);
    
    // Get zone IDs to search (this zone + all children)
    const zoneIds = [zone.id, ...childZones.map(z => z.id)];
    
    // Filter devices that belong to any of these zones
    return Object.values(devices).filter(d => zoneIds.includes(d.zone));
}

async function getRoomTemperature() {
    try {
        let tempSensor = null;
        
        // PRIORITY 1: For TADO rooms, get TADO device directly by ID (may be in different zone)
        if (ROOM.heating.type === 'tado_valve') {
            try {
                const tadoDevice = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
                
                if (tadoDevice.capabilitiesObj?.measure_temperature) {
                    tempSensor = tadoDevice;
                    log(`📊 Using TADO device temperature sensor: ${tadoDevice.name} (${tadoDevice.capabilitiesObj.measure_temperature.value}°C)`);
                } else {
                    log(`⚠️  TADO device "${tadoDevice.name}" has no temperature sensor, falling back to zone sensor`);
                }
            } catch (tadoError) {
                log(`⚠️  Could not get TADO device: ${tadoError.message}, falling back to zone sensor`);
            }
        }
        
        // PRIORITY 2: Fall back to any temperature sensor in zone
        if (!tempSensor) {
            const zone = await getZoneByName(ROOM.zoneName);
            if (!zone) {
                log(`❌ Zone "${ROOM.zoneName}" not found`);
                return null;
            }
            
            const devices = await Homey.devices.getDevices();
            const zoneDevices = Object.values(devices).filter(d => d.zone === zone.id);
            tempSensor = zoneDevices.find(d => d.capabilitiesObj?.measure_temperature);
            
            if (tempSensor) {
                log(`📊 Using zone temperature sensor: ${tempSensor.name} (${tempSensor.capabilitiesObj.measure_temperature.value}°C)`);
            }
        }
        
        if (!tempSensor) {
            log(`❌ No temperature sensor found for room "${ROOM.zoneName}"`);
            return null;
        }
        
        return tempSensor.capabilitiesObj.measure_temperature.value;
    } catch (error) {
        log(`Error reading room temperature: ${error.message}`);
        return null;
    }
}

async function isWindowOpen() {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (!zone) return false;
        
        // Get devices from zone and all child zones
        const zoneDevices = await getZoneAndChildDevices(zone);
        
        // Check if ANY contact alarm in zone or child zones is active
        return zoneDevices.some(d => d.capabilitiesObj?.alarm_contact?.value === true);
    } catch (error) {
        log(`Error reading window status: ${error.message}`);
        return false;
    }
}

// ============================================================================
// Heating Control Abstraction
// ============================================================================

async function getHeatingStatus() {
    if (ROOM.heating.type === 'smart_plug') {
        // Check if any radiator is on
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                if (device.capabilitiesObj?.onoff?.value) {
                    return true;
                }
            } catch (error) {
                log(`⚠️  Error reading heating device ${deviceId}: ${error.message}`);
            }
        }
        return false;
    } else if (ROOM.heating.type === 'tado_valve') {
        // Check TADO heating power
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const heatingPower = device.capabilitiesObj?.tado_heating_power?.value || 0;
            return heatingPower > 0;
        } catch (error) {
            log(`⚠️  Error reading TADO status: ${error.message}`);
            return false;
        }
    }
    return false;
}

async function setHeating(turnOn, effectiveTarget) {
    if (ROOM.heating.type === 'smart_plug') {
        // Smart plugs: Binary on/off control with hysteresis
        // turnOn parameter determines action
        const results = [];
        let anyChanged = false;
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                // Only set if different to avoid unnecessary commands
                if (currentState !== turnOn) {
                    await device.setCapabilityValue('onoff', turnOn);
                    log(`🔌 Smart plug ${device.name}: ${turnOn ? 'ON' : 'OFF'}`);
                    anyChanged = true;
                } else {
                    log(`✓ Smart plug ${device.name} already ${turnOn ? 'ON' : 'OFF'}`);
                }
                results.push(true);
            } catch (error) {
                log(`❌ Error controlling radiator ${deviceId}: ${error.message}`);
                results.push(false);
            }
        }
        // Store expected state for manual intervention detection
        // Always store expected state to maintain baseline
        global.set(`${ROOM.zoneName}.Heating.ExpectedOnOff`, turnOn);
        // Only update change time if we actually made a change
        if (anyChanged) {
            global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
        }
        
        return { success: results.every(r => r), changed: anyChanged };
        
    } else if (ROOM.heating.type === 'tado_valve') {
        // TADO valves: Can be turned on/off, and target temperature can be set
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            
            let changed = false;
            
            if (turnOn) {
                // Turn on and set target temperature - but only if needed!
                if (currentOnOff !== true) {
                    await device.setCapabilityValue('onoff', true);
                    log(`🔥 TADO turned ON`);
                    changed = true;
                }
                
                if (currentTarget !== effectiveTarget) {
                    await device.setCapabilityValue('target_temperature', effectiveTarget);
                    log(`🎯 TADO target set to ${effectiveTarget}°C (was ${currentTarget}°C)`);
                    changed = true;
                }
                
                if (!changed) {
                    log(`✓ TADO already ON with target ${effectiveTarget}°C - no change needed`);
                }
                
                // Store expected target for manual intervention detection
                global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, effectiveTarget);
                // Only update LastAutomationChangeTime when we ACTUALLY made a change
                // This prevents constantly resetting the grace period on every script run
                if (changed) {
                    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
                    log(`📝 Stored expected target: ${effectiveTarget}°C and reset grace period (changed)`);
                } else {
                    log(`📝 Updated expected target: ${effectiveTarget}°C (no physical change, grace period not reset)`);
                }
            } else {
                // Turn off completely - but only if needed!
                if (currentOnOff !== false) {
                    await device.setCapabilityValue('onoff', false);
                    log(`🔥 TADO turned OFF`);
                    changed = true;
                }
                
                if (!changed) {
                    log(`✓ TADO already OFF - no change needed`);
                }
                
                // CLEAR ExpectedTargetTemp when turning off - prevents false positives from stale values
                // Stale expected values could cause false positive manual override detection when schedule changes
                global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, null);
                log(`📝 Cleared expected target (TADO off - prevents false positive detection from stale values)`);
            }
            
            return { success: true, changed: changed };
        } catch (error) {
            log(`❌ Error controlling TADO: ${error.message}`);
            return { success: false, changed: false };
        }
    }
    return { success: false, changed: false };
}

async function isTadoAway() {
    try {
        const tadoHome = await Homey.devices.getDevice({ id: TADO_HOME_ID });
        const presenceMode = await tadoHome.capabilitiesObj.tado_presence_mode.value;
        
        if (!presenceMode) {
            log(`⚠️  TADO: Could not read presence mode`);
            return false;
        }
        
        return (presenceMode === 'away');
        
    } catch (error) {
        log(`⚠️  TADO: Error reading status: ${error.message}`);
        return false;
    }
}

// ============================================================================
// School Day Detection
// ============================================================================

async function isSchoolDay() {
    // Try direct calendar reading first
    try {
        const hasEventsToday = await Homey.flow.runFlowCardCondition({
            uri: 'homey:app:no.runely.calendar:any_event_in',
            id: 'no.runely.calendar:any_event_in',
            args: { when: 1, type: '3' }
        });
        
        log(`📚 School Day (Calendar): ${hasEventsToday ? 'SCHOOL DAY' : 'HOLIDAY/VACATION'}`);
        return hasEventsToday;
        
    } catch (directError) {
        // Fallback to Homey Logic
        try {
            const variables = await Homey.logic.getVariables();
            let schoolDayVariable = null;
            
            for (const [id, variable] of Object.entries(variables)) {
                if (variable.name === HOMEY_LOGIC_SCHOOLDAY_VAR) {
                    schoolDayVariable = variable;
                    break;
                }
            }
            
            if (!schoolDayVariable) {
                throw new Error(`Homey Logic variable "${HOMEY_LOGIC_SCHOOLDAY_VAR}" not found`);
            }
            
            const schoolDay = schoolDayVariable.value;
            log(`📚 School Day (Homey Logic): ${schoolDay ? 'SCHOOL DAY' : 'HOLIDAY/VACATION'}`);
            return schoolDay;
            
        } catch (homeyLogicError) {
            // Final fallback to weekday detection
            log(`⚠️  Could not read School Day status - using weekday fallback`);
            const now = new Date();
            const day = now.getDay();
            const isWeekday = (day >= 1 && day <= 5);
            log(`📚 School Day (Fallback): ${isWeekday ? 'SCHOOL DAY (assumed)' : 'WEEKEND'}`);
            return isWeekday;
        }
    }
}

async function isSchoolDayTomorrow() {
    try {
        const variables = await Homey.logic.getVariables();
        let schoolDayVariable = null;
        
        for (const [id, variable] of Object.entries(variables)) {
            if (variable.name === HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR) {
                schoolDayVariable = variable;
                break;
            }
        }
        
        if (!schoolDayVariable) {
            log(`⚠️  ${HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR} variable not found - using weekend detection`);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
            return !isTomorrowWeekend;
        }
        
        return schoolDayVariable.value;
        
    } catch (error) {
        log(`⚠️  Could not read ${HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR} - using weekend detection`);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
        return !isTomorrowWeekend;
    }
}

// ============================================================================
// Zone-Based Inactivity Detection
// ============================================================================

async function checkInactivity(slot) {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (!zone) {
            log(`⚠️  Zone "${ROOM.zoneName}" not found`);
            return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
        }
        
        // Get effective settings using unified override pattern
        const inactivityOffset = getEffectiveSetting(slot, 'inactivityOffset', ROOM.settings.inactivityOffset || 0);
        const inactivityTimeout = getEffectiveSetting(slot, 'inactivityTimeout', ROOM.settings.inactivityTimeout);
        
        // If offset=0, clear flag and return inactive=false
        if (inactivityOffset === 0) {
            const wasInactive = global.get(`${ROOM.zoneName}.Heating.InactivityMode`);
            if (wasInactive) {
                global.set(`${ROOM.zoneName}.Heating.InactivityMode`, false);
                log(`ℹ️  Inactivity mode cleared (offset = 0 in this period)`);
            }
            return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
        }
        
        // Store active settings for status display
        global.set(`${ROOM.zoneName}.Heating.ActiveInactivityTimeout`, inactivityTimeout);
        global.set(`${ROOM.zoneName}.Heating.ActiveInactivityOffset`, inactivityOffset);
        
        // Use zone.active and zone.activeLastUpdated for tracking!
        if (zone.active) {
            // Zone is active right now
            const wasInactive = global.get(`${ROOM.zoneName}.Heating.InactivityMode`);
            
            if (wasInactive) {
                global.set(`${ROOM.zoneName}.Heating.InactivityMode`, false);
                log(`💤 Activity detected in zone - inactivity mode deactivated`);
                return { inactive: false, wasInactive: true, minutesSinceMotion: 0 };
            }
            
            return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
        }
        
        // Zone is inactive - calculate duration
        const now = Date.now();
        const lastActive = new Date(zone.activeLastUpdated).getTime();
        const minutesSinceActive = (now - lastActive) / (1000 * 60);
        
        if (minutesSinceActive >= inactivityTimeout) {
            const wasInactive = global.get(`${ROOM.zoneName}.Heating.InactivityMode`);
            
            if (!wasInactive) {
                global.set(`${ROOM.zoneName}.Heating.InactivityMode`, true);
                const timeoutSource = getSettingSource(slot, 'inactivityTimeout');
                const offsetSource = getSettingSource(slot, 'inactivityOffset');
                log(`💤 Zone inactive for ${Math.floor(minutesSinceActive)} minutes`);
                log(`   Timeout: ${inactivityTimeout} min (${timeoutSource}), Offset: ${inactivityOffset}°C (${offsetSource})`);
                return { inactive: true, wasInactive: false, minutesSinceMotion: Math.floor(minutesSinceActive), inactivityOffset: inactivityOffset };
            }
            
            return { inactive: true, wasInactive: true, minutesSinceMotion: Math.floor(minutesSinceActive), inactivityOffset: inactivityOffset };
        }
        
        return { inactive: false, wasInactive: false, minutesSinceMotion: Math.floor(minutesSinceActive), inactivityOffset: 0 };
        
    } catch (error) {
        log(`⚠️  Could not check zone activity: ${error.message}`);
        return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
    }
}

// ============================================================================
// Unified Notification System
// ============================================================================

const changes = [];

function addChange(changeText) {
    changes.push(changeText);
    log(`⭐ Change: ${changeText}`);
}

async function sendUnifiedNotification(status) {
    if (changes.length === 0) {
        return;
    }
    
    try {
        const lines = [];
        lines.push(`🏠 ${roomArg} - Heating Update`);
        
        // Changes - combine on one line with bullet separator
        const changesSummary = changes.map(c => c).join(' • ');
        lines.push(`⭐ ${changesSummary}`);
        
        lines.push("");
        
        // Status - all on one compact line with icons
        // Only show icons for alert/exception conditions (icons are self-explanatory)
        const statusParts = [];
        statusParts.push(`🌡️${status.room}→${status.target}°C`);
        
        // Only show wind icon if window is OPEN
        if (status.window !== 'CLOSED') {
            statusParts.push(`💨`);
        }
        
        // Only show hourglass icon if in window settle delay
        if (status.windowSettle) {
            statusParts.push(`⏳`);
        }
        
        // Only show inactive icon if room IS inactive
        if (status.inactivity !== 'NO') {
            statusParts.push(`💤`);
        }
        
        // Only show snowflake icon if heating is completely OFF
        if (status.heating === 'OFF') {
            statusParts.push(`❄️`);
        }
        
        // Only show walking person icon if in AWAY mode
        if (status.tado === 'AWAY') {
            statusParts.push(`🚶`);
        }
        
        lines.push(`📊 ${statusParts.join(' ')}`);
        
        // Next schedule change
        if (status.nextChange) {
            lines.push(`⏰ Next: ${status.nextChange}`);
        }
        
        const notificationText = lines.join('\n');
        
        await Homey.flow.runFlowCardAction({
            uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
            id: "homey:manager:notifications:create_notification",
            args: { text: notificationText }
        });
        
        log(`✅ Unified notification sent (${changes.length} changes)`);
    } catch (error) {
        log(`⚠️  Could not send notification: ${error.message}`);
    }
}


// ============================================================================
// Heating Control Logic
// ============================================================================

async function controlHeating(roomTemp, slot, windowOpen) {
    const heatingOn = await getHeatingStatus();
    const tadoAway = await isTadoAway();
    const inactivity = await checkInactivity(slot);
    const wasInTadoAway = global.get(`${ROOM.zoneName}.Heating.TadoAwayActive`);
    
    // Get effective settings using unified override pattern
    const inactivityOffset = inactivity.inactivityOffset || 0;
    const windowOpenTimeout = getEffectiveSetting(slot, 'windowOpenTimeout', ROOM.settings.windowOpenTimeout);
    const windowClosedDelay = getEffectiveSetting(slot, 'windowClosedDelay', ROOM.settings.windowClosedDelay || 600);
    
    // Calculate effective target temperature
    let effectiveTarget = slot.target;
    
    log(`\n--- HEATING CONTROL ---`);
    log(`Room: ${roomTemp}°C | Base Target: ${slot.target}°C`);
    log(`Window: ${windowOpen ? 'OPEN' : 'CLOSED'}`);
    log(`TADO Away mode: ${tadoAway ? 'YES (nobody home)' : 'NO (someone home)'}`);
    log(`Inactivity: ${inactivity.inactive ? `YES (${inactivity.minutesSinceMotion} min since activity)` : `NO (${inactivity.minutesSinceMotion} min since activity)`} | Offset: ${inactivityOffset}°C`);
    log(`Heating: ${heatingOn ? 'ON' : 'OFF'}`);
    
    // TADO Away Mode - note: wasInTadoAway check moved to main execution before manual intervention detection
    if (tadoAway) {
        log(`🏠 TADO is in away mode - nobody home`);
        
        if (ROOM.settings.tadoAwayMinTemp === null) {
            if (heatingOn) {
                if (ROOM.heating.type === 'smart_plug') {
                    await setHeating(false, effectiveTarget);
                    log(`🔥 Heating turned off completely (TADO away mode, no min temp)`);
                } else {
                    // For TADO valves, we still need to set a low target
                    effectiveTarget = 15; // Very low temp when away and no min set
                    await setHeating(true, effectiveTarget);
                    log(`🔥 TADO set to very low (15°C) - away mode, no min temp`);
                }
                addChange("Away");
                addChange("Heat off");
                global.set(`${ROOM.zoneName}.Heating.TadoAwayActive`, true);
                return 'tado_away_off';
            } else {
                log(`✓ Heating already off`);
                global.set(`${ROOM.zoneName}.Heating.TadoAwayActive`, true);
                return 'tado_away_skip';
            }
        } else {
            log(`🔥 TADO away mode: Holding minimum ${ROOM.settings.tadoAwayMinTemp}°C`);
            
            if (!wasInTadoAway) {
                addChange("Away");
                addChange(`Min ${ROOM.settings.tadoAwayMinTemp}°C`);
                global.set(`${ROOM.zoneName}.Heating.TadoAwayActive`, true);
            }
            
            effectiveTarget = ROOM.settings.tadoAwayMinTemp;
            log(`→ Effective target: ${effectiveTarget}°C (away min temp)`);
        }
    } else {
        if (wasInTadoAway) {
            global.set(`${ROOM.zoneName}.Heating.TadoAwayActive`, false);
            log(`✅ TADO back to home mode`);
            addChange("Home");
        }
    }
    
    // Window Timeout Check - CHECK THIS FIRST before sending any notifications!
    const windowOpenTime = global.get(`${ROOM.zoneName}.Heating.WindowOpenTime`);
    let windowTimeoutHandled = global.get(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`);
    const windowClosedTime = global.get(`${ROOM.zoneName}.Heating.WindowClosedTime`);
    // windowClosedDelay already defined at top of function using slot override pattern
    
    if (windowOpen) {
        // Clear any window closed delay if window opens again
        if (windowClosedTime) {
            global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, null);
            log(`ℹ️  Window opened again - cleared settle delay`);
        }
        
        if (!windowOpenTime) {
            global.set(`${ROOM.zoneName}.Heating.WindowOpenTime`, Date.now());
            global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, false);
            const timeoutSource = getSettingSource(slot, 'windowOpenTimeout');
            log(`⏱️  Window opened - starting ${windowOpenTimeout} sec timeout (${timeoutSource})`);
        } else {
            const secondsOpen = (Date.now() - windowOpenTime) / 1000;
            if (secondsOpen >= windowOpenTimeout) {
                log(`⚠️  Window has been open for ${Math.floor(secondsOpen)} sec`);
                
                // Check if we need to turn off heating
                // For TADO: Always ensure it's off when window open (even if not actively heating)
                // For smart plugs: Only turn off if currently on
                const shouldTurnOff = ROOM.heating.type === 'tado_valve' || heatingOn;
                
                if (!windowTimeoutHandled) {
                    if (shouldTurnOff) {
                        // Turn off heating completely (both smart plugs and TADO)
                        await setHeating(false, effectiveTarget);
                        log(`🔥 Heating turned OFF (window open too long)`);
                        addChange(`Window (${Math.floor(secondsOpen)}s)`);
                        addChange(`Heat off`);
                        global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, true);
                        return 'window_timeout_off';
                    }
                    global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, true);
                } else {
                    // Timeout already handled
                    // For TADO: Still call setHeating(false) to ensure onoff is false
                    // (in case we upgraded from temp-based to onoff-based control)
                    if (ROOM.heating.type === 'tado_valve') {
                        await setHeating(false, effectiveTarget);
                        log(`🔥 TADO ensured OFF (window still open)`);
                    }
                }
                
                // Window is open and timeout reached - don't run normal heating logic
                // Don't send confusing notifications about activity/inactivity changes
                return 'window_open_skip';
            } else {
                log(`ℹ️  Window open for ${Math.floor(secondsOpen)} sec (timeout: ${windowOpenTimeout} sec)`);
            }
        }
    } else {
        // Window is closed
        if (windowOpenTime) {
            // Window just closed - check if it was open long enough to affect heating
            const secondsOpen = (Date.now() - windowOpenTime) / 1000;
            
            // Only start settle delay if window was open long enough to trigger timeout
            // If window was only open briefly, no need to wait for air to settle
            if (secondsOpen >= windowOpenTimeout) {
                // Window was open long enough to turn off heating - start settle delay
                global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, Date.now());
                global.set(`${ROOM.zoneName}.Heating.WindowOpenTime`, null);
                global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, false);
                
                const delayMinutes = Math.floor(windowClosedDelay / 60);
                const delaySource = getSettingSource(slot, 'windowClosedDelay');
                addChange("Window closed");
                addChange(`Waiting ${delayMinutes}min`);
                log(`✓ Window closed (was open ${Math.floor(secondsOpen)}s) - waiting ${delayMinutes} min for air to settle (${delaySource})`);
                
                return 'window_closed_waiting';
            } else {
                // Window was only open briefly - no settle delay needed
                global.set(`${ROOM.zoneName}.Heating.WindowOpenTime`, null);
                global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, false);
                log(`✓ Window closed (was only open ${Math.floor(secondsOpen)}s) - no settle delay needed`);
                
                // Continue with normal heating logic (no notification)
            }
        }
        
        // Check if we're in the settle delay period
        if (windowClosedTime) {
            const secondsSinceClosed = (Date.now() - windowClosedTime) / 1000;
            
            if (secondsSinceClosed < windowClosedDelay) {
                // Still waiting for air to settle
                const remainingSeconds = Math.floor(windowClosedDelay - secondsSinceClosed);
                const remainingMinutes = Math.floor(remainingSeconds / 60);
                const remainingSecs = remainingSeconds % 60;
                log(`⏳ Waiting for air to settle: ${remainingMinutes}m ${remainingSecs}s remaining`);
                return 'window_closed_waiting';
            } else {
                // Delay complete - clear flag and resume normal heating
                global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, null);
                
                // Suppress notifications when in away mode (not relevant when nobody home)
                if (!tadoAway) {
                    addChange("Air settled");
                    addChange("Heat resumed");
                }
                log(`✓ Air settle delay complete - resuming heating${tadoAway ? ' (away mode - notification suppressed)' : ''}`);
                
                // For TADO, turn on and set target - recalculate from scratch
                if (ROOM.heating.type === 'tado_valve') {
                    // Start fresh with base slot target (not the potentially modified effectiveTarget)
                    let resumeTarget = slot.target;
                    
                    // Apply away mode minimum if currently away
                    if (tadoAway && ROOM.settings.tadoAwayMinTemp !== null) {
                        resumeTarget = ROOM.settings.tadoAwayMinTemp;
                        log(`🏠 Away mode: Using minimum ${resumeTarget}°C`);
                    }
                    // Apply inactivity offset if room is inactive and not in away mode
                    else if (!tadoAway && inactivity.inactive && inactivityOffset > 0) {
                        resumeTarget -= inactivityOffset;
                        log(`💤 Inactivity mode active - reducing target by ${inactivityOffset}°C`);
                        log(`→ Effective target: ${resumeTarget}°C (inactivity)`);
                        
                        if (!inactivity.wasInactive) {
                            addChange(`Inactive (${inactivity.minutesSinceMotion}min)`);
                            addChange(`-${inactivityOffset}°C → ${resumeTarget}°C`);
                        }
                    }
                    
                    await setHeating(true, resumeTarget);
                    log(`🔥 TADO resumed - target set to ${resumeTarget}°C`);
                    return 'window_settled_tado';
                }
                // For smart plugs, continue to hysteresis logic below to determine if heating needed
                log(`💡 Smart plugs: Continuing to hysteresis check to determine heating state`);
            }
        }
    }
    
    // Inactivity Mode (only if not in TADO away mode)
    if (!tadoAway && inactivity.inactive && inactivityOffset > 0) {
        effectiveTarget -= inactivityOffset;
        log(`💤 Inactivity mode active - reducing target by ${inactivityOffset}°C`);
        log(`→ Effective target: ${effectiveTarget}°C (inactivity)`);
        
        if (!inactivity.wasInactive) {
            addChange(`Inactive (${inactivity.minutesSinceMotion}min)`);
            addChange(`-${inactivityOffset}°C → ${effectiveTarget}°C`);
        }
    } else if (inactivity.wasInactive && !inactivity.inactive) {
        addChange("Active");
        
        if (inactivityOffset > 0) {
            addChange(`→ ${effectiveTarget}°C`);
        }
    }
    
    // Heating Logic (only if window is closed or timeout not reached)
    if (!windowOpen || (windowOpenTime && (Date.now() - windowOpenTime) / 1000 < windowOpenTimeout)) {
        
        if (ROOM.heating.type === 'smart_plug') {
            // Smart plug: Calculate hysteresis range
            const hysteresis = ROOM.heating.hysteresis || 0.5;
            const targetLow = effectiveTarget - (hysteresis / 2);
            const targetHigh = effectiveTarget + (hysteresis / 2);
            
            log(`Smart plug hysteresis: ${effectiveTarget}°C ±${hysteresis/2}°C = ${targetLow}-${targetHigh}°C`);
            
            if (roomTemp < targetLow) {
                if (!heatingOn) {
                    await setHeating(true, effectiveTarget);
                    log(`🔥 Heating on (${roomTemp}°C < ${targetLow}°C)`);
                    addChange("Heat on");
                    return 'heating_on';
                } else {
                    log(`✓ Heating already on`);
                    return 'no_change';
                }
            } else if (roomTemp > targetHigh) {
                if (heatingOn) {
                    await setHeating(false, effectiveTarget);
                    log(`❄️  Heating off (${roomTemp}°C > ${targetHigh}°C)`);
                    addChange("Heat off");
                    return 'heating_off';
                } else {
                    log(`✓ Heating already off`);
                    return 'no_change';
                }
            } else {
                log(`✓ Temperature OK (${targetLow}-${targetHigh}°C)`);
                return 'no_change';
            }
            
        } else if (ROOM.heating.type === 'tado_valve') {
            // TADO valve: Set target temperature if needed
            // TADO handles heating power automatically
            const result = await setHeating(true, effectiveTarget);
            
            if (result.changed) {
                log(`✓ TADO updated (TADO handles heating power)`);
                return 'tado_target_set';
            } else {
                log(`✓ TADO unchanged - already at correct settings`);
                return 'no_change';
            }
        }
    } else {
        log(`⏸️  Heating control skipped (window open)`);
        return 'window_open_skip';
    }
}

// ============================================================================
// Diagnostics
// ============================================================================

async function logDiagnostics(now, roomTemp, slot, action) {
    try {
        const heatingOn = await getHeatingStatus();
        const windowOpen = await isWindowOpen();
        
        // Calculate effectiveTarget same way as main execution
        let effectiveTarget = slot.target;
        const tadoAway = await isTadoAway();
        const inactivity = await checkInactivity(slot);
        const inactivityOffset = inactivity.inactivityOffset || 0;
        
        if (tadoAway && ROOM.settings.tadoAwayMinTemp) {
            effectiveTarget = ROOM.settings.tadoAwayMinTemp;
        } else if (inactivity.inactive && slot.inactivityOffset > 0) {
            effectiveTarget = slot.target - slot.inactivityOffset;
        }
        
        const lastLogTime = global.get(`${ROOM.zoneName}.Heating.LastLogTime`) || 0;
        const minutesSinceLastLog = (Date.now() - lastLogTime) / 1000 / 60;
        const lastAction = global.get(`${ROOM.zoneName}.Heating.LastAction`);
        const lastWindowOpen = global.get(`${ROOM.zoneName}.Heating.LastWindowOpen`);
        const lastEffectiveTarget = global.get(`${ROOM.zoneName}.Heating.LastEffectiveTarget`) || slot.target;
        const lastRoomTemp = global.get(`${ROOM.zoneName}.Heating.CurrentTemp`);
        
        // Determine if we should log this event
        // Actions that should be logged (important events)
        const importantActions = ['heating_on', 'heating_off', 'tado_away_off', 'window_closed_waiting'];
        const isImportantAction = importantActions.includes(action);
        
        // Window-related actions should only log when window status changes
        const isWindowAction = action === 'window_timeout_off' || action === 'window_open_skip';
        const windowStatusChanged = windowOpen !== lastWindowOpen;
        const shouldLogWindowAction = isWindowAction && windowStatusChanged;
        
        // ALWAYS log when window status changes, even if action is "no_change"
        const shouldLogWindowStatusChange = windowStatusChanged;
        
        // Other conditions for logging
        // Use effectiveTarget (with inactivity offset) not slot.target
        const targetChanged = effectiveTarget !== lastEffectiveTarget;
        const tempChangedSignificantly = Math.abs(roomTemp - (lastRoomTemp || roomTemp)) >= 0.5;
        const timeForPeriodicLog = minutesSinceLastLog >= 15;
        
        const shouldLog = isImportantAction || shouldLogWindowAction || shouldLogWindowStatusChange || targetChanged || tempChangedSignificantly || timeForPeriodicLog;
        
        if (!shouldLog) {
            // Update current state even if not logging
            global.set(`${ROOM.zoneName}.Heating.CurrentTemp`, roomTemp);
            global.set(`${ROOM.zoneName}.Heating.LastAction`, action);
            global.set(`${ROOM.zoneName}.Heating.LastEffectiveTarget`, effectiveTarget);
            global.set(`${ROOM.zoneName}.Heating.LastWindowOpen`, windowOpen);
            return;
        }
        
        const logText = global.get(`${ROOM.zoneName}.Heating.DiagnostikLog`) || '';
        
        // Format: DateTime|RoomTemp|Target|HeatingStatus|WindowStatus|Action
        // Use effectiveTarget (actual target after inactivity offset) not slot.target
        const heatingStatus = ROOM.heating.type === 'tado_valve' 
            ? (heatingOn ? 'HEATING' : 'IDLE')
            : (heatingOn ? 'ON' : 'OFF');
        
        const newEntry = `${formatDateTime(now)}|${roomTemp}|${effectiveTarget}|${heatingStatus}|${windowOpen?'OPEN':'CLOSED'}|${action}\n`;
        
        const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
        const trimmedLog = lines.slice(-5000).join('\n') + '\n';
        
        global.set(`${ROOM.zoneName}.Heating.DiagnostikLog`, trimmedLog);
        global.set(`${ROOM.zoneName}.Heating.LastLogTime`, Date.now());
        global.set(`${ROOM.zoneName}.Heating.LastWindowOpen`, windowOpen);
        global.set(`${ROOM.zoneName}.Heating.LastUpdate`, formatDateTime(now));
        global.set(`${ROOM.zoneName}.Heating.CurrentTemp`, roomTemp);
        global.set(`${ROOM.zoneName}.Heating.LastAction`, action);
        global.set(`${ROOM.zoneName}.Heating.LastEffectiveTarget`, effectiveTarget);
        
    } catch (error) {
        log(`Warning: Diagnostics error: ${error.message}`);
    }
}

// ============================================================================
// Main Execution
// ============================================================================

// Check if heating is globally enabled (from Homey Logic variable)
try {
    const variables = await Homey.logic.getVariables();
    let heatingEnabledVar = null;
    
    for (const [id, variable] of Object.entries(variables)) {
        if (variable.name === 'HeatingEnabled') {
            heatingEnabledVar = variable;
            break;
        }
    }
    
    if (heatingEnabledVar && heatingEnabledVar.value === false) {
        log(`\n⏸️  ${ROOM.zoneName} - Heating is globally DISABLED`);
        log(`   Skipping heating control - radiators/TADO already turned off by flow`);
        return;
    }
} catch (error) {
    // Logic variable not found or error - continue with heating (fail-safe)
    log(`ℹ️  HeatingEnabled check: ${error.message} - continuing with heating`);
}

// ============================================================================
// Away Mode Transition Check (BEFORE Manual Intervention Detection)
// ============================================================================

// Check if we're returning from away mode and reset grace period BEFORE detecting manual intervention
// This prevents false positive detection during TADO's automatic away→home temperature adjustment
const currentTadoAway = await isTadoAway();
const wasInTadoAway = global.get(`${ROOM.zoneName}.Heating.TadoAwayActive`);

if (wasInTadoAway && !currentTadoAway) {
    // Returning from away mode - reset grace period NOW (before manual intervention check)
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    log(`\n✅ TADO returning from away mode - grace period reset to prevent false positive manual detection`);
}

// ============================================================================
// Manual Intervention Detection (Highest Priority)
// ============================================================================

// Check for manual interventions BEFORE boost/pause (unless explicitly canceling)
if (!requestCancel && !requestBoost && !requestPause) {
    const manualOverrideActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    if (!manualOverrideActive) {
        const intervention = await detectManualIntervention();
        if (intervention.detected) {
            activateManualOverrideMode(
                intervention.type,
                intervention.originalValue,
                intervention.currentValue
            );
            
            // Manual override has highest priority - cancel any active boost/pause
            const boostWasActive = global.get(`${ROOM.zoneName}.Heating.BoostMode`);
            const pauseWasActive = global.get(`${ROOM.zoneName}.Heating.PauseMode`);
            
            if (boostWasActive) {
                log(`\n🔄 Cancelling active boost due to manual intervention...`);
                cancelBoostMode();
            }
            if (pauseWasActive) {
                log(`\n🔄 Cancelling active pause due to manual intervention...`);
                cancelPauseMode();
            }
        }
    }
}

// ============================================================================
// Override Mode Check (Boost & Pause)
// ============================================================================

// Handle cancel request first - cancels boost, pause, AND manual override
if (requestCancel) {
    const wasCancelled = cancelAllOverrideModes();
    
    if (wasCancelled) {
        // Override was active and cancelled - continue with normal schedule
        log(`Continuing to run normal schedule after cancellation...`);
    } else {
        // No active overrides - just run normally
        log(`No active overrides - running normal schedule`);
    }
}

// Activate pause if requested (latest call wins - cancel any active boost/manual override)
if (requestPause) {
    const boostWasActive = global.get(`${ROOM.zoneName}.Heating.BoostMode`);
    const manualWasActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    if (boostWasActive) {
        log(`\n🔄 Cancelling active boost to activate pause...`);
        cancelBoostMode();
    }
    if (manualWasActive) {
        log(`\n🔄 Cancelling active manual override to activate pause...`);
        cancelManualOverrideMode();
    }
    activatePauseMode();
}

// Activate boost if requested (latest call wins - cancel any active pause/manual override)
if (requestBoost) {
    const pauseWasActive = global.get(`${ROOM.zoneName}.Heating.PauseMode`);
    const manualWasActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    if (pauseWasActive) {
        log(`\n🔄 Cancelling active pause to activate boost...`);
        cancelPauseMode();
    }
    if (manualWasActive) {
        log(`\n🔄 Cancelling active manual override to activate boost...`);
        cancelManualOverrideMode();
    }
    activateBoostMode();
}

// Check if pause mode is active (pause takes precedence in checking order)
const pauseStatus = checkPauseMode();

if (pauseStatus.active) {
    log(`\n⏸️ PAUSE MODE ACTIVE`);
    log(`Remaining: ${pauseStatus.remainingMinutes} minutes`);
    
    // Read room temperature for status
    const roomTemp = await getRoomTemperature();
    if (roomTemp === null) {
        log('❌ Could not read room temperature!');
        return;
    }
    
    // Run pause heating control (turns off all heating)
    const action = await controlHeatingPause();
    
    // Log diagnostics with pause action
    const now = getDanishLocalTime();
    const dummySlot = { target: 0 }; // Target is effectively 0 during pause
    await logDiagnostics(now, roomTemp, dummySlot, action);
    
    // Send notification - don't show condition icons during pause (use 'CLOSED' and 'NO' so icons don't appear)
    await sendUnifiedNotification({
        room: roomTemp,
        target: 'OFF',
        window: 'CLOSED',  // Don't show window icon during pause override
        windowSettle: false,
        inactivity: 'NO',  // Don't show inactivity icon during pause override
        heating: 'OFF',
        tado: 'HOME',  // Don't show away icon during pause override
        nextChange: `Pause ends in ${pauseStatus.remainingMinutes} min`
    });
    
    log(`\n=== PAUSE MODE - COMPLETED ===`);
    return;
}

// If pause just expired, continue with normal schedule
if (pauseStatus.expired) {
    log(`\n⏱️ Pause mode expired - resuming normal schedule`);
}

// Check if boost mode is active
const boostStatus = checkBoostMode();

if (boostStatus.active) {
    log(`\n🚀 BOOST MODE ACTIVE`);
    log(`Remaining: ${boostStatus.remainingMinutes} minutes`);
    
    // Read room temperature for status
    const roomTemp = await getRoomTemperature();
    if (roomTemp === null) {
        log('❌ Could not read room temperature!');
        return;
    }
    
    // Run boost heating control (ignores all schedules, windows, etc.)
    const action = await controlHeatingBoost();
    
    // Log diagnostics with boost action
    const now = getDanishLocalTime();
    const dummySlot = { target: ROOM.heating.type === 'tado_valve' ? BOOST_TEMPERATURE_TADO : 25 };
    await logDiagnostics(now, roomTemp, dummySlot, action);
    
    // Send notification - don't show condition icons during boost (use 'CLOSED' and 'NO' so icons don't appear)
    const heatingOn = await getHeatingStatus();
    const boostTarget = ROOM.heating.type === 'tado_valve' ? BOOST_TEMPERATURE_TADO : 'MAX';
    
    await sendUnifiedNotification({
        room: roomTemp,
        target: `${boostTarget}`,
        window: 'CLOSED',  // Don't show window icon during boost override
        windowSettle: false,
        inactivity: 'NO',  // Don't show inactivity icon during boost override
        heating: heatingOn ? 'ON' : 'OFF',
        tado: 'HOME',  // Don't show away icon during boost override
        nextChange: `Boost ends in ${boostStatus.remainingMinutes} min`
    });
    
    log(`\n=== BOOST MODE - COMPLETED ===`);
    return;
}

// If boost just expired, continue with normal schedule
if (boostStatus.expired) {
    log(`\n⏱️ Boost mode expired - resuming normal schedule`);
}

// ============================================================================
// Manual Override Mode Check (After Boost/Pause)
// ============================================================================

// Check if manual override mode is active (pause takes precedence over normal, manual over all)
const manualOverrideStatus = checkManualOverrideMode();

if (manualOverrideStatus.active) {
    log(`\n🤚 MANUAL OVERRIDE MODE ACTIVE`);
    log(`Remaining: ${manualOverrideStatus.remainingMinutes} minutes`);
    
    // Read room temperature for status
    const roomTemp = await getRoomTemperature();
    if (roomTemp === null) {
        log('❌ Could not read room temperature!');
        return;
    }
    
    // Handle manual override (read state but don't change anything)
    const action = await handleManualOverride();
    
    // Log diagnostics with manual override action
    const now = getDanishLocalTime();
    
    // Get actual current target for diagnostics
    let actualTarget = 0;
    if (ROOM.heating.type === 'tado_valve') {
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            actualTarget = device.capabilitiesObj.target_temperature.value;
        } catch (error) {
            // Use 0 if can't read
        }
    }
    
    const currentSlot = { target: actualTarget, inactivityOffset: 0 }; // Target is whatever user set manually
    await logDiagnostics(now, roomTemp, currentSlot, action);
    
    // Send notification - show current state but indicate manual override
    const heatingOn = await getHeatingStatus();
    let currentTarget = 'MANUAL';
    
    if (ROOM.heating.type === 'tado_valve') {
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            currentTarget = device.capabilitiesObj.target_temperature.value;
        } catch (error) {
            // Ignore error
        }
    }
    
    await sendUnifiedNotification({
        room: roomTemp,
        target: currentTarget,
        window: 'CLOSED',  // Don't show window icon during manual override
        windowSettle: false,
        inactivity: 'NO',  // Don't show inactivity icon during manual override
        heating: heatingOn ? (ROOM.heating.type === 'tado_valve' ? 'HEATING' : 'ON') : 'OFF',
        tado: 'HOME',  // Don't show away icon during manual override
        nextChange: `Override ends in ${manualOverrideStatus.remainingMinutes} min`
    });
    
    log(`\n=== MANUAL OVERRIDE MODE - COMPLETED ===`);
    return;
}

// If manual override just expired, continue with normal schedule
if (manualOverrideStatus.expired) {
    log(`\n⏱️ Manual override expired - resuming normal schedule`);
}

// ============================================================================
// Normal Schedule Operation
// ============================================================================

const now = getDanishLocalTime();
const weekend = isWeekend(now);
const schoolDay = !weekend ? await isSchoolDay() : false;

// Select schedule from room configuration
let baseSchedule, dayType;
if (weekend) {
    baseSchedule = ROOM.schedules.weekend;
    dayType = 'Weekend';
} else if (schoolDay) {
    baseSchedule = ROOM.schedules.weekday;
    dayType = 'School Day';
} else {
    baseSchedule = ROOM.schedules.holiday;
    dayType = 'Holiday/Vacation';
}

const schedule = await getCompleteSchedule(baseSchedule);

log(`\n=== ${ROOM.zoneName} Heating Control ===`);
log(`Time: ${formatDateTime(now)}`);
log(`Day: ${dayType}`);

// Find current time slot
const currentSlot = getCurrentTimeSlot(schedule, now);
log(`Time period: ${currentSlot.start}-${currentSlot.end}`);
log(`Target: ${currentSlot.target}°C`);

// Store target temperature and effective settings in global variables
const previousTarget = global.get(`${ROOM.zoneName}.Temperature`);

// Get effective settings for storage
const effectiveInactivityOffset = getEffectiveSetting(currentSlot, 'inactivityOffset', ROOM.settings.inactivityOffset || 0);
const effectiveInactivityTimeout = getEffectiveSetting(currentSlot, 'inactivityTimeout', ROOM.settings.inactivityTimeout);
const effectiveWindowOpenTimeout = getEffectiveSetting(currentSlot, 'windowOpenTimeout', ROOM.settings.windowOpenTimeout);
const effectiveWindowClosedDelay = getEffectiveSetting(currentSlot, 'windowClosedDelay', ROOM.settings.windowClosedDelay || 600);

global.set(`${ROOM.zoneName}.Temperature`, currentSlot.target);
global.set(`${ROOM.zoneName}.Heating.InactivityOffset`, effectiveInactivityOffset);
global.set(`${ROOM.zoneName}.Heating.SlotInactivityTimeout`, currentSlot.inactivityTimeout || null);
global.set(`${ROOM.zoneName}.Heating.SlotWindowOpenTimeout`, currentSlot.windowOpenTimeout || null);
global.set(`${ROOM.zoneName}.Heating.SlotWindowClosedDelay`, currentSlot.windowClosedDelay || null);

// For smart plugs, also store calculated low/high for reference
if (ROOM.heating.type === 'smart_plug') {
    const hysteresis = ROOM.heating.hysteresis || 0.5;
    const targetLow = currentSlot.target - (hysteresis / 2);
    const targetHigh = currentSlot.target + (hysteresis / 2);
    global.set(`${ROOM.zoneName}.TemperatureLow`, targetLow);
    global.set(`${ROOM.zoneName}.TemperatureHigh`, targetHigh);
}

// Store schedule info for status script
global.set(`${ROOM.zoneName}.Heating.ScheduleType`, dayType);
global.set(`${ROOM.zoneName}.Heating.CurrentPeriod`, `${currentSlot.start}-${currentSlot.end}`);
global.set(`${ROOM.zoneName}.Heating.PeriodName`, currentSlot.name || 'Unknown');

// Notification if target changes
if (previousTarget !== null && previousTarget !== currentSlot.target) {
    log(`📊 Target temperature changed: ${previousTarget}°C → ${currentSlot.target}°C`);
    addChange(`Schedule ${currentSlot.start}-${currentSlot.end}`);
    addChange(`${previousTarget}→${currentSlot.target}°C`);
}

// Read room temperature
const roomTemp = await getRoomTemperature();
if (roomTemp === null) {
    log('❌ Could not read room temperature!');
    return;
}

// Read window status
const windowOpen = await isWindowOpen();

// Run heating control
const action = await controlHeating(roomTemp, currentSlot, windowOpen);

// Log diagnostics
await logDiagnostics(now, roomTemp, currentSlot, action);

// Send unified notification
const heatingOn = await getHeatingStatus();
const tadoAway = await isTadoAway();

// Use stored inactivity mode (don't check again - zone might have become active!)
const wasInactivityMode = global.get(`${ROOM.zoneName}.Heating.InactivityMode`) || false;

// Calculate effective target for display using stored inactivity state
let displayTarget = currentSlot.target;
if (tadoAway && ROOM.settings.tadoAwayMinTemp) {
    displayTarget = ROOM.settings.tadoAwayMinTemp;
} else if (wasInactivityMode && currentSlot.inactivityOffset > 0) {
    displayTarget = currentSlot.target - currentSlot.inactivityOffset;
}

// Store both base target and effective target
// .Temperature = base schedule target (for schedule change detection)
// .EffectiveTemperature = actual target after inactivity/away adjustments (for status display)
global.set(`${ROOM.zoneName}.EffectiveTemperature`, displayTarget);

const windowTime = windowOpen ? Math.floor((Date.now() - (global.get(`${ROOM.zoneName}.Heating.WindowOpenTime`) || Date.now())) / 1000) : 0;

// Check if we're in window settle delay
const windowClosedTime = global.get(`${ROOM.zoneName}.Heating.WindowClosedTime`);
const inWindowSettleDelay = windowClosedTime !== null;

// Get minutes since activity for display (if room is inactive)
let minutesSinceActivity = 0;
if (wasInactivityMode) {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (zone && !zone.active) {
            const now = getDanishLocalTime();
            const lastActiveTimeUTC = new Date(zone.activeLastUpdated);
            const lastActiveTimeDK = new Date(lastActiveTimeUTC.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
            minutesSinceActivity = Math.floor((now - lastActiveTimeDK) / 60000);
        }
    } catch (error) {
        // Ignore error, just use 0
    }
}

// Determine actual heating status for notification
let heatingStatus;
const windowTimeoutHandled = global.get(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`);
if (windowOpen && windowTimeoutHandled) {
    // Window is open and timeout reached - heating is turned off
    heatingStatus = 'OFF';
} else if (inWindowSettleDelay) {
    // In window settle delay - heating is not yet resumed
    heatingStatus = 'OFF';
} else {
    // Normal status based on heating state
    heatingStatus = heatingOn ? (ROOM.heating.type === 'tado_valve' ? 'HEATING' : 'ON') : 
                                (ROOM.heating.type === 'tado_valve' ? 'IDLE' : 'OFF');
}

// Calculate next schedule change
const nextChange = await getNextScheduleChange(schedule, currentSlot);

await sendUnifiedNotification({
    room: roomTemp,
    target: `${displayTarget}`,
    window: windowOpen ? `OPEN (${windowTime} sec)` : 'CLOSED',
    windowSettle: inWindowSettleDelay,
    inactivity: wasInactivityMode ? `YES (${minutesSinceActivity} min)` : 'NO',
    heating: heatingStatus,
    tado: tadoAway ? 'AWAY' : 'HOME',
    nextChange: nextChange
});

log(`\n=== COMPLETED ===`);