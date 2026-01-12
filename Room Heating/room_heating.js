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
 *   await run('Clara', 'cancel')  // Cancel active boost or pause
 *
 * Or in Advanced Flow:
 *   Use "Run a script" action with argument:
 *   - "Clara"          → Normal heating
 *   - "clara, boost"   → Boost mode - max heat for 1 hour (comma-separated)
 *   - "clara, pause"   → Pause mode - force OFF for 1 hour (comma-separated)
 *   - "Clara, cancel"  → Cancel boost or pause
 * 
 * Features:
 * - Single script for ALL rooms
 * - Configure all rooms in ROOMS object
 * - Pass room name as argument to select which room
 * - Auto-detects sensors via zones
 * - Supports both smart_plug and tado_valve
 * - Target-based temperature control with automatic hysteresis
 * 
 * Author: Henrik Skovgaard
 * Version: 10.5.0
 * Created: 2025-12-31
 * Based on: Clara Heating v6.4.6
 *
 * 10.5.0 (2026-01-12) - ⏸️ Add pause heating mode (opposite of boost)
 *   - New "pause" argument: run('Clara', 'pause') forces heating OFF for 60 minutes
 *   - Smart plugs: Turn off all radiators, ignore all conditions
 *   - TADO valves: Turn completely OFF (onoff = false)
 *   - Ignores temperature, schedule, window, inactivity, away mode during pause
 *   - Latest call wins: pause cancels boost, boost cancels pause (mutually exclusive)
 *   - Cancel command now cancels both boost and pause modes
 *   - Automatic revert to schedule after 60 minutes
 *   - New global vars: PauseMode, PauseStartTime, PauseDuration
 *   - Notifications when pause starts, ends, and is active
 *   - New functions: activatePauseMode(), cancelPauseMode(), checkPauseMode(), controlHeatingPause()
 * 10.4.4 (2026-01-09) - 🐛 Fix next schedule showing wrong day type
 *   - getNextScheduleChange() now correctly determines tomorrow's schedule type
 *   - Friday evening no longer shows "School" when Saturday uses weekend schedule
 *   - Properly checks if tomorrow is weekend/school day/holiday
 *   - Shows actual first period from tomorrow's schedule, not today's
 *   - Example: Friday 20:27 now shows "Night" (weekend) not "School" (weekday)
 * 10.4.3 (2026-01-08) - 🔧 Fix Flow argument parsing
 *   - Homey Flows pass "Clara, boost" as single string (not separate args)
 *   - Script now splits comma-separated arguments automatically
 *   - Works with both: Flow "Clara, boost" and HomeyScript run('Clara', 'boost')
 *   - Example Flow input: "Clara, boost" or "oliver, cancel" (case-insensitive)
 * 10.4.2 (2026-01-08) - 🔧 Make room names case-insensitive
 *   - Can now use 'clara' or 'Clara', 'oliver' or 'Oliver'  
 *   - Fixes "Unknown room" error when using lowercase names
 *   - Example: run('clara', 'boost') works same as run('Clara', 'boost')
 * 10.4.1 (2026-01-08) - 🛑 Add cancel boost function
 *   - New "cancel" argument: run('Clara', 'cancel') cancels active boost
 *   - Immediately clears boost mode and resumes schedule
 *   - Notification sent when boost is cancelled
 *   - Works even if boost not active (safe to call anytime)
 * Version History:
 * 10.4.0 (2026-01-08) - 🚀 Add boost heating mode
 *   - New "boost" argument: run('Clara', 'boost') activates boost for 60 minutes  
 *   - Smart plugs: Turn on all radiators, ignore schedule and hysteresis
 *   - TADO valves: Set to 25°C boost temperature
 *   - Ignores window open, inactivity, away mode during boost
 *   - Automatic revert to schedule after 60 minutes
 *   - New global vars: BoostMode, BoostStartTime, BoostDuration
 *   - Notifications when boost starts and ends
 * 10.3.11 (2026-01-08) - ⏳ Add window closed delay for air to settle
 *   - New setting: windowClosedDelay (seconds, default 600 = 10 minutes)
 *   - After window closes, heating waits before resuming
 *   - Allows air to mix and settle for accurate temperature reading
 *   - Prevents heating from working harder due to cold air near sensor
 *   - New global var: WindowClosedTime tracks when window was closed
 *   - New action: 'window_closed_waiting' during settle period
 *   - Notification shows "Window closed • Waiting Xmin" then "Air settled • Heat resumed"
 * 10.3.10 (2026-01-05) - 📱 Fix snowflake icon appearing when TADO is IDLE
 *   - Snowflake (❄️) now only shows when heating is OFF, not IDLE
 *   - IDLE is normal for TADO - means valve is on but not actively heating
 *   - "OFF" = heating completely turned off (e.g., window open)
 *   - "IDLE" = heating ready but room at target (no icon needed)
 * 10.3.9 (2026-01-03) - 🛠️ CRITICAL FIX: Double checkInactivity() call caused wrong notification target
 *   - checkInactivity() was called twice: once in controlHeating(), once before notification
 *   - Between calls, zone could become active (e.g., person closing window)
 *   - Second call returned different results, causing notification to show wrong target
 *   - Example: TADO set to 20°C (with inactivity), but notification showed 21°C (no inactivity)
 *   - Fix: Use stored EffectiveTemperature and InactivityMode flag instead of rechecking
 *   - "IDLE" = heating ready but room at target (no icon needed)
 * 10.3.8 (2026-01-03) - 📱 Changed window icon to wind icon
 *   - Changed open window icon from 🪟 to 💨 (wind/draft)
 *   - More intuitive - immediately suggests "air coming in from outside"
 *   - Icons: 💨=window open, 💤=inactive, ❄️=heating off, 🚶=away mode
 * 10.3.7 (2026-01-03) - 📱 Remove redundant temperature comparisons from notifications
 *   - Removed "21.9 > 20.75°C" and "19.7 < 20.5°C" from heat on/off messages
 *   - Temperature comparison is redundant (already shown in status: 🌡️21.9→20.5°C)
 *   - "Heat on • 19.7 < 20.5°C" → "Heat on"
 *   - "Heat off • 21.9 > 20.75°C" → "Heat off"
 *   - "Inactive (20min) • -2°C → 20.5°C • Heat off • 21.9 > 20.75°C" → "Inactive (20min) • -2°C → 20.5°C • Heat off"
 * 10.3.6 (2026-01-03) - 📱 Condensed change descriptions (Option 2 - More Condensed)
 *   - "Window opened • Heating turned off (open 75 sec)" → "Window (75s) • Heat off"
 *   - "Schedule changed to 06:00-20:00 • Target: 20°C → 22.5°C" → "Schedule 06:00-20:00 • 20→22.5°C"
 *   - "No activity detected (20+ min) • Target reduced by 2°C to 20.5°C" → "Inactive (20min) • -2°C → 20.5°C"
 *   - "Activity detected - resumed • Target restored to 22.5°C" → "Active • → 22.5°C"
 *   - "Nobody home detected (TADO) • Minimum temperature set: 18°C" → "Away • Min 18°C"
 *   - "Someone arrived home (TADO)" → "Home"
 *   - All messages now more compact while remaining clear
 * 10.3.5 (2026-01-03) - 📱 Use walking person icon for away mode (matches TADO app)
 *   - Changed away mode icon from 🏠 to 🚶 (walking person)
 *   - Matches TADO app's own away mode symbol
 *   - Icons: 💨=window open, 💤=inactive, ❄️=heating off, 🚶=away mode
 * 10.3.4 (2026-01-03) - 📱 Icon-only alerts - removed all text after icons
 *   - Icons are now standalone, self-explanatory symbols
 *   - 💨 = window open
 *   - 💤 = room inactive
 *   - ❄️ = heating off
 *   - 🚶 = away mode
 *   - Ultra-clean, minimal notification format
 * 10.3.3 (2026-01-03) - 📱 Condensed notifications - only show alert icons
 *   - Window icon only shown when OPEN (not when closed)
 *   - Inactive icon only shown when room IS inactive (not when active)
 *   - Heating icon only shown when NOT heating (OFF/IDLE, not when ON/HEATING)
 *   - House icon only shown when in AWAY mode (not when HOME)
 *   - Result: Normal operation shows just temperature, alerts show relevant icons
 * 10.3.2 (2026-01-03) - 📱 Compact notification format with icons
 *   - Notifications now much more compact (3-4 lines vs 8-10 lines)
 *   - Temperature display: "22.3→20°C" instead of separate lines
 *   - Window: ✓ (closed) or ✗ (open) - removed redundant status text
 *   - Inactivity: ✗ (active) or ✓ (inactive/sleeping)
 *   - Heating: 🔥 for ON/HEATING, ❄️ for OFF/IDLE
 *   - Added next schedule change time with target and period name
 *   - All status on single line with icons for quick scanning
 * 10.3.1 (2026-01-02) - 📝 Add specific 'window_closed' action when window closes
 * 10.3.0 (2026-01-02) - 🛠️ CRITICAL: Fix missing log entries when window closes
 * 10.2.9 (2026-01-02) - 📝 Fix inconsistent action logging between TADO and smart plugs
 * 10.2.8 (2026-01-02) - 🔥 CRITICAL: Stop sending unnecessary commands to TADO!
 * 10.2.7 (2026-01-02) - 🛠️ CRITICAL FIX: effectiveTarget was undefined in logDiagnostics!
 * 10.2.6 (2026-01-02) - 🕐 Fix DST timezone bug in getDanishLocalTime()
 * 10.2.5 (2026-01-02) - 🛠️ Fix false schedule change notifications
 * 10.2.4 (2026-01-02) - 📝 Fix diagnostic log to track effectiveTarget instead of slot.target (BROKEN!)
 * 10.2.3 (2026-01-02) - 🪟 Add notification when window closes
 * 10.2.2 (2026-01-02) - 🛠️ Fix confusing notifications when window open
 * 10.2.1 (2026-01-02) - 🛠️ Fix window timeout flag reset when heating still on
 * 10.2.0 (2026-01-02) - 🔥 Use TADO onoff capability to turn off properly (BREAKING CHANGE)
 * 10.1.6 (2026-01-02) - 🔥 TADO window handling: Turn OFF instead of reducing temp
 * 10.1.5 (2026-01-02) - 🛠️ Fix TADO window handling and notification status
 * 10.1.4 (2025-12-31) - 🔧 Revert to getVariables() method - the working approach
 * 10.1.3 (2025-12-31) - 🔧 Consistent Logic variable access across all functions (BROKEN)
 * 10.1.2 (2025-12-31) - 🔧 Fix to use Homey's built-in Logic variables (not Better Logic)
 * 10.1.1 (2025-12-31) - 🔧 Fix HeatingEnabled to use Logic variable (not global script variable)
 * 10.1.0 (2025-12-31) - 🎚️ Global heating control via HeatingEnabled variable
 * 10.0.1 (2025-12-31) - 🛠️ Fix excessive window logging and notifications
 * 10.0.0 (2025-12-31) - 🔧 Configuration via global variables (BREAKING CHANGE)
 * 9.0.0 (2025-12-31) - 🎯 Per-room schedules and settings (BREAKING CHANGE)
 * 8.0.1 (2025-12-31) - 🛠️ Fix excessive logging bug
 * 8.0.0 (2025-12-31) - 🎯 Target-based temperature control (BREAKING CHANGE)
 *   - Schedules now use single "target" temperature instead of low/high
 *   - Smart plugs automatically calculate hysteresis range (±0.25°C default)
 *   - TADO valves use target directly - handles heating power automatically
 *   - Clearer configuration: "I want 22.5°C" not "low 22.25, high 22.75"
 *   - Per-room hysteresis setting for smart plugs
 *   - TADO always gets correct target (not away temp when just off)
 *   - Simplified inactivity/away logic: target - offset
 *   - Global vars: Temperature (target), TemperatureLow/High (calculated for smart plugs)
 * 7.1.0 (2025-12-31) - 🎯 Multi-room support with argument selection
 * 7.0.0 (2025-12-31) - 🌟 Zone-based generic implementation
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
    roomArgRaw = args?.[0] || 'Oliver';
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
    
    if (!schoolDayTomorrow && eveningSlot.start === '22:00') {
        const extendedSchedule = [...baseSchedule];
        const lastSlot = extendedSchedule[extendedSchedule.length - 1];
        extendedSchedule[extendedSchedule.length - 1] = { ...lastSlot, end: '22:00' };
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
    
    if (boostCancelled || pauseCancelled) {
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
// Zone-Based Device Functions
// ============================================================================

async function getZoneByName(zoneName) {
    const zones = await Homey.zones.getZones();
    return Object.values(zones).find(z => z.name === zoneName);
}

async function getRoomTemperature() {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (!zone) {
            log(`❌ Zone "${ROOM.zoneName}" not found`);
            return null;
        }
        
        const devices = await Homey.devices.getDevices();
        const zoneDevices = Object.values(devices).filter(d => d.zone === zone.id);
        
        const tempSensor = zoneDevices.find(d => d.capabilitiesObj?.measure_temperature);
        
        if (!tempSensor) {
            log(`❌ No temperature sensor found in zone "${ROOM.zoneName}"`);
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
        
        const devices = await Homey.devices.getDevices();
        const zoneDevices = Object.values(devices).filter(d => d.zone === zone.id);
        
        // Check if ANY contact alarm in zone is active
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
            } else {
                // Turn off completely - but only if needed!
                if (currentOnOff !== false) {
                    await device.setCapabilityValue('onoff', false);
                    log(`🔥 TADO turned OFF`);
                    changed = true;
                } else {
                    log(`✓ TADO already OFF - no change needed`);
                }
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

async function checkInactivity(inactivityOffset) {
    try {
        const zone = await getZoneByName(ROOM.zoneName);
        if (!zone) {
            log(`⚠️  Zone "${ROOM.zoneName}" not found`);
            return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
        }
        
        // If offset=0, clear flag and return inactive=false
        if (inactivityOffset === 0) {
            const wasInactive = global.get(`${ROOM.zoneName}.Heating.InactivityMode`);
            if (wasInactive) {
                global.set(`${ROOM.zoneName}.Heating.InactivityMode`, false);
                log(`ℹ️  Inactivity mode cleared (offset = 0 in this period)`);
            }
            return { inactive: false, wasInactive: false, minutesSinceMotion: 0 };
        }
        
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
        
        if (minutesSinceActive >= ROOM.settings.inactivityTimeout) {
            const wasInactive = global.get(`${ROOM.zoneName}.Heating.InactivityMode`);
            
            if (!wasInactive) {
                global.set(`${ROOM.zoneName}.Heating.InactivityMode`, true);
                log(`💤 Zone inactive for ${Math.floor(minutesSinceActive)} minutes`);
                return { inactive: true, wasInactive: false, minutesSinceMotion: Math.floor(minutesSinceActive) };
            }
            
            return { inactive: true, wasInactive: true, minutesSinceMotion: Math.floor(minutesSinceActive) };
        }
        
        return { inactive: false, wasInactive: false, minutesSinceMotion: Math.floor(minutesSinceActive) };
        
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

async function controlHeating(roomTemp, slot, windowOpen, inactivityOffset) {
    const heatingOn = await getHeatingStatus();
    const tadoAway = await isTadoAway();
    const inactivity = await checkInactivity(inactivityOffset);
    const wasInTadoAway = global.get(`${ROOM.zoneName}.Heating.TadoAwayActive`);
    
    // Calculate effective target temperature
    let effectiveTarget = slot.target;
    
    log(`\n--- HEATING CONTROL ---`);
    log(`Room: ${roomTemp}°C | Base Target: ${slot.target}°C`);
    log(`Window: ${windowOpen ? 'OPEN' : 'CLOSED'}`);
    log(`TADO Away mode: ${tadoAway ? 'YES (nobody home)' : 'NO (someone home)'}`);
    log(`Inactivity: ${inactivity.inactive ? `YES (${inactivity.minutesSinceMotion} min since activity)` : `NO (${inactivity.minutesSinceMotion} min since activity)`} | Offset: ${inactivityOffset}°C`);
    log(`Heating: ${heatingOn ? 'ON' : 'OFF'}`);
    
    // TADO Away Mode
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
    const windowClosedDelay = ROOM.settings.windowClosedDelay || 600;  // Default 10 minutes
    
    if (windowOpen) {
        // Clear any window closed delay if window opens again
        if (windowClosedTime) {
            global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, null);
            log(`ℹ️  Window opened again - cleared settle delay`);
        }
        
        if (!windowOpenTime) {
            global.set(`${ROOM.zoneName}.Heating.WindowOpenTime`, Date.now());
            global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, false);
            log(`⏱️  Window opened - starting ${ROOM.settings.windowOpenTimeout} sec timeout`);
        } else {
            const secondsOpen = (Date.now() - windowOpenTime) / 1000;
            if (secondsOpen >= ROOM.settings.windowOpenTimeout) {
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
                log(`ℹ️  Window open for ${Math.floor(secondsOpen)} sec (timeout: ${ROOM.settings.windowOpenTimeout} sec)`);
            }
        }
    } else {
        // Window is closed
        if (windowOpenTime) {
            // Window just closed - start the settle delay
            global.set(`${ROOM.zoneName}.Heating.WindowClosedTime`, Date.now());
            global.set(`${ROOM.zoneName}.Heating.WindowOpenTime`, null);
            global.set(`${ROOM.zoneName}.Heating.WindowTimeoutHandled`, false);
            
            const delayMinutes = Math.floor(windowClosedDelay / 60);
            addChange("Window closed");
            addChange(`Waiting ${delayMinutes}min`);
            log(`✓ Window closed - waiting ${delayMinutes} min for air to settle`);
            
            return 'window_closed_waiting';
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
                addChange("Air settled");
                addChange("Heat resumed");
                log(`✓ Air settle delay complete - resuming heating`);
                
                // For TADO, turn on and set target
                if (ROOM.heating.type === 'tado_valve') {
                    await setHeating(true, effectiveTarget);
                    log(`🔥 TADO resumed - target set to ${effectiveTarget}°C`);
                }
                // For smart plugs, let the hysteresis logic below handle it
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
    if (!windowOpen || (windowOpenTime && (Date.now() - windowOpenTime) / 1000 < ROOM.settings.windowOpenTimeout)) {
        
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
        const inactivity = await checkInactivity(slot.inactivityOffset || 0);
        
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
// Override Mode Check (Boost & Pause)
// ============================================================================

// Handle cancel request first - cancels both boost and pause
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

// Activate pause if requested (latest call wins - cancel any active boost)
if (requestPause) {
    const boostWasActive = global.get(`${ROOM.zoneName}.Heating.BoostMode`);
    if (boostWasActive) {
        log(`\n🔄 Cancelling active boost to activate pause...`);
        cancelBoostMode();
    }
    activatePauseMode();
}

// Activate boost if requested (latest call wins - cancel any active pause)
if (requestBoost) {
    const pauseWasActive = global.get(`${ROOM.zoneName}.Heating.PauseMode`);
    if (pauseWasActive) {
        log(`\n🔄 Cancelling active pause to activate boost...`);
        cancelPauseMode();
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

// Store target temperature in global variables
const previousTarget = global.get(`${ROOM.zoneName}.Temperature`);

global.set(`${ROOM.zoneName}.Temperature`, currentSlot.target);
global.set(`${ROOM.zoneName}.Heating.InactivityOffset`, currentSlot.inactivityOffset || 0);

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
const action = await controlHeating(roomTemp, currentSlot, windowOpen, currentSlot.inactivityOffset);

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