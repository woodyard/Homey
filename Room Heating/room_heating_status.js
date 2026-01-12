/**
 * Generic Room Heating Status (Zone-Based, Multi-Room)
 * 
 * Shows current status for ALL configured rooms.
 * Just run the script - it loops through all rooms in ROOMS config.
 * 
 * Author: Henrik Skovgaard
 * Version: 4.5.0
 * Created: 2025-12-31
 * Based on: Clara Status v2.8.0
 *
 * Version History:
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
    
    if (!roomsJson) {
        throw new Error('❌ Configuration not found! Please run room-heating-config.js first to save configuration.');
    }
    
    return JSON.parse(roomsJson);
}

// Load configuration
const ROOMS = loadConfiguration();


// ============================================================================
// Global Configuration
// ============================================================================

const TADO_HOME_ID = 'acc819ec-fc88-4e8c-b98b-5de8bb97d91c';
const HOMEY_LOGIC_SCHOOLDAY_VAR = 'IsSchoolDay';
const HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR = 'IsSchoolDayTomorrow';

// ============================================================================
// Zone-Based Device Functions
// ============================================================================

async function getZoneByName(zoneName) {
    const zones = await Homey.zones.getZones();
    return Object.values(zones).find(z => z.name === zoneName);
}

async function getZoneDevices(zoneName, heatingDeviceIds) {
    try {
        const zone = await getZoneByName(zoneName);
        if (!zone) {
            return { error: `Zone "${zoneName}" not found` };
        }
        
        const allDevices = await Homey.devices.getDevices();
        const zoneDevices = Object.values(allDevices).filter(d => d.zone === zone.id);
        
        return {
            zone: zone,
            tempSensor: zoneDevices.find(d => d.capabilitiesObj?.measure_temperature),
            motionSensor: zoneDevices.find(d => d.capabilitiesObj?.alarm_motion),
            windowSensors: zoneDevices.filter(d => d.capabilitiesObj?.alarm_contact),
            heatingDevices: zoneDevices.filter(d => heatingDeviceIds.includes(d.id))
        };
    } catch (error) {
        return { error: error.message };
    }
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
        
        return {
            scheduleType: scheduleType,
            currentSlot: {
                start: currentPeriod.split('-')[0],
                end: currentPeriod.split('-')[1],
                name: periodName,
                target: target,
                inactivityOffset: inactivityOffset
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

async function getSchoolDayStatus() {
    try {
        const variables = await Homey.logic.getVariables();
        
        let isSchoolDayToday = null;
        let isSchoolDayTomorrow = null;
        
        for (const varId in variables) {
            const variable = variables[varId];
            if (variable.name === HOMEY_LOGIC_SCHOOLDAY_VAR) {
                isSchoolDayToday = variable.value;
            }
            if (variable.name === HOMEY_LOGIC_SCHOOLDAY_TOMORROW_VAR) {
                isSchoolDayTomorrow = variable.value;
            }
        }
        
        const today = getDanishLocalTime();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
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
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
            return !isTomorrowWeekend;
        }
        
        return schoolDayVariable.value;
        
    } catch (error) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
        return !isTomorrowWeekend;
    }
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

async function getCompleteSchedule(baseSchedule, roomConfig) {
    const schoolDayTomorrow = await isSchoolDayTomorrow();
    const eveningSlot = schoolDayTomorrow ? roomConfig.schedules.earlyEvening : roomConfig.schedules.lateEvening;
    
    if (!schoolDayTomorrow && eveningSlot.start === '22:00') {
        const extendedSchedule = [...baseSchedule];
        const lastSlot = extendedSchedule[extendedSchedule.length - 1];
        extendedSchedule[extendedSchedule.length - 1] = { ...lastSlot, end: '22:00' };
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
    
    
    log('\n╔═══════════════════════════════════════════════════════════════╗');
    log(`║          ${roomName.toUpperCase()}'S HEATING SYSTEM - STATUS${' '.repeat(Math.max(0, 26 - roomName.length))}║`);
    log('╚═══════════════════════════════════════════════════════════════╝\n');
    // Get all devices for this zone
    const devices = await getZoneDevices(ZONE_NAME, roomConfig.heating.devices);
    
    if (devices.error) {
        log(`❌ Error: ${devices.error}\n`);
        return;
    }
    
    // Global variables
    log('══ TEMPERATURE SETTINGS ══');
    const baseTarget = global.get(`${ZONE_NAME}.Temperature`);
    const effectiveTarget = global.get(`${ZONE_NAME}.EffectiveTemperature`);
    const inactivityOffset = global.get(`${ZONE_NAME}.Heating.InactivityOffset`) || 0;
    const inactivityMode = global.get(`${ZONE_NAME}.Heating.InactivityMode`);
    
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
    
    // Pause Mode Status
    const pauseActive = global.get(`${ZONE_NAME}.Heating.PauseMode`);
    if (pauseActive) {
        const pauseStartTime = global.get(`${ZONE_NAME}.Heating.PauseStartTime`);
        const pauseDuration = global.get(`${ZONE_NAME}.Heating.PauseDuration`) || 60;
        
        if (pauseStartTime) {
            const minutesElapsed = (Date.now() - pauseStartTime) / 1000 / 60;
            const remainingMinutes = Math.max(0, Math.ceil(pauseDuration - minutesElapsed));
            
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
    const boostActive = global.get(`${ZONE_NAME}.Heating.BoostMode`);
    if (boostActive) {
        const boostStartTime = global.get(`${ZONE_NAME}.Heating.BoostStartTime`);
        const boostDuration = global.get(`${ZONE_NAME}.Heating.BoostDuration`) || 60;
        
        if (boostStartTime) {
            const minutesElapsed = (Date.now() - boostStartTime) / 1000 / 60;
            const remainingMinutes = Math.max(0, Math.ceil(boostDuration - minutesElapsed));
            
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
        if (scheduleInfo.currentSlot.inactivityOffset > 0) {
            log(`Inactivity:     -${scheduleInfo.currentSlot.inactivityOffset}°C offset when inactive`);
        } else {
            log(`Inactivity:     No offset in this period`);
        }
        
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
                const windowOpenTime = global.get(`${ZONE_NAME}.Heating.WindowOpenTime`);
                if (windowOpenTime) {
                    const secondsOpen = Math.floor((Date.now() - windowOpenTime) / 1000);
                    log(`Window:         🔴 OPEN (${secondsOpen}s)`);
                } else {
                    log(`Window:         🔴 OPEN`);
                }
            } else {
                // Check if we're in the settle delay period
                const windowClosedTime = global.get(`${ZONE_NAME}.Heating.WindowClosedTime`);
                if (windowClosedTime) {
                    const windowClosedDelay = roomConfig.settings.windowClosedDelay || 600;
                    const secondsSinceClosed = Math.floor((Date.now() - windowClosedTime) / 1000);
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
} catch (error) {
    log(`School Day:    Error - ${error.message}`);
}

// Show status for each room
for (const [roomName, roomConfig] of Object.entries(ROOMS)) {
    await showRoomStatus(roomName, roomConfig);
}

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          END OF STATUS REPORT                                ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');