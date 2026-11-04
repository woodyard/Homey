/**
 * Generic Room Heating Control (Zone-Based, Multi-Room)
 *
 * Universal heating control for multiple rooms - select room via argument!
 *
 * Usage in HomeyScript:
 *   await run('Clara')            // Run for Clara's room
 *   await run('Oliver')           // Run for Oliver's room
 *   await run('clara', 'boost')   // Boost heating - heat to 25°C for 1 hour (case-insensitive)
 *   await run('clara', 'pause')   // Pause heating - force OFF for 1 hour (case-insensitive)
 *   await run('Clara', 'cancel')  // Cancel active boost, pause, or manual override
 *
 * Or in Advanced Flow:
 *   Use "Run a script" action with argument:
 *   - "Clara"          → Normal heating
 *   - "clara, boost"   → Boost mode - heat to 25°C for 1 hour (comma-separated)
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
 * - Manual intervention detection (TADO only) - respects a turned knob for 90 minutes
 * - Smart schedule monitoring - auto-exits manual mode when device returns to schedule
 * - Command verification with status polling (single attempt)
 * - One run per room at a time (run lock); requests wait, normal runs skip
 *
 * Author: Henrik Skovgaard
 * Version: 10.27.1
 * Created: 2025-12-31
 * Based on: Clara Heating v6.4.6
 *
 * Version history: CHANGELOG.md
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
// Per-run snapshot of Homey data
// ============================================================================
// All devices, all zones, the Logic variables and the TADO presence are read once per
// run and reused (they used to be fetched 4-7 times each). Heating devices are still
// read fresh with getDevice() around commands and verification, and the HeatingStatus
// variable is read fresh under its lock.

let snapshot = {};

function clearSnapshot() {
    snapshot = {};
}

async function getAllDevices() {
    if (!snapshot.devices) snapshot.devices = await Homey.devices.getDevices();
    return snapshot.devices;
}

async function getAllZones() {
    if (!snapshot.zones) snapshot.zones = await Homey.zones.getZones();
    return snapshot.zones;
}

/** Logic variable by name, or null if it does not exist. */
async function getLogicVariable(name) {
    if (!snapshot.variables) snapshot.variables = await Homey.logic.getVariables();
    return Object.values(snapshot.variables).find(v => v.name === name) || null;
}

// ============================================================================
// Auto-discover heating devices in zone
// ============================================================================

async function discoverHeatingDevices() {
    const zone = await getZoneByName(ROOM.zoneName);
    if (!zone) {
        throw new Error(`❌ Zone "${ROOM.zoneName}" not found - cannot discover heating devices`);
    }

    const allDevices = await getAllDevices();
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
// Run Guard - one run per room at a time
// ============================================================================
// The flow triggers this script from a 5-minute cron, motion, window contacts,
// TADO presence and countdown timers, so two runs for the same room can overlap.
// A second run would read half-applied device state and could flag it as manual
// intervention. Rule: one run per room at a time. A normal run that finds another
// in progress simply exits (the next trigger is at most 5 minutes away); a
// boost/pause/cancel request waits for its turn so it is never lost.

const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const RUN_LOCK_KEY = `${ROOM.zoneName}.Heating.RunLock`;
const RUN_LOCK_STALE_MS = 120000;   // treat a lock older than this as abandoned (script killed mid-run)
const RUN_LOCK_WAIT_MS = RUN_LOCK_STALE_MS + 5000;  // a request waits past the stale threshold, so it always gets through
const RUN_LOCK_POLL_MS = 2000;

function readJsonGlobal(key) {
    try {
        const raw = global.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function readRunLock() {
    return readJsonGlobal(RUN_LOCK_KEY);
}

/**
 * Acquire the room's run lock.
 * @param {number} waitMs - How long to wait if another run holds it (0 = give up immediately)
 * @returns {Promise<boolean>} True if acquired
 */
async function acquireRunLock(waitMs) {
    const deadline = Date.now() + waitMs;

    while (true) {
        const lock = readRunLock();
        const ageMs = lock ? Date.now() - lock.startedAt : 0;
        const busy = lock && lock.sessionId !== SESSION_ID && ageMs < RUN_LOCK_STALE_MS;

        if (!busy) {
            if (lock && lock.sessionId !== SESSION_ID) {
                log(`🧹 Clearing stale run lock (${Math.round(ageMs / 1000)}s old)`);
            }
            global.set(RUN_LOCK_KEY, JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now() }));
            return true;
        }

        if (Date.now() >= deadline) {
            return false;
        }

        log(`⏳ Another run in progress (${Math.round(ageMs / 1000)}s) - waiting...`);
        await wait(RUN_LOCK_POLL_MS);   // HomeyScript has no setTimeout
    }
}

function releaseRunLock() {
    const lock = readRunLock();
    if (lock && lock.sessionId === SESSION_ID) {
        global.set(RUN_LOCK_KEY, null);
    }
}

// ============================================================================
// Debug Mode - Check if debug notifications are enabled
// ============================================================================

let DEBUG_MODE = false;
try {
    DEBUG_MODE = (await getLogicVariable('HeatingDebugMode'))?.value === true;
    if (DEBUG_MODE) {
        log(`🐛 DEBUG MODE ENABLED - Mode transitions and verification events will be sent as notifications`);
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
// Unified Room State Management
// ============================================================================
// All room-level state in a single object. Mode transitions go through
// transitionMode() so a mode is always exited and entered in one place.

const STATE_KEY = `${ROOM.zoneName}.Heating.State`;

const DEFAULT_STATE = {
    mode: 'auto',            // 'auto' | 'manual' | 'boost' | 'pause'
    modeExpires: null,        // timestamp when mode auto-expires
    modeDetails: {},          // mode-specific: { type, originalValue } for manual

    away: false,              // away applies to this room (TADO away and the room not in use)
    tadoAway: false,          // TADO presence on the previous run (a change clears the baseline)
    awayPaused: false,        // activity paused away during this TADO away period (later changes are routine)
    awaySince: null,          // timestamp when away mode started

    // Reference points for TADO manual detection (smart plugs have no detection)
    baseline: {
        commandedTargetTemp: null, // last target the script asked the valve for (null = nothing to compare)
        lastSeenTargetTemp: null   // target the valve reported at the end of the previous run
    },

    window: {
        openSince: null,          // timestamp when window opened
        closedSince: null,        // timestamp when window closed (for settle delay)
        timeoutHandled: false     // whether window-open timeout action was taken
    },

    inactive: false,              // room inactivity mode active

    heatingSince: null,           // when the runs first saw the heating on (cleared when off)
    sensorStaleSince: null,       // when the room sensor was declared silent (null = reporting)

    schedule: {
        lastTarget: null,         // scheduled target on the previous run (change notifications)
        lastSlotName: null        // slot name on the previous run
    },

    diag: {                       // diagnostics log throttling
        lastLogTime: 0,
        lastAction: null,
        lastWindowOpen: null,
        lastEffectiveTarget: null,
        lastTemp: null
    },

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
                tadoAway: parsed.tadoAway ?? !!parsed.away,   // before 10.26 'away' was TADO's presence
                // Only the current baseline fields are kept (drops fields from older versions)
                baseline: {
                    commandedTargetTemp: parsed.baseline?.commandedTargetTemp ?? null,
                    lastSeenTargetTemp: parsed.baseline?.lastSeenTargetTemp ?? null
                },
                window: { ...DEFAULT_STATE.window, ...(parsed.window || {}) },
                schedule: { ...DEFAULT_STATE.schedule, ...(parsed.schedule || {}) },
                diag: { ...DEFAULT_STATE.diag, ...(parsed.diag || {}) },
                notification: { ...DEFAULT_STATE.notification, ...(parsed.notification || {}) }
            };
        } catch (e) {
            log(`⚠️ Failed to parse room state, re-initializing: ${e.message}`);
        }
    }
    return {
        ...DEFAULT_STATE,
        baseline: { ...DEFAULT_STATE.baseline },
        window: { ...DEFAULT_STATE.window },
        schedule: { ...DEFAULT_STATE.schedule },
        diag: { ...DEFAULT_STATE.diag },
        notification: { ...DEFAULT_STATE.notification }
    };
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
 * Format room state as a compact readable string for debug notifications.
 */
function formatStateForDebug(state) {
    const mode = state.mode === 'auto' ? 'auto' : `${state.mode} (${state.modeExpires ? Math.ceil((state.modeExpires - Date.now()) / 60000) + 'min' : '?'})`;
    const away = state.away ? `away ${state.awaySince ? Math.floor((Date.now() - state.awaySince) / 60000) + 'min' : ''}` : 'home';
    const bl = [];
    if (state.baseline.commandedTargetTemp !== null) bl.push(`cmd=${state.baseline.commandedTargetTemp}°C`);
    if (state.baseline.lastSeenTargetTemp !== null) bl.push(`seen=${state.baseline.lastSeenTargetTemp}°C`);
    const baseline = bl.length ? bl.join(' ') : 'none';
    const win = state.window.closedSince ? 'settling' : state.window.openSince ? 'open' : 'closed';
    const inactive = state.inactive ? 'yes' : 'no';
    return `mode=${mode} | ${away} | inactive=${inactive} | win=${win} | baseline: ${baseline}`;
}

// Room state is loaded in main() once the run lock is held (another run may change it while we wait)
let roomState = null;

// Today's schedule / current slot, resolved once per run in main()
let scheduleCtx = null;

// ============================================================================
// Global Configuration (Shared) - from config script
// ============================================================================

const TADO_HOME_ID = GLOBAL_CONFIG?.tadoHomeId;
if (!TADO_HOME_ID) {
    throw new Error('❌ tadoHomeId missing from Config.Global - run room_heating_config.js');
}


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

/**
 * Target while TADO is in away mode: tadoAwayMinTemp, unless the schedule already asks
 * for less (a 15°C night slot stays at 15, away never raises a target).
 * @param {number} slotTarget - The schedule's target for the current slot
 * @returns {number}
 */
function awayTarget(slotTarget) {
    const awayTemp = ROOM.settings.tadoAwayMinTemp;
    return (awayTemp === null || awayTemp === undefined) ? slotTarget : Math.min(slotTarget, awayTemp);
}

/**
 * Effective target for a schedule slot, as the control logic applies it: the away target
 * when TADO is away, otherwise the slot target lowered by the slot's effective inactivity
 * offset (slot value or room default) when the room is inactive.
 */
function effectiveTargetFor(slot, away, inactive) {
    if (away) {
        return awayTarget(slot.target);
    }
    const offset = getEffectiveSetting(slot, 'inactivityOffset', ROOM.settings.inactivityOffset || 0);
    return inactive && offset > 0 ? slot.target - offset : slot.target;
}

/**
 * Is the room in use? The zone is active now, or was within the slot's inactivityTimeout
 * (slot value or room default). Unlike checkInactivity this ignores inactivityOffset, so
 * it also answers in slots without a setback.
 */
async function isRoomInUse(slot) {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (!zone) return false;
        if (zone.active) return true;
        const lastActive = new Date(zone.activeLastUpdated).getTime();
        if (!Number.isFinite(lastActive)) return false;
        // Once away applies, only activity after it started can pause it: a slot change
        // that lengthens the timeout must not bring back activity from before away began.
        if (roomState && roomState.away && roomState.awaySince && lastActive <= roomState.awaySince) return false;
        const timeout = getEffectiveSetting(slot, 'inactivityTimeout', ROOM.settings.inactivityTimeout);
        return (Date.now() - lastActive) / 60000 < timeout;
    } catch (error) {
        log(`⚠️  Could not check whether the room is in use: ${error.message}`);
        return false;
    }
}

/**
 * Does away apply to this room? TADO says away AND the room is not in use. Activity in
 * the room (someone home that TADO does not track) keeps the normal schedule; once the
 * room has been unused for inactivityTimeout it falls back to the away target.
 */
async function isAwayForRoom(slot) {
    if (!(await isTadoAway())) return false;
    return !(await isRoomInUse(slot));
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
// Override Modes (Boost / Pause / Manual)
// ============================================================================

const BOOST_DURATION_MINUTES = 60;
const BOOST_TEMPERATURE = 25;        // TADO target during boost; smart plugs heat up to it and no further
const PAUSE_DURATION_MINUTES = 60;

const MODE_LABELS = {
    boost:  { icon: '🚀', name: 'BOOST',           short: 'Boost',    ended: '⏱️ Boost ended' },
    pause:  { icon: '⏸️', name: 'PAUSE',           short: 'Pause',    ended: '⏱️ Pause ended' },
    manual: { icon: '🤚', name: 'MANUAL OVERRIDE', short: 'Override', ended: '⏱️ Override ended' }
};

/**
 * Activate an override mode.
 * @param {string} mode - 'boost' | 'pause' | 'manual'
 * @param {object} params - manual only: { type, originalValue, currentValue } (TADO target change)
 */
function activateMode(mode, params = {}) {
    transitionMode(roomState, mode, params);
    saveRoomState(roomState);

    const duration = mode === 'boost' ? BOOST_DURATION_MINUTES
                   : mode === 'pause' ? PAUSE_DURATION_MINUTES
                   : (ROOM.settings.manualOverrideDuration || 90);
    const label = MODE_LABELS[mode];

    log(`\n${label.icon} ${label.name} MODE ACTIVATED`);
    log(`Duration: ${duration} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);

    if (mode === 'manual') {
        log(`Changed: ${params.originalValue}°C → ${params.currentValue}°C`);
        addChange(`🤚 Manual override`);
    } else {
        addChange(`${label.icon} ${label.short} activated`);
    }
    addChange(`${duration} min`);
}

/**
 * Cancel whatever override mode is active and resume the schedule.
 * @returns {Promise<boolean>} True if a mode was active and cancelled
 */
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
 * Check whether the active override mode (if any) has expired.
 * Manual mode on TADO also ends early when the valve returns to its smart schedule.
 * @returns {Promise<{ mode: string, active: boolean, expired: boolean, remainingMinutes: number, reason: string|null }>}
 */
async function checkModeExpiry() {
    const mode = roomState.mode;
    const inactive = { mode, active: false, expired: false, remainingMinutes: 0, reason: null };

    if (mode === 'auto') {
        return inactive;
    }

    if (!roomState.modeExpires) {
        // Mode set but no expiry - clear it
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);
        return inactive;
    }

    const remainingMs = roomState.modeExpires - Date.now();
    const label = MODE_LABELS[mode];

    if (mode === 'manual' && ROOM.heating.type === 'tado_valve') {
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
                    return { mode, active: false, expired: true, remainingMinutes: 0, reason: 'smart_schedule' };
                } else {
                    log(`✓ Device still in manual mode (smart_schedule = false)`);
                }
            }
        } catch (error) {
            log(`⚠️ Could not check smart_schedule: ${error.message}`);
        }
    }

    if (remainingMs <= 0) {
        log(`\n⏱️ ${label.name} MODE EXPIRED`);
        transitionMode(roomState, 'auto');
        saveRoomState(roomState);

        addChange(label.ended);
        addChange(`Resumed schedule`);
        return { mode, active: false, expired: true, remainingMinutes: 0, reason: 'timeout' };
    }

    return { mode, active: true, expired: false, remainingMinutes: Math.ceil(remainingMs / 60000), reason: null };
}

/**
 * Apply boost (heat to BOOST_TEMPERATURE) or pause (all heating OFF).
 * Ignores schedule, window and inactivity logic entirely.
 * @param {string} mode - 'boost' | 'pause'
 * @param {number} roomTemp - Current room temperature (smart plugs stop boosting at BOOST_TEMPERATURE)
 * @returns {Promise<string>} Action string for diagnostics
 */
async function controlOverrideMode(mode, roomTemp) {
    const turnOn = mode === 'boost';

    log(`\n--- ${MODE_LABELS[mode].name} HEATING CONTROL ---`);
    log(turnOn ? `Boost mode: ACTIVE - overriding all normal logic` : `Pause mode: ACTIVE - turning off all heating`);

    if (ROOM.heating.type === 'smart_plug') {
        if (!turnOn) {
            log(`Smart plug mode: Turning OFF all radiators`);
            await setHeating(false, BOOST_TEMPERATURE);
            return `${mode}_heating`;
        }

        // Radiators on until the room reaches the boost temperature, with the room's
        // hysteresis around it, so an hour of boost cannot overheat the room
        const hysteresis = ROOM.heating.hysteresis || 0.5;
        const targetLow = BOOST_TEMPERATURE - (hysteresis / 2);
        const targetHigh = BOOST_TEMPERATURE + (hysteresis / 2);
        const heatingOn = await getHeatingStatus();
        const radiatorsOn = roomTemp < targetLow ? true : roomTemp > targetHigh ? false : heatingOn;

        log(`Smart plug mode: Room ${roomTemp}°C, boost range ${targetLow}-${targetHigh}°C → radiators ${radiatorsOn ? 'ON' : 'OFF'}`);
        await setHeating(radiatorsOn, BOOST_TEMPERATURE);
        return radiatorsOn ? 'boost_heating' : 'boost_at_target';
    } else if (ROOM.heating.type === 'tado_valve') {
        log(turnOn ? `TADO mode: Setting to ${BOOST_TEMPERATURE}°C boost temperature` : `TADO mode: Turning OFF completely`);
        const result = await setHeating(turnOn, BOOST_TEMPERATURE);
        return result.success ? `${mode}_tado` : `${mode}_error`;
    }

    return `${mode}_unknown_type`;
}

// ============================================================================
// Resume Normal Heating (After Override Mode Exit)
// ============================================================================

/**
 * Resume normal heating after an override mode ends or the room returns from away/window settle.
 * Computes the schedule target (with away minimum / inactivity offset) and applies it.
 * @param {Object} slot - Current time slot with target temperature
 * @param {boolean} fromExpiry - True if auto-expired, false if manually cancelled
 * @param {string} modeType - 'pause', 'boost', 'manual', 'away_return', 'window_settle' for logging
 * @returns {Promise<boolean>} True if the devices are in (or were set to) the resumed state
 */
async function resumeNormalHeating(slot, fromExpiry, modeType) {
    log(`\n--- RESUMING NORMAL HEATING (${modeType} ${fromExpiry ? 'expired' : 'cancelled'}) ---`);

    const away = await isAwayForRoom(slot);
    const inactivity = await checkInactivity(slot);
    const inactivityOffset = inactivity.inactivityOffset || 0;

    let resumeTarget = slot.target;

    if (away && ROOM.settings.tadoAwayMinTemp !== null) {
        resumeTarget = awayTarget(slot.target);
        log(`🏠 Away mode: Using ${resumeTarget}°C`);
    } else if (!away && inactivity.inactive && inactivityOffset > 0) {
        resumeTarget -= inactivityOffset;
        log(`💤 Inactivity mode active - reducing target by ${inactivityOffset}°C`);
        log(`→ Resume target: ${resumeTarget}°C (with inactivity offset)`);
    } else {
        log(`→ Resume target: ${resumeTarget}°C (scheduled target)`);
    }

    if (ROOM.heating.type === 'smart_plug') {
        // Smart plugs: hysteresis decides whether heating should be on right now
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

        const result = await setHeating(shouldTurnOn, resumeTarget);
        return result.success;
    } else if (ROOM.heating.type === 'tado_valve') {
        log(`TADO mode: Resuming with target ${resumeTarget}°C`);
        const result = await setHeating(true, resumeTarget);
        return result.success;
    }

    return false;
}

// ============================================================================
// Manual Intervention Detection
// ============================================================================

/**
 * TADO only: has a person changed the valve's target since the script last set it?
 *
 * Rule: the target is "manual" when it differs from what the script last commanded
 * AND it has moved since the end of the previous run. A valve that still shows the
 * old value is just slow to apply our command, not manual. A value set by TADO's own
 * schedule (smart_schedule = true) is not a person either; the script re-asserts it.
 *
 * Smart plugs have no manual detection: the schedule simply re-asserts them on the
 * next run, and the Boost/Pause flows exist for intentional changes.
 */
async function detectManualIntervention() {
    if (ROOM.heating.type !== 'tado_valve') {
        return { detected: false };
    }

    if (roomState.window.closedSince !== null) {
        log(`⏸️ Skipping manual detection - window settle delay active`);
        return { detected: false };
    }

    const commanded = roomState.baseline.commandedTargetTemp;
    const lastSeen = roomState.baseline.lastSeenTargetTemp;

    if (commanded === null || commanded === undefined) {
        log(`ℹ️ No commanded target to compare against yet`);
        return { detected: false };
    }
    if (lastSeen === null || lastSeen === undefined) {
        log(`ℹ️ No previous reading yet - manual detection starts next run`);
        return { detected: false };
    }

    try {
        const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
        const currentTarget = device.capabilitiesObj.target_temperature.value;
        const smartSchedule = device.capabilitiesObj['onoff.smart_schedule']?.value;

        if (await isAwayForRoom(scheduleCtx.currentSlot)) {
            log(`ℹ️ Away applies to this room - skipping manual detection`);
            return { detected: false };
        }

        if (Math.abs(currentTarget - commanded) <= 0.3) {
            log(`✓ TADO target ${currentTarget}°C matches last command`);
            return { detected: false };
        }

        if (smartSchedule === true) {
            log(`ℹ️ TADO target ${currentTarget}°C comes from its own schedule (smart_schedule = true), not a person - will re-assert`);
            return { detected: false };
        }

        if (Math.abs(currentTarget - lastSeen) <= 0.3) {
            log(`ℹ️ TADO still at ${currentTarget}°C - last command (${commanded}°C) not applied yet, not manual`);
            return { detected: false };
        }

        log(`\n🤚 MANUAL INTERVENTION DETECTED (TADO)`);
        log(`Commanded: ${commanded}°C, Last seen: ${lastSeen}°C, Now: ${currentTarget}°C`);
        return { detected: true, type: 'temperature', originalValue: commanded, currentValue: currentTarget };
    } catch (error) {
        log(`⚠️ Error detecting manual intervention: ${error.message}`);
        return { detected: false };
    }
}

/**
 * Remember the TADO target as reported at the end of this run. The next run's manual
 * detection compares against it: a target that has not moved since we last looked
 * is a slow valve, not a person.
 */
async function recordLastSeenTarget() {
    if (ROOM.heating.type !== 'tado_valve' || !roomState) return;
    try {
        const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
        roomState.baseline.lastSeenTargetTemp = device.capabilitiesObj.target_temperature.value;
        saveRoomState(roomState);
    } catch (error) {
        log(`⚠️ Could not record TADO target: ${error.message}`);
    }
}

async function handleManualOverride() {
    log(`\n--- MANUAL OVERRIDE CONTROL ---`);
    log(`Manual override: ACTIVE - respecting user's manual changes`);
    log(`Automation paused - no commands will be sent`);
    
    // Manual mode exists for TADO only: read the valve for the log, change nothing
    try {
        const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
        const currentTarget = device.capabilitiesObj.target_temperature.value;
        const heatingPower = device.capabilitiesObj.tado_heating_power?.value || 0;
        log(`✓ TADO target: ${currentTarget}°C (manual)`);
        log(`✓ Heating power: ${heatingPower}%`);
    } catch (error) {
        log(`❌ Error reading TADO: ${error.message}`);
    }

    return 'manual_override_active';
}

// ============================================================================
// Zone-Based Device Functions
// ============================================================================

async function getZoneByName(zoneName) {
    const zones = await getAllZones();
    return Object.values(zones).find(z => z.name === zoneName);
}

async function getZoneAndChildDevices(zone) {
    // Get devices from this zone and all child zones
    const devices = await getAllDevices();
    const zones = await getAllZones();
    
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
            
            const devices = await getAllDevices();
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

// A sensor that stops reporting (flat battery, lost connection) keeps its last value.
// For smart plugs that value drives the radiators, so a silent sensor stuck at a low
// reading would keep them on indefinitely.
//
// A steady reading on its own proves nothing: a settled room with the heating off may not
// report for hours. But a room that is being heated warms up, so a working sensor reports.
// The sensor therefore counts as silent only when the heating has been on for the whole
// limit and the sensor has not reported once in that time. Once silent, it stays silent
// until it reports again.
const SENSOR_STALE_MINUTES = 60;

/**
 * Has the room temperature sensor gone silent while the room was being heated? Notifies
 * once when it goes silent and once when it reports again.
 * @param {Object} roomTempObj - Result of getRoomTemperature()
 * @returns {Promise<boolean>} True while the sensor counts as silent
 */
async function checkSensorStale(roomTempObj) {
    const limitMinutes = ROOM.settings.sensorStaleMinutes || SENSOR_STALE_MINUTES;
    const limitMs = limitMinutes * 60000;
    const now = Date.now();
    const lastUpdated = roomTempObj?.lastUpdated ? new Date(roomTempObj.lastUpdated).getTime() : NaN;
    const silentMinutes = Number.isFinite(lastUpdated) ? Math.floor((now - lastUpdated) / 60000) : null;
    const before = JSON.stringify([roomState.heatingSince, roomState.sensorStaleSince]);

    // How long the heating has been on without a break, as seen by the runs
    const heatingOn = await getHeatingStatus();
    roomState.heatingSince = heatingOn ? (roomState.heatingSince || now) : null;

    const wasStale = roomState.sensorStaleSince !== null && roomState.sensorStaleSince !== undefined;
    let stale;
    if (wasStale) {
        stale = !(Number.isFinite(lastUpdated) && lastUpdated > roomState.sensorStaleSince);
    } else {
        stale = heatingOn && Number.isFinite(lastUpdated)
            && now - roomState.heatingSince >= limitMs
            && now - lastUpdated >= limitMs;
    }

    if (stale && !wasStale) {
        roomState.sensorStaleSince = now;
        log(`⚠️ Temperature sensor ${roomTempObj.source} silent for ${silentMinutes} min while heating (limit ${limitMinutes} min)`);
        addChange(`⚠️ ${roomTempObj.source} silent ${silentMinutes} min`);
        addChange(ROOM.heating.type === 'smart_plug' ? 'Heat off until it reports' : 'Check TADO connection');
    } else if (stale) {
        log(`⚠️ Temperature sensor ${roomTempObj?.source} still silent (${silentMinutes} min)`);
    } else if (wasStale) {
        roomState.sensorStaleSince = null;
        log(`✅ Temperature sensor ${roomTempObj?.source} reporting again`);
        addChange(`✅ ${roomTempObj?.source} reporting again`);
    }

    if (JSON.stringify([roomState.heatingSince, roomState.sensorStaleSince]) !== before) {
        saveRoomState(roomState);
    }
    return stale;
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
// Device Commands (send + single verification)
// ============================================================================
// Runs are serialized by the run guard, so no per-device locking or queuing is
// needed. A command is sent once and then polled until the device reports the
// new value or the timeout passes. An unverified command is not retried: the
// device usually applies it a little later, and the baseline logic treats a
// state that matches the last command as "delayed verification", not manual.

const VERIFY_TIMEOUT_MS = { smart_plug: 10000, tado_valve: 30000 };
const VERIFY_POLL_MS = 1000;
const TEMP_TOLERANCE = 0.3;

/**
 * Send a capability value and wait once for the device to report it back.
 * @returns {Promise<{ success: boolean, verified: boolean, error?: string }>}
 *   success  - Homey accepted the command
 *   verified - the device reported the new value within the timeout
 */
async function sendCommand(device, capability, value) {
    log(`📤 Sending command: ${capability} = ${value}`);
    debugNotify(`📤 Sending ${capability}=${value}`);

    try {
        await device.setCapabilityValue(capability, value);
    } catch (error) {
        log(`❌ Command failed: ${error.message}`);
        debugNotify(`❌ FAILED: ${capability}=${value}`);
        return { success: false, verified: false, error: error.message };
    }

    const timeout = VERIFY_TIMEOUT_MS[ROOM.heating.type] || 10000;
    const startTime = Date.now();

    while ((Date.now() - startTime) < timeout) {
        try {
            const current = await Homey.devices.getDevice({ id: device.id });
            const currentValue = current.capabilitiesObj[capability]?.value;

            if (currentValue === undefined) {
                log(`⚠️ Capability ${capability} not found on device`);
                return { success: true, verified: false, error: 'Capability not found' };
            }

            const matches = capability === 'target_temperature'
                ? Math.abs(currentValue - value) <= TEMP_TOLERANCE
                : currentValue === value;

            if (matches) {
                const elapsed = Date.now() - startTime;
                log(`✅ Verified in ${elapsed}ms: ${capability} = ${currentValue}`);
                debugNotify(`✅ Verified in ${elapsed}ms: ${capability}=${currentValue}`);
                return { success: true, verified: true };
            }
        } catch (error) {
            log(`⚠️ Error during verification: ${error.message}`);
        }

        await wait(VERIFY_POLL_MS);   // HomeyScript has no setTimeout
    }

    log(`⏱️ Not verified within ${timeout / 1000}s: ${capability} = ${value} (device may still apply it)`);
    debugNotify(`⚠️ Not verified: ${capability}=${value}`);
    return { success: true, verified: false, error: 'Verification timeout' };
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

/**
 * Apply a heating state. Smart plugs: all radiators ON/OFF. TADO: ON with target, or OFF.
 * Commands are only sent when the device is not already in the requested state.
 * @returns {Promise<{ success: boolean, changed: boolean }>}
 *   success - every device is in the requested state or accepted a command for it
 *   changed - at least one command was sent
 */
async function setHeating(turnOn, effectiveTarget) {
    const onOff = turnOn ? 'ON' : 'OFF';

    if (ROOM.heating.type === 'smart_plug') {
        let allOk = true;
        let anyChanged = false;

        for (const deviceId of ROOM.heating.devices) {
            try {
                const device = await Homey.devices.getDevice({ id: deviceId });

                if (device.capabilitiesObj.onoff.value === turnOn) {
                    log(`✓ Smart plug ${device.name} already ${onOff}`);
                    continue;
                }

                const result = await sendCommand(device, 'onoff', turnOn);
                if (result.success) {
                    anyChanged = true;
                    log(result.verified
                        ? `🔌 Smart plug ${device.name}: ${onOff} (verified)`
                        : `⚠️ Smart plug ${device.name}: ${onOff} sent but not verified`);
                } else {
                    allOk = false;
                    log(`❌ Smart plug ${device.name}: Command failed - ${result.error}`);
                }
            } catch (error) {
                allOk = false;
                log(`❌ Error controlling radiator ${deviceId}: ${error.message}`);
            }
        }

        return { success: allOk, changed: anyChanged };

    } else if (ROOM.heating.type === 'tado_valve') {
        try {
            const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
            const currentOnOff = device.capabilitiesObj.onoff.value;
            const currentTarget = device.capabilitiesObj.target_temperature.value;

            let allOk = true;
            let changed = false;

            if (turnOn) {
                // Remember what we asked for - manual detection compares the valve against this
                roomState.baseline.commandedTargetTemp = effectiveTarget;
                saveRoomState(roomState);

                if (currentOnOff !== true) {
                    const result = await sendCommand(device, 'onoff', true);
                    if (result.success) {
                        changed = true;
                        log(result.verified ? `🔥 TADO turned ON (verified)` : `⚠️ TADO turned ON (not verified)`);
                    } else {
                        allOk = false;
                        log(`❌ TADO turn ON failed: ${result.error}`);
                    }
                }

                if (currentTarget !== effectiveTarget) {
                    const result = await sendCommand(device, 'target_temperature', effectiveTarget);
                    if (result.success) {
                        changed = true;
                        log(result.verified
                            ? `🎯 TADO target set to ${effectiveTarget}°C (was ${currentTarget}°C) (verified)`
                            : `⚠️ TADO target set to ${effectiveTarget}°C (not verified)`);
                    } else {
                        allOk = false;
                        log(`❌ TADO target change failed: ${result.error}`);
                    }
                }

                if (!changed && allOk) {
                    log(`✓ TADO already ON with target ${effectiveTarget}°C - no change needed`);
                }
            } else {
                // Off: no target to compare against until we set one again
                roomState.baseline.commandedTargetTemp = null;
                saveRoomState(roomState);

                if (currentOnOff !== false) {
                    const result = await sendCommand(device, 'onoff', false);
                    if (result.success) {
                        changed = true;
                        log(result.verified ? `🔥 TADO turned OFF (verified)` : `⚠️ TADO turned OFF (not verified)`);
                    } else {
                        allOk = false;
                        log(`❌ TADO turn OFF failed: ${result.error}`);
                    }
                } else {
                    log(`✓ TADO already OFF - no change needed`);
                }
            }

            return { success: allOk, changed };
        } catch (error) {
            log(`❌ Error controlling TADO: ${error.message}`);
            return { success: false, changed: false };
        }
    }

    return { success: false, changed: false };
}

async function isTadoAway() {
    if (snapshot.tadoAway !== undefined) return snapshot.tadoAway;
    snapshot.tadoAway = false;
    try {
        const tadoHome = await Homey.devices.getDevice({ id: TADO_HOME_ID });
        const presenceMode = tadoHome.capabilitiesObj.tado_presence_mode.value;

        if (!presenceMode) {
            log(`⚠️  TADO: Could not read presence mode`);
        } else {
            snapshot.tadoAway = presenceMode === 'away';
        }
    } catch (error) {
        log(`⚠️  TADO: Error reading status: ${error.message}`);
    }
    return snapshot.tadoAway;
}

// ============================================================================
// School Day Detection
// ============================================================================
// A school day is a weekday that is not a school holiday (date ranges from the
// config), not a Danish public holiday (fixed dates from the config plus the
// Easter-based ones computed here), and not overridden by the SchoolHoliday
// Logic variable (an ad hoc "no school today" switch for sick days and the like).
// No network access: the holiday list is edited once a year in the config.

const SCHOOL_HOLIDAYS = GLOBAL_CONFIG?.schoolHolidays || [];
const PUBLIC_HOLIDAYS_FIXED = GLOBAL_CONFIG?.publicHolidaysFixed || ['01-01', '06-05', '12-24', '12-25', '12-26', '12-31'];
const SCHOOL_HOLIDAY_VARIABLE = GLOBAL_CONFIG?.schoolHolidayVariable || 'SchoolHoliday';

function isoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Easter Sunday for a year (Gregorian, anonymous algorithm). */
function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

/** Danish public holidays that move with Easter, as ISO dates for the given year. */
function easterBasedHolidays(year) {
    const easter = easterSunday(year);
    const offset = (days, name) => {
        const d = new Date(easter);
        d.setDate(d.getDate() + days);
        return { date: isoDate(d), name };
    };
    return [
        offset(-3, 'Skærtorsdag'),
        offset(-2, 'Langfredag'),
        offset(1, '2. påskedag'),
        offset(39, 'Kristi himmelfartsdag'),
        offset(50, '2. pinsedag')
    ];
}

/**
 * Why a date is not a school day, or null if it is one.
 * @param {Date} date - Danish local date
 * @returns {string|null}
 */
function noSchoolReason(date) {
    if (isWeekend(date)) return 'Weekend';

    const iso = isoDate(date);
    for (const range of SCHOOL_HOLIDAYS) {
        if (iso >= range.from && iso <= range.to) return range.name || 'School holiday';
    }
    if (PUBLIC_HOLIDAYS_FIXED.includes(iso.slice(5))) return 'Public holiday';

    const easterHoliday = easterBasedHolidays(date.getFullYear()).find(h => h.date === iso);
    if (easterHoliday) return easterHoliday.name;

    return null;
}

/** Value of the SchoolHoliday Logic variable (true = no school today), false if missing. */
async function readSchoolHolidayOverride() {
    try {
        return (await getLogicVariable(SCHOOL_HOLIDAY_VARIABLE))?.value === true;
    } catch (error) {
        log(`⚠️  Could not read ${SCHOOL_HOLIDAY_VARIABLE}: ${error.message}`);
    }
    return false;
}

function danishDate(offsetDays) {
    const d = getDanishLocalTime();
    d.setDate(d.getDate() + offsetDays);
    return d;
}

/** Is today a school day? Holiday list, public holidays and the override all say no. */
async function isSchoolDay() {
    const today = danishDate(0);
    const reason = noSchoolReason(today);
    if (reason) {
        log(`📚 School Day: NO - ${reason} (${isoDate(today)})`);
        return false;
    }
    if (await readSchoolHolidayOverride()) {
        log(`📚 School Day: NO - ${SCHOOL_HOLIDAY_VARIABLE} override is on (${isoDate(today)})`);
        return false;
    }
    log(`📚 School Day: YES (${isoDate(today)})`);
    return true;
}

/** Is tomorrow a school day? Decided by the holiday list only (the override is for today). */
async function isSchoolDayTomorrow() {
    const tomorrow = danishDate(1);
    const reason = noSchoolReason(tomorrow);
    log(`📚 School Day Tomorrow: ${reason ? `NO - ${reason}` : 'YES'} (${isoDate(tomorrow)})`);
    return !reason;
}

// The holiday ranges are edited once a year. When the last range is about to end, remind
// once a week (shared by all rooms) until next school year's dates are added.
const HOLIDAY_REMINDER_KEY = 'Heating.HolidayListReminder';
const HOLIDAY_REMINDER_DAYS_BEFORE = 30;
const HOLIDAY_REMINDER_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;

async function remindIfHolidayListEnding() {
    const lastEnd = SCHOOL_HOLIDAYS.map(range => range.to).sort().pop() || null;

    if (lastEnd) {
        const [y, m, d] = lastEnd.split('-').map(Number);
        const remindFrom = new Date(y, m - 1, d - HOLIDAY_REMINDER_DAYS_BEFORE);
        if (isoDate(danishDate(0)) < isoDate(remindFrom)) return;
    }

    const sent = readJsonGlobal(HOLIDAY_REMINDER_KEY);
    if (sent && sent.lastEnd === lastEnd && Date.now() - sent.sentAt < HOLIDAY_REMINDER_REPEAT_MS) return;
    global.set(HOLIDAY_REMINDER_KEY, JSON.stringify({ lastEnd, sentAt: Date.now() }));

    const text = lastEnd
        ? `📚 Heating: the school holiday list ends ${lastEnd}. Add next school year's holidays to room_heating_config.js and run it.`
        : `📚 Heating: the school holiday list is empty. Add the school year's holidays to room_heating_config.js and run it.`;
    log(text);
    try {
        await Homey.flow.runFlowCardAction({
            uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
            id: "homey:manager:notifications:create_notification",
            args: { text }
        });
    } catch (error) {
        log(`⚠️  Could not send holiday list reminder: ${error.message}`);
    }
}

// ============================================================================
// Zone-Based Inactivity Detection
// ============================================================================

// Evaluated once per slot per run: checkInactivity saves roomState.inactive, so a second
// evaluation in the same run would see its own write (wasInactive) and lose the transition.
const inactivityResults = new Map();

async function checkInactivity(slot) {
    if (!inactivityResults.has(slot)) {
        inactivityResults.set(slot, await evaluateInactivity(slot));
    }
    return inactivityResults.get(slot);
}

async function evaluateInactivity(slot) {
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

// Routine changes (heat on/off, schedule, inactivity) are only notified together with an
// exception (window, away, boost/pause/manual, sensor), unless notifyRoutineChanges is
// true in the global config.
const ROUTINE = true;
const NOTIFY_ROUTINE_CHANGES = GLOBAL_CONFIG?.notifyRoutineChanges === true;

const changes = [];
let hasExceptionChange = false;

function addChange(changeText, routine = false) {
    changes.push(changeText);
    if (!routine) hasExceptionChange = true;
    log(`⭐ Change${routine ? ' (routine)' : ''}: ${changeText}`);
}

async function sendUnifiedNotification(status) {
    if (changes.length === 0) {
        return;
    }

    if (!hasExceptionChange && !NOTIFY_ROUTINE_CHANGES) {
        log(`🔕 Only routine changes (${changes.join(', ')}) - no notification`);
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
    const away = await isAwayForRoom(slot);
    const inactivity = await checkInactivity(slot);
    const wasAway = roomState.away;
    
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
    if (tadoAway && !away) {
        log(`Away paused for this room: in use (activity within ${getEffectiveSetting(slot, 'inactivityTimeout', ROOM.settings.inactivityTimeout)} min)`);
    }
    log(`Inactivity: ${inactivity.inactive ? `YES (${inactivity.minutesSinceMotion} min since activity)` : `NO (${inactivity.minutesSinceMotion} min since activity)`} | Offset: ${inactivityOffset}°C`);
    log(`Heating: ${heatingOn ? 'ON' : 'OFF'}`);
    
    // Away: TADO says away and the room is not in use (activity overrides away)
    if (away) {
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
                addChange("Away", !!roomState.awayPaused);
                addChange("Heat off", !!roomState.awayPaused);
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
                return 'tado_away_off';
            } else {
                log(`✓ Heating already off`);
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
                return 'tado_away_skip';
            }
        } else {
            effectiveTarget = awayTarget(slot.target);
            log(`🔥 TADO away mode: Holding ${effectiveTarget}°C (away ${ROOM.settings.tadoAwayMinTemp}°C, schedule ${slot.target}°C)`);

            if (!wasAway) {
                // The first "Away" of a TADO away period is an exception; re-entry after activity is routine
                addChange("Away", !!roomState.awayPaused);
                addChange(`Min ${effectiveTarget}°C`, !!roomState.awayPaused);
                roomState.away = true; roomState.awaySince = roomState.awaySince || Date.now(); saveRoomState(roomState);
            }

            log(`→ Effective target: ${effectiveTarget}°C (away)`);
        }
    } else {
        if (wasAway) {
            roomState.away = false; roomState.awaySince = null;
            if (tadoAway) {
                // Activity while TADO is still away: routine, so a room that keeps going in and
                // out of use during a long absence does not fill the timeline
                roomState.awayPaused = true;
                log(`👣 Activity in the room - away paused, resuming normal schedule`);
                addChange("Activity", ROUTINE);
                addChange("Away paused", ROUTINE);
            } else {
                roomState.awayPaused = false;
                log(`✅ TADO back to home mode - resuming normal schedule`);
                addChange("Home");
            }
            saveRoomState(roomState);

            // With a window open or the settle delay running, the window logic below decides
            // (it keeps the heating off and resumes it when allowed)
            if (!windowOpen && !roomState.window.openSince && !roomState.window.closedSince) {
                await resumeNormalHeating(slot, false, 'away_return');
                return 'tado_home_resume';
            }
            log(`Window open or settling - the window logic decides the heating`);
        }
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
                    } else if (heatingOn) {
                        // A radiator switched on by hand or by a resume must not heat into an open window
                        await setHeating(false, effectiveTarget);
                        log(`Radiators switched OFF (window still open)`);
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
        
        // Settle delay: after a long window opening, wait a fixed time for the air near
        // the sensor to settle before resuming, so the heating doesn't chase cold air.
        if (windowClosedTime) {
            const secondsSinceClosed = (Date.now() - windowClosedTime) / 1000;

            if (secondsSinceClosed < windowClosedDelay) {
                const remainingSeconds = Math.floor(windowClosedDelay - secondsSinceClosed);
                log(`⏳ Waiting for air to settle: ${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s remaining`);
                return 'window_closed_waiting';
            }

            log(`✓ Air settle delay complete - resuming heating${away ? ' (away mode)' : ''}`);
            const resumed = await resumeNormalHeating(slot, true, 'window_settle');

            if (resumed) {
                roomState.window.closedSince = null;
                saveRoomState(roomState);

                // Not worth a notification when nobody is home
                if (!away) {
                    addChange("Air settled");
                    addChange("Heat resumed");
                }

                return 'window_settled';
            }

            log(`⚠️ Resume did not complete - will retry on next run`);
            return 'window_settle_retry';
        }
    }

    // Inactivity Mode (only if not in TADO away mode)
    if (!away && inactivity.inactive && inactivityOffset > 0) {
        effectiveTarget -= inactivityOffset;
        log(`💤 Inactivity mode active - reducing target by ${inactivityOffset}°C`);
        log(`→ Effective target: ${effectiveTarget}°C (inactivity)`);
        
        if (!inactivity.wasInactive) {
            addChange(`Inactive (${inactivity.minutesSinceMotion}min)`, ROUTINE);
            addChange(`-${inactivityOffset}°C → ${effectiveTarget}°C`, ROUTINE);
        }
    } else if (inactivity.wasInactive && !inactivity.inactive) {
        addChange("Active", ROUTINE);
        
        if (inactivityOffset > 0) {
            addChange(`→ ${effectiveTarget}°C`, ROUTINE);
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
                    addChange("Heat on", ROUTINE);
                    return 'heating_on';
                } else {
                    log(`✓ Heating already on`);
                    return 'no_change';
                }
            } else if (roomTemp > targetHigh) {
                if (heatingOn) {
                    await setHeating(false, effectiveTarget);
                    log(`❄️  Heating off (${roomTemp}°C > ${targetHigh}°C)`);
                    addChange("Heat off", ROUTINE);
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

// ── Live status publishing ──────────────────────────────────────────────────
// Writes a per-room status object into the "HeatingStatus" Logic variable (JSON keyed
// by zone name). Both the web dashboard and room_heating_status.js read it. Logic
// variables are readable over the Web API; HomeyScript globals are not.
//
// Every room runs on the same 5-minute cron and each run reads the variable, adds its
// own entry and writes it back, so without a lock one room can overwrite another's
// entry. global.get/global.set are synchronous, so the check-and-take below cannot
// interleave with another run.
const STATUS_LOCK_KEY = 'HeatingStatus.Lock';
const STATUS_LOCK_STALE_MS = 15000;
const STATUS_LOCK_POLL_MS = 250;

async function acquireStatusLock() {
    const deadline = Date.now() + STATUS_LOCK_STALE_MS + 5000;
    while (true) {
        const lock = readJsonGlobal(STATUS_LOCK_KEY);
        if (!lock || lock.sessionId === SESSION_ID || Date.now() - lock.startedAt > STATUS_LOCK_STALE_MS) {
            global.set(STATUS_LOCK_KEY, JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now() }));
            return true;
        }
        if (Date.now() >= deadline) {
            return false;
        }
        await wait(STATUS_LOCK_POLL_MS);   // HomeyScript has no setTimeout
    }
}

function releaseStatusLock() {
    if (readJsonGlobal(STATUS_LOCK_KEY)?.sessionId === SESSION_ID) {
        global.set(STATUS_LOCK_KEY, null);
    }
}

async function publishHeatingStatus(entry) {
    if (!(await acquireStatusLock())) {
        log(`⚠️ HeatingStatus lock still held after ${STATUS_LOCK_STALE_MS / 1000}s - publishing without it`);
    }
    try {
        const variables = await Homey.logic.getVariables();
        let found = null;
        for (const [id, v] of Object.entries(variables)) {
            if (v.name === 'HeatingStatus') { found = { id, value: v.value }; break; }
        }
        let all = {};
        if (found && found.value) { try { all = JSON.parse(found.value); } catch (e) { all = {}; } }
        all[entry.room] = entry;
        const value = JSON.stringify(all);
        if (found) {
            await Homey.logic.updateVariable({ id: found.id, variable: { value } });
        } else {
            await Homey.logic.createVariable({ variable: { name: 'HeatingStatus', type: 'string', value } });
        }
    } catch (error) {
        log(`⚠️ publishHeatingStatus failed (create a text Logic variable "HeatingStatus" if missing): ${error.message}`);
    } finally {
        releaseStatusLock();
    }
}

const DIAG_LOG_MAX_LINES = 500;   // was 5000; ~30 KB per room instead of ~300 KB

/**
 * @param {Object} slot - The schedule slot, or in an override mode { target } for that mode
 * @param {boolean} override - Boost/pause/manual: slot.target is the target as is, and the
 *   inactivity flag is reported as stored (not evaluated against the mode's pseudo-slot)
 */
async function logDiagnostics(now, roomTemp, slot, action, override = false) {
    try {
        const heatingOn = await getHeatingStatus();
        const windowOpen = await isWindowOpen();
        const tadoAway = await isTadoAway();
        const away = await isAwayForRoom(scheduleCtx ? scheduleCtx.currentSlot : slot);
        const inactive = override ? !!roomState.inactive : (await checkInactivity(slot)).inactive;
        const effectiveTarget = override ? slot.target : effectiveTargetFor(slot, away, inactive);

        // Live status for the dashboard and the status script - published on every run.
        // scheduledTarget is always the schedule's target; effectiveTarget reflects the
        // active mode (0 during pause, boost temperature during boost, the knob value in manual).
        const cs = scheduleCtx ? scheduleCtx.currentSlot : null;
        await publishHeatingStatus({
            room: ROOM.zoneName,
            mode: roomState ? roomState.mode : 'auto',
            modeExpires: roomState ? roomState.modeExpires : null,
            scheduleType: scheduleCtx ? scheduleCtx.dayType : null,
            period: cs ? { start: cs.start, end: cs.end, name: cs.name || 'Unknown' } : null,
            settings: cs ? {
                inactivityOffset: getEffectiveSetting(cs, 'inactivityOffset', ROOM.settings.inactivityOffset || 0),
                inactivityOffsetSource: getSettingSource(cs, 'inactivityOffset'),
                inactivityTimeout: getEffectiveSetting(cs, 'inactivityTimeout', ROOM.settings.inactivityTimeout),
                inactivityTimeoutSource: getSettingSource(cs, 'inactivityTimeout'),
                windowOpenTimeout: getEffectiveSetting(cs, 'windowOpenTimeout', ROOM.settings.windowOpenTimeout),
                windowOpenTimeoutSource: getSettingSource(cs, 'windowOpenTimeout'),
                windowClosedDelay: getEffectiveSetting(cs, 'windowClosedDelay', ROOM.settings.windowClosedDelay || 600),
                windowClosedDelaySource: getSettingSource(cs, 'windowClosedDelay')
            } : null,
            nextChange: scheduleCtx ? scheduleCtx.nextChange : null,
            scheduledTarget: cs ? cs.target : slot.target,
            effectiveTarget,
            currentTemp: (typeof roomTemp === 'number') ? roomTemp : null,
            heating: !!heatingOn,
            windowOpen: !!windowOpen,
            // Window timestamps after this run's window logic (epoch ms): openSince while the window
            // is open, closedSince only while the settle delay runs - lets the dashboard count down.
            // Runs that skip the window logic (boost/pause/manual, away without a minimum, silent
            // sensor) publish the stored values, which can disagree with windowOpen.
            windowOpenSince: roomState.window.openSince || null,
            windowClosedSince: roomState.window.closedSince || null,
            inactive: !!inactive,
            away: !!away,
            tadoAway: !!tadoAway,
            lastAction: action,
            updatedAt: Date.now(),
        });

        // Diagnostics log: only write an entry when something worth recording happened
        const diag = roomState.diag;
        const minutesSinceLastLog = (Date.now() - (diag.lastLogTime || 0)) / 1000 / 60;
        const lastEffectiveTarget = diag.lastEffectiveTarget ?? slot.target;
        const lastRoomTemp = diag.lastTemp;

        const importantActions = ['heating_on', 'heating_off', 'tado_away_off', 'window_closed_waiting'];
        const isImportantAction = importantActions.includes(action);

        // Window open logging is suppressed until the timeout is reached (window_open_skip = waiting)
        const suppressWindowLog = action === 'window_open_skip';
        const windowStatusChanged = windowOpen !== diag.lastWindowOpen;
        const shouldLogWindowAction = action === 'window_timeout_off' && windowStatusChanged;
        const shouldLogWindowStatusChange = windowStatusChanged && !suppressWindowLog;

        const targetChanged = effectiveTarget !== lastEffectiveTarget;
        const tempChangedSignificantly = Math.abs(roomTemp - (lastRoomTemp || roomTemp)) >= 0.5;
        const timeForPeriodicLog = minutesSinceLastLog >= 15;

        const shouldLog = isImportantAction || shouldLogWindowAction || shouldLogWindowStatusChange
            || targetChanged || tempChangedSignificantly || timeForPeriodicLog;

        // Append an entry when something worth recording happened, and keep the log short:
        // every global.set rewrites HomeyScript's whole store, so a big log slows down every
        // run and every other script's writes. An oversized log from an older version is
        // trimmed on the first run.
        const diagKey = `${ROOM.zoneName}.Heating.DiagnostikLog`;
        const lines = (global.get(diagKey) || '').split('\n').filter(l => l.length > 0);

        if (shouldLog) {
            const tempLog = (typeof roomTemp === 'object' && roomTemp !== null) ? JSON.stringify(roomTemp) : roomTemp;
            // Format: DateTime|RoomTemp|Target|HeatingStatus|WindowStatus|Action
            lines.push(`${formatDateTime(now)}|${tempLog}|${effectiveTarget}|${heatingStatusLabel(heatingOn)}|${windowOpen ? 'OPEN' : 'CLOSED'}|${action}`);
            diag.lastLogTime = Date.now();
        }

        if (shouldLog || lines.length > DIAG_LOG_MAX_LINES) {
            global.set(diagKey, lines.slice(-DIAG_LOG_MAX_LINES).join('\n') + '\n');
        }

        diag.lastTemp = roomTemp;
        diag.lastAction = action;
        diag.lastEffectiveTarget = effectiveTarget;
        if (!suppressWindowLog) {
            diag.lastWindowOpen = windowOpen;   // "waiting" counts as still closed
        }
        saveRoomState(roomState);

    } catch (error) {
        log(`Warning: Diagnostics error: ${error.message}`);
    }
}

// ============================================================================
// Schedule Resolution
// ============================================================================

/**
 * Determine today's schedule type, the complete schedule (with evening slot)
 * and the current time slot. Called once per run.
 */
async function resolveSchedule() {
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? await isSchoolDay() : false;

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
    const currentSlot = getCurrentTimeSlot(schedule, now);

    return { now, weekend, schoolDay, dayType, baseSchedule, schedule, currentSlot };
}

/**
 * Heating status label for notifications and diagnostics.
 * TADO: HEATING/IDLE (valve modulates itself). Smart plug: ON/OFF.
 */
function heatingStatusLabel(heatingOn) {
    if (ROOM.heating.type === 'tado_valve') {
        return heatingOn ? 'HEATING' : 'IDLE';
    }
    return heatingOn ? 'ON' : 'OFF';
}

// ============================================================================
// Main Execution
// ============================================================================
async function main() {
    // Load room state now that we hold the run lock
    roomState = getRoomState();
    saveRoomState(roomState);


    // Check if heating is globally enabled (from Homey Logic variable)
    try {
        const heatingEnabledVar = await getLogicVariable('HeatingEnabled');

        if (heatingEnabledVar && heatingEnabledVar.value === false) {
            log(`\n⏸️  ${ROOM.zoneName} - Heating is globally DISABLED`);
            log(`   Skipping heating control - radiators/TADO already turned off by flow`);
            return;
        }
    } catch (error) {
        // Logic variable not found or error - continue with heating (fail-safe)
        log(`ℹ️  HeatingEnabled check: ${error.message} - continuing with heating`);
    }

    await remindIfHolidayListEnding();

    // Debug: dump current state to timeline
    debugNotify(`📋 ${formatStateForDebug(roomState)}`);

    // ============================================================================
    // Away Mode Transition Check (BEFORE Manual Intervention Detection)
    // ============================================================================

    // TADO adjusts targets itself when presence changes, so on a transition (either way)
    // forget what we last commanded: there is nothing valid to compare the valve against
    // until the script sets a target again.
    const currentTadoAway = await isTadoAway();
    const wasInTadoAway = roomState.tadoAway;

    if (wasInTadoAway !== currentTadoAway) {
        roomState.tadoAway = currentTadoAway;
        roomState.awayPaused = false;
        roomState.baseline.commandedTargetTemp = null;
        saveRoomState(roomState);
        log(wasInTadoAway && !currentTadoAway
            ? `\n✅ TADO returning from away mode - cleared commanded target`
            : `\n🏠 TADO entering away mode - cleared commanded target`);
    }

    // ============================================================================
    // Schedule Resolution (once per run)
    // ============================================================================

    scheduleCtx = await resolveSchedule();
    scheduleCtx.nextChange = await getNextScheduleChange(scheduleCtx.schedule, scheduleCtx.currentSlot);
    const currentSlot = scheduleCtx.currentSlot;

    // ============================================================================
    // Manual Intervention Detection (Highest Priority)
    // ============================================================================

    // Check for manual interventions BEFORE boost/pause (unless explicitly canceling)
    if (!requestCancel && !requestBoost && !requestPause && roomState.mode === 'auto') {
        const intervention = await detectManualIntervention();
        if (intervention.detected) {
            activateMode('manual', {
                type: intervention.type,
                originalValue: intervention.originalValue,
                currentValue: intervention.currentValue
            });
        }
    }

    // ============================================================================
    // Override Mode Requests (cancel / pause / boost)
    // ============================================================================

    // Cancel request - cancels boost, pause AND manual override
    if (requestCancel) {
        const wasCancelled = await cancelAllOverrideModes(currentSlot);
        log(wasCancelled
            ? `Override cancelled and heating resumed - continuing with normal schedule`
            : `No active overrides - running normal schedule`);
    }

    // Pause / boost request - latest call wins, cancels any other active mode
    for (const [requested, mode] of [[requestPause, 'pause'], [requestBoost, 'boost']]) {
        if (!requested) continue;
        if (roomState.mode !== 'auto' && roomState.mode !== mode) {
            log(`\n🔄 Cancelling active ${roomState.mode} to activate ${mode}...`);
            transitionMode(roomState, 'auto');
            saveRoomState(roomState);
        }
        activateMode(mode);
    }

    // ============================================================================
    // Override Mode Active / Expired
    // ============================================================================

    const modeStatus = await checkModeExpiry();

    if (modeStatus.active) {
        const mode = modeStatus.mode;
        const label = MODE_LABELS[mode];

        log(`\n${label.icon} ${label.name} MODE ACTIVE`);
        log(`Remaining: ${modeStatus.remainingMinutes} minutes`);

        const roomTempObj = await getRoomTemperature();
        const roomTemp = roomTempObj ? roomTempObj.value : null;

        if (roomTemp === null) {
            log('❌ Could not read room temperature!');
            return;
        }

        // Manual: read-only. Boost/pause: force heating on/off.
        const action = mode === 'manual' ? await handleManualOverride() : await controlOverrideMode(mode, roomTemp);

        // Target for diagnostics/notification depends on the mode
        let diagSlot, notifTarget;
        if (mode === 'pause') {
            diagSlot = { target: 0 };
            notifTarget = 'OFF';
        } else if (mode === 'boost') {
            diagSlot = { target: BOOST_TEMPERATURE };
            notifTarget = `${BOOST_TEMPERATURE}`;
        } else {
            // Manual: target is whatever the user set (TADO only - smart plugs have no target)
            let actualTarget = null;
            if (ROOM.heating.type === 'tado_valve') {
                try {
                    const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
                    actualTarget = device.capabilitiesObj.target_temperature.value;
                } catch (error) {
                    // Leave null if unreadable
                }
            }
            diagSlot = { target: actualTarget ?? 0 };
            notifTarget = actualTarget ?? 'MANUAL';
        }

        await logDiagnostics(scheduleCtx.now, roomTemp, diagSlot, action, true);

        let notifHeating = 'OFF';
        if (mode !== 'pause') {
            const heatingOn = await getHeatingStatus();
            notifHeating = mode === 'boost' ? (heatingOn ? 'ON' : 'OFF') : heatingStatusLabel(heatingOn);
        }

        // Condition icons (window/inactive/away) are not shown during override modes
        await sendUnifiedNotification({
            room: roomTemp,
            target: notifTarget,
            window: 'CLOSED',
            windowSettle: false,
            inactivity: 'NO',
            heating: notifHeating,
            tado: 'HOME',
            nextChange: `${label.short} ends in ${modeStatus.remainingMinutes} min`
        });

        log(`\n=== ${label.name} MODE - COMPLETED ===`);
        return;
    }

    if (modeStatus.expired) {
        if (modeStatus.reason === 'smart_schedule') {
            log(`\n🔄 Manual override cancelled by device - returning to automatic schedule`);
            log(`Device's manual control period expired before system's 90-minute override`);
        } else {
            log(`\n⏱️ ${MODE_LABELS[modeStatus.mode].short} expired - resuming normal schedule`);
        }
        await resumeNormalHeating(currentSlot, true, modeStatus.mode);
    }

    // ============================================================================
    // Normal Schedule Operation
    // ============================================================================

    log(`\n=== ${ROOM.zoneName} Heating Control ===`);
    log(`Time: ${formatDateTime(scheduleCtx.now)}`);
    log(`Day: ${scheduleCtx.dayType}`);
    log(`Time period: ${currentSlot.start}-${currentSlot.end}`);
    log(`Target: ${currentSlot.target}°C`);

    // Notify when the schedule moves to a new target or slot
    const previousTarget = roomState.schedule.lastTarget;
    const previousSlotName = roomState.schedule.lastSlotName;
    const slotName = currentSlot.name || 'Unknown';

    roomState.schedule.lastTarget = currentSlot.target;
    roomState.schedule.lastSlotName = slotName;
    saveRoomState(roomState);

    const targetChanged = previousTarget !== null && previousTarget !== currentSlot.target;
    const slotNameChanged = previousSlotName !== null && previousSlotName !== slotName;

    if (targetChanged) {
        log(`📊 Target temperature changed: ${previousTarget}°C → ${currentSlot.target}°C`);
        addChange(`Schedule ${currentSlot.start}-${currentSlot.end}`, ROUTINE);
        addChange(`${previousTarget}→${currentSlot.target}°C`, ROUTINE);
    } else if (slotNameChanged) {
        log(`📊 Schedule slot changed: ${previousSlotName} → ${currentSlot.name}`);
        addChange(`${previousSlotName} → ${currentSlot.name}`, ROUTINE);
        addChange(`${currentSlot.target}°C`, ROUTINE);
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

    // Run heating control. Smart plugs act on the room temperature, so with a silent
    // sensor they are kept off; TADO valves regulate on their own sensor and carry on.
    let action;
    if ((await checkSensorStale(roomTempObj)) && ROOM.heating.type === 'smart_plug') {
        log(`🛑 Room temperature unknown - radiators kept OFF until the sensor reports again`);
        await setHeating(false, currentSlot.target);
        action = 'sensor_stale_off';
    } else {
        action = await controlHeating(roomTempObj, currentSlot, windowOpen);
    }

    // Log diagnostics
    await logDiagnostics(scheduleCtx.now, roomTemp, currentSlot, action);

    // Send unified notification
    const heatingOn = await getHeatingStatus();
    const tadoAway = await isAwayForRoom(currentSlot);   // away as applied to this room

    // Use stored inactivity mode (don't check again - zone might have become active!)
    const wasInactivityMode = roomState.inactive || false;

    // Effective target for display, from the stored inactivity state
    const displayTarget = effectiveTargetFor(currentSlot, tadoAway, wasInactivityMode);

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
        heatingStatus = heatingStatusLabel(heatingOn);
    }

    // Calculate next schedule change
    const nextChange = scheduleCtx.nextChange;

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
}

// ============================================================================
// Entry Point
// ============================================================================

const hasRequest = requestBoost || requestPause || requestCancel;
const lockWaitStart = Date.now();
const lockAcquired = await acquireRunLock(hasRequest ? RUN_LOCK_WAIT_MS : 0);

if (!lockAcquired) {
    log(`⏭️ Another run for ${ROOM.zoneName} is in progress - skipping this run`);
    return;
}

// A request that waited for another run reads Homey again: what was read before may be old
if (Date.now() - lockWaitStart > RUN_LOCK_POLL_MS / 2) {
    clearSnapshot();
}

try {
    await main();
} finally {
    await recordLastSeenTarget();
    releaseRunLock();
}
