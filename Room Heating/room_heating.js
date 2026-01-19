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
 * - Smart schedule monitoring - auto-exits manual mode when device returns to schedule
 * - Command verification with status polling
 * - Concurrent session coordination via command queues
 *
 * Author: Henrik Skovgaard
 * Version: 10.12.0
 * Created: 2025-12-31
 * Based on: Clara Heating v6.4.6
 *
 * Recent Changes (see CHANGELOG.txt for complete version history):
 * 10.12.0 (2026-01-19) - 🔄 Smart schedule: Exit manual mode when device returns to auto
 * 10.11.0 (2026-01-18) - ✨ Resume: Set and verify temperature when resuming from pause/boost
 * 10.10.2 (2026-01-18) - 🔧 Optimize: Store smart plug baseline once per room, not per device
 * 10.10.1 (2026-01-18) - 🐛 Debug notifications for queue/verification (HeatingDebugMode variable)
 * 10.10.0 (2026-01-18) - 🔧 Verified-baseline detection: Only compare against verified device states
 * 10.9.2  (2026-01-18) - 🔄 Retry: Auto-retry up to 3 times if TADO temperature not verified
 * 10.9.1  (2026-01-18) - 🐛 Fix: False manual override when returning from away mode
 * 10.9.0  (2026-01-18) - ✅ Command verification & queue system + state-based detection
 * 10.8.6  (2026-01-17) - 🐛 Fix: Snowflake icon shown incorrectly during manual override
 * 10.8.5  (2026-01-17) - 🐛 Fix: Grace period blocks manual control detection
 * 10.8.4  (2026-01-17) - 🐛 Fix: Boost/pause cancelled by false manual detection
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
// Session Management - Unique ID for this script execution
// ============================================================================

const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
global.set(`${ROOM.zoneName}.Heating.CurrentSession`, SESSION_ID);
log(`🔑 Session ID: ${SESSION_ID.substr(0, 30)}...`);

// ============================================================================
// Debug Mode - Check if debug notifications are enabled
// ============================================================================

let DEBUG_MODE = false;
try {
    const variables = await Homey.logic.getVariables();
    for (const [id, variable] of Object.entries(variables)) {
        if (variable.name === 'HeatingDebugMode') {
            DEBUG_MODE = variable.value === true;
            if (DEBUG_MODE) {
                log(`🐛 DEBUG MODE ENABLED - Queue and verification events will be sent as notifications`);
            }
            break;
        }
    }
} catch (error) {
    // Debug variable not found - continue without debug
}

async function debugNotify(message) {
    if (DEBUG_MODE) {
        try {
            await Homey.flow.runFlowCardAction({
                uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
                id: "homey:manager:notifications:create_notification",
                args: { text: `🐛 ${roomArg}: ${message}` }
            });
        } catch (error) {
            // Ignore notification errors in debug mode
        }
    }
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
// Device State Management for Command Queue
// ============================================================================

/**
 * Get global variable key for device state
 * @param {string} zoneName - Zone name
 * @param {string} deviceId - Device ID
 * @returns {string} Global variable key
 */
function getDeviceStateKey(zoneName, deviceId) {
    const cleanId = deviceId.replace(/-/g, '_');
    return `${zoneName}.Heating.Device.${cleanId}.State`;
}

/**
 * Initialize or retrieve device state from global variables
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device unique ID
 * @returns {object} Device state object
 */
function initDeviceState(zoneName, deviceId) {
    const stateKey = getDeviceStateKey(zoneName, deviceId);
    const existingState = global.get(stateKey);
    
    if (existingState) {
        try {
            return JSON.parse(existingState);
        } catch (error) {
            log(`⚠️ Failed to parse device state for ${deviceId}, initializing fresh state`);
        }
    }
    
    // Initialize fresh state
    const state = {
        deviceId: deviceId,
        status: 'idle',
        command: null,
        queue: [],
        lastVerified: 0,
        lastError: null
    };
    
    saveDeviceState(zoneName, deviceId, state);
    return state;
}

/**
 * Save device state to global variables
 * @param {string} zoneName - Zone name
 * @param {string} deviceId - Device ID
 * @param {object} state - State object to save
 */
function saveDeviceState(zoneName, deviceId, state) {
    const stateKey = getDeviceStateKey(zoneName, deviceId);
    global.set(stateKey, JSON.stringify(state));
}

/**
 * Clean up stale device states
 * Removes states for devices that timed out or are stuck
 */
async function cleanupStaleDeviceStates() {
    const STALE_TIMEOUT = 300000; // 5 minutes
    const now = Date.now();
    
    for (const deviceId of ROOM.heating.devices) {
        const state = initDeviceState(ROOM.zoneName, deviceId);
        
        // Check if command has been stuck for too long
        if (state.command && (now - state.command.timestamp) > STALE_TIMEOUT) {
            log(`🧹 Cleaning up stale state for device ${deviceId.substr(0, 8)}...`);
            
            state.status = 'idle';
            state.command = null;
            state.lastError = 'Cleaned up stale state';
            saveDeviceState(ROOM.zoneName, deviceId, state);
        }
        
        // Clean up old queue items
        const validQueueItems = state.queue.filter(cmd =>
            (now - cmd.timestamp) < STALE_TIMEOUT
        );
        
        if (validQueueItems.length !== state.queue.length) {
            log(`🧹 Removed ${state.queue.length - validQueueItems.length} stale queue items for device ${deviceId.substr(0, 8)}...`);
            state.queue = validQueueItems;
            saveDeviceState(ROOM.zoneName, deviceId, state);
        }
    }
}

// ============================================================================
// Boost & Pause Heating Functions
// ============================================================================

const BOOST_DURATION_MINUTES = 60;
const BOOST_TEMPERATURE_TADO = 25;
const PAUSE_DURATION_MINUTES = 60;
// Note: Grace period eliminated - using state-based detection instead (checking device status)

function activateBoostMode() {
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, true);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, BOOST_DURATION_MINUTES);
    
    // Baseline will be set by sendCommandWithVerification when boost command is verified
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    
    log(`\n🚀 BOOST MODE ACTIVATED`);
    log(`Duration: ${BOOST_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    
    addChange(`🚀 Boost activated`);
    addChange(`${BOOST_DURATION_MINUTES} min`);
}

async function cancelBoostMode(currentSlot = null) {
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
        
        // Explicitly resume heating with temperature verification
        if (currentSlot) {
            await resumeNormalHeating(currentSlot, false, 'boost');
        }
        
        return true;
    } else {
        log(`\nℹ️ No active boost to cancel`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        return false;
    }
}

async function cancelAllOverrideModes(currentSlot = null) {
    const boostCancelled = await cancelBoostMode(currentSlot);
    const pauseCancelled = await cancelPauseMode(currentSlot);
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
        
        // Reset grace period to prevent false manual detection after boost expires
        global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
        log(`📝 Grace period reset to prevent false manual detection after boost expiration`);
        
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
        
        let anyVerified = false;
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                if (!currentState) {
                    const result = await sendCommandWithVerification(
                        device,
                        'onoff',
                        true,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success && result.verified) {
                        log(`🔌 ${device.name}: ON (verified)`);
                        anyVerified = true;
                    } else if (result.success) {
                        log(`⚠️ ${device.name}: ON (not verified)`);
                    } else {
                        log(`❌ ${device.name}: Failed to turn ON`);
                    }
                } else {
                    log(`✓ ${device.name}: already ON`);
                }
            } catch (error) {
                log(`❌ Error controlling ${deviceId}: ${error.message}`);
            }
        }
        
        // Only reset grace period if commands were verified
        if (anyVerified) {
            global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
            log(`📝 Grace period reset (boost commands verified)`);
        }
        
        return 'boost_heating';
        
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Setting to ${BOOST_TEMPERATURE_TADO}°C boost temperature`);
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            
            let verified = false;
            
            if (currentOnOff !== true) {
                const result = await sendCommandWithVerification(
                    device,
                    'onoff',
                    true,
                    ROOM.zoneName,
                    SESSION_ID
                );
                
                if (result.success && result.verified) {
                    log(`🔥 TADO turned ON (verified)`);
                    verified = true;
                } else if (result.success) {
                    log(`⚠️ TADO turned ON (not verified)`);
                } else {
                    log(`❌ TADO turn ON failed`);
                }
            }
            
            if (currentTarget !== BOOST_TEMPERATURE_TADO) {
                const result = await sendCommandWithVerification(
                    device,
                    'target_temperature',
                    BOOST_TEMPERATURE_TADO,
                    ROOM.zoneName,
                    SESSION_ID
                );
                
                if (result.success && result.verified) {
                    log(`🎯 TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C (verified)`);
                    verified = true;
                } else if (result.success) {
                    log(`⚠️ TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C (not verified)`);
                } else {
                    log(`❌ TADO temperature change failed`);
                }
            } else {
                log(`✓ TADO already at boost temperature`);
            }
            
            // Update expected target to prevent false manual detection
            global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, BOOST_TEMPERATURE_TADO);
            
            // Only reset grace period if commands were verified
            if (verified) {
                global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
                log(`📝 Expected target updated to ${BOOST_TEMPERATURE_TADO}°C and grace period reset (verified)`);
            } else {
                log(`📝 Expected target updated to ${BOOST_TEMPERATURE_TADO}°C (boost mode - prevents false manual detection)`);
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
    
    // Clear baseline when activating pause mode
    if (ROOM.heating.type === 'tado_valve') {
        global.set(`${ROOM.zoneName}.Heating.LastVerifiedTargetTemp`, null);
    }
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    
    log(`\n⏸️ PAUSE MODE ACTIVATED`);
    log(`Duration: ${PAUSE_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    
    addChange(`⏸️ Pause activated`);
    addChange(`${PAUSE_DURATION_MINUTES} min`);
}

async function cancelPauseMode(currentSlot = null) {
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
        
        // Explicitly resume heating with temperature verification
        if (currentSlot) {
            await resumeNormalHeating(currentSlot, false, 'pause');
        }
        
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
        
        // Reset grace period to prevent false manual detection after pause expires
        global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
        log(`📝 Grace period reset to prevent false manual detection after pause expiration`);
        
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
        
        let anyVerified = false;
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                if (currentState) {
                    const result = await sendCommandWithVerification(
                        device,
                        'onoff',
                        false,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success && result.verified) {
                        log(`🔌 ${device.name}: OFF (verified)`);
                        anyVerified = true;
                    } else if (result.success) {
                        log(`⚠️ ${device.name}: OFF (not verified)`);
                    } else {
                        log(`❌ ${device.name}: Failed to turn OFF`);
                    }
                } else {
                    log(`✓ ${device.name}: already OFF`);
                }
            } catch (error) {
                log(`❌ Error controlling ${deviceId}: ${error.message}`);
            }
        }
        
        // Only reset grace period if commands were verified
        if (anyVerified) {
            global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
            log(`📝 Grace period reset (pause commands verified)`);
        }
        
        return 'pause_heating';
        
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Turning OFF completely`);
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            
            let verified = false;
            
            if (currentOnOff !== false) {
                const result = await sendCommandWithVerification(
                    device,
                    'onoff',
                    false,
                    ROOM.zoneName,
                    SESSION_ID
                );
                
                if (result.success && result.verified) {
                    log(`🔥 TADO turned OFF (verified)`);
                    verified = true;
                } else if (result.success) {
                    log(`⚠️ TADO turned OFF (not verified)`);
                } else {
                    log(`❌ TADO turn OFF failed`);
                }
            } else {
                log(`✓ TADO already OFF`);
            }
            
            // Clear expected target to prevent false manual detection during pause
            global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, null);
            
            // Only reset grace period if command was verified
            if (verified) {
                global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
                log(`📝 Expected target cleared and grace period reset (verified)`);
            } else {
                log(`📝 Expected target cleared (pause mode - prevents false manual detection)`);
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
// Resume Normal Heating (After Override Mode Exit)
// ============================================================================

/**
 * Resume normal heating after override mode cancellation/expiry
 * Explicitly sets both onoff and target temperature with verification
 * @param {Object} slot - Current time slot with target temperature
 * @param {boolean} fromExpiry - True if auto-expired, false if manually cancelled
 * @param {string} modeType - 'pause', 'boost', or 'manual' for logging
 * @returns {Promise<boolean>} True if resumed successfully
 */
async function resumeNormalHeating(slot, fromExpiry, modeType) {
    log(`\n--- RESUMING NORMAL HEATING (${modeType} ${fromExpiry ? 'expired' : 'cancelled'}) ---`);
    
    // Calculate correct target temperature for current schedule
    const tadoAway = await isTadoAway();
    const inactivity = await checkInactivity(slot);
    const inactivityOffset = inactivity.inactivityOffset || 0;
    
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
        log(`→ Resume target: ${resumeTarget}°C (with inactivity offset)`);
    } else {
        log(`→ Resume target: ${resumeTarget}°C (scheduled target)`);
    }
    
    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Resuming to scheduled state`);
        
        // For smart plugs, use hysteresis to determine if heating should be on/off
        const roomTemp = await getRoomTemperature();
        if (roomTemp === null) {
            log(`❌ Cannot read room temperature - skipping resume`);
            return false;
        }
        
        const hysteresis = ROOM.heating.hysteresis || 0.5;
        const targetLow = resumeTarget - (hysteresis / 2);
        const targetHigh = resumeTarget + (hysteresis / 2);
        const shouldTurnOn = roomTemp < targetLow;
        
        log(`Room: ${roomTemp}°C, Target range: ${targetLow}-${targetHigh}°C`);
        log(`Resume state: ${shouldTurnOn ? 'ON' : 'OFF'}`);
        
        let anyVerified = false;
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const result = await sendCommandWithVerification(
                    device,
                    'onoff',
                    shouldTurnOn,
                    ROOM.zoneName,
                    SESSION_ID
                );
                
                if (result.success && result.verified) {
                    log(`🔌 ${device.name}: ${shouldTurnOn ? 'ON' : 'OFF'} (verified)`);
                    anyVerified = true;
                } else if (result.success) {
                    log(`⚠️ ${device.name}: ${shouldTurnOn ? 'ON' : 'OFF'} (not verified)`);
                } else {
                    log(`❌ ${device.name}: Failed to set state`);
                }
            } catch (error) {
                log(`❌ Error resuming ${deviceId}: ${error.message}`);
            }
        }
        
        if (anyVerified) {
            global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
            log(`📝 Grace period reset (resume verified)`);
        }
        
        return anyVerified;
        
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Resuming with target ${resumeTarget}°C`);
        
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            let verified = false;
            
            // ALWAYS set onoff to ensure it's on
            const onoffResult = await sendCommandWithVerification(
                device,
                'onoff',
                true,
                ROOM.zoneName,
                SESSION_ID
            );
            
            if (onoffResult.success && onoffResult.verified) {
                log(`🔥 TADO turned ON (verified)`);
                verified = true;
            } else if (onoffResult.success) {
                log(`⚠️ TADO turned ON (not verified)`);
            } else {
                log(`❌ TADO turn ON failed`);
            }
            
            // ALWAYS set temperature even if already correct (for explicit verification)
            // This ensures user sees temperature verification when resuming
            const tempResult = await sendCommandWithVerification(
                device,
                'target_temperature',
                resumeTarget,
                ROOM.zoneName,
                SESSION_ID
            );
            
            if (tempResult.success && tempResult.verified) {
                log(`🎯 TADO target set to ${resumeTarget}°C (verified)`);
                verified = true;
            } else if (tempResult.success) {
                log(`⚠️ TADO target set to ${resumeTarget}°C (not verified)`);
            } else {
                log(`❌ TADO temperature change failed`);
            }
            
            // Update expected target to prevent false manual detection
            global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, resumeTarget);
            
            if (verified) {
                global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
                log(`📝 Expected target updated to ${resumeTarget}°C and grace period reset (verified)`);
            } else {
                log(`📝 Expected target updated to ${resumeTarget}°C (resume mode)`);
            }
            
            return verified;
        } catch (error) {
            log(`❌ Error resuming TADO: ${error.message}`);
            return false;
        }
    }
    
    return false;
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

async function cancelManualOverrideMode(currentSlot = null) {
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
        
        // Explicitly resume heating with temperature verification
        if (currentSlot) {
            await resumeNormalHeating(currentSlot, false, 'manual');
        }
        
        return true;
    } else {
        log(`\nℹ️ No active manual override to cancel`);
        log(`Room: ${roomArg} (${ROOM.zoneName})`);
        return false;
    }
}

async function checkManualOverrideMode() {
    const overrideActive = global.get(`${ROOM.zoneName}.Heating.ManualOverrideMode`);
    
    if (!overrideActive) {
        return { active: false, expired: false, remainingMinutes: 0, reason: null };
    }
    
    const overrideStartTime = global.get(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`);
    const overrideDuration = global.get(`${ROOM.zoneName}.Heating.ManualOverrideDuration`) || 90;
    
    if (!overrideStartTime) {
        // Override flag set but no start time - clear it
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
        return { active: false, expired: false, remainingMinutes: 0, reason: null };
    }
    
    const minutesElapsed = (Date.now() - overrideStartTime) / 1000 / 60;
    const remainingMinutes = Math.max(0, overrideDuration - minutesElapsed);
    
    // Check if device has returned to automatic schedule mode (only for TADO)
    // The device's onoff.smart_schedule property becomes true when manual control expires
    // and the device returns to following its automatic schedule
    // NOTE: "onoff.smart_schedule" is a separate capability, not a sub-property of onoff!
    if (ROOM.heating.type === 'tado_valve') {
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            
            // Access onoff.smart_schedule as a separate capability (note the bracket notation due to dot in name)
            const smartScheduleCapability = device.capabilitiesObj['onoff.smart_schedule'];
            
            if (smartScheduleCapability) {
                const smartSchedule = smartScheduleCapability.value;
                log(`🔍 Smart schedule status: ${smartSchedule} (${smartSchedule ? 'AUTO MODE' : 'MANUAL MODE'})`);
                
                if (smartSchedule === true) {
                    // Device has returned to automatic schedule mode
                    // User's manual control on the device has expired (shorter than our 90-min override)
                    log(`\n🔄 MANUAL OVERRIDE AUTO-CANCELLED`);
                    log(`Device returned to automatic schedule (smart_schedule = true)`);
                    log(`Duration: ${Math.floor(minutesElapsed)} minutes elapsed of ${overrideDuration} planned`);
                    log(`User's device manual control was shorter than system override period`);
                    
                    // Clear manual override mode variables
                    global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
                    global.set(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`, null);
                    global.set(`${ROOM.zoneName}.Heating.ManualOverrideDuration`, null);
                    global.set(`${ROOM.zoneName}.Heating.ManualOverrideType`, null);
                    global.set(`${ROOM.zoneName}.Heating.ManualOverrideOriginalValue`, null);
                    
                    addChange(`🔄 Device → auto`);
                    addChange(`Override ended`);
                    
                    return { active: false, expired: true, remainingMinutes: 0, reason: 'smart_schedule' };
                } else {
                    log(`✓ Device still in manual mode (smart_schedule = false)`);
                }
            } else {
                log(`⚠️ onoff.smart_schedule capability not found on device`);
            }
        } catch (error) {
            log(`⚠️ Could not check smart_schedule property: ${error.message}`);
            // Continue with normal expiration check
        }
    }
    
    if (minutesElapsed >= overrideDuration) {
        // Override expired normally (90 minutes elapsed)
        log(`\n⏱️ MANUAL OVERRIDE MODE EXPIRED`);
        log(`Duration: ${overrideDuration} minutes elapsed`);
        
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideMode`, false);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideStartTime`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideDuration`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideType`, null);
        global.set(`${ROOM.zoneName}.Heating.ManualOverrideOriginalValue`, null);
        
        addChange(`⏱️ Override ended`);
        addChange(`Resumed schedule`);
        
        return { active: false, expired: true, remainingMinutes: 0, reason: 'timeout' };
    }
    
    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMinutes), reason: null };
}

async function detectManualIntervention() {
    // CRITICAL: Check if any device is currently being controlled by automation
    // If a device is 'sending' or 'verifying', skip manual detection entirely
    // This eliminates the need for time-based grace periods - we check actual device state
    for (const deviceId of ROOM.heating.devices) {
        const state = initDeviceState(ROOM.zoneName, deviceId);
        
        if (state.status === 'sending' || state.status === 'verifying') {
            log(`⏸️ Skipping manual detection - device ${deviceId.substr(0, 8)}... is ${state.status}`);
            return { detected: false };
        }
    }
    
    // All devices idle - safe to check for manual intervention
    log(`✓ All devices idle - checking for manual intervention`);
    
    if (ROOM.heating.type === 'tado_valve') {
        // TADO: Detect temperature changes by comparing against LAST VERIFIED target
        // Only compare against values we've actually verified on the device
        const lastVerifiedTarget = global.get(`${ROOM.zoneName}.Heating.LastVerifiedTargetTemp`);
        
        if (lastVerifiedTarget === null || lastVerifiedTarget === undefined) {
            // No verified baseline yet - can't detect manual changes
            log(`ℹ️ No verified baseline target yet - skipping manual detection`);
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
            const tempDifference = Math.abs(currentTarget - lastVerifiedTarget);
            
            if (tempDifference > 0.3) {
                log(`\n🤚 MANUAL INTERVENTION DETECTED (TADO)`);
                log(`Last verified: ${lastVerifiedTarget}°C, Current: ${currentTarget}°C`);
                log(`Difference: ${tempDifference.toFixed(1)}°C`);
                
                return {
                    detected: true,
                    type: 'temperature',
                    originalValue: lastVerifiedTarget,
                    currentValue: currentTarget
                };
            }
            
            return { detected: false };
            
        } catch (error) {
            log(`⚠️ Error detecting manual intervention: ${error.message}`);
            return { detected: false };
        }
        
    } else if (ROOM.heating.type === 'smart_plug') {
        // Smart plugs: Detect switch changes by comparing against LAST VERIFIED state
        const lastVerifiedOnOff = global.get(`${ROOM.zoneName}.Heating.LastVerifiedOnOff`);
        
        if (lastVerifiedOnOff === null || lastVerifiedOnOff === undefined) {
            // No verified baseline yet - can't detect manual changes
            log(`ℹ️ No verified baseline state yet - skipping manual detection`);
            return { detected: false };
        }
        
        try {
            const currentStates = [];
            let anyDifferent = false;
            
            for (const deviceId of ROOM.heating.devices) {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                currentStates.push({ id: deviceId, name: device.name, state: currentState });
                
                if (currentState !== lastVerifiedOnOff) {
                    anyDifferent = true;
                    log(`\n🤚 MANUAL INTERVENTION DETECTED (SMART PLUG)`);
                    log(`Device: ${device.name}`);
                    log(`Last verified: ${lastVerifiedOnOff ? 'ON' : 'OFF'}, Current: ${currentState ? 'ON' : 'OFF'}`);
                }
            }
            
            if (anyDifferent) {
                return {
                    detected: true,
                    type: 'switch',
                    originalValue: lastVerifiedOnOff,
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
// Command Queue Management Functions
// ============================================================================

/**
 * Try to acquire lock for sending command
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device ID
 * @param {string} sessionId - Current session ID
 * @returns {boolean} True if lock acquired, false otherwise
 */
function tryAcquireLock(zoneName, deviceId, sessionId) {
    const state = initDeviceState(zoneName, deviceId);
    const now = Date.now();
    const LOCK_TIMEOUT = 30000; // 30 seconds
    
    if (state.status === 'idle') {
        return true;
    }
    
    // Check if previous command has timed out
    if (state.command && (now - state.command.timestamp) > LOCK_TIMEOUT) {
        log(`⏱️ Previous command timed out, acquiring lock for new command`);
        state.status = 'idle';
        state.command = null;
        state.lastError = 'Previous command timed out';
        saveDeviceState(zoneName, deviceId, state);
        return true;
    }
    
    // Check if it's our own session (re-entry)
    if (state.command && state.command.sessionId === sessionId) {
        log(`✓ Lock already held by this session`);
        return true;
    }
    
    return false;
}

/**
 * Add command to device queue
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device ID
 * @param {object} command - Command to queue
 * @param {string} sessionId - Current session ID
 */
function queueCommand(zoneName, deviceId, command, sessionId) {
    const state = initDeviceState(zoneName, deviceId);
    
    // Add to queue if not already present
    const existingIndex = state.queue.findIndex(c => c.sessionId === sessionId);
    
    if (existingIndex === -1) {
        state.queue.push({
            ...command,
            sessionId: sessionId,
            timestamp: Date.now(),
            priority: command.priority || 'normal'
        });
        
        log(`📝 Command queued (position: ${state.queue.length})`);
        debugNotify(`📝 Queued ${command.type}=${command.value} (pos ${state.queue.length})`);
    } else {
        log(`✓ Command already in queue (position: ${existingIndex + 1})`);
    }
    
    saveDeviceState(zoneName, deviceId, state);
}

/**
 * Wait for command to reach front of queue
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device ID
 * @param {string} sessionId - Current session ID
 * @param {number} timeout - Total timeout in milliseconds
 * @returns {Promise<object>} Result object with success status
 */
async function waitForQueuePosition(zoneName, deviceId, sessionId, timeout) {
    const startTime = Date.now();
    const POLL_INTERVAL = 2000; // Check every 2 seconds
    
    while ((Date.now() - startTime) < timeout) {
        const state = initDeviceState(zoneName, deviceId);
        
        // Check if we're at front of queue and device is idle
        if (state.status === 'idle' && state.queue.length > 0) {
            const nextCommand = state.queue[0];
            
            if (nextCommand.sessionId === sessionId) {
                log(`✅ Reached front of queue`);
                debugNotify(`✅ Reached queue front`);
                
                // Remove from queue
                state.queue.shift();
                saveDeviceState(zoneName, deviceId, state);
                
                return { success: true };
            }
        }
        
        // Log position in queue
        const position = state.queue.findIndex(c => c.sessionId === sessionId);
        if (position >= 0) {
            const remaining = Math.floor((timeout - (Date.now() - startTime)) / 1000);
            log(`⏳ Queue position: ${position + 1}/${state.queue.length} (${remaining}s remaining)`);
        } else {
            log(`⚠️ Command no longer in queue`);
            return { success: false, reason: 'removed_from_queue' };
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    
    log(`⏱️ Queue wait timeout`);
    
    // Remove from queue on timeout
    const state = initDeviceState(zoneName, deviceId);
    state.queue = state.queue.filter(c => c.sessionId !== sessionId);
    saveDeviceState(zoneName, deviceId, state);
    
    return { success: false, reason: 'timeout' };
}

/**
 * Process the next command in queue (if any)
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device ID
 */
async function processNextQueuedCommand(zoneName, deviceId) {
    const state = initDeviceState(zoneName, deviceId);
    
    if (state.queue.length > 0) {
        log(`📋 Queue has ${state.queue.length} pending command(s)`);
        
        // Sort queue by priority and timestamp
        state.queue.sort((a, b) => {
            if (a.priority === 'high' && b.priority !== 'high') return -1;
            if (a.priority !== 'high' && b.priority === 'high') return 1;
            return a.timestamp - b.timestamp;
        });
        
        saveDeviceState(zoneName, deviceId, state);
        
        log(`👉 Next session can now acquire lock: ${state.queue[0].sessionId.substr(0, 20)}...`);
    } else {
        log(`✓ Queue is empty`);
    }
}

/**
 * Verify device status after command
 * @param {object} device - Homey device object
 * @param {string} capability - Capability to check
 * @param {any} expectedValue - Expected value after command
 * @param {string} zoneName - Room zone name
 * @param {string} deviceId - Device ID
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} True if verified, false if timeout
 */
async function verifyDeviceStatus(device, capability, expectedValue, zoneName, deviceId, timeout) {
    const startTime = Date.now();
    const POLL_INTERVAL = 1000; // Check every 1 second
    const TOLERANCE = 0.3; // For temperature comparisons
    
    while ((Date.now() - startTime) < timeout) {
        try {
            // Refresh device state
            const currentDevice = await Homey.devices.getDevice({ id: deviceId });
            const currentValue = currentDevice.capabilitiesObj[capability]?.value;
            
            if (currentValue === undefined) {
                log(`⚠️ Capability ${capability} not found on device`);
                return false;
            }
            
            // Compare values (with tolerance for temperatures)
            let matches = false;
            if (capability === 'target_temperature') {
                matches = Math.abs(currentValue - expectedValue) <= TOLERANCE;
            } else {
                matches = currentValue === expectedValue;
            }
            
            if (matches) {
                const elapsed = Date.now() - startTime;
                log(`✅ Status verified in ${elapsed}ms: ${capability} = ${currentValue}`);
                debugNotify(`✅ Verified in ${elapsed}ms: ${capability}=${currentValue}`);
                return true;
            }
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            
        } catch (error) {
            log(`⚠️ Error during verification: ${error.message}`);
        }
    }
    
    log(`⏱️ Verification timeout after ${timeout}ms`);
    return false;
}

/**
 * Send command to device and verify status update with retry logic
 * @param {object} device - Homey device object
 * @param {string} capability - Capability name (onoff, target_temperature)
 * @param {any} value - Value to set
 * @param {string} zoneName - Room zone name
 * @param {string} sessionId - Current session ID
 * @param {number} timeout - Verification timeout in milliseconds
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<object>} Result object with success status
 */
async function sendCommandWithVerification(device, capability, value, zoneName, sessionId, timeout = 30000, maxRetries = 3) {
    const deviceId = device.id;
    const state = initDeviceState(zoneName, deviceId);
    
    // Try to acquire lock
    if (!tryAcquireLock(zoneName, deviceId, sessionId)) {
        log(`⏸️ Device busy, queuing command...`);
        queueCommand(zoneName, deviceId, { type: capability, value: value }, sessionId);
        
        // Wait for our turn in queue (60 seconds total)
        const result = await waitForQueuePosition(zoneName, deviceId, sessionId, 60000);
        if (!result.success) {
            return { success: false, reason: 'queue_timeout', skipped: true };
        }
        
        // Retry acquiring lock after queue wait
        if (!tryAcquireLock(zoneName, deviceId, sessionId)) {
            return { success: false, reason: 'lock_failed', skipped: true };
        }
    }
    
    // We have the lock - send command with retry logic
    let attemptNumber = 0;
    let lastError = null;
    
    while (attemptNumber < maxRetries) {
        attemptNumber++;
        
        try {
            // Set status to sending
            state.status = 'sending';
            state.command = {
                type: capability,
                value: value,
                expectedValue: value,
                timestamp: Date.now(),
                sessionId: sessionId,
                retryCount: attemptNumber - 1
            };
            saveDeviceState(zoneName, deviceId, state);
            
            if (attemptNumber === 1) {
                log(`📤 Sending command: ${capability} = ${value}`);
                debugNotify(`📤 Sending ${capability}=${value}`);
            } else {
                log(`🔄 Retry attempt ${attemptNumber}/${maxRetries}: ${capability} = ${value}`);
                debugNotify(`🔄 Retry ${attemptNumber}/${maxRetries}: ${capability}=${value}`);
            }
            
            // Send actual command
            await device.setCapabilityValue(capability, value);
            
            // Set status to verifying
            state.status = 'verifying';
            state.command.timestamp = Date.now(); // Reset timestamp for verification phase
            saveDeviceState(zoneName, deviceId, state);
            
            log(`🔍 Verifying device status update...`);
            
            // Wait for status verification
            const verified = await verifyDeviceStatus(device, capability, value, zoneName, deviceId, timeout);
            
            if (verified) {
                log(`✅ Command verified successfully${attemptNumber > 1 ? ` (after ${attemptNumber} attempts)` : ''}`);
                debugNotify(`✅ Success${attemptNumber > 1 ? ` (${attemptNumber} attempts)` : ''}: ${capability}=${value}`);
                
                // Clear state and process queue
                state.status = 'idle';
                state.command = null;
                state.lastVerified = Date.now();
                state.lastError = null;
                saveDeviceState(zoneName, deviceId, state);
                
                // CRITICAL: Store the verified value as baseline for manual detection
                // Only compare against values we've actually confirmed on the device
                // For TADO (target_temperature), store immediately since only one device
                // For smart plugs (onoff), let setHeating() store after all devices verified
                if (capability === 'target_temperature') {
                    global.set(`${zoneName}.Heating.LastVerifiedTargetTemp`, value);
                    log(`📝 Stored verified target: ${value}°C (baseline for manual detection)`);
                    debugNotify(`📝 Baseline: ${value}°C`);
                }
                // Note: onoff baseline is stored by setHeating() after all devices verified
                
                // Process next queued command
                await processNextQueuedCommand(zoneName, deviceId);
                
                return { success: true, verified: true, attempts: attemptNumber };
            } else {
                lastError = 'Verification timeout';
                log(`⚠️ Command verification failed on attempt ${attemptNumber}/${maxRetries}`);
                debugNotify(`⚠️ Verify failed (attempt ${attemptNumber}/${maxRetries})`);
                
                // If not last attempt, wait a bit before retrying
                if (attemptNumber < maxRetries) {
                    const retryDelay = 2000; // 2 seconds between retries
                    log(`⏳ Waiting ${retryDelay/1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
            
        } catch (error) {
            lastError = error.message;
            log(`❌ Command failed on attempt ${attemptNumber}/${maxRetries}: ${error.message}`);
            
            // If not last attempt, wait a bit before retrying
            if (attemptNumber < maxRetries) {
                const retryDelay = 2000; // 2 seconds between retries
                log(`⏳ Waiting ${retryDelay/1000}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    
    // All retries exhausted
    log(`❌ Command failed after ${maxRetries} attempts - giving up`);
    debugNotify(`❌ FAILED after ${maxRetries} attempts: ${capability}=${value}`);
    
    state.status = 'failed';
    state.lastError = lastError;
    saveDeviceState(zoneName, deviceId, state);
    
    // Process queue even on final failure
    await processNextQueuedCommand(zoneName, deviceId);
    
    return { success: true, verified: false, attempts: maxRetries, error: lastError };
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
        let anyVerified = false;
        
        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                
                // Only set if different to avoid unnecessary commands
                if (currentState !== turnOn) {
                    // Use command verification system
                    const result = await sendCommandWithVerification(
                        device,
                        'onoff',
                        turnOn,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success) {
                        if (result.verified) {
                            log(`🔌 Smart plug ${device.name}: ${turnOn ? 'ON' : 'OFF'} (verified)`);
                            anyChanged = true;
                            anyVerified = true;
                            results.push(true);
                        } else {
                            log(`⚠️ Smart plug ${device.name}: Command sent but not verified`);
                            anyChanged = true;
                            results.push(true);
                        }
                    } else if (result.skipped) {
                        log(`⏭️ Smart plug ${device.name}: Command skipped (${result.reason})`);
                        results.push(false);
                    } else {
                        log(`❌ Smart plug ${device.name}: Command failed - ${result.error}`);
                        results.push(false);
                    }
                } else {
                    log(`✓ Smart plug ${device.name} already ${turnOn ? 'ON' : 'OFF'}`);
                    results.push(true);
                }
            } catch (error) {
                log(`❌ Error controlling radiator ${deviceId}: ${error.message}`);
                results.push(false);
            }
        }
        
        // Store baseline ONCE after all devices processed (not per-device)
        if (anyVerified) {
            // At least one device was verified - store baseline
            global.set(`${ROOM.zoneName}.Heating.LastVerifiedOnOff`, turnOn);
            log(`📝 Stored verified state: ${turnOn ? 'ON' : 'OFF'} (baseline for manual detection)`);
            debugNotify(`📝 Baseline: ${turnOn ? 'ON' : 'OFF'}`);
        } else if (!anyChanged) {
            // No changes were made - verify all devices match expected state
            let allMatch = true;
            for (const deviceId of ROOM.heating.devices) {
                try {
                    const device = await Homey.devices.getDevice({ id: deviceId });
                    const currentState = device.capabilitiesObj.onoff.value;
                    if (currentState !== turnOn) {
                        allMatch = false;
                        log(`⚠️ Device ${device.name} is ${currentState ? 'ON' : 'OFF'} but expected ${turnOn ? 'ON' : 'OFF'}`);
                        break;
                    }
                } catch (error) {
                    allMatch = false;
                    break;
                }
            }
            
            if (allMatch) {
                // All devices match - safe to update baseline
                global.set(`${ROOM.zoneName}.Heating.LastVerifiedOnOff`, turnOn);
                log(`📝 Updated baseline state: ${turnOn ? 'ON' : 'OFF'} (verified current state)`);
            } else {
                // Mismatch detected - don't update baseline, let manual detection handle it
                log(`⚠️ Device states don't match expected - not updating baseline`);
            }
        }
        
        return { success: results.every(r => r), changed: anyChanged };
        
    } else if (ROOM.heating.type === 'tado_valve') {
        // TADO valves: Can be turned on/off, and target temperature can be set
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;
            
            let changed = false;
            let verified = false;
            
            if (turnOn) {
                // Turn on and set target temperature - but only if needed!
                if (currentOnOff !== true) {
                    const result = await sendCommandWithVerification(
                        device,
                        'onoff',
                        true,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success && result.verified) {
                        log(`🔥 TADO turned ON (verified)`);
                        changed = true;
                        verified = true;
                    } else if (result.success) {
                        log(`⚠️ TADO turned ON (not verified)`);
                        changed = true;
                    } else {
                        log(`❌ TADO turn ON failed: ${result.error || result.reason}`);
                    }
                }
                
                if (currentTarget !== effectiveTarget) {
                    const result = await sendCommandWithVerification(
                        device,
                        'target_temperature',
                        effectiveTarget,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success && result.verified) {
                        log(`🎯 TADO target set to ${effectiveTarget}°C (was ${currentTarget}°C) (verified)`);
                        changed = true;
                        verified = true;
                    } else if (result.success) {
                        log(`⚠️ TADO target set to ${effectiveTarget}°C (not verified)`);
                        changed = true;
                    } else {
                        log(`❌ TADO target change failed: ${result.error || result.reason}`);
                    }
                }
                
                if (!changed) {
                    log(`✓ TADO already ON with target ${effectiveTarget}°C - no change needed`);
                }
                
                // Note: LastVerifiedTargetTemp is now stored by sendCommandWithVerification when verified
                // If no changes were made, verify the ACTUAL device state matches what we expect
                if (!verified && !changed) {
                    // Read actual current target from device
                    try {
                        const currentDevice = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
                        const actualTarget = currentDevice.capabilitiesObj.target_temperature.value;
                        
                        // Check if it matches what we expect (0.3°C tolerance)
                        if (Math.abs(actualTarget - effectiveTarget) <= 0.3) {
                            // Device is at expected target - safe to update baseline
                            global.set(`${ROOM.zoneName}.Heating.LastVerifiedTargetTemp`, actualTarget);
                            log(`📝 Updated baseline target: ${actualTarget}°C (verified current state)`);
                        } else {
                            // Device is at different target - don't update baseline
                            log(`⚠️ Device target is ${actualTarget}°C but expected ${effectiveTarget}°C - not updating baseline`);
                        }
                    } catch (error) {
                        log(`⚠️ Could not verify device state - not updating baseline`);
                    }
                }
            } else {
                // Turn off completely - but only if needed!
                if (currentOnOff !== false) {
                    const result = await sendCommandWithVerification(
                        device,
                        'onoff',
                        false,
                        ROOM.zoneName,
                        SESSION_ID
                    );
                    
                    if (result.success && result.verified) {
                        log(`🔥 TADO turned OFF (verified)`);
                        changed = true;
                        verified = true;
                    } else if (result.success) {
                        log(`⚠️ TADO turned OFF (not verified)`);
                        changed = true;
                    } else {
                        log(`❌ TADO turn OFF failed: ${result.error || result.reason}`);
                    }
                }
                
                if (!changed) {
                    log(`✓ TADO already OFF - no change needed`);
                }
                
                // CLEAR baseline when turning off - no target to compare against when off
                global.set(`${ROOM.zoneName}.Heating.LastVerifiedTargetTemp`, null);
                log(`📝 Cleared baseline target (TADO off - no target to compare)`);
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
            log(`✅ TADO back to home mode - resuming normal schedule`);
            addChange("Home");
            
            // Explicitly resume heating with temperature verification when returning home
            await resumeNormalHeating(slot, false, 'away_return');
            
            // Return early to allow resume to complete, normal schedule continues on next run
            return 'tado_home_resume';
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
                // Delay complete - use explicit resume logic with verification
                log(`✓ Air settle delay complete - resuming heating with verification${tadoAway ? ' (away mode)' : ''}`);
                
                // Use resumeNormalHeating for consistent behavior with temperature verification
                const resumed = await resumeNormalHeating(slot, true, 'window_settle');
                
                if (resumed) {
                    // Clear the settle delay flag
                    global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, null);
                    
                    // Suppress notifications when in away mode (not relevant when nobody home)
                    if (!tadoAway) {
                        addChange("Air settled");
                        addChange("Heat resumed");
                    }
                    
                    return 'window_settled';
                } else {
                    // Resume failed or no change - don't clear settle delay yet, will retry
                    log(`⚠️ Resume failed or no change - will retry on next run`);
                    return 'window_settle_retry';
                }
                
                // For smart plugs, clear settle delay and continue to hysteresis logic
                global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, null);
                
                // Suppress notifications when in away mode
                if (!tadoAway) {
                    addChange("Air settled");
                    addChange("Heat resumed");
                }
                
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
// Cleanup Stale Device States
// ============================================================================

// Clean up any stale device states from timed-out or crashed previous executions
await cleanupStaleDeviceStates();

// ============================================================================
// Away Mode Transition Check (BEFORE Manual Intervention Detection)
// ============================================================================

// Check if we're returning from away mode and clear baseline BEFORE detecting manual intervention
// This prevents false positive detection during TADO's automatic away→home temperature adjustment
const currentTadoAway = await isTadoAway();
const wasInTadoAway = global.get(`${ROOM.zoneName}.Heating.TadoAwayActive`);

if (wasInTadoAway && !currentTadoAway) {
    // Returning from away mode - CLEAR baseline to prevent false positive
    // TADO automatically adjusts temperature when returning home, so we can't compare against old away value
    global.set(`${ROOM.zoneName}.Heating.LastVerifiedTargetTemp`, null);
    log(`\n✅ TADO returning from away mode - cleared verified baseline to prevent false positive manual detection`);
    log(`   TADO will automatically restore scheduled temperature, which should not be treated as manual intervention`);
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
    // Get current slot before canceling (needed for resume)
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? await isSchoolDay() : false;
    
    let baseSchedule;
    if (weekend) {
        baseSchedule = ROOM.schedules.weekend;
    } else if (schoolDay) {
        baseSchedule = ROOM.schedules.weekday;
    } else {
        baseSchedule = ROOM.schedules.holiday;
    }
    
    const schedule = await getCompleteSchedule(baseSchedule);
    const currentSlot = getCurrentTimeSlot(schedule, now);
    
    const wasCancelled = await cancelAllOverrideModes(currentSlot);
    
    if (wasCancelled) {
        // Override was active and cancelled - resume logic already called in cancel functions
        log(`Override cancelled and heating resumed - continuing with normal schedule`);
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

// If pause just expired, explicitly resume heating
if (pauseStatus.expired) {
    log(`\n⏱️ Pause mode expired - resuming normal schedule`);
    
    // Get current slot for temperature target
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? await isSchoolDay() : false;
    
    let baseSchedule;
    if (weekend) {
        baseSchedule = ROOM.schedules.weekend;
    } else if (schoolDay) {
        baseSchedule = ROOM.schedules.weekday;
    } else {
        baseSchedule = ROOM.schedules.holiday;
    }
    
    const schedule = await getCompleteSchedule(baseSchedule);
    const currentSlot = getCurrentTimeSlot(schedule, now);
    
    await resumeNormalHeating(currentSlot, true, 'pause');
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

// If boost just expired, explicitly resume heating
if (boostStatus.expired) {
    log(`\n⏱️ Boost mode expired - resuming normal schedule`);
    
    // Get current slot for temperature target
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? await isSchoolDay() : false;
    
    let baseSchedule;
    if (weekend) {
        baseSchedule = ROOM.schedules.weekend;
    } else if (schoolDay) {
        baseSchedule = ROOM.schedules.weekday;
    } else {
        baseSchedule = ROOM.schedules.holiday;
    }
    
    const schedule = await getCompleteSchedule(baseSchedule);
    const currentSlot = getCurrentTimeSlot(schedule, now);
    
    await resumeNormalHeating(currentSlot, true, 'boost');
}

// ============================================================================
// Manual Override Mode Check (After Boost/Pause)
// ============================================================================

// Check if manual override mode is active (pause takes precedence over normal, manual over all)
const manualOverrideStatus = await checkManualOverrideMode();

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
        heating: heatingOn ? (ROOM.heating.type === 'tado_valve' ? 'HEATING' : 'ON') :
                            (ROOM.heating.type === 'tado_valve' ? 'IDLE' : 'OFF'),
        tado: 'HOME',  // Don't show away icon during manual override
        nextChange: `Override ends in ${manualOverrideStatus.remainingMinutes} min`
    });
    
    log(`\n=== MANUAL OVERRIDE MODE - COMPLETED ===`);
    return;
}

// If manual override just expired, explicitly resume heating
if (manualOverrideStatus.expired) {
    // Enhanced logging based on expiration reason
    if (manualOverrideStatus.reason === 'smart_schedule') {
        log(`\n🔄 Manual override cancelled by device - returning to automatic schedule`);
        log(`Device's manual control period expired before system's 90-minute override`);
    } else {
        log(`\n⏱️ Manual override expired - resuming normal schedule`);
    }
    
    // Get current slot for temperature target
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? await isSchoolDay() : false;
    
    let baseSchedule;
    if (weekend) {
        baseSchedule = ROOM.schedules.weekend;
    } else if (schoolDay) {
        baseSchedule = ROOM.schedules.weekday;
    } else {
        baseSchedule = ROOM.schedules.holiday;
    }
    
    const schedule = await getCompleteSchedule(baseSchedule);
    const currentSlot = getCurrentTimeSlot(schedule, now);
    
    await resumeNormalHeating(currentSlot, true, 'manual');
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