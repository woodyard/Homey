/**
 * Generic Room Heating Status (Zone-Based, Multi-Room)
 *
 * Shows current status for ALL configured rooms.
 * Just run the script - it loops through all rooms in ROOMS config.
 *
 * Author: Henrik Skovgaard
 * Version: 5.0.2
 * Created: 2025-12-31
 * Based on: Clara Status v2.8.0
 *
 * Version history: CHANGELOG.md
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

const TADO_HOME_ID = GLOBAL_CONFIG?.tadoHomeId;   // from room_heating_config.js

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
// Unified Room State (matches room_heating.js v10.20.0)
// ============================================================================

const DEFAULT_STATE = {
    mode: 'auto',
    modeExpires: null,
    modeDetails: {},
    away: false,
    awaySince: null,
    baseline: {
        commandedTargetTemp: null,
        lastSeenTargetTemp: null
    },
    window: {
        openSince: null,
        closedSince: null,
        timeoutHandled: false
    },
    inactive: false,
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

// ============================================================================
// Live Status (published by the heating script into the "HeatingStatus" Logic variable)
// ============================================================================

async function readHeatingStatus() {
    try {
        const variables = await Homey.logic.getVariables();
        for (const v of Object.values(variables)) {
            if (v.name === 'HeatingStatus' && v.value) {
                return JSON.parse(v.value);
            }
        }
    } catch (error) {
        log(`⚠️ Could not read HeatingStatus: ${error.message}`);
    }
    return {};
}

const HEATING_STATUS = await readHeatingStatus();

function formatTimestamp(ms) {
    if (!ms) return 'N/A';
    const d = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================================

async function showRoomStatus(roomName, roomConfig) {
    const ZONE_NAME = roomConfig.zoneName;
    const roomState = getRoomState(ZONE_NAME);
    const hs = HEATING_STATUS[ZONE_NAME] || null;   // live status from the heating script

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
    if (!hs) {
        log(`⚠️  No live status for this room yet - run the heating script once`);
    }
    const baseTarget = hs ? hs.scheduledTarget : null;
    const effectiveTarget = hs ? hs.effectiveTarget : null;
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
            if (overrideType === 'target') {
                log(`Type:           Target set from the dashboard`);
                log(`Target:         ${roomState.modeDetails.target}°C`);
            } else {
                log(`Type:           Manual ${overrideType} change detected`);
            }
            if (overrideType === 'temperature' || overrideType === 'target') {
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
    
    // Current schedule, as resolved by the heating script on its last run
    if (hs && hs.period) {
        const s = hs.settings || {};
        log(`\n══ CURRENT SCHEDULE ══`);
        log(`Schedule:       ${hs.scheduleType}`);
        log(`Period:         ${hs.period.start}-${hs.period.end} (${hs.period.name})`);
        log(`Base Target:    ${hs.scheduledTarget}°C`);

        if (s.inactivityOffset > 0) {
            log(`Inactivity:     -${s.inactivityOffset}°C (${s.inactivityOffsetSource}) after ${s.inactivityTimeout} min (${s.inactivityTimeoutSource})`);
        } else {
            log(`Inactivity:     No offset in this period`);
        }
        log(`Window Open:    ${s.windowOpenTimeout} sec timeout (${s.windowOpenTimeoutSource})`);
        log(`Window Closed:  ${Math.floor(s.windowClosedDelay / 60)} min settle delay (${s.windowClosedDelaySource})`);
        log(`As of:          ${formatTimestamp(hs.updatedAt)}`);

        if (hs.nextChange) {
            log(`\n══ NEXT SCHEDULE CHANGE ══`);
            log(`Next Change:    ${hs.nextChange}`);
        }
    } else {
        log(`\n⚠️  Schedule unknown - no live status published yet`);
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
    
    // Run lock (one run per room at a time - matches heating v10.19.0)
    log('\n══ RUN LOCK ══');
    let runLock = null;
    try {
        const raw = global.get(`${ZONE_NAME}.Heating.RunLock`);
        runLock = raw ? JSON.parse(raw) : null;
    } catch (error) {
        runLock = null;
    }
    if (runLock) {
        const age = Math.floor((Date.now() - runLock.startedAt) / 1000);
        log(age < 120 ? `🔒 Run in progress (${age}s)` : `⚠️ Stale lock (${age}s old) - next run will clear it`);
    } else {
        log(`✓ Free - no run in progress`);
    }

    // Diagnostics
    log('\n══ DIAGNOSTICS ══');
    
    log(`Last update:    ${hs ? formatTimestamp(hs.updatedAt) : 'N/A'}`);
    log(`Last action:    ${formatValue(hs ? hs.lastAction : null)}`);
    
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

// Schedule type today, as resolved by the heating script (identical for all rooms)
log('\n══ SCHEDULE TODAY (GLOBAL) ══');
{
    const published = Object.values(HEATING_STATUS).filter(s => s && s.scheduleType);
    if (published.length > 0) {
        const latest = published.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0];
        const icon = latest.scheduleType === 'School Day' ? '📚' : latest.scheduleType === 'Weekend' ? '🏡' : '🏖️';
        log(`Today:         ${icon} ${latest.scheduleType} (as of ${formatTimestamp(latest.updatedAt)})`);
    } else {
        log(`Today:         Unknown - no live status published yet`);
    }
}

// Show status for each room
for (const [roomName, roomConfig] of Object.entries(ROOMS)) {
    await showRoomStatus(roomName, roomConfig);
}

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          END OF STATUS REPORT                                 ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');