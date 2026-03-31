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
 * Version: 10.16.0
 * Created: 2025-12-31
 * Based on: Clara Heating v6.4.6
 *
 * Recent Changes (see CHANGELOG.txt for complete version history):
 * 10.16.0 (2026-03-31) - 🔄 Unified room state object (replaces 20+ scattered global variables)
 * 10.15.2 (2026-03-27) - 🐛 Fix: False manual detection from cross-run race condition (commanded state tracking)
 * 10.15.1 (2026-03-26) - 🐛 Fix: False manual detection when smart plug command sent but not verified
 * 10.15.0 (2026-03-15) - 🔧 Auto-discover heating devices by zone (no more hardcoded device IDs)
 * 10.14.7 (2026-03-15) - 🔕 Suppress duplicate notifications (30 min cooldown for identical changes)
 * 10.14.6 (2026-03-02) - 🐛 Fix: Freeze LastRunTemp during settle delay to prevent false stability
 * 10.14.5 (2026-02-25) - 🐛 Fix: Window settle delay survives sensor flaps (don't clear on brief open)
 * 10.14.4 (2026-02-04) - 🐛 Fix: Robustly handle object-wrapped sensor values in logging and logic
 * 10.14.3 (2026-02-04) - 🐛 Fix: [object Object] in notifications during override modes
 * 10.14.2 (2026-02-03) - ⏳ Increase minimum smart settling time to 10 minutes (was 2 min)
 * 10.14.1 (2026-02-03) - 🐛 Fix: Ensure smart settling logic uses fresh sensor data (check timestamp)
 * 10.14.0 (2026-02-01) - 🌡️ Smart window settling: Resume early if temperature stabilizes (safety max: 30m)
 * 10.13.0 (2026-01-23) - 📚 Direct Skoleintra calendar: cached fetch replaces IcalCalendar/Homey Logic
 * 10.12.3 (2026-01-23) - 🔔 Notify on slot name change even when temperature stays the same
 * 10.12.2 (2026-01-20) - 🐛 Fix: False manual detection during window settle delay
 * 10.12.1 (2026-01-19) - 🐛 Fix: False manual detection for smart plugs (away→home + resume bugs)
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
    roomArgRaw = args?.[0] || 'Clara';
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

// ============================================================================
// Auto-discover heating devices in zone
// ============================================================================

async function discoverHeatingDevices() {
    const zone = await getZoneByName(ROOM.zoneName);
    if (!zone) {
        throw new Error(`❌ Zone "${ROOM.zoneName}" not found - cannot discover heating devices`);
    }

    const allDevices = await Homey.devices.getDevices();
    const zoneDevices = Object.values(allDevices).filter(d => d.zone === zone.id);

    let discovered = [];

    if (ROOM.heating.type === 'smart_plug') {
        // Find smart plugs configured as heaters (Plugged In = Heater → virtualClass = 'heater')
        discovered = zoneDevices
            .filter(d => d.virtualClass === 'heater' || d.class === 'heater')
            .map(d => d.id);
        log(`🔌 Discovered ${discovered.length} heater(s): ${zoneDevices.filter(d => d.virtualClass === 'heater' || d.class === 'heater').map(d => d.name).join(', ')}`);
    } else if (ROOM.heating.type === 'tado_valve') {
        // Find TADO valves (devices with tado_heating_power capability)
        discovered = zoneDevices
            .filter(d => d.capabilitiesObj?.tado_heating_power !== undefined)
            .map(d => d.id);
        log(`🔥 Discovered ${discovered.length} TADO valve(s): ${zoneDevices.filter(d => d.capabilitiesObj?.tado_heating_power !== undefined).map(d => d.name).join(', ')}`);
    }

    if (discovered.length === 0) {
        throw new Error(`❌ No ${ROOM.heating.type} heating devices found in zone "${ROOM.zoneName}"`);
    }

    return discovered;
}

ROOM.heating.devices = await discoverHeatingDevices();

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

// ============================================================================
// Unified Room State Management
// ============================================================================
// All room-level state in a single object. Mode transitions go through
// transitionMode() which ensures baselines are cleared and old modes
// are properly exited — eliminating the class of bugs where individual
// global variables fall out of sync.

const STATE_KEY = `${ROOM.zoneName}.Heating.State`;

const DEFAULT_STATE = {
    mode: 'auto',            // 'auto' | 'manual' | 'boost' | 'pause'
    modeExpires: null,        // timestamp when mode auto-expires
    modeDetails: {},          // mode-specific: { type, originalValue } for manual

    away: false,              // TADO away mode active
    awaySince: null,          // timestamp when away mode started

    baseline: {
        verifiedOnOff: null,      // last verified smart plug state
        verifiedTargetTemp: null, // last verified TADO target
        commandedOnOff: null,     // last automation-commanded smart plug state
        lastChangeTime: null      // timestamp of last automation change
    },

    window: {
        openSince: null,          // timestamp when window opened
        closedSince: null,        // timestamp when window closed (for settle delay)
        timeoutHandled: false     // whether window-open timeout action was taken
    },

    inactive: false,              // room inactivity mode active
    lastRunTemp: null,            // temperature from previous run (for stability check)

    notification: {
        lastKey: null,            // dedup key for last notification
        lastTime: 0               // timestamp of last notification
    }
};

function getRoomState() {
    const raw = global.get(STATE_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            // Merge with defaults to handle fields added in future versions
            return {
                ...DEFAULT_STATE,
                ...parsed,
                baseline: { ...DEFAULT_STATE.baseline, ...(parsed.baseline || {}) },
                window: { ...DEFAULT_STATE.window, ...(parsed.window || {}) },
                notification: { ...DEFAULT_STATE.notification, ...(parsed.notification || {}) }
            };
        } catch (e) {
            log(`⚠️ Failed to parse room state, re-initializing: ${e.message}`);
        }
    }
    return { ...DEFAULT_STATE, baseline: { ...DEFAULT_STATE.baseline }, window: { ...DEFAULT_STATE.window }, notification: { ...DEFAULT_STATE.notification } };
}

function saveRoomState(state) {
    global.set(STATE_KEY, JSON.stringify(state));
}

/**
 * Transition to a new mode. Handles all cleanup from the old mode
 * and initialization of the new mode in one place.
 *
 * @param {object} state - Current room state (mutated in place)
 * @param {string} newMode - 'auto' | 'manual' | 'boost' | 'pause'
 * @param {object} params - Mode-specific params:
 *   boost:  { duration? }
 *   pause:  { duration? }
 *   manual: { duration?, type, originalValue }
 * @returns {object} The mutated state
 */
function transitionMode(state, newMode, params = {}) {
    const oldMode = state.mode;

    if (oldMode !== newMode) {
        log(`🔄 MODE: ${oldMode} → ${newMode}`);
        debugNotify(`🔄 ${oldMode} → ${newMode}`);
    }

    // Clear baselines on ANY mode transition to prevent false manual detection.
    // The new mode's control function will establish fresh baselines.
    if (oldMode !== newMode) {
        state.baseline.verifiedOnOff = null;
        state.baseline.verifiedTargetTemp = null;
        state.baseline.lastChangeTime = Date.now();
        // commandedOnOff intentionally kept — tracks what was last sent
    }

    // Enter new mode
    state.mode = newMode;

    if (newMode === 'auto') {
        state.modeExpires = null;
        state.modeDetails = {};
    } else if (newMode === 'boost') {
        const duration = params.duration || BOOST_DURATION_MINUTES;
        state.modeExpires = Date.now() + duration * 60000;
        state.modeDetails = {};
    } else if (newMode === 'pause') {
        const duration = params.duration || PAUSE_DURATION_MINUTES;
        state.modeExpires = Date.now() + duration * 60000;
        state.modeDetails = {};
    } else if (newMode === 'manual') {
        const duration = params.duration || (ROOM.settings.manualOverrideDuration || 90);
        state.modeExpires = Date.now() + duration * 60000;
        state.modeDetails = {
            type: params.type,
            originalValue: params.originalValue
        };
    }

    return state;
}

/**
 * Migrate from legacy individual global variables to unified state object.
 * Only runs once — when STATE_KEY doesn't exist yet.
 * @returns {object|null} Migrated state, or null if already migrated
 */
function migrateFromLegacyState() {
    if (global.get(STATE_KEY)) return null;

    const z = ROOM.zoneName;
    const state = getRoomState(); // starts from DEFAULT_STATE

    // Determine current mode from legacy flags
    if (global.get(`${z}.Heating.ManualOverrideMode`)) {
        state.mode = 'manual';
        const startTime = global.get(`${z}.Heating.ManualOverrideStartTime`);
        const duration = global.get(`${z}.Heating.ManualOverrideDuration`) || 90;
        state.modeExpires = startTime ? startTime + duration * 60000 : null;
        state.modeDetails = {
            type: global.get(`${z}.Heating.ManualOverrideType`),
            originalValue: global.get(`${z}.Heating.ManualOverrideOriginalValue`)
        };
    } else if (global.get(`${z}.Heating.BoostMode`)) {
        state.mode = 'boost';
        const startTime = global.get(`${z}.Heating.BoostStartTime`);
        const duration = global.get(`${z}.Heating.BoostDuration`) || 60;
        state.modeExpires = startTime ? startTime + duration * 60000 : null;
    } else if (global.get(`${z}.Heating.PauseMode`)) {
        state.mode = 'pause';
        const startTime = global.get(`${z}.Heating.PauseStartTime`);
        const duration = global.get(`${z}.Heating.PauseDuration`) || 60;
        state.modeExpires = startTime ? startTime + duration * 60000 : null;
    }

    state.away = !!global.get(`${z}.Heating.TadoAwayActive`);

    state.baseline = {
        verifiedOnOff: global.get(`${z}.Heating.LastVerifiedOnOff`) ?? null,
        verifiedTargetTemp: global.get(`${z}.Heating.LastVerifiedTargetTemp`) ?? null,
        commandedOnOff: global.get(`${z}.Heating.LastCommandedOnOff`) ?? null,
        lastChangeTime: global.get(`${z}.Heating.LastAutomationChangeTime`) ?? null
    };

    state.window = {
        openSince: global.get(`${z}.Heating.WindowOpenTime`) ?? null,
        closedSince: global.get(`${z}.Heating.WindowClosedTime`) ?? null,
        timeoutHandled: !!global.get(`${z}.Heating.WindowTimeoutHandled`)
    };

    state.inactive = !!global.get(`${z}.Heating.InactivityMode`);
    state.lastRunTemp = global.get(`${z}.Heating.LastRunTemp`) ?? null;

    state.notification = {
        lastKey: global.get(`${z}.Heating.LastNotificationKey`) ?? null,
        lastTime: global.get(`${z}.Heating.LastNotificationTime`) || 0
    };

    log(`📦 Migrated from legacy state variables to unified state object`);
    return state;
}

/**
 * Format room state as a compact readable string for debug notifications.
 */
function formatStateForDebug(state) {
    const mode = state.mode === 'auto' ? 'auto' : `${state.mode} (${state.modeExpires ? Math.ceil((state.modeExpires - Date.now()) / 60000) + 'min' : '?'})`;
    const away = state.away ? `away ${state.awaySince ? Math.floor((Date.now() - state.awaySince) / 60000) + 'min' : ''}` : 'home';
    const bl = [];
    if (state.baseline.verifiedOnOff !== null) bl.push(`onoff=${state.baseline.verifiedOnOff ? 'ON' : 'OFF'}`);
    if (state.baseline.verifiedTargetTemp !== null) bl.push(`temp=${state.baseline.verifiedTargetTemp}°C`);
    if (state.baseline.commandedOnOff !== null) bl.push(`cmd=${state.baseline.commandedOnOff ? 'ON' : 'OFF'}`);
    const baseline = bl.length ? bl.join(' ') : 'none';
    const win = state.window.closedSince ? 'settling' : state.window.openSince ? 'open' : 'closed';
    const inactive = state.inactive ? 'yes' : 'no';
    return `mode=${mode} | ${away} | inactive=${inactive} | win=${win} | baseline: ${baseline}`;
}

// Initialize room state (migrate from legacy if needed)
let roomState = migrateFromLegacyState() || getRoomState();
saveRoomState(roomState);

// ============================================================================
// Global Configuration (Shared) - from config script
// ============================================================================

const TADO_HOME_ID = GLOBAL_CONFIG?.tadoHomeId || 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c';
const ICALCALENDAR_DEVICE_ID = GLOBAL_CONFIG?.icalCalendarId || '2ba196bb-b710-4b99-8bb2-72da3987d38c';
const SCHOOL_CALENDAR_URL = GLOBAL_CONFIG?.schoolCalendarUrl || null;
const SCHOOL_CALENDAR_CACHE_TTL = GLOBAL_CONFIG?.schoolCalendarCacheTTL || 3600;  // 1 hour default


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

function activateBoostMode() {
    transitionMode(roomState, 'boost');
    saveRoomState(roomState);

    log(`\n🚀 BOOST MODE ACTIVATED`);
    log(`Duration: ${BOOST_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    addChange(`🚀 Boost activated`);
    addChange(`${BOOST_DURATION_MINUTES} min`);
}

async function cancelBoostMode(currentSlot = null) {
    if (roomState.mode !== 'boost') {
        log(`\nℹ️ No active boost to cancel`);
        return false;
    }

    transitionMode(roomState, 'auto');
    saveRoomState(roomState);

    log(`\n🛑 BOOST MODE CANCELLED`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    addChange(`🛑 Boost cancelled`);
    addChange(`Resumed schedule`);

    if (currentSlot) {
        await resumeNormalHeating(currentSlot, false, 'boost');
    }

    return true;
}

async function cancelAllOverrideModes(currentSlot = null) {
    if (roomState.mode === 'auto') {
        log(`\nℹ️ No active override modes to cancel`);
        return false;
    }

    const oldMode = roomState.mode;
    transitionMode(roomState, 'auto');
    saveRoomState(roomState);

    log(`\n✅ Override mode (${oldMode}) cancelled - resuming normal schedule`);

    if (currentSlot) {
        await resumeNormalHeating(currentSlot, false, oldMode);
    }

    return true;
}

/**
 * Check if boost mode is active and handle expiry.
 * @returns {{ active: boolean, expired: boolean, remainingMinutes: number }}
 */
function checkBoostMode() {
    if (roomState.mode !== 'boost') {
        return { active: false, expired: false, remainingMinutes: 0 };
    }

    if (!roomState.modeExpires) {
        // Boost flag set but no expiry - clear it
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
        return { active: false, expired: false, remainingMinutes: 0 };
    }

    const remainingMs = roomState.modeExpires - Date.now();

    if (remainingMs <= 0) {
        log(`\n⏱️ BOOST MODE EXPIRED`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);

        addChange(`⏱️ Boost ended`);
        addChange(`Resumed schedule`);
        return { active: false, expired: true, remainingMinutes: 0 };
    }

    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMs / 60000) };
}

async function controlHeatingBoost() {
    log(`\n--- BOOST HEATING CONTROL ---`);
    log(`Boost mode: ACTIVE - overriding all normal logic`);

    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Turning ON all radiators`);
        roomState.baseline.commandedOnOff = true;

        let anyVerified = false;

        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;

                if (!currentState) {
                    const result = await sendCommandWithVerification(device, 'onoff', true, ROOM.zoneName, SESSION_ID);

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

        if (anyVerified) {
            roomState.baseline.lastChangeTime = Date.now();
        }
        saveRoomState(roomState);

        return 'boost_heating';

    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Setting to ${BOOST_TEMPERATURE_TADO}°C boost temperature`);

        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;

            let verified = false;

            if (currentOnOff !== true) {
                const result = await sendCommandWithVerification(device, 'onoff', true, ROOM.zoneName, SESSION_ID);
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
                const result = await sendCommandWithVerification(device, 'target_temperature', BOOST_TEMPERATURE_TADO, ROOM.zoneName, SESSION_ID);
                if (result.success && result.verified) {
                    log(`🎯 TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C (verified)`);
                    roomState.baseline.verifiedTargetTemp = BOOST_TEMPERATURE_TADO;
                    verified = true;
                } else if (result.success) {
                    log(`⚠️ TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C (not verified)`);
                } else {
                    log(`❌ TADO temperature change failed`);
                }
            } else {
                log(`✓ TADO already at boost temperature`);
            }

            if (verified) {
                roomState.baseline.lastChangeTime = Date.now();
            }
            saveRoomState(roomState);

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
    transitionMode(roomState, 'pause');
    saveRoomState(roomState);

    log(`\n⏸️ PAUSE MODE ACTIVATED`);
    log(`Duration: ${PAUSE_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    addChange(`⏸️ Pause activated`);
    addChange(`${PAUSE_DURATION_MINUTES} min`);
}

async function cancelPauseMode(currentSlot = null) {
    if (roomState.mode !== 'pause') {
        log(`\nℹ️ No active pause to cancel`);
        return false;
    }

    transitionMode(roomState, 'auto');
    saveRoomState(roomState);

    log(`\n🔄 PAUSE MODE CANCELLED`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    addChange(`🔄 Pause cancelled`);
    addChange(`Resumed schedule`);

    if (currentSlot) {
        await resumeNormalHeating(currentSlot, false, 'pause');
    }

    return true;
}

/**
 * Check if pause mode is active and handle expiry.
 * @returns {{ active: boolean, expired: boolean, remainingMinutes: number }}
 */
function checkPauseMode() {
    if (roomState.mode !== 'pause') {
        return { active: false, expired: false, remainingMinutes: 0 };
    }

    if (!roomState.modeExpires) {
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
        return { active: false, expired: false, remainingMinutes: 0 };
    }

    const remainingMs = roomState.modeExpires - Date.now();

    if (remainingMs <= 0) {
        log(`\n⏱️ PAUSE MODE EXPIRED`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);

        addChange(`⏱️ Pause ended`);
        addChange(`Resumed schedule`);
        return { active: false, expired: true, remainingMinutes: 0 };
    }

    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMs / 60000) };
}

async function controlHeatingPause() {
    log(`\n--- PAUSE HEATING CONTROL ---`);
    log(`Pause mode: ACTIVE - turning off all heating`);

    if (ROOM.heating.type === 'smart_plug') {
        log(`Smart plug mode: Turning OFF all radiators`);
        roomState.baseline.commandedOnOff = false;

        let anyVerified = false;

        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;

                if (currentState) {
                    const result = await sendCommandWithVerification(device, 'onoff', false, ROOM.zoneName, SESSION_ID);

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

        if (anyVerified) {
            roomState.baseline.lastChangeTime = Date.now();
        }
        saveRoomState(roomState);

        return 'pause_heating';

    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Turning OFF completely`);

        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;

            let verified = false;

            if (currentOnOff !== false) {
                const result = await sendCommandWithVerification(device, 'onoff', false, ROOM.zoneName, SESSION_ID);
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

            if (verified) {
                roomState.baseline.lastChangeTime = Date.now();
            }
            saveRoomState(roomState);

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
        const roomTempObj = await getRoomTemperature();
        const roomTemp = roomTempObj?.value;
        if (roomTemp === null || roomTemp === undefined) {
            log(`❌ Cannot read room temperature - skipping resume`);
            return false;
        }
        
        const hysteresis = ROOM.heating.hysteresis || 0.5;
        const targetLow = resumeTarget - (hysteresis / 2);
        const targetHigh = resumeTarget + (hysteresis / 2);
        const shouldTurnOn = roomTemp < targetLow;
        
        log(`Room: ${roomTemp}°C, Target range: ${targetLow}-${targetHigh}°C`);
        log(`Resume state: ${shouldTurnOn ? 'ON' : 'OFF'}`);

        roomState.baseline.commandedOnOff = shouldTurnOn;

        let anyVerified = false;

        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;

                if (currentState !== shouldTurnOn) {
                    const result = await sendCommandWithVerification(device, 'onoff', shouldTurnOn, ROOM.zoneName, SESSION_ID);

                    if (result.success && result.verified) {
                        log(`🔌 ${device.name}: ${shouldTurnOn ? 'ON' : 'OFF'} (verified)`);
                        anyVerified = true;
                    } else if (result.success) {
                        log(`⚠️ ${device.name}: ${shouldTurnOn ? 'ON' : 'OFF'} (not verified)`);
                    } else {
                        log(`❌ ${device.name}: Failed to set state`);
                    }
                } else {
                    log(`✓ ${device.name}: already ${shouldTurnOn ? 'ON' : 'OFF'}`);
                }
            } catch (error) {
                log(`❌ Error resuming ${deviceId}: ${error.message}`);
            }
        }

        if (anyVerified) {
            roomState.baseline.verifiedOnOff = shouldTurnOn;
            roomState.baseline.lastChangeTime = Date.now();
            log(`📝 Stored baseline: ${shouldTurnOn ? 'ON' : 'OFF'} (resume verified)`);
        } else {
            // Check actual device states to update baseline
            let allMatch = true;
            for (const deviceId of ROOM.heating.devices) {
                try {
                    const device = await Homey.devices.getDevice({ id: deviceId });
                    if (device.capabilitiesObj.onoff.value !== shouldTurnOn) { allMatch = false; break; }
                } catch (error) { allMatch = false; break; }
            }
            if (allMatch) {
                roomState.baseline.verifiedOnOff = shouldTurnOn;
                roomState.baseline.lastChangeTime = Date.now();
                log(`📝 Stored baseline: ${shouldTurnOn ? 'ON' : 'OFF'} (verified current state)`);
            } else {
                log(`⚠️ Device states don't match expected after resume - not storing baseline`);
            }
        }
        saveRoomState(roomState);

        return anyVerified;

    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Resuming with target ${resumeTarget}°C`);

        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            let verified = false;

            const onoffResult = await sendCommandWithVerification(device, 'onoff', true, ROOM.zoneName, SESSION_ID);
            if (onoffResult.success && onoffResult.verified) {
                log(`🔥 TADO turned ON (verified)`);
                verified = true;
            } else if (onoffResult.success) {
                log(`⚠️ TADO turned ON (not verified)`);
            } else {
                log(`❌ TADO turn ON failed`);
            }

            const tempResult = await sendCommandWithVerification(device, 'target_temperature', resumeTarget, ROOM.zoneName, SESSION_ID);
            if (tempResult.success && tempResult.verified) {
                log(`🎯 TADO target set to ${resumeTarget}°C (verified)`);
                roomState.baseline.verifiedTargetTemp = resumeTarget;
                verified = true;
            } else if (tempResult.success) {
                log(`⚠️ TADO target set to ${resumeTarget}°C (not verified)`);
            } else {
                log(`❌ TADO temperature change failed`);
            }

            if (verified) {
                roomState.baseline.lastChangeTime = Date.now();
            }
            saveRoomState(roomState);

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
    transitionMode(roomState, 'manual', { type: overrideType, originalValue: originalValue });
    saveRoomState(roomState);

    const duration = ROOM.settings.manualOverrideDuration || 90;
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
    if (roomState.mode !== 'manual') {
        log(`\nℹ️ No active manual override to cancel`);
        return false;
    }

    transitionMode(roomState, 'auto');
    saveRoomState(roomState);

    log(`\n🔄 MANUAL OVERRIDE MODE CANCELLED`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    addChange(`🔄 Override cancelled`);
    addChange(`Resumed schedule`);

    if (currentSlot) {
        await resumeNormalHeating(currentSlot, false, 'manual');
    }

    return true;
}

async function checkManualOverrideMode() {
    if (roomState.mode !== 'manual') {
        return { active: false, expired: false, remainingMinutes: 0, reason: null };
    }

    if (!roomState.modeExpires) {
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
        return { active: false, expired: false, remainingMinutes: 0, reason: null };
    }

    const remainingMs = roomState.modeExpires - Date.now();

    // Check if TADO device has returned to automatic schedule
    if (ROOM.heating.type === 'tado_valve') {
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const smartScheduleCapability = device.capabilitiesObj['onoff.smart_schedule'];

            if (smartScheduleCapability) {
                const smartSchedule = smartScheduleCapability.value;
                log(`🔍 Smart schedule status: ${smartSchedule} (${smartSchedule ? 'AUTO MODE' : 'MANUAL MODE'})`);

                if (smartSchedule === true) {
                    log(`\n🔄 MANUAL OVERRIDE AUTO-CANCELLED`);
                    log(`Device returned to automatic schedule (smart_schedule = true)`);

                    transitionMode(roomState, 'auto');
                    saveRoomState(roomState);

                    addChange(`🔄 Device → auto`);
                    addChange(`Override ended`);
                    return { active: false, expired: true, remainingMinutes: 0, reason: 'smart_schedule' };
                } else {
                    log(`✓ Device still in manual mode (smart_schedule = false)`);
                }
            }
        } catch (error) {
            log(`⚠️ Could not check smart_schedule: ${error.message}`);
        }
    }

    if (remainingMs <= 0) {
        log(`\n⏱️ MANUAL OVERRIDE MODE EXPIRED`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);

        addChange(`⏱️ Override ended`);
        addChange(`Resumed schedule`);
        return { active: false, expired: true, remainingMinutes: 0, reason: 'timeout' };
    }

    return { active: true, expired: false, remainingMinutes: Math.ceil(remainingMs / 60000), reason: null };
}

async function detectManualIntervention() {
    // Skip if any device is mid-command
    for (const deviceId of ROOM.heating.devices) {
        const devState = initDeviceState(ROOM.zoneName, deviceId);
        if (devState.status === 'sending' || devState.status === 'verifying') {
            log(`⏸️ Skipping manual detection - device ${deviceId.substr(0, 8)}... is ${devState.status}`);
            return { detected: false };
        }
    }

    // Skip during window settle delay
    if (roomState.window.closedSince !== null) {
        log(`⏸️ Skipping manual detection - window settle delay active`);
        return { detected: false };
    }

    log(`✓ All devices idle - checking for manual intervention`);

    if (ROOM.heating.type === 'tado_valve') {
        const lastVerifiedTarget = roomState.baseline.verifiedTargetTemp;

        if (lastVerifiedTarget === null || lastVerifiedTarget === undefined) {
            log(`ℹ️ No verified baseline target yet - establishing initial baseline`);
            try {
                const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
                const currentTarget = device.capabilitiesObj.target_temperature.value;
                const currentOnOff = device.capabilitiesObj.onoff.value;

                if (await isTadoAway()) {
                    log(`⚠️ TADO in away mode - will establish baseline when returning home`);
                    return { detected: false };
                }

                if (currentOnOff) {
                    roomState.baseline.verifiedTargetTemp = currentTarget;
                    roomState.baseline.lastChangeTime = Date.now();
                    saveRoomState(roomState);
                    log(`📝 Initial baseline established: ${currentTarget}°C (TADO on)`);
                } else {
                    log(`⚠️ TADO is OFF - will establish baseline after next heating control`);
                }
                return { detected: false };
            } catch (error) {
                log(`⚠️ Error establishing initial baseline: ${error.message}`);
                return { detected: false };
            }
        }

        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentTarget = device.capabilitiesObj.target_temperature.value;

            if (await isTadoAway()) {
                return { detected: false };
            }

            const tempDifference = Math.abs(currentTarget - lastVerifiedTarget);
            if (tempDifference > 0.3) {
                log(`\n🤚 MANUAL INTERVENTION DETECTED (TADO)`);
                log(`Last verified: ${lastVerifiedTarget}°C, Current: ${currentTarget}°C`);
                log(`Difference: ${tempDifference.toFixed(1)}°C`);
                return { detected: true, type: 'temperature', originalValue: lastVerifiedTarget, currentValue: currentTarget };
            }
            return { detected: false };
        } catch (error) {
            log(`⚠️ Error detecting manual intervention: ${error.message}`);
            return { detected: false };
        }

    } else if (ROOM.heating.type === 'smart_plug') {
        const lastVerifiedOnOff = roomState.baseline.verifiedOnOff;

        if (lastVerifiedOnOff === null || lastVerifiedOnOff === undefined) {
            log(`ℹ️ No verified baseline state yet - establishing initial baseline`);
            try {
                const deviceStates = [];
                let allSame = true;
                let firstState = null;

                for (const deviceId of ROOM.heating.devices) {
                    const device = await Homey.devices.getDevice({ id: deviceId });
                    const currentState = device.capabilitiesObj.onoff.value;
                    deviceStates.push({ id: deviceId, name: device.name, state: currentState });
                    if (firstState === null) { firstState = currentState; }
                    else if (currentState !== firstState) { allSame = false; }
                }

                if (allSame && firstState !== null) {
                    roomState.baseline.verifiedOnOff = firstState;
                    roomState.baseline.lastChangeTime = Date.now();
                    saveRoomState(roomState);
                    log(`📝 Initial baseline established: ${firstState ? 'ON' : 'OFF'} (all ${deviceStates.length} devices match)`);
                } else {
                    log(`⚠️ Devices in mixed state - will establish baseline after next heating control`);
                }
                return { detected: false };
            } catch (error) {
                log(`⚠️ Error establishing initial baseline: ${error.message}`);
                return { detected: false };
            }
        }

        try {
            const currentStates = [];
            let anyDifferent = false;

            for (const deviceId of ROOM.heating.devices) {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;
                currentStates.push({ id: deviceId, name: device.name, state: currentState });
                if (currentState !== lastVerifiedOnOff) { anyDifferent = true; }
            }

            if (anyDifferent) {
                const lastCommanded = roomState.baseline.commandedOnOff;
                const allMatchCommanded = currentStates.every(s => s.state === lastCommanded);

                if (lastCommanded !== null && lastCommanded !== undefined && allMatchCommanded) {
                    roomState.baseline.verifiedOnOff = lastCommanded;
                    roomState.baseline.lastChangeTime = Date.now();
                    saveRoomState(roomState);
                    log(`✓ Device state matches last automation command (${lastCommanded ? 'ON' : 'OFF'}) - delayed verification, not manual`);
                    log(`📝 Updated baseline to ${lastCommanded ? 'ON' : 'OFF'} (corrected stale baseline)`);
                    return { detected: false };
                }

                for (const s of currentStates) {
                    if (s.state !== lastVerifiedOnOff) {
                        log(`\n🤚 MANUAL INTERVENTION DETECTED (SMART PLUG)`);
                        log(`Device: ${s.name}`);
                        log(`Last verified: ${lastVerifiedOnOff ? 'ON' : 'OFF'}, Current: ${s.state ? 'ON' : 'OFF'}`);
                        if (lastCommanded !== null && lastCommanded !== undefined) {
                            log(`Last commanded: ${lastCommanded ? 'ON' : 'OFF'} (does not match current state)`);
                        }
                    }
                }

                return { detected: true, type: 'switch', originalValue: lastVerifiedOnOff, currentValue: currentStates };
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
        
        let rawValue = tempSensor.capabilitiesObj.measure_temperature.value;
        
        // 🐛 Fix: Handle case where sensor returns object instead of number
        if (typeof rawValue === 'object' && rawValue !== null) {
            log(`⚠️ Temperature value is an object: ${JSON.stringify(rawValue)}`);
            // Try to extract value if it exists
            if (rawValue.hasOwnProperty('value')) {
                rawValue = rawValue.value;
            }
        }
        
        return {
            value: rawValue,
            lastUpdated: tempSensor.capabilitiesObj.measure_temperature.lastUpdated,
            source: tempSensor.name
        };
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
                
                // Note: baseline storage is handled by the caller (setHeating, controlHeatingBoost, etc.)
                // to keep command infrastructure decoupled from room state management
                
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
        roomState.baseline.commandedOnOff = turnOn;

        const results = [];
        let anyChanged = false;
        let anyVerified = false;

        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });
                const currentState = device.capabilitiesObj.onoff.value;

                if (currentState !== turnOn) {
                    const result = await sendCommandWithVerification(device, 'onoff', turnOn, ROOM.zoneName, SESSION_ID);

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

        // Store baseline ONCE after all devices processed
        if (anyVerified) {
            roomState.baseline.verifiedOnOff = turnOn;
            log(`📝 Stored verified state: ${turnOn ? 'ON' : 'OFF'} (baseline)`);
            debugNotify(`📝 Baseline: ${turnOn ? 'ON' : 'OFF'}`);
        } else {
            let allMatch = true;
            for (const deviceId of ROOM.heating.devices) {
                try {
                    const device = await Homey.devices.getDevice({ id: deviceId });
                    if (device.capabilitiesObj.onoff.value !== turnOn) { allMatch = false; break; }
                } catch (error) { allMatch = false; break; }
            }
            if (allMatch) {
                roomState.baseline.verifiedOnOff = turnOn;
                log(`📝 Updated baseline state: ${turnOn ? 'ON' : 'OFF'} (verified current state)`);
            } else {
                log(`⚠️ Device states don't match expected - not updating baseline`);
            }
        }
        saveRoomState(roomState);

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
                
                // Store baseline for verified commands
                if (verified) {
                    roomState.baseline.verifiedTargetTemp = effectiveTarget;
                    roomState.baseline.lastChangeTime = Date.now();
                } else if (!changed) {
                    // No changes made — verify actual device state matches expectation
                    try {
                        const currentDevice = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
                        const actualTarget = currentDevice.capabilitiesObj.target_temperature.value;
                        if (Math.abs(actualTarget - effectiveTarget) <= 0.3) {
                            roomState.baseline.verifiedTargetTemp = actualTarget;
                            log(`📝 Updated baseline target: ${actualTarget}°C (verified current state)`);
                        } else {
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
                
                // Clear baseline when turning off - no target to compare when off
                roomState.baseline.verifiedTargetTemp = null;
                log(`📝 Cleared baseline target (TADO off)`);
            }

            saveRoomState(roomState);
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
// School Day Detection (Direct Calendar Fetch with Caching)
// ============================================================================

/**
 * Get Danish local date in YYYYMMDD format (for iCal comparison)
 */
function getDanishDateString(offsetDays = 0) {
    const now = new Date();
    const danish = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
    danish.setDate(danish.getDate() + offsetDays);

    const year = danish.getFullYear();
    const month = String(danish.getMonth() + 1).padStart(2, '0');
    const day = String(danish.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
}

/**
 * Check if cached school calendar data is still valid
 */
function isSchoolCalendarCacheValid() {
    const cacheTime = global.get('SchoolCalendar.CacheTime');
    if (!cacheTime) return false;

    const ageSeconds = (Date.now() - cacheTime) / 1000;
    return ageSeconds < SCHOOL_CALENDAR_CACHE_TTL;
}

/**
 * Fetch and cache school calendar data from Skoleintra
 * Returns cached data if still valid, otherwise fetches fresh data
 */
async function getSchoolCalendarData() {
    // Check if we have valid cached data
    if (isSchoolCalendarCacheValid()) {
        const cachedData = global.get('SchoolCalendar.Data');
        if (cachedData) {
            log(`📚 Using cached school calendar (age: ${Math.floor((Date.now() - global.get('SchoolCalendar.CacheTime')) / 60000)} min)`);
            return cachedData;
        }
    }

    // No valid cache - fetch fresh data
    if (!SCHOOL_CALENDAR_URL) {
        log(`⚠️  No school calendar URL configured`);
        return null;
    }

    try {
        log(`📚 Fetching school calendar from Skoleintra...`);
        const response = await fetch(SCHOOL_CALENDAR_URL);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const icalData = await response.text();

        // Cache the data
        global.set('SchoolCalendar.Data', icalData);
        global.set('SchoolCalendar.CacheTime', Date.now());

        log(`✅ School calendar fetched and cached (${icalData.length} bytes)`);
        return icalData;

    } catch (error) {
        log(`⚠️  Failed to fetch school calendar: ${error.message}`);

        // Return stale cache if available (better than nothing)
        const staleData = global.get('SchoolCalendar.Data');
        if (staleData) {
            log(`📚 Using stale cached data as fallback`);
            return staleData;
        }

        return null;
    }
}

/**
 * Check if calendar has events on a specific date (YYYYMMDD format)
 */
function hasEventsOnDate(icalData, dateStr) {
    if (!icalData) return null;

    const lines = icalData.split('\n');

    for (const line of lines) {
        if (line.startsWith('DTSTART:') || line.startsWith('DTSTART;')) {
            // Extract the date value (handles both DTSTART:20260121T090000Z and DTSTART;VALUE=DATE:20260121)
            const value = line.includes(':') ? line.split(':').pop().trim() : '';
            const eventDate = value.substring(0, 8);  // Extract YYYYMMDD

            if (eventDate === dateStr) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check if today is a school day
 * Uses direct Skoleintra calendar with caching, falls back to weekday detection
 */
async function isSchoolDay() {
    const todayStr = getDanishDateString(0);

    // Try direct calendar check
    const icalData = await getSchoolCalendarData();
    const hasEvents = hasEventsOnDate(icalData, todayStr);

    if (hasEvents !== null) {
        log(`📚 School Day (Skoleintra): ${hasEvents ? 'SCHOOL DAY' : 'HOLIDAY/VACATION'} (${todayStr})`);
        return hasEvents;
    }

    // Fallback to weekday detection
    log(`⚠️  Could not check school calendar - using weekday fallback`);
    const now = new Date();
    const day = now.getDay();
    const isWeekday = (day >= 1 && day <= 5);
    log(`📚 School Day (Fallback): ${isWeekday ? 'SCHOOL DAY (assumed)' : 'WEEKEND'}`);
    return isWeekday;
}

/**
 * Check if tomorrow is a school day
 * Uses direct Skoleintra calendar with caching, falls back to weekday detection
 */
async function isSchoolDayTomorrow() {
    const tomorrowStr = getDanishDateString(1);

    // Try direct calendar check
    const icalData = await getSchoolCalendarData();
    const hasEvents = hasEventsOnDate(icalData, tomorrowStr);

    if (hasEvents !== null) {
        log(`📚 School Day Tomorrow (Skoleintra): ${hasEvents ? 'SCHOOL DAY' : 'HOLIDAY/VACATION'} (${tomorrowStr})`);
        return hasEvents;
    }

    // Fallback to weekday detection
    log(`⚠️  Could not check school calendar - using weekend fallback`);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
    return !isTomorrowWeekend;
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
            const wasInactive = roomState.inactive;
            if (wasInactive) {
                roomState.inactive = false; saveRoomState(roomState);
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
            const wasInactive = roomState.inactive;
            
            if (wasInactive) {
                roomState.inactive = false; saveRoomState(roomState);
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
            const wasInactive = roomState.inactive;
            
            if (!wasInactive) {
                roomState.inactive = true; saveRoomState(roomState);
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

    // Deduplicate: suppress notification if identical changes were sent recently (within 30 min)
    const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;
    const changesKey = [...changes].sort().join('|');
    const lastNotifKey = roomState.notification.lastKey;
    const lastNotifTime = roomState.notification.lastTime || 0;
    const timeSinceLast = Date.now() - lastNotifTime;

    if (changesKey === lastNotifKey && timeSinceLast < NOTIFICATION_COOLDOWN_MS) {
        log(`🔕 Notification suppressed (duplicate "${changesKey}" sent ${Math.floor(timeSinceLast / 60000)} min ago)`);
        return;
    }

    roomState.notification.lastKey = changesKey;
    roomState.notification.lastTime = Date.now();
    saveRoomState(roomState);

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

async function controlHeating(roomTempObj, slot, windowOpen) {
    const roomTemp = roomTempObj?.value;
    const heatingOn = await getHeatingStatus();
    const tadoAway = await isTadoAway();
    const inactivity = await checkInactivity(slot);
    const wasInTadoAway = roomState.away;
    
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
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
                return 'tado_away_off';
            } else {
                log(`✓ Heating already off`);
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
                return 'tado_away_skip';
            }
        } else {
            log(`🔥 TADO away mode: Holding minimum ${ROOM.settings.tadoAwayMinTemp}°C`);
            
            if (!wasInTadoAway) {
                addChange("Away");
                addChange(`Min ${ROOM.settings.tadoAwayMinTemp}°C`);
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
            }
            
            effectiveTarget = ROOM.settings.tadoAwayMinTemp;
            log(`→ Effective target: ${effectiveTarget}°C (away min temp)`);
        }
    } else {
        if (wasInTadoAway) {
            roomState.away = false; roomState.awaySince = null; saveRoomState(roomState);
            log(`✅ TADO back to home mode - resuming normal schedule`);
            addChange("Home");
            
            // Explicitly resume heating with temperature verification when returning home
            await resumeNormalHeating(slot, false, 'away_return');
            
            // Return early to allow resume to complete, normal schedule continues on next run
            return 'tado_home_resume';
        }
    }
    
    // Track LastRunTemp for stability checking (smart window settling)
    const lastRunTemp = roomState.lastRunTemp;
    if (roomTemp !== null && !roomState.window.closedSince) {
        roomState.lastRunTemp = roomTemp;
        saveRoomState(roomState);
    }

    // Window Timeout Check - CHECK THIS FIRST before sending any notifications!
    const windowOpenTime = roomState.window.openSince;
    let windowTimeoutHandled = roomState.window.timeoutHandled;
    const windowClosedTime = roomState.window.closedSince;
    // windowClosedDelay already defined at top of function using slot override pattern
    
    if (windowOpen) {
        // Don't clear WindowClosedTime on window open - brief sensor flaps after
        // physically closing a window would otherwise destroy the settle delay.
        // WindowClosedTime will be overwritten with a fresh timestamp if the window
        // truly opens and closes again past the timeout period (line 2581).
        if (windowClosedTime) {
            log(`ℹ️  Window opened during settle delay - settle preserved until confirmed open`);
        }

        if (!windowOpenTime) {
            roomState.window.openSince = Date.now();
            roomState.window.timeoutHandled = false;
            saveRoomState(roomState);
            const timeoutSource = getSettingSource(slot, 'windowOpenTimeout');
            log(`⏱️  Window opened - starting ${windowOpenTimeout} sec timeout (${timeoutSource})`);
        } else {
            const secondsOpen = (Date.now() - windowOpenTime) / 1000;
            if (secondsOpen >= windowOpenTimeout) {
                log(`⚠️  Window has been open for ${Math.floor(secondsOpen)} sec`);

                const shouldTurnOff = ROOM.heating.type === 'tado_valve' || heatingOn;

                if (!windowTimeoutHandled) {
                    if (shouldTurnOff) {
                        await setHeating(false, effectiveTarget);
                        log(`🔥 Heating turned OFF (window open too long)`);
                        addChange(`Window (${Math.floor(secondsOpen)}s)`);
                        addChange(`Heat off`);
                        roomState.window.timeoutHandled = true;
                        saveRoomState(roomState);
                        return 'window_timeout_off';
                    }
                    roomState.window.timeoutHandled = true;
                    saveRoomState(roomState);
                } else {
                    if (ROOM.heating.type === 'tado_valve') {
                        await setHeating(false, effectiveTarget);
                        log(`🔥 TADO ensured OFF (window still open)`);
                    }
                }

                return 'window_open_skip';
            } else {
                log(`ℹ️  Window open for ${Math.floor(secondsOpen)} sec (timeout: ${windowOpenTimeout} sec)`);
            }
        }
    } else {
        // Window is closed
        if (windowOpenTime) {
            const secondsOpen = (Date.now() - windowOpenTime) / 1000;

            if (secondsOpen >= windowOpenTimeout) {
                roomState.window.closedSince = Date.now();
                roomState.window.openSince = null;
                roomState.window.timeoutHandled = false;
                saveRoomState(roomState);

                const delayMinutes = Math.floor(windowClosedDelay / 60);
                const delaySource = getSettingSource(slot, 'windowClosedDelay');
                addChange("Window closed");
                addChange(`Waiting ${delayMinutes}min`);
                log(`✓ Window closed (was open ${Math.floor(secondsOpen)}s) - waiting ${delayMinutes} min for air to settle (${delaySource})`);

                return 'window_closed_waiting';
            } else {
                roomState.window.openSince = null;
                roomState.window.timeoutHandled = false;
                saveRoomState(roomState);
                log(`✓ Window closed (was only open ${Math.floor(secondsOpen)}s) - no settle delay needed`);
            }
        }
        
        // Check if we're in the settle delay period
        if (windowClosedTime) {
            const secondsSinceClosed = (Date.now() - windowClosedTime) / 1000;
            
            // Smart Settling Logic
            const minSettlingTime = 600; // 10 minutes minimum wait
            const stabilityThreshold = 0.2; // 0.2°C change allowed
            let isStable = false;
            let stabilityReason = "";

            // Check stability if we are past min time and have data
            if (secondsSinceClosed > minSettlingTime) {
                // Ensure sensor has updated since window closed
                const sensorTimestamp = roomTempObj?.lastUpdated ? new Date(roomTempObj.lastUpdated).getTime() : 0;
                
                if (sensorTimestamp <= windowClosedTime) {
                    log(`⏳ Sensor value is stale (from before window closed) - waiting for update`);
                    isStable = false;
                    stabilityReason = "(waiting for fresh sensor reading)";
                }
                else if (lastRunTemp !== null && lastRunTemp !== undefined && roomTemp !== null) {
                    const change = Math.abs(roomTemp - lastRunTemp);
                    if (change < stabilityThreshold) {
                        isStable = true;
                        stabilityReason = `(stable: change ${change.toFixed(2)}°C < ${stabilityThreshold}°C)`;
                        log(`🌡️ Temperature stable ${stabilityReason} - settling complete early`);
                    } else {
                        stabilityReason = `(unstable: change ${change.toFixed(2)}°C >= ${stabilityThreshold}°C)`;
                        log(`🌡️ Temperature changing ${stabilityReason} - still settling`);
                    }
                } else {
                    log(`🌡️ Cannot check stability (missing temp data) - waiting full delay`);
                }
            }

            // Resume if:
            // 1. Time > Max Delay (windowClosedDelay)
            // 2. Time > Min Delay AND Temperature is Stable
            if (secondsSinceClosed < windowClosedDelay && !isStable) {
                // Still waiting for air to settle
                const remainingSeconds = Math.floor(windowClosedDelay - secondsSinceClosed);
                const remainingMinutes = Math.floor(remainingSeconds / 60);
                const remainingSecs = remainingSeconds % 60;
                log(`⏳ Waiting for air to settle: ${remainingMinutes}m ${remainingSecs}s remaining ${stabilityReason}`);
                return 'window_closed_waiting';
            } else {
                // Delay complete - use explicit resume logic with verification
                log(`✓ Air settle delay complete - resuming heating with verification${tadoAway ? ' (away mode)' : ''}`);
                
                // Use resumeNormalHeating for consistent behavior with temperature verification
                const resumed = await resumeNormalHeating(slot, true, 'window_settle');
                
                if (resumed) {
                    // Clear the settle delay flag
                    roomState.window.closedSince = null;
                    saveRoomState(roomState);
                    
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
        const isWindowAction = action === 'window_timeout_off'; // Removed window_open_skip to suppress pre-timeout logs
        const windowStatusChanged = windowOpen !== lastWindowOpen;
        const shouldLogWindowAction = isWindowAction && windowStatusChanged;
        
        // Suppress window open logging until timeout reached (window_open_skip means waiting)
        const suppressWindowLog = action === 'window_open_skip';
        
        // ALWAYS log when window status changes, even if action is "no_change", UNLESS suppressed
        const shouldLogWindowStatusChange = windowStatusChanged && !suppressWindowLog;
        
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
            
            // Only update LastWindowOpen if not suppressed (treats "waiting" as still closed)
            if (!suppressWindowLog) {
                global.set(`${ROOM.zoneName}.Heating.LastWindowOpen`, windowOpen);
            }
            return;
        }
        
        const logText = global.get(`${ROOM.zoneName}.Heating.DiagnostikLog`) || '';
        
        // Format: DateTime|RoomTemp|Target|HeatingStatus|WindowStatus|Action
        // Use effectiveTarget (actual target after inactivity offset) not slot.target
        const heatingStatus = ROOM.heating.type === 'tado_valve' 
            ? (heatingOn ? 'HEATING' : 'IDLE')
            : (heatingOn ? 'ON' : 'OFF');
        
        // 🐛 Fix: Ensure roomTemp is logged correctly even if it's an object
        let tempLog = roomTemp;
        if (typeof roomTemp === 'object' && roomTemp !== null) {
            tempLog = JSON.stringify(roomTemp);
        }

        const newEntry = `${formatDateTime(now)}|${tempLog}|${effectiveTarget}|${heatingStatus}|${windowOpen?'OPEN':'CLOSED'}|${action}\n`;
        
        const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
        const trimmedLog = lines.slice(-5000).join('\n') + '\n';
        
        global.set(`${ROOM.zoneName}.Heating.DiagnostikLog`, trimmedLog);
        global.set(`${ROOM.zoneName}.Heating.LastLogTime`, Date.now());
        
        // Only update LastWindowOpen if not suppressed
        if (!suppressWindowLog) {
            global.set(`${ROOM.zoneName}.Heating.LastWindowOpen`, windowOpen);
        }
        
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

// Debug: dump current state to timeline
debugNotify(`📋 ${formatStateForDebug(roomState)}`);

// ============================================================================
// Away Mode Transition Check (BEFORE Manual Intervention Detection)
// ============================================================================

// Check if we're returning from away mode and clear baseline BEFORE detecting manual intervention
// This prevents false positive detection during TADO's automatic away→home temperature adjustment
const currentTadoAway = await isTadoAway();
const wasInTadoAway = roomState.away;

if (wasInTadoAway !== currentTadoAway) {
    // Away mode transition (entering OR leaving) - clear baselines to prevent false manual detection.
    // External flows or TADO integration may change device states during transitions.
    roomState.baseline.verifiedTargetTemp = null;
    roomState.baseline.verifiedOnOff = null;
    roomState.baseline.lastChangeTime = Date.now();
    saveRoomState(roomState);

    if (wasInTadoAway && !currentTadoAway) {
        log(`\n✅ TADO returning from away mode - cleared baselines`);
    } else {
        log(`\n🏠 TADO entering away mode - cleared baselines`);
    }
}

// ============================================================================
// Manual Intervention Detection (Highest Priority)
// ============================================================================

// Check for manual interventions BEFORE boost/pause (unless explicitly canceling)
if (!requestCancel && !requestBoost && !requestPause) {
    if (roomState.mode === 'auto') {
        const intervention = await detectManualIntervention();
        if (intervention.detected) {
            activateManualOverrideMode(
                intervention.type,
                intervention.originalValue,
                intervention.currentValue
            );

            // Note: no need to cancel boost/pause since mode was already 'auto'
            // transitionMode in activateManualOverrideMode handles everything
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

// Activate pause if requested (latest call wins - cancel any active mode)
if (requestPause) {
    if (roomState.mode !== 'auto' && roomState.mode !== 'pause') {
        log(`\n🔄 Cancelling active ${roomState.mode} to activate pause...`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
    }
    activatePauseMode();
}

// Activate boost if requested (latest call wins - cancel any active mode)
if (requestBoost) {
    if (roomState.mode !== 'auto' && roomState.mode !== 'boost') {
        log(`\n🔄 Cancelling active ${roomState.mode} to activate boost...`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
    }
    activateBoostMode();
}

// Check if pause mode is active (pause takes precedence in checking order)
const pauseStatus = checkPauseMode();

if (pauseStatus.active) {
    log(`\n⏸️ PAUSE MODE ACTIVE`);
    log(`Remaining: ${pauseStatus.remainingMinutes} minutes`);
    
    // Read room temperature for status
    const roomTempObj = await getRoomTemperature();
    const roomTemp = roomTempObj ? roomTempObj.value : null;

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
    const roomTempObj = await getRoomTemperature();
    const roomTemp = roomTempObj ? roomTempObj.value : null;

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
    const roomTempObj = await getRoomTemperature();
    const roomTemp = roomTempObj ? roomTempObj.value : null;

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
const previousSlotName = global.get(`${ROOM.zoneName}.Heating.PeriodName`);
global.set(`${ROOM.zoneName}.Heating.PeriodName`, currentSlot.name || 'Unknown');

// Notification if target or slot name changes
const slotNameChanged = previousSlotName !== null && previousSlotName !== (currentSlot.name || 'Unknown');
const targetChanged = previousTarget !== null && previousTarget !== currentSlot.target;

if (targetChanged || slotNameChanged) {
    if (targetChanged) {
        log(`📊 Target temperature changed: ${previousTarget}°C → ${currentSlot.target}°C`);
        addChange(`Schedule ${currentSlot.start}-${currentSlot.end}`);
        addChange(`${previousTarget}→${currentSlot.target}°C`);
    } else {
        // Slot name changed but temperature is the same
        log(`📊 Schedule slot changed: ${previousSlotName} → ${currentSlot.name}`);
        addChange(`${previousSlotName} → ${currentSlot.name}`);
        addChange(`${currentSlot.target}°C`);
    }
}

// Read room temperature
const roomTempObj = await getRoomTemperature();
const roomTemp = roomTempObj?.value;

if (roomTemp === null || roomTemp === undefined) {
    log('❌ Could not read room temperature!');
    return;
}

// Read window status
const windowOpen = await isWindowOpen();

// Run heating control
const action = await controlHeating(roomTempObj, currentSlot, windowOpen);

// Log diagnostics
await logDiagnostics(now, roomTemp, currentSlot, action);

// Send unified notification
const heatingOn = await getHeatingStatus();
const tadoAway = await isTadoAway();

// Use stored inactivity mode (don't check again - zone might have become active!)
const wasInactivityMode = roomState.inactive || false;

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

const windowTime = windowOpen ? Math.floor((Date.now() - (roomState.window.openSince || Date.now())) / 1000) : 0;

// Check if we're in window settle delay
const windowClosedTime = roomState.window.closedSince;
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
const windowTimeoutHandled = roomState.window.timeoutHandled;
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