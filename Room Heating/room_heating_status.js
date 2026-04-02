/**
 * Generic Room Heating Status (Zone-Based, Multi-Room)
 *
 * Shows current status for ALL configured rooms.
 * Just run the script - it loops through all rooms in ROOMS config.
 *
 * Author: Henrik Skovgaard
 * Version: 4.12.0
 * Created: 2025-12-31
 * Based on: Clara Status v2.8.0
 *
 * Version History:
 * 4.12.0 (2026-03-31) - 🔄 Read from unified state object (matches heating v10.16.0)
 *   - Reads mode/window/inactivity from ${zoneName}.Heating.State JSON
 *   - Legacy individual globals no longer written by heating script
 *   - Added getRoomState() helper with DEFAULT_STATE merge
 *   - Schedule globals (ScheduleType, Temperature, etc.) unchanged
 * 4.11.0 (2026-03-15) - 🔧 Auto-discover heating devices by zone (matches heating v10.15.0)
 *   - Removed dependency on hardcoded device IDs from config
 *   - Smart plugs discovered via virtualClass='heater' in zone
 *   - TADO valves discovered via tado_heating_power capability in zone
 *   - getZoneDevices() no longer requires device ID parameter
 * 4.10.1 (2026-01-27) - 📊 Show school calendar cache info (matches heating v10.13.1)
 * 4.10.0 (2026-01-23) - 📚 Direct Skoleintra calendar fetch with caching (matches heating v10.13.0)
 * 4.9.0 (2026-01-18) - 📊 Show device queue status (matches heating v10.9.0)
 * 4.8.0 (2026-01-17) - 🎛️ Show unified slot-override architecture (matches heating v10.8.0)
 * 4.7.0 (2026-01-17) - ⏱️ Show per-slot inactivity timeout (matches heating v10.7.0)
 * 4.6.3 (2026-01-16) - 🐛 Fix: Schedule gap when Day ends before lateEvening starts (matches heating v10.6.13)
 * 4.6.2 (2026-01-15) - 🔍 Search child zones for motion and window sensors (matches heating v10.6.9)
 *   - Added getZoneAndChildDevices() helper to search parent zone + all child zones
 *   - Motion sensors now shown in DEVICES section even if in child zones
 *   - Window sensors now detected in child zones
 *   - Supports complex zone hierarchies (e.g., "Stue / Spisestue" with children)
 *   - Backward compatible with simple zone structures
 * 4.6.1 (2026-01-15) - 📊 CRITICAL FIX: Get TADO devices directly by ID (matches heating v10.6.8)
 *   - Fixed bug where TADO devices in different zones weren't shown in status
 *   - TADO rooms now get thermostat directly by device ID instead of zone filtering
 *   - Shows correct temperature sensor in DEVICES section (TADO device, not motion sensor)
 *   - Heating devices now fetched directly by ID, works even if in different zone
 *   - Ensures status displays match actual heating control behavior
 * 4.6.0 (2026-01-13) - 🤚 Show manual override mode status (matches heating v10.6.0)
 *   - Displays manual override mode status when active
 *   - Shows remaining override time
 *   - Shows type of manual intervention (temperature or switch)
 *   - Indicates manual override in current status section
 *   - Shows how to cancel active manual override
 * 4.5.0 (2026-01-12) - ⏸️ Show pause mode status (matches heating v10.5.0)
 *   - Displays pause mode status when active
 *   - Shows remaining pause time
 *   - Indicates pause override in current status section
 *   - Shows how to cancel active pause
 * 4.4.2 (2026-01-09) - 📅 Show next schedule change (matches heating v10.4.4)
 *   - Added "Next Schedule Change" section showing upcoming period transition
 *   - Correctly determines tomorrow's schedule type (weekend/school/holiday)
 *   - Shows time, target temperature, and period name for next change
 *   - Matches fix in heating script for cross-day schedule transitions
 * 4.4.1 (2026-01-08) - 🛑 Show cancel instructions when boost active (matches heating v10.4.1)
 *   - Displays how to cancel active boost
 *   - Shows cancel command in boost status section
 * 4.4.0 (2026-01-08) - 🚀 Show boost mode status (matches heating v10.4.0)
 *   - Displays boost mode status when active
 *   - Shows remaining boost time
 *   - Indicates boost override in current status section
 * 4.3.0 (2026-01-08) - ⏳ Show window settle delay status (matches heating v10.3.11)
 *   - After window closes, shows "⏳ SETTLING (Xm Ys remaining)"
 *   - Displays configured delay time from room settings
 *   - Shows when heating will resume after air settles
 *   - Displays configured delay time from room settings
 *   - Shows when heating will resume after air settles
 * 4.2.9 (2026-01-04) - 🧹 Remove redundant motion sensor line from Activity section
 *   - Motion sensor already shown in DEVICES section, no need to repeat
 * 4.2.8 (2026-01-03) - 📝 Fix extra space after snowflake icon
 *   - Removed double space after ❄️ icon: "❄️  OFF" → "❄️ OFF"
 *   - Applied to both CURRENT STATUS and DEVICES sections
 *   - Consistent single space after all icons now
 * 4.2.7 (2026-01-03) - 🔥 Simplify heating status to overall state
 *   - Smart plugs now show "Heating: 🔥 ON" or "Heating: ❄️ OFF" (not individual radiators)
 *   - Individual radiator states shown in DEVICES section with on/off status
 *   - CURRENT STATUS section now more concise
 * 4.2.6 (2026-01-03) - 📊 Window status on one line + devices table
 *   - Window status now shows on single line: "Window: 🔴 OPEN (1038s)"
 *   - Added new DEVICES section showing all zone devices
 *   - Devices table shows: temperature, motion, window(s), and heating devices
 *   - Multi-device types show count and list with dash prefix
 * 4.2.5 (2026-01-03) - 🧹 Remove redundant window sensor device listing
 *   - Removed "- O Eve Door & Window: OPEN" line under window status
 *   - Window status already shows if open/closed and duration
 *   - Individual device names are redundant in this context
 * 4.2.4 (2026-01-03) - 📝 Fix window sensor device name alignment
 *   - Added dash prefix to window sensor names for clarity
 *   - Format: "                - O Eve Door & Window: OPEN"
 *   - Makes it clear device name is a sub-detail under window status
 *   - Preserves full device name (no truncation)
 * 4.2.3 (2026-01-02) - 📝 Remove extra space in radiator formatting
 *   - Had extra space between padding and value causing misalignment
 *   - "C Radiator 2:   " + " " + "🔥 ON" = 17 chars (wrong!)
 *   - Now: "C Radiator 2:   " + "🔥 ON" = 16 chars (correct!)
 * 4.2.2 (2026-01-02) - 📝 Fix radiator alignment properly - padding AFTER colon!
 * 4.2.1 (2026-01-02) - 📝 Fix smart plug radiator names to use 15-char width (BROKEN - ugly!)
 * 4.2.0 (2026-01-02) - 📝 Standardize ALL label widths to 15 characters
 * 4.1.7 (2026-01-02) - 📝 Align temperature settings columns consistently
 * 4.1.6 (2026-01-02) - 🛠️ Remove confusing motion sensor timestamp
 * 4.1.5 (2026-01-02) - 🎯 Show both base and effective temperature (matches heating v10.2.5)
 * 4.1.4 (2026-01-02) - 🕐 Fix timezone issue in activity display
 * 4.1.3 (2025-12-31) - 🔧 Revert to getVariables() method (matches heating v10.1.4)
 * 4.1.2 (2025-12-31) - 🔧 Fix to use Homey's built-in Logic variables (matches heating v10.1.2)
 * 4.1.1 (2025-12-31) - 🔧 Fix HeatingEnabled to use Logic variable (matches heating v10.1.1)
 * 4.1.0 (2025-12-31) - 🎚️ Show HeatingEnabled global status (matches heating v10.1.0)
 * 4.0.0 (2025-12-31) - 🔧 Configuration via global variables (matches heating v10.0.0)
 * 3.3.0 (2025-12-31) - 🎯 Per-room configuration support (matches heating v9.0.0)
 * 3.2.1 (2025-12-31) - 🧹 Removed redundant inactivity section
 * 3.2.0 (2025-12-31) - 🎯 Target-based display (matches heating v8.0.0)
 * 3.1.0 (2025-12-31) - 🔄 Show ALL rooms automatically
 * 3.0.0 (2025-12-31) - 🌟 Zone-based multi-room implementation
 */

// ============================================================================
// ROOM CONFIGURATIONS - Must match heating script!
// ============================================================================


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
// Global Configuration
// ============================================================================

const TADO_HOME_ID = GLOBAL_CONFIG?.tadoHomeId || 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c';
const SCHOOL_CALENDAR_URL = GLOBAL_CONFIG?.schoolCalendarUrl || null;
const SCHOOL_CALENDAR_CACHE_TTL = GLOBAL_CONFIG?.schoolCalendarCacheTTL || 3600;  // 1 hour default

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

async function getZoneDevices(zoneName, roomConfig) {
    try {
        const zone = await getZoneByName(zoneName);
        if (!zone) {
            return { error: `Zone "${zoneName}" not found` };
        }

        // Get devices from zone and all child zones
        const zoneDevices = await getZoneAndChildDevices(zone);

        // Auto-discover heating devices by type
        let heatingDevices = [];
        if (roomConfig.heating.type === 'smart_plug') {
            heatingDevices = zoneDevices.filter(d => d.virtualClass === 'heater' || d.class === 'heater');
        } else if (roomConfig.heating.type === 'tado_valve') {
            heatingDevices = zoneDevices.filter(d => d.capabilitiesObj?.tado_heating_power !== undefined);
        }

        // Find temperature sensor with priority logic
        let tempSensor = null;

        // PRIORITY 1: For TADO rooms, use the TADO device itself as temp sensor
        if (roomConfig.heating.type === 'tado_valve' && heatingDevices.length > 0) {
            const tadoDevice = heatingDevices[0];
            if (tadoDevice.capabilitiesObj?.measure_temperature) {
                tempSensor = tadoDevice;
            }
        }

        // PRIORITY 2: Fall back to any temperature sensor in zone
        if (!tempSensor) {
            tempSensor = zoneDevices.find(d => d.capabilitiesObj?.measure_temperature);
        }

        return {
            zone: zone,
            tempSensor: tempSensor,
            motionSensor: zoneDevices.find(d => d.capabilitiesObj?.alarm_motion),
            windowSensors: zoneDevices.filter(d => d.capabilitiesObj?.alarm_contact),
            heatingDevices: heatingDevices
        };
    } catch (error) {
        return { error: error.message };
    }
}

// ============================================================================
// Device State Management (for queue status display)
// ============================================================================

/**
 * Get global variable key for device state
 */
function getDeviceStateKey(zoneName, deviceId) {
    const cleanId = deviceId.replace(/-/g, '_');
    return `${zoneName}.Heating.Device.${cleanId}.State`;
}

/**
 * Get device state from global variables
 */
function getDeviceState(zoneName, deviceId) {
    const stateKey = getDeviceStateKey(zoneName, deviceId);
    const existingState = global.get(stateKey);
    
    if (existingState) {
        try {
            return JSON.parse(existingState);
        } catch (error) {
            return null;
        }
    }
    
    return null;
}

// ============================================================================
// Unified Room State (matches room_heating.js v10.16.0)
// ============================================================================

const DEFAULT_STATE = {
    mode: 'auto',
    modeExpires: null,
    modeDetails: {},
    away: false,
    awaySince: null,
    baseline: {
        verifiedOnOff: null,
        verifiedTargetTemp: null,
        commandedOnOff: null,
        lastChangeTime: null
    },
    window: {
        openSince: null,
        closedSince: null,
        timeoutHandled: false
    },
    inactive: false,
    lastRunTemp: null,
    notification: {
        lastKey: null,
        lastTime: 0
    }
};

function getRoomState(zoneName) {
    const raw = global.get(`${zoneName}.Heating.State`);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return {
                ...DEFAULT_STATE,
                ...parsed,
                baseline: { ...DEFAULT_STATE.baseline, ...(parsed.baseline || {}) },
                window: { ...DEFAULT_STATE.window, ...(parsed.window || {}) },
                notification: { ...DEFAULT_STATE.notification, ...(parsed.notification || {}) }
            };
        } catch (e) {
            // Fall through to defaults
        }
    }
    return { ...DEFAULT_STATE, baseline: { ...DEFAULT_STATE.baseline }, window: { ...DEFAULT_STATE.window }, notification: { ...DEFAULT_STATE.notification } };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getDanishLocalTime() {
    const now = new Date();
    const danishTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
    return danishTime;
}

function formatValue(value, suffix = '') {
    if (value === null || value === undefined) {
        return 'N/A';
    }
    return value + suffix;
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function getCurrentScheduleInfo(zoneName) {
    try {
        const now = getDanishLocalTime();
        
        const scheduleType = global.get(`${zoneName}.Heating.ScheduleType`) || 'Unknown';
        const currentPeriod = global.get(`${zoneName}.Heating.CurrentPeriod`) || 'Unknown';
        const periodName = global.get(`${zoneName}.Heating.PeriodName`) || 'Unknown';
        
        const target = global.get(`${zoneName}.Temperature`);
        const inactivityOffset = global.get(`${zoneName}.Heating.InactivityOffset`) || 0;
        const slotInactivityTimeout = global.get(`${zoneName}.Heating.SlotInactivityTimeout`);
        const slotWindowOpenTimeout = global.get(`${zoneName}.Heating.SlotWindowOpenTimeout`);
        const slotWindowClosedDelay = global.get(`${zoneName}.Heating.SlotWindowClosedDelay`);
        
        return {
            scheduleType: scheduleType,
            currentSlot: {
                start: currentPeriod.split('-')[0],
                end: currentPeriod.split('-')[1],
                name: periodName,
                target: target,
                inactivityOffset: inactivityOffset,
                inactivityTimeout: slotInactivityTimeout,
                windowOpenTimeout: slotWindowOpenTimeout,
                windowClosedDelay: slotWindowClosedDelay
            },
            time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
        };
    } catch (error) {
        return {
            scheduleType: 'Unknown',
            error: error.message
        };
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
 */
async function getSchoolCalendarData() {
    // Check if we have valid cached data
    if (isSchoolCalendarCacheValid()) {
        const cachedData = global.get('SchoolCalendar.Data');
        if (cachedData) {
            return cachedData;
        }
    }

    // No valid cache - fetch fresh data
    if (!SCHOOL_CALENDAR_URL) {
        return null;
    }

    try {
        const response = await fetch(SCHOOL_CALENDAR_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const icalData = await response.text();
        global.set('SchoolCalendar.Data', icalData);
        global.set('SchoolCalendar.CacheTime', Date.now());
        return icalData;

    } catch (error) {
        // Return stale cache if available
        return global.get('SchoolCalendar.Data') || null;
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
            const value = line.includes(':') ? line.split(':').pop().trim() : '';
            const eventDate = value.substring(0, 8);
            if (eventDate === dateStr) {
                return true;
            }
        }
    }
    return false;
}

async function getSchoolDayStatus() {
    try {
        const today = getDanishLocalTime();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayStr = getDanishDateString(0);
        const tomorrowStr = getDanishDateString(1);

        // Try direct calendar check
        const icalData = await getSchoolCalendarData();
        let isSchoolDayToday = hasEventsOnDate(icalData, todayStr);
        let isSchoolDayTomorrow = hasEventsOnDate(icalData, tomorrowStr);

        // Fallback to weekday detection if calendar unavailable
        if (isSchoolDayToday === null) {
            isSchoolDayToday = !isWeekend(today);
        }
        if (isSchoolDayTomorrow === null) {
            isSchoolDayTomorrow = !isWeekend(tomorrow);
        }

        const todayType = isWeekend(today) ? 'Weekend' : (isSchoolDayToday ? 'School Day' : 'Holiday/Vacation');
        const tomorrowType = isWeekend(tomorrow) ? 'Weekend' : (isSchoolDayTomorrow ? 'School Day' : 'Holiday/Vacation');

        return {
            today: todayType,
            tomorrow: tomorrowType,
            todayIsSchoolDay: isSchoolDayToday,
            tomorrowIsSchoolDay: isSchoolDayTomorrow
        };
    } catch (error) {
        return {
            today: 'Unknown',
            tomorrow: 'Unknown',
            error: error.message
        };
    }
}

async function isSchoolDayTomorrow() {
    const tomorrowStr = getDanishDateString(1);

    // Try direct calendar check
    const icalData = await getSchoolCalendarData();
    const hasEvents = hasEventsOnDate(icalData, tomorrowStr);

    if (hasEvents !== null) {
        return hasEvents;
    }

    // Fallback to weekday detection
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
    return !isTomorrowWeekend;
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

async function getCompleteSchedule(baseSchedule, roomConfig) {
    const schoolDayTomorrow = await isSchoolDayTomorrow();
    const eveningSlot = schoolDayTomorrow ? roomConfig.schedules.earlyEvening : roomConfig.schedules.lateEvening;
    
    // If evening slot starts later than the last base schedule slot ends, extend the last slot
    // to prevent gaps (e.g., weekday Day ends 20:00, but lateEvening starts 21:00 on holiday)
    const lastSlot = baseSchedule[baseSchedule.length - 1];
    const lastSlotEnd = timeToMinutes(lastSlot.end);
    const eveningStart = timeToMinutes(eveningSlot.start);
    
    if (!schoolDayTomorrow && eveningStart > lastSlotEnd) {
        const extendedSchedule = [...baseSchedule];
        extendedSchedule[extendedSchedule.length - 1] = { ...lastSlot, end: eveningSlot.start };
        return [...extendedSchedule, eveningSlot];
    }
    
    return [...baseSchedule, eveningSlot];
}

async function getNextScheduleChange(schedule, currentSlot, roomConfig) {
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
        tomorrowSchedule = roomConfig.schedules.weekend;
    } else {
        // Check if tomorrow is a school day or holiday
        const schoolDayTomorrow = await isSchoolDayTomorrow();
        tomorrowSchedule = schoolDayTomorrow ? roomConfig.schedules.weekday : roomConfig.schedules.holiday;
    }
    
    const firstSlot = tomorrowSchedule[0];
    return `${currentSlot.end} → ${firstSlot.target}°C (${firstSlot.name})`;
}

// ============================================================================
// Display Status for Single Room
// ============================================================================

async function showRoomStatus(roomName, roomConfig) {
    const ZONE_NAME = roomConfig.zoneName;
    const roomState = getRoomState(ZONE_NAME);

    log('\n╔═══════════════════════════════════════════════════════════════╗');
    log(`║          ${roomName.toUpperCase()}'S HEATING SYSTEM - STATUS${' '.repeat(Math.max(0, 26 - roomName.length))}║`);
    log('╚═══════════════════════════════════════════════════════════════╝\n');
    // Get all devices for this zone
    const devices = await getZoneDevices(ZONE_NAME, roomConfig);
    
    if (devices.error) {
        log(`❌ Error: ${devices.error}\n`);
        return;
    }
    
    // Global variables
    log('══ TEMPERATURE SETTINGS ══');
    const baseTarget = global.get(`${ZONE_NAME}.Temperature`);
    const effectiveTarget = global.get(`${ZONE_NAME}.EffectiveTemperature`);
    const inactivityOffset = global.get(`${ZONE_NAME}.Heating.InactivityOffset`) || 0;
    const inactivityMode = roomState.inactive;
    
    // Show both base and effective if they differ
    if (effectiveTarget && effectiveTarget !== baseTarget) {
        log(`Base Target:    ${formatValue(baseTarget, '°C')}`);
        log(`Effective:      ${formatValue(effectiveTarget, '°C')} (reduced/adjusted)`);
    } else {
        log(`Target:         ${formatValue(baseTarget, '°C')}`);
    }
    
    // For smart plugs, show calculated hysteresis range
    const target = effectiveTarget || baseTarget;
    if (roomConfig.heating.type === 'smart_plug' && target) {
        const hysteresis = roomConfig.heating.hysteresis || 0.5;
        const targetLow = target - (hysteresis / 2);
        const targetHigh = target + (hysteresis / 2);
        log(`Hysteresis:    ±${(hysteresis/2).toFixed(2)}°C`);
        log(`Range:         ${targetLow.toFixed(2)}-${targetHigh.toFixed(2)}°C`);
    }
    
    // Manual Override Mode Status
    if (roomState.mode === 'manual') {
        if (roomState.modeExpires) {
            const remainingMinutes = Math.max(0, Math.ceil((roomState.modeExpires - Date.now()) / 60000));
            const overrideType = roomState.modeDetails.type;
            const originalValue = roomState.modeDetails.originalValue;

            log(`\n🤚 MANUAL OVERRIDE MODE ACTIVE 🤚`);
            log(`Remaining:      ${remainingMinutes} minutes`);
            log(`Type:           Manual ${overrideType} change detected`);
            if (overrideType === 'temperature') {
                log(`Original:       ${originalValue}°C (before manual change)`);
            } else {
                log(`Original:       ${originalValue ? 'ON' : 'OFF'} (before manual change)`);
            }
            log(`Override:       Automation paused (respecting user's manual change)`);
            log(`To cancel:      await run('${roomName}', 'cancel')`);
        }
    }
    
    // Pause Mode Status
    if (roomState.mode === 'pause') {
        if (roomState.modeExpires) {
            const remainingMinutes = Math.max(0, Math.ceil((roomState.modeExpires - Date.now()) / 60000));

            log(`\n⏸️ PAUSE MODE ACTIVE ⏸️`);
            log(`Remaining:      ${remainingMinutes} minutes`);
            log(`Override:       Heating forced OFF (all conditions ignored)`);
            if (roomConfig.heating.type === 'tado_valve') {
                log(`Mode:           TADO turned OFF`);
            } else {
                log(`Mode:           All radiators OFF`);
            }
            log(`To cancel:      await run('${roomName}', 'cancel')`);
        }
    }
    
    // Boost Mode Status
    if (roomState.mode === 'boost') {
        if (roomState.modeExpires) {
            const remainingMinutes = Math.max(0, Math.ceil((roomState.modeExpires - Date.now()) / 60000));

            log(`\n🚀 BOOST MODE ACTIVE 🚀`);
            log(`Remaining:      ${remainingMinutes} minutes`);
            log(`Override:       All schedules, windows, and rules ignored`);
            if (roomConfig.heating.type === 'tado_valve') {
                log(`Boost Temp:     25°C`);
            } else {
                log(`Mode:           All radiators ON`);
            }
            log(`To cancel:      await run('${roomName}', 'cancel')`);
        }
    }
    
    // Current Schedule Info
    const scheduleInfo = getCurrentScheduleInfo(ZONE_NAME);
    const now = getDanishLocalTime();
    const weekend = isWeekend(now);
    const schoolDay = !weekend ? (await getSchoolDayStatus()).todayIsSchoolDay : false;
    
    let baseSchedule;
    if (weekend) {
        baseSchedule = roomConfig.schedules.weekend;
    } else if (schoolDay) {
        baseSchedule = roomConfig.schedules.weekday;
    } else {
        baseSchedule = roomConfig.schedules.holiday;
    }
    
    const fullSchedule = await getCompleteSchedule(baseSchedule, roomConfig);
    const nextChange = scheduleInfo.currentSlot ? await getNextScheduleChange(fullSchedule, scheduleInfo.currentSlot, roomConfig) : null;
    if (scheduleInfo.error) {
        log(`\n⚠️  Could not determine schedule: ${scheduleInfo.error}`);
    } else {
        log(`\n══ CURRENT SCHEDULE ══`);
        log(`Schedule:       ${scheduleInfo.scheduleType}`);
        log(`Time:           ${scheduleInfo.time}`);
        log(`Period:         ${scheduleInfo.currentSlot.start}-${scheduleInfo.currentSlot.end} (${scheduleInfo.currentSlot.name})`);
        log(`Base Target:    ${scheduleInfo.currentSlot.target}°C`);
        
        // Inactivity settings (show effective values and sources)
        const effectiveOffset = scheduleInfo.currentSlot.inactivityOffset !== undefined ?
            scheduleInfo.currentSlot.inactivityOffset : (roomConfig.settings.inactivityOffset || 0);
        const offsetSource = scheduleInfo.currentSlot.inactivityOffset !== undefined ? 'slot' : 'room';
        
        if (effectiveOffset > 0) {
            const effectiveTimeout = scheduleInfo.currentSlot.inactivityTimeout || roomConfig.settings.inactivityTimeout;
            const timeoutSource = scheduleInfo.currentSlot.inactivityTimeout ? 'slot' : 'room';
            log(`Inactivity:     -${effectiveOffset}°C (${offsetSource}) after ${effectiveTimeout} min (${timeoutSource})`);
        } else {
            log(`Inactivity:     No offset in this period`);
        }
        
        // Window settings (show effective values and sources)
        const effectiveWindowOpen = scheduleInfo.currentSlot.windowOpenTimeout || roomConfig.settings.windowOpenTimeout;
        const windowOpenSource = scheduleInfo.currentSlot.windowOpenTimeout ? 'slot' : 'room';
        const effectiveWindowClosed = scheduleInfo.currentSlot.windowClosedDelay || roomConfig.settings.windowClosedDelay || 600;
        const windowClosedSource = scheduleInfo.currentSlot.windowClosedDelay ? 'slot' : 'room';
        
        log(`Window Open:    ${effectiveWindowOpen} sec timeout (${windowOpenSource})`);
        log(`Window Closed:  ${Math.floor(effectiveWindowClosed/60)} min settle delay (${windowClosedSource})`);
        
        // Show next schedule change
        if (nextChange) {
            log(`\n══ NEXT SCHEDULE CHANGE ══`);
            log(`Next Change:    ${nextChange}`);
        }
    }
    
    // Current Status
    log('\n══ CURRENT STATUS ══');
    
    // Room Temperature
    if (devices.tempSensor) {
        try {
            const roomTemp = devices.tempSensor.capabilitiesObj.measure_temperature.value;
            log(`Room Temp:      ${formatValue(roomTemp, '°C')}`);
            
            if (roomTemp && target) {
                const deviation = roomTemp - target;
                log(`Deviation:      ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}°C from target`);
                
                // For smart plugs, show if within hysteresis range
                if (roomConfig.heating.type === 'smart_plug') {
                    const hysteresis = roomConfig.heating.hysteresis || 0.5;
                    const targetLow = target - (hysteresis / 2);
                    const targetHigh = target + (hysteresis / 2);
                    const withinRange = roomTemp >= targetLow && roomTemp <= targetHigh;
                    log(`Within range:   ${withinRange ? '✓ YES' : '✗ NO'}`);
                }
            }
        } catch (error) {
            log(`Room Temp:      Error - ${error.message}`);
        }
    } else {
        log(`Room Temp:      No temperature sensor found in zone`);
    }
    
    // Window Status
    if (devices.windowSensors.length > 0) {
        try {
            const anyWindowOpen = devices.windowSensors.some(w => w.capabilitiesObj.alarm_contact.value);
            
            if (anyWindowOpen) {
                if (roomState.window.openSince) {
                    const secondsOpen = Math.floor((Date.now() - roomState.window.openSince) / 1000);
                    log(`Window:         🔴 OPEN (${secondsOpen}s)`);
                } else {
                    log(`Window:         🔴 OPEN`);
                }
            } else {
                // Check if we're in the settle delay period (but not during boost/pause modes)
                const isOverrideMode = roomState.mode === 'boost' || roomState.mode === 'pause';
                if (roomState.window.closedSince && !isOverrideMode) {
                    const windowClosedDelay = roomConfig.settings.windowClosedDelay || 600;
                    const secondsSinceClosed = Math.floor((Date.now() - roomState.window.closedSince) / 1000);
                    const remainingSeconds = Math.max(0, windowClosedDelay - secondsSinceClosed);
                    const remainingMinutes = Math.floor(remainingSeconds / 60);
                    const remainingSecs = remainingSeconds % 60;
                    log(`Window:         🟢 CLOSED`);
                    log(`Air Settle:     ⏳ WAITING (${remainingMinutes}m ${remainingSecs}s remaining)`);
                } else {
                    log(`Window:         🟢 CLOSED`);
                }
            }
        } catch (error) {
            log(`Window:         Error - ${error.message}`);
        }
    } else {
        log(`Window:         No window sensors found in zone`);
    }
    
    // Heating Status
    if (devices.heatingDevices.length > 0) {
        try {
            if (roomConfig.heating.type === 'smart_plug') {
                // Check if any radiator is on
                const anyOn = devices.heatingDevices.some(r => r.capabilitiesObj.onoff.value);
                log(`Heating:        ${anyOn ? '🔥 ON' : '❄️ OFF'}`);
            } else if (roomConfig.heating.type === 'tado_valve') {
                const tado = devices.heatingDevices[0];
                const targetTemp = tado.capabilitiesObj.target_temperature?.value;
                const heatingPower = tado.capabilitiesObj.tado_heating_power?.value || 0;
                
                log(`TADO Target:    ${formatValue(targetTemp, '°C')}`);
                log(`Heating Power:  ${heatingPower}%`);
                log(`Status:         ${heatingPower > 0 ? '🔥 HEATING' : '❄️ IDLE'}`);
            }
        } catch (error) {
            log(`Heating:        Error - ${error.message}`);
        }
    } else {
        log(`Heating:        No heating devices found`);
    }
    
    // Devices Table
    log('\n══ DEVICES ══');
    
    if (devices.tempSensor) {
        log(`Temperature:    ${devices.tempSensor.name}`);
    } else {
        log(`Temperature:    None found`);
    }
    
    if (devices.motionSensor) {
        log(`Motion:         ${devices.motionSensor.name}`);
    } else {
        log(`Motion:         None found`);
    }
    
    if (devices.windowSensors.length > 0) {
        if (devices.windowSensors.length === 1) {
            log(`Window:         ${devices.windowSensors[0].name}`);
        } else {
            log(`Windows:        ${devices.windowSensors.length} sensors`);
            devices.windowSensors.forEach(w => {
                log(`                - ${w.name}`);
            });
        }
    } else {
        log(`Window:         None found`);
    }
    
    if (devices.heatingDevices.length > 0) {
        if (roomConfig.heating.type === 'smart_plug') {
            if (devices.heatingDevices.length === 1) {
                const isOn = devices.heatingDevices[0].capabilitiesObj.onoff.value;
                log(`Heating:        ${devices.heatingDevices[0].name} (${isOn ? '🔥 ON' : '❄️ OFF'})`);
            } else {
                log(`Heating:        ${devices.heatingDevices.length} radiators`);
                devices.heatingDevices.forEach(h => {
                    const isOn = h.capabilitiesObj.onoff.value;
                    log(`                - ${h.name} (${isOn ? '🔥 ON' : '❄️ OFF'})`);
                });
            }
        } else if (roomConfig.heating.type === 'tado_valve') {
            log(`Heating:        ${devices.heatingDevices[0].name}`);
        }
    } else {
        log(`Heating:        None found`);
    }
    
    // Zone Activity & Inactivity Status
    try {
        const zone = devices.zone;
        const isActive = zone.active;
        
        // Get current time in Danish timezone for accurate calculation
        const now = getDanishLocalTime();
        
        // zone.activeLastUpdated is a UTC timestamp - convert to Danish time for display
        const lastActiveTimeUTC = new Date(zone.activeLastUpdated);
        const lastActiveTimeDK = new Date(lastActiveTimeUTC.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
        const minutesSinceActive = Math.floor((now - lastActiveTimeDK) / 60000);
        
        log(`\n══ ACTIVITY & INACTIVITY ══`);
        log(`Activity:       ${isActive ? '✅ ACTIVE NOW' : `💤 Inactive for ${minutesSinceActive} min`}`);
        log(`Last Active:    ${lastActiveTimeDK.toLocaleString('da-DK')}`);
        
        // Inactivity mode status (temperature reduction)
        if (inactivityMode) {
            log(`Temp Reduced:   💤 YES (target lowered due to inactivity)`);
        } else {
            log(`Temp Reduced:   ✓ NO (normal target)`);
        }
        
    } catch (error) {
        log(`\n══ ACTIVITY & INACTIVITY ══`);
        log(`Error:         ${error.message}`);
    }
    
    // Window Settings (new section)
    log('\n══ WINDOW SETTINGS ══');
    log(`Open Timeout:   ${roomConfig.settings.windowOpenTimeout} sec (heating off after window open this long)`);
    log(`Closed Delay:   ${roomConfig.settings.windowClosedDelay || 600} sec (${Math.floor((roomConfig.settings.windowClosedDelay || 600) / 60)} min air settle time)`);
    
    // Device Queue Status (Command Verification System)
    log('\n══ DEVICE QUEUE STATUS ══');
    
    if (devices.heatingDevices.length > 0) {
        let anyDeviceBusy = false;
        let totalQueueItems = 0;
        
        for (const device of devices.heatingDevices) {
            const state = getDeviceState(ZONE_NAME, device.id);
            
            if (state) {
                const deviceName = device.name.length > 20 ? device.name.substring(0, 17) + '...' : device.name;
                const statusIcon = {
                    'idle': '✓',
                    'sending': '📤',
                    'verifying': '🔍',
                    'failed': '❌'
                }[state.status] || '?';
                
                log(`${deviceName}:`);
                log(`  Status:       ${statusIcon} ${state.status.toUpperCase()}`);
                
                if (state.command) {
                    const age = Math.floor((Date.now() - state.command.timestamp) / 1000);
                    log(`  Command:      ${state.command.type} = ${state.command.value} (${age}s ago)`);
                    anyDeviceBusy = true;
                }
                
                if (state.queue && state.queue.length > 0) {
                    log(`  Queue:        ${state.queue.length} command(s) waiting`);
                    totalQueueItems += state.queue.length;
                    
                    // Show first 3 queued commands
                    state.queue.slice(0, 3).forEach((cmd, idx) => {
                        const age = Math.floor((Date.now() - cmd.timestamp) / 1000);
                        const sessionShort = cmd.sessionId.substr(8, 12);
                        log(`    ${idx + 1}. ${cmd.type} = ${cmd.value} (${age}s, ${sessionShort})`);
                    });
                    
                    if (state.queue.length > 3) {
                        log(`    ... and ${state.queue.length - 3} more`);
                    }
                } else {
                    log(`  Queue:        Empty`);
                }
                
                if (state.lastVerified) {
                    const since = Math.floor((Date.now() - state.lastVerified) / 1000);
                    log(`  Last OK:      ${since}s ago`);
                }
                
                if (state.lastError) {
                    log(`  Last Error:   ${state.lastError}`);
                }
            } else {
                log(`${device.name}:`);
                log(`  Status:       ✓ No state (idle)`);
            }
        }
        
        if (anyDeviceBusy) {
            log(`\n⚠️  ${devices.heatingDevices.length > 1 ? 'Devices are' : 'Device is'} being controlled - manual detection paused`);
        }
        
        if (totalQueueItems > 0) {
            log(`\n📋 Total queued: ${totalQueueItems} command(s) from concurrent sessions`);
        }
    } else {
        log(`No heating devices found`);
    }
    
    // Diagnostics
    log('\n══ DIAGNOSTICS ══');
    
    const lastUpdate = global.get(`${ZONE_NAME}.Heating.LastUpdate`);
    const lastAction = global.get(`${ZONE_NAME}.Heating.LastAction`);
    
    log(`Last update:    ${formatValue(lastUpdate)}`);
    log(`Last action:    ${formatValue(lastAction)}`);
    
    const diagnostikLog = global.get(`${ZONE_NAME}.Heating.DiagnostikLog`);
    if (diagnostikLog) {
        const lines = diagnostikLog.split('\n').filter(l => l.length > 0);
        log(`Log entries:    ${lines.length}`);
        
        if (lines.length > 0) {
            log('\nLatest 10 log entries:');
            const recent = lines.slice(-10);
            recent.forEach(line => {
                const parts = line.split('|');
                // New format: DateTime|RoomTemp|Target|HeatingStatus|WindowStatus|Action
                if (parts.length >= 6) {
                    log(`  ${parts[0]} | Temp: ${parts[1]}°C | Target: ${parts[2]}°C | Heat: ${parts[3]} | Window: ${parts[4]} | ${parts[5]}`);
                }
            });
        }
    } else {
        log(`Log entries:    0 (no data)`);
    }
}

// ============================================================================
// Main Execution - Show All Rooms
// ============================================================================

log('\n');
log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          HEATING SYSTEM - ALL ROOMS STATUS                   ║');
log('╚═══════════════════════════════════════════════════════════════╝');

// Global Heating Enabled Status (from Homey Logic variable)
log('\n══ GLOBAL HEATING STATUS ══');
try {
    const variables = await Homey.logic.getVariables();
    let heatingEnabledVar = null;
    
    for (const [id, variable] of Object.entries(variables)) {
        if (variable.name === 'HeatingEnabled') {
            heatingEnabledVar = variable;
            break;
        }
    }
    
    if (heatingEnabledVar) {
        const isEnabled = heatingEnabledVar.value;
        if (isEnabled === false) {
            log(`Status:        ⏸️  DISABLED`);
            log(`Note:          Heating control is globally turned off`);
        } else if (isEnabled === true) {
            log(`Status:        ✅ ENABLED`);
        } else {
            log(`Status:        ⚠️  UNKNOWN VALUE (${isEnabled})`);
        }
    } else {
        log(`Status:        ⚠️  NOT FOUND`);
        log(`Note:          Create HeatingEnabled Logic variable (Yes/No) to control heating`);
    }
} catch (error) {
    log(`Status:        ⚠️  ERROR`);
    log(`Error:         ${error.message}`);
    log(`Note:          Create HeatingEnabled Logic variable (Yes/No) in Homey settings`);
}

// TADO Home Status (shared across all rooms)
try {
    const tadoHome = await Homey.devices.getDevice({ id: TADO_HOME_ID });
    const presenceMode = tadoHome.capabilitiesObj.tado_presence_mode.value;
    const isAnyoneHome = tadoHome.capabilitiesObj.tado_is_anyone_home.value;
    
    log('\n══ TADO HOME STATUS (GLOBAL) ══');
    log(`TADO Mode:     ${presenceMode === 'away' ? '🏠 AWAY' : '✅ HOME'} (${presenceMode})`);
    log(`Anyone home:   ${isAnyoneHome ? 'YES' : 'NO'}`);
} catch (error) {
    log('\n══ TADO HOME STATUS (GLOBAL) ══');
    log(`TADO:          Error - ${error.message}`);
}

// School Day Status (shared)
log('\n══ SCHOOL DAY INFO (GLOBAL) ══');
try {
    const schoolStatus = await getSchoolDayStatus();
    
    if (schoolStatus.error) {
        log(`Error:         ${schoolStatus.error}`);
    } else {
        const todayIcon = schoolStatus.todayIsSchoolDay ? '📚' : '🏖️';
        const tomorrowIcon = schoolStatus.tomorrowIsSchoolDay ? '📚' : '🏖️';
        
        log(`Today:         ${todayIcon} ${schoolStatus.today}`);
        log(`Tomorrow:      ${tomorrowIcon} ${schoolStatus.tomorrow}`);
    }

    // Cache Info
    const cacheTime = global.get('SchoolCalendar.CacheTime');
    const cachedData = global.get('SchoolCalendar.Data');
    
    if (cacheTime) {
        const ageMinutes = Math.floor((Date.now() - cacheTime) / 60000);
        log(`Cache Age:     ${ageMinutes} minutes ago`);
    } else {
        log(`Cache Age:     N/A (No cache time)`);
    }
    
    if (cachedData) {
        log(`Data Size:     ${cachedData.length} chars`);
    } else {
        log(`Data Size:     0 (No data)`);
    }
} catch (error) {
    log(`School Day:    Error - ${error.message}`);
}

// Show status for each room
for (const [roomName, roomConfig] of Object.entries(ROOMS)) {
    await showRoomStatus(roomName, roomConfig);
}

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          END OF STATUS REPORT                                 ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');