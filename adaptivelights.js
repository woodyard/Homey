// ====== HOMEY ADAPTIVE LIGHTING - CENTRALIZED SCRIPT ======
// Universal script for all rooms with per-room profiles and schedules
//
// Script Name: AdaptiveLighting
// Version:     2.13.6
// Date:        2025-12-26
// Author:      Henrik Skovgaard
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 2.13.6 2025-12-26  Fix timezone handling for Copenhagen time
//                    - getCurrentTimeInMinutes() now correctly uses CET/CEST
//                    - getCurrentDayOfWeek() now correctly uses CET/CEST
//                    - Fixes 1-hour offset where script was using UTC instead of local time
// 2.13.5 2025-12-26  Fix temperature not applying correctly on color bulbs
//                    - Reset saturation to 0 when applying temperature
//                    - Ensures pure white light without color mixing
//                    - Fixes issue where temperature ended up wrong (e.g. 76 vs 90)
// 2.13.4 2025-12-21  Gentler morning light across all rooms
//                    - Reduced morning brightness (except bathroom/kitchen)
//                    - Warmer morning temperature (0.7) for soft wake-up
//                    - Updated: kidsRoom, entrance, dining, standard profiles
//                    - Evening→Night changed to 21:30 for stue/filament
// 2.13.3 2025-12-20  Fix "clear" mode for lights that are off
//                    - "clear" on a turned-off light only clears manual mode
//                    - Does not turn on the light
// 2.13.2 2025-12-17  Improved notifications
//                    - Only notify FIRST time entering manual mode
//                    - Notify when exiting manual mode (→ auto)
//                    - No repeated "Skipped - manual mode" notifications
// 2.13.1 2025-12-17  Handle missing lastProfile gracefully
//                    - If no lastProfile exists, initialize without setting manual mode
//                    - Fixes false positives after script update
// 2.13.0 2025-12-17  Improved manual mode detection with lastProfile tracking
//                    - Remembers which profile was last applied to each device
//                    - Manual mode only set if values don't match LAST profile
//                    - Prevents false positives when profile changes
//                    - Storage changed from AL_ManualModes to AL_DeviceStates
// 2.12.1 2025-12-17  Fix false manual mode detection
//                    - Only sets manual mode if values don't match ANY profile
//                    - Profile changes (e.g., Morning→Daytime) are now handled correctly
//                    - "clear" now also applies profile (instant)
// 2.12.0 2025-12-16  Persistent manual mode tracking
//                    - Uses HomeyScript global storage to remember manual mode
//                    - Manual mode persists until light turns on, force, or clear
//                    - "clear" argument clears manual mode AND applies profile
//                    - Data stored in AL_ManualModes global variable
// 2.11.3 2025-12-16  Reduced logging noise
//                    - No logging when light turns on (normal mode)
//                    - Only logs in "check" mode (periodic updates)
//                    - Still logs manual adjustment skips
// 2.11.2 2025-12-16  Combined min+max constraints for sunrise/sunset
//                    - "sunset>17:00<19:00" = sunset, min 17:00, max 19:00
//                    - Updated filament and stue profiles
// 2.11.1 2025-12-16  Min/max constraints for sunrise/sunset
//                    - "sunset>18:00" = sunset, but at least 18:00
//                    - "sunrise<08:00" = sunrise, but at most 08:00
//                    - Updated filament, stue, dining profiles
// 2.11.0 2025-12-16  Sunrise/sunset support
//                    - Added getSunTimes() function (NOAA algorithm)
//                    - Use "sunrise" or "sunset" in startTime/endTime
//                    - Supports offsets: "sunset-30", "sunrise+60"
//                    - Added latitude/longitude to SETTINGS
// 2.10.5 2025-12-15  Simultaneous dim and temperature fade
//                    - Both now fade together using Promise.all()
//                    - Total fade time is 60s (not 120s)
// 2.10.4 2025-12-15  Fix temperature flow card ID
//                    - Instant change when light turns on
//                    - Fade duration only for periodic updates (check mode)
// 2.10.2 2025-12-15  Fix check mode logic
//                    - Now correctly skips if already at active profile values
//                    - Checks against active profile first, then manual adjustment
// 2.10.1 2025-12-14  Fix color mode handling
//                    - Switches light_mode from "color" to "temperature" before applying
//                    - Refactored applyToDevice helper function
// 2.10.0 2025-12-14  Group duration support
//                    - Detects groups by name pattern (e.g., "Name X/Y")
//                    - Applies duration to each individual bulb in group
//                    - Uses correct flow card URI format
// 2.9.1  2025-12-14  Fixed transition duration using flow card action
//                    - Duration is top-level property, not inside args
//                    - Works on Hue, IKEA and other supported devices
// 2.9.0  2025-12-14  Added transition duration support
//                    - transitionDuration setting (default: 60 seconds)
//                    - Smooth fade when changing profiles (if device supports it)
// 2.8.0  2025-12-14  Added Homey notification support
//                    - Uses correct URI format from EVE script
//                    - enableNotifications setting (default: true)
// 2.7.0  2025-12-14  Added weekend profile support
//                    - Optional weekendProfiles for Saturday/Sunday
//                    - Pre-built weekend variants for bedroom and kids room
//                    - Logs show [Weekend] indicator when using weekend profile
// 2.6.0  2025-12-14  Changed to startTime/endTime with "HH:MM" format
// 2.5.1  2025-12-14  Fixed args handling for runWithArg
// 2.5.0  2025-12-14  Improved argument modes for different use cases
// 2.4.0  2025-12-14  Added "force" argument to reset manually adjusted lights
// 2.3.0  2025-12-14  Added manual adjustment detection for hourly updates
// 2.2.0  2025-12-14  Cleaned up config - only groups and standalone devices
// 2.1.0  2025-12-14  Added filament bulb profile with reduced brightness
// 2.0.0  2025-12-14  Complete rewrite with centralized room configuration
//                    - Per-room lighting profiles
//                    - Per-room schedules
//                    - Fallback to default profiles
//                    - Dynamic room name detection
//                    - All Kertemindegade devices pre-configured
// 1.0.0  2025-xx-xx  Initial version with hardcoded device ID
// -------------------------------------------------------------------------
//
// INSTALLATION:
// 1. Open Homey App → More → Apps → HomeyScript
// 2. Create new script named "AdaptiveLighting"
// 3. Paste this entire script
// 4. Save the script
//
// USAGE IN ADVANCED FLOWS:
// 1. Trigger: "[Your Light]" → "turned on"
// 2. Action: HomeyScript → "Run script with argument"
// 3. Select script: "AdaptiveLighting"
// 4. Argument: Device ID (e.g., "f4bf99d6-ed4a-43e8-b305-9866d7ef5341")
//
// HOURLY UPDATE (to adjust lights that are already on):
// 1. Trigger: "Every hour"
// 2. Condition: "[Light]" → "is on"
// 3. Action: HomeyScript → "Run script with argument"
// 4. Argument: "device-id check"  ← Note the "check" mode!
//
// The "check" mode compares current values against profiles.
// If values don't match any profile (manually adjusted), the update is skipped.
//
// FORCE RESET (revert manually adjusted light to profile):
// 1. Trigger: Button pressed / Voice command / etc.
// 2. Action: HomeyScript → "Run script with argument"
// 3. Argument: "device-id force"  or  "device-id reset"
//
// CLEAR MANUAL MODE (reset to auto):
// 1. Trigger: Button pressed / Voice command / etc.
// 2. Action: HomeyScript → "Run script with argument"
// 3. Argument: "device-id clear"
//
// ARGUMENT MODES:
//   "device-id"         Always apply profile, clear manual mode (for "turned on" triggers)
//   "device-id check"   Check first, skip if in manual mode (for hourly updates)
//   "device-id force"   Always apply, clear manual mode (explicit reset)
//   "device-id reset"   Same as force
//   "device-id clear"   Clear manual mode and apply profile (instant)
//
// =========================================================================

// ====== DEFAULT LIGHTING PROFILES ======
// Used when a room has no custom configuration
// Time format: "HH:MM" (24-hour), Temperature scale: 0.0 = cool/blue, 1.0 = warm/orange
const DEFAULT_PROFILES = [
  {
    name: "Morning",
    startTime: "06:00",
    endTime: "09:00",
    brightness: 0.35,     // 35% - Gentle morning light
    temperature: 0.7      // Warm white
  },
  {
    name: "Daytime",
    startTime: "09:00",
    endTime: "18:00",
    brightness: 0.8,      // 80% - Comfortable daytime
    temperature: 0.5      // Neutral white
  },
  {
    name: "Evening",
    startTime: "18:00",
    endTime: "22:00",
    brightness: 0.30,     // 30% - Relaxing evening
    temperature: 0.7      // Warm white
  },
  {
    name: "Night",
    startTime: "22:00",
    endTime: "06:00",
    brightness: 0.15,     // 15% - Gentle night light
    temperature: 0.9      // Very warm (orange glow)
  }
];

// ====== ROOM PROFILE TEMPLATES ======
// Reusable profile sets for different room types
// Time format: "HH:MM" (24-hour)
const PROFILES = {
  
  // Standard living spaces (default)
  standard: DEFAULT_PROFILES,
  
  // Filament bulbs - reduced brightness (they appear brighter than regular LEDs)
  // Also slightly lower temperature since filament already has warm glow
  filament: [
    { name: "Morning",  startTime: "06:00",              endTime: "sunrise+30>08:00",   brightness: 0.20, temperature: 0.55 },
    { name: "Daytime",  startTime: "sunrise+30>08:00",   endTime: "sunset>17:00<19:00", brightness: 0.55, temperature: 0.40 },
    { name: "Evening",  startTime: "sunset>17:00<19:00", endTime: "21:30",              brightness: 0.20, temperature: 0.70 },
    { name: "Night",    startTime: "21:30",              endTime: "06:00",              brightness: 0.08, temperature: 0.70 }
  ],
  
  // Stue (living room) - reduced morning brightness, comfortable evening
  stue: [
    { name: "Morning",  startTime: "06:00",              endTime: "sunrise+30>08:00",   brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "sunrise+30>08:00",   endTime: "sunset>17:00<19:00", brightness: 0.80, temperature: 0.4 },
    { name: "Evening",  startTime: "sunset>17:00<19:00", endTime: "21:30",              brightness: 0.35, temperature: 0.9 },
    { name: "Night",    startTime: "21:30",              endTime: "06:00",              brightness: 0.10, temperature: 0.9 }
  ],
  
  // Bathroom - bright until late, very dim at night
  bathroom: [
    { name: "Morning",  startTime: "06:00", endTime: "09:00", brightness: 1.0,  temperature: 0.3 },
    { name: "Daytime",  startTime: "09:00", endTime: "21:00", brightness: 0.9,  temperature: 0.4 },
    { name: "Evening",  startTime: "21:00", endTime: "23:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "23:00", endTime: "06:00", brightness: 0.08, temperature: 1.0 }
  ],
  
  // Bedroom - dimmer overall, very dim at night
  bedroom: [
    { name: "Morning",  startTime: "07:00", endTime: "09:00", brightness: 0.25, temperature: 0.8 },
    { name: "Daytime",  startTime: "09:00", endTime: "20:00", brightness: 0.6,  temperature: 0.5 },
    { name: "Evening",  startTime: "20:00", endTime: "22:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "22:00", endTime: "07:00", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Kids room - earlier bedtime schedule
  kidsRoom: [
    { name: "Morning",  startTime: "07:00", endTime: "08:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "08:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "20:00", brightness: 0.35, temperature: 0.7 },
    { name: "Night",    startTime: "20:00", endTime: "07:00", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Kitchen - bright for cooking, dimmer late evening
  kitchen: [
    { name: "Morning",  startTime: "06:00", endTime: "09:00", brightness: 1.0,  temperature: 0.3 },
    { name: "Daytime",  startTime: "09:00", endTime: "20:00", brightness: 1.0,  temperature: 0.4 },
    { name: "Evening",  startTime: "20:00", endTime: "22:00", brightness: 0.5,  temperature: 0.6 },
    { name: "Night",    startTime: "22:00", endTime: "06:00", brightness: 0.15, temperature: 0.9 }
  ],
  
  // Entrance/hallway - motion-triggered, functional
  entrance: [
    { name: "Morning",  startTime: "06:00", endTime: "09:00", brightness: 0.40, temperature: 0.7 },
    { name: "Daytime",  startTime: "09:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "23:00", brightness: 0.4,  temperature: 0.7 },
    { name: "Night",    startTime: "23:00", endTime: "06:00", brightness: 0.10, temperature: 1.0 }
  ],
  
  // Dining room - ambient, cozy
  dining: [
    { name: "Morning",  startTime: "06:00",              endTime: "09:00",              brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "09:00",              endTime: "sunset>17:00<19:00", brightness: 0.7,  temperature: 0.5 },
    { name: "Evening",  startTime: "sunset>17:00<19:00", endTime: "22:00",              brightness: 0.35, temperature: 0.75 },
    { name: "Night",    startTime: "22:00",              endTime: "06:00",              brightness: 0.10, temperature: 0.9 }
  ],
  
  // ===== WEEKEND VARIANTS =====
  // Use these as weekendProfiles for rooms where you want different weekend schedules
  
  // Bedroom weekend - later morning, sleep in!
  bedroomWeekend: [
    { name: "Morning",  startTime: "09:00", endTime: "11:00", brightness: 0.25, temperature: 0.8 },
    { name: "Daytime",  startTime: "11:00", endTime: "20:00", brightness: 0.6,  temperature: 0.5 },
    { name: "Evening",  startTime: "20:00", endTime: "23:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "23:00", endTime: "09:00", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Kids room weekend - later morning and bedtime
  kidsRoomWeekend: [
    { name: "Morning",  startTime: "08:30", endTime: "10:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "10:00", endTime: "19:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "19:00", endTime: "21:00", brightness: 0.35, temperature: 0.7 },
    { name: "Night",    startTime: "21:00", endTime: "08:30", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Standard weekend - later morning
  standardWeekend: [
    { name: "Morning",  startTime: "08:00", endTime: "10:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "10:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "23:00", brightness: 0.30, temperature: 0.7 },
    { name: "Night",    startTime: "23:00", endTime: "08:00", brightness: 0.15, temperature: 0.9 }
  ]
};

// ====== ROOM CONFIGURATION ======
// Only groups and standalone devices - individual bulbs in groups are excluded
// Groups are identified by NOT having "button.migrate_v3" in their state
//
const ROOM_CONFIG = {
  
  // =====================================================================
  // STUE (Living Room) - Kertemindegade 9
  // =====================================================================
  "f4bf99d6-ed4a-43e8-b305-9866d7ef5341": {
    name: "Stue Loft",
    profiles: PROFILES.filament  // Gruppe med 5 filament pærer
  },
  "0332a0da-582e-480c-bc65-c26cf53161de": {
    name: "Stue Standerlampe",
    profiles: PROFILES.stue  // Gruppe med 2 pærer
  },
  // Stue Lyskæde fjernet - kun on/off, ingen dim

  // =====================================================================
  // SPISESTUE (Dining Room) - Kertemindegade 9
  // =====================================================================
  "4972799f-a2ca-4834-b0d2-380724486eab": {
    name: "Spisestue Loft",
    profiles: PROFILES.dining
  },
  "50ae2853-9f89-4a74-85f5-f873a6adfd71": {
    name: "Spisestue Bordlampe",
    profiles: PROFILES.dining
  },
  "cc30f76b-7634-489c-a721-541fdb49d46f": {
    name: "Spisestue Perler",
    profiles: PROFILES.dining  // Twinkly
  },

  // =====================================================================
  // SOVEVÆRELSE (Bedroom) - Kertemindegade 9
  // =====================================================================
  "8f222a3f-06e5-4786-84bf-c7011c85e092": {
    name: "Soveværelse Loft",
    profiles: PROFILES.bedroom,              // Weekdays
    weekendProfiles: PROFILES.bedroomWeekend // Weekends - later morning
  },

  // =====================================================================
  // KØKKEN (Kitchen) - Kertemindegade 9
  // =====================================================================
  "72af0fb7-24df-4f6b-b3ed-1b555185e902": {
    name: "Køkken Loft",
    profiles: PROFILES.kitchen  // Gruppe med 3 pærer
  },
  "f8bbcd29-0675-4066-8fb1-b486532f42eb": {
    name: "Køkken Køkkenbord",
    profiles: PROFILES.kitchen  // Gruppe med 3 pærer
  },

  // =====================================================================
  // BADEVÆRELSE 9 (Bathroom) - Kertemindegade 9
  // =====================================================================
  "1847a2b3-9261-4cb4-882c-14c219e4a4a3": {
    name: "Badeværelse 9",
    profiles: PROFILES.bathroom  // Gruppe
  },

  // =====================================================================
  // BADEVÆRELSE 7 (Bathroom) - Kertemindegade 7
  // =====================================================================
  "39e1e679-a9b8-4bc7-9c28-4f6541854be0": {
    name: "Badeværelse 7",
    profiles: PROFILES.bathroom  // Gruppe
  },

  // =====================================================================
  // ENTRE 9 (Entrance) - Kertemindegade 9
  // =====================================================================
  "6a4040bb-c059-419c-975f-f9b31cd6ee34": {
    name: "Entre 9 Loft",
    profiles: PROFILES.entrance
  },
  "69331b1f-13ef-4a27-abed-eb34b4c355d1": {
    name: "Entre 9 Garderobe",
    profiles: PROFILES.entrance
  },

  // =====================================================================
  // ENTRE 7 (Entrance) - Kertemindegade 7
  // =====================================================================
  "55b6b097-3320-4574-8be9-09f25bb5a664": {
    name: "Entre 7",
    profiles: PROFILES.entrance
  },

  // =====================================================================
  // OLIVERS VÆRELSE (Oliver's Room) - Kertemindegade 9
  // =====================================================================
  "7768c895-c037-4b83-84d4-9ef82404fe12": {
    name: "Olivers Værelse Loft",
    profiles: PROFILES.kidsRoom,
    weekendProfiles: PROFILES.kidsRoomWeekend  // Later bedtime on weekends
  },

  // =====================================================================
  // CLARAS VÆRELSE (Clara's Room) - Kertemindegade 7
  // =====================================================================
  "8938b436-6c9b-4b88-89c4-656ca842b1c8": {
    name: "Claras Værelse Loft",
    profiles: PROFILES.kidsRoom,
    weekendProfiles: PROFILES.kidsRoomWeekend  // Later bedtime on weekends
  },
  "0dec2c10-a178-44e0-a346-6977f01e7cd5": {
    name: "Claras Værelse LightStrip",
    profiles: PROFILES.kidsRoom
  },
  "4c34d605-334b-4207-b9a3-1796829b0caf": {
    name: "Claras Værelse Svampelampe",
    profiles: PROFILES.kidsRoom  // Kun dim, ingen temperatur
  },

  // =====================================================================
  // ALTAN (Balcony)
  // =====================================================================
  "16a55a55-d67b-4b85-9562-cc4f11e12975": {
    name: "Altan Lyskæde",
    profiles: PROFILES.standard  // Twinkly
  }
};

// ====== SCRIPT SETTINGS ======
const SETTINGS = {
  timezone: 'Europe/Copenhagen',
  latitude: 55.6761,             // København latitude (for sunrise/sunset)
  longitude: 12.5683,            // København longitude
  enableLogging: true,           // Log to HomeyScript console
  enableDetailedLogging: false,  // Extra debug info in console
  enableNotifications: true,     // Send notifications to Homey timeline
  tolerance: 0.10,               // 10% tolerance when comparing values
  transitionDuration: 60         // Fade time in SECONDS (60 = 1 min, 0 = instant)
                                 // Note: Only works on devices that support duration (Hue, IKEA, etc.)
};

// ====== HELPER FUNCTIONS ======

/**
 * Calculate sunrise and sunset times for a given date
 * Uses NOAA algorithm for accurate results
 */
function getSunTimes(date) {
  const lat = SETTINGS.latitude;
  const lon = SETTINGS.longitude;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  
  // Julian day
  const JD = Math.floor(365.25 * (date.getFullYear() + 4716)) + 
             Math.floor(30.6001 * (date.getMonth() + 2)) + 
             date.getDate() - 1524.5;
  
  const JC = (JD - 2451545) / 36525;
  const L0 = (280.46646 + JC * (36000.76983 + 0.0003032 * JC)) % 360;
  const M = 357.52911 + JC * (35999.05029 - 0.0001537 * JC);
  const e = 0.016708634 - JC * (0.000042037 + 0.0000001267 * JC);
  const C = Math.sin(M * rad) * (1.914602 - JC * (0.004817 + 0.000014 * JC)) +
            Math.sin(2 * M * rad) * (0.019993 - 0.000101 * JC) +
            Math.sin(3 * M * rad) * 0.000289;
  const sunLong = L0 + C;
  const obliq = 23.439291 - JC * 0.0130042;
  const declination = Math.asin(Math.sin(obliq * rad) * Math.sin(sunLong * rad)) * deg;
  
  const y = Math.tan(obliq * rad / 2) ** 2;
  const EoT = 4 * deg * (y * Math.sin(2 * L0 * rad) - 
              2 * e * Math.sin(M * rad) + 
              4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
              0.5 * y * y * Math.sin(4 * L0 * rad) -
              1.25 * e * e * Math.sin(2 * M * rad));
  
  const cosHA = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(declination * rad))) -
                Math.tan(lat * rad) * Math.tan(declination * rad);
  
  // Handle polar day/night
  if (Math.abs(cosHA) > 1) {
    return { 
      sunriseMinutes: cosHA < -1 ? 0 : 720,    // Polar day: sunrise at midnight, polar night: noon
      sunsetMinutes: cosHA < -1 ? 1439 : 720   // Polar day: sunset at midnight, polar night: noon
    };
  }
  
  const HA = Math.acos(cosHA) * deg;
  const solarNoon = 720 - 4 * lon - EoT;
  const sunriseUTC = solarNoon - HA * 4;
  const sunsetUTC = solarNoon + HA * 4;
  
  // Denmark: CET (UTC+1) in winter, CEST (UTC+2) in summer
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const lastSundayMarch = 31 - new Date(year, 2, 31).getDay();
  const lastSundayOctober = 31 - new Date(year, 9, 31).getDay();
  const isSummerTime = (month > 2 && month < 9) || 
                       (month === 2 && day >= lastSundayMarch) ||
                       (month === 9 && day < lastSundayOctober);
  const tzOffset = isSummerTime ? 120 : 60;
  
  return {
    sunriseMinutes: Math.round(sunriseUTC + tzOffset),
    sunsetMinutes: Math.round(sunsetUTC + tzOffset)
  };
}

/**
 * Get current time in minutes since midnight (0-1439)
 * Uses Europe/Copenhagen timezone
 */
function getCurrentTimeInMinutes() {
  const now = new Date();
  
  // Convert UTC to Copenhagen time  
  const copenhagenTimeStr = now.toLocaleString('en-US', { 
    timeZone: 'Europe/Copenhagen',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Parse "HH:MM" format directly (don't create new Date - that reverts to UTC!)
  const [hours, minutes] = copenhagenTimeStr.split(':').map(Number);
  
  return hours * 60 + minutes;
}

/**
 * Get current day of week (0 = Sunday, 6 = Saturday)
 * Uses Europe/Copenhagen timezone
 */
function getCurrentDayOfWeek() {
  const now = new Date();
  
  // Get full Copenhagen date/time string
  const copenhagenStr = now.toLocaleString('en-US', { 
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Create Date from the Copenhagen string
  const copenhagenDate = new Date(copenhagenStr);
  return copenhagenDate.getDay();
}

/**
 * Check if current day is a weekend (Saturday or Sunday)
 */
function isWeekend() {
  const day = getCurrentDayOfWeek();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Get day name for logging
 */
function getDayName() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[getCurrentDayOfWeek()];
}

/**
 * Send notification to Homey timeline
 */
async function notify(text) {
  if (SETTINGS.enableNotifications) {
    await Homey.flow.runFlowCardAction({
      uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
      id: "homey:manager:notifications:create_notification",
      args: { text: text }
    });
  }
}

/**
 * Get device key (short ID)
 */
function getDeviceKey(deviceId) {
  return deviceId.substring(0, 8);
}

/**
 * Get all device states from global storage
 * Structure: { "deviceKey": { manual: boolean, lastProfile: string } }
 */
function getDeviceStates() {
  try {
    const data = global.get('AL_DeviceStates');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Save all device states to global storage
 */
function saveDeviceStates(states) {
  global.set('AL_DeviceStates', JSON.stringify(states));
}

/**
 * Check if device is in manual mode
 */
function isManualMode(deviceId) {
  const key = getDeviceKey(deviceId);
  const states = getDeviceStates();
  return states[key]?.manual === true;
}

/**
 * Set manual mode for a device
 */
function setManualMode(deviceId, enabled) {
  const key = getDeviceKey(deviceId);
  const states = getDeviceStates();
  
  if (!states[key]) {
    states[key] = {};
  }
  states[key].manual = enabled;
  
  // Clean up if not manual and no lastProfile
  if (!enabled && !states[key].lastProfile) {
    delete states[key];
  }
  
  saveDeviceStates(states);
  
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Manual mode ${enabled ? 'enabled' : 'disabled'} for ${key}`);
  }
}

/**
 * Get last applied profile for a device
 */
function getLastProfile(deviceId) {
  const key = getDeviceKey(deviceId);
  const states = getDeviceStates();
  return states[key]?.lastProfile || null;
}

/**
 * Set last applied profile for a device
 */
function setLastProfile(deviceId, profileName) {
  const key = getDeviceKey(deviceId);
  const states = getDeviceStates();
  
  if (!states[key]) {
    states[key] = {};
  }
  states[key].lastProfile = profileName;
  states[key].manual = false; // Clear manual mode when profile is applied
  
  saveDeviceStates(states);
  
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Last profile set to ${profileName} for ${key}`);
  }
}

/**
 * Parse time string "HH:MM" or hour number to minutes since midnight
 */
function parseTimeToMinutes(time) {
  if (typeof time === 'number') {
    // Legacy support: treat number as hour
    return time * 60;
  }
  if (typeof time === 'string') {
    const timeLower = time.toLowerCase().trim();
    
    // Handle sunrise/sunset with optional offset and min/max
    // Examples: "sunset", "sunset-30", "sunrise+60", "sunset>18:00", "sunrise<08:00", "sunset>17:00<19:00"
    if (timeLower.startsWith('sunrise') || timeLower.startsWith('sunset')) {
      const sunTimes = getSunTimes(new Date());
      const baseMinutes = timeLower.startsWith('sunrise') ? sunTimes.sunriseMinutes : sunTimes.sunsetMinutes;
      
      // Parse: (sunrise|sunset)(+/-offset)?(>minTime)?(<maxTime)?
      const match = timeLower.match(/^(sunrise|sunset)([+-]\d+)?(?:>(\d{1,2}:\d{2}))?(?:<(\d{1,2}:\d{2}))?$/);
      if (match) {
        const offset = match[2] ? parseInt(match[2], 10) : 0;
        let result = baseMinutes + offset;
        
        // Handle minimum constraint (>)
        if (match[3]) {
          const minParts = match[3].split(':');
          const minMinutes = parseInt(minParts[0], 10) * 60 + parseInt(minParts[1], 10);
          result = Math.max(result, minMinutes);
        }
        
        // Handle maximum constraint (<)
        if (match[4]) {
          const maxParts = match[4].split(':');
          const maxMinutes = parseInt(maxParts[0], 10) * 60 + parseInt(maxParts[1], 10);
          result = Math.min(result, maxMinutes);
        }
        
        return result;
      }
      return baseMinutes;
    }
    
    // Standard "HH:MM" format
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    return hours * 60 + minutes;
  }
  return 0;
}

/**
 * Format minutes to readable time string
 */
function formatMinutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get current hour in configured timezone (for logging)
 */
function getCurrentHour() {
  const now = new Date();
  const copenhagenTimeStr = now.toLocaleString('en-US', { 
    timeZone: 'Europe/Copenhagen',
    hour12: false,
    hour: '2-digit'
  });
  return parseInt(copenhagenTimeStr, 10);
}

/**
 * Get formatted timestamp for logging
 */
function getTimestamp() {
  return new Date().toLocaleString('da-DK', { timeZone: SETTINGS.timezone });
}

/**
 * Check if two values are approximately equal (within tolerance)
 */
function approxEqual(a, b, tolerance = SETTINGS.tolerance) {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Check if current light state matches any profile in the list
 * Returns the matching profile name, or null if no match (manually adjusted)
 */
function findMatchingProfile(profiles, currentBrightness, currentTemperature) {
  for (const profile of profiles) {
    const brightnessMatch = approxEqual(currentBrightness, profile.brightness);
    const temperatureMatch = currentTemperature === null || 
                             approxEqual(currentTemperature, profile.temperature);
    
    if (brightnessMatch && temperatureMatch) {
      return profile.name;
    }
  }
  return null; // No match = manually adjusted
}

/**
 * Find the appropriate lighting profile for the current time
 * Supports both "HH:MM" strings and legacy hour numbers
 */
function findActiveProfile(profiles, currentMinutes) {
  for (const profile of profiles) {
    // Support both startTime/endTime and legacy startHour/endHour
    const startTime = profile.startTime ?? profile.startHour;
    const endTime = profile.endTime ?? profile.endHour;
    
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);
    
    let inRange = false;
    
    if (startMinutes <= endMinutes) {
      // Normal range (e.g., 09:00-18:00)
      inRange = currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00-06:00)
      inRange = currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    
    if (inRange) {
      return profile;
    }
  }
  
  // Fallback to last profile (should not happen with proper config)
  return profiles[profiles.length - 1];
}

/**
 * Get room configuration or create default
 * Returns weekend profiles if it's weekend and they exist
 */
function getRoomConfig(deviceId, deviceName) {
  const config = ROOM_CONFIG[deviceId];
  const weekend = isWeekend();
  
  if (config) {
    // Check for weekend-specific profiles
    const profiles = (weekend && config.weekendProfiles) 
      ? config.weekendProfiles 
      : (config.profiles || DEFAULT_PROFILES);
    
    return {
      name: config.name || deviceName,
      profiles: profiles,
      isWeekend: weekend,
      usingWeekendProfile: weekend && !!config.weekendProfiles
    };
  }
  
  // Unknown device - use defaults with device name from Homey
  return {
    name: deviceName,
    profiles: DEFAULT_PROFILES,
    isWeekend: weekend,
    usingWeekendProfile: false
  };
}

/**
 * Apply lighting settings to device
 */
/**
 * Find group members by name pattern (e.g., "SV Light Loft" -> "SV Light Loft 1/3", "SV Light Loft 2/3")
 */
async function findGroupMembers(groupName) {
  const devices = await Homey.devices.getDevices();
  const members = [];
  
  for (const d of Object.values(devices)) {
    // Match "GroupName X/Y" pattern
    if (d.name.startsWith(groupName + ' ') && d.name !== groupName && d.class === 'light') {
      members.push(d);
    }
  }
  
  return members;
}

/**
 * Apply brightness and temperature to a single device
 */
async function applyToDevice(deviceOrId, brightness, temperature, duration) {
  const deviceId = typeof deviceOrId === 'string' ? deviceOrId : deviceOrId.id;
  const device = typeof deviceOrId === 'string' 
    ? await Homey.devices.getDevice({ id: deviceOrId }) 
    : deviceOrId;
  
  // First: Switch to temperature mode and reset saturation (if device supports color)
  try {
    const currentMode = device.capabilitiesObj?.light_mode?.value;
    const currentSaturation = device.capabilitiesObj?.light_saturation?.value;
    
    // Always set saturation to 0 if it's high (ensures pure white light)
    if (currentSaturation !== undefined && currentSaturation > 0.1) {
      await device.setCapabilityValue('light_saturation', 0);
      if (SETTINGS.enableDetailedLogging) {
        log(`[AdaptiveLighting] Reset saturation on ${device.name} from ${Math.round(currentSaturation * 100)}% to 0%`);
      }
    }
    
    if (currentMode === 'color') {
      await device.setCapabilityValue('light_mode', 'temperature');
      if (SETTINGS.enableDetailedLogging) {
        log(`[AdaptiveLighting] Switched ${device.name} from color to temperature mode`);
      }
    }
  } catch (e) {
    // Device might not support light_mode or light_saturation - that's ok
  }
  
  // Set brightness and temperature simultaneously
  if (duration > 0) {
    // Run both in parallel so they fade together
    const dimPromise = Homey.flow.runFlowCardAction({
      uri: `homey:flowcardaction:homey:device:${deviceId}:dim`,
      id: `homey:device:${deviceId}:dim`,
      args: { dim: brightness },
      duration: duration
    }).catch(() => device.setCapabilityValue('dim', brightness));
    
    const tempPromise = Homey.flow.runFlowCardAction({
      uri: `homey:flowcardaction:homey:device:${deviceId}:temperature`,
      id: `homey:device:${deviceId}:temperature`,
      args: { temperature: temperature },
      duration: duration
    }).catch(() => device.setCapabilityValue('light_temperature', temperature).catch(() => null));
    
    await Promise.all([dimPromise, tempPromise]);
    return { brightness: true, temperature: true };
  }
  
  // Instant change (no duration)
  try {
    await device.setCapabilityValue('dim', brightness);
  } catch (e) {
    // Ignore
  }
  
  try {
    await device.setCapabilityValue('light_temperature', temperature);
    return { brightness: true, temperature: true };
  } catch (e) {
    return { brightness: true, temperature: false };
  }
}

/**
 * Apply brightness and temperature to a device or group
 * Uses flow card action with duration for smooth transitions
 * @param {object} device - The device object
 * @param {number} brightness - Target brightness (0-1)
 * @param {number} temperature - Target color temperature (0-1)
 * @param {boolean} useDuration - Whether to use fade duration (false for instant)
 */
async function applyLighting(device, brightness, temperature, useDuration = false) {
  const duration = useDuration ? SETTINGS.transitionDuration : 0; // seconds
  
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Applying: dim=${brightness}, temp=${temperature}, duration=${duration}s`);
  }
  
  // Find group members (if any)
  const members = await findGroupMembers(device.name);
  const isGroup = members.length > 0;
  
  if (isGroup) {
    // Apply to each member
    if (SETTINGS.enableDetailedLogging) {
      log(`[AdaptiveLighting] Group detected with ${members.length} members`);
    }
    
    for (const member of members) {
      try {
        await applyToDevice(member, brightness, temperature, duration);
      } catch (e) {
        if (SETTINGS.enableDetailedLogging) {
          log(`[AdaptiveLighting] Member ${member.name} error: ${e.message}`);
        }
      }
    }
    return { brightness: true, temperature: true };
    
  } else {
    // Single device
    return await applyToDevice(device, brightness, temperature, duration);
  }
}

// ====== MAIN SCRIPT ======

// Handle args - can be string directly or array depending on HomeyScript context
// runWithArg passes argument as args (string), runCode may pass as args[0]
const argString = typeof args === 'string' ? args : 
                  (Array.isArray(args) ? args[0] : args?.[0]) || '';
const argParts = argString.toString().trim().split(/\s+/);
const DEVICE_ID = argParts[0];
const MODE_ARG = (argParts[1] || '').toLowerCase();

const CHECK_MANUAL = MODE_ARG === 'check' || MODE_ARG === 'hourly';
const FORCE_UPDATE = MODE_ARG === 'force' || MODE_ARG === 'reset';
const CLEAR_MANUAL = MODE_ARG === 'clear' || MODE_ARG === 'off';

// Debug logging for troubleshooting argument issues
if (SETTINGS.enableDetailedLogging) {
  log(`[AdaptiveLighting] args type: ${typeof args}`);
  log(`[AdaptiveLighting] argString: "${argString}"`);
  log(`[AdaptiveLighting] DEVICE_ID: "${DEVICE_ID}"`);
  log(`[AdaptiveLighting] MODE_ARG: "${MODE_ARG}"`);
}

if (!DEVICE_ID) {
  log(`[AdaptiveLighting] ✗ ERROR: No device ID provided.`);
  log(`[AdaptiveLighting] Usage: "deviceId [mode]"`);
  log(`[AdaptiveLighting] Modes: check (skip if manual), force/reset (always apply)`);
  return false;
}

try {
  // Get the device from Homey
  const device = await Homey.devices.getDevice({ id: DEVICE_ID });
  const currentMinutes = getCurrentTimeInMinutes();
  const currentTimeStr = formatMinutesToTime(currentMinutes);
  
  // Get room configuration (custom or default)
  const roomConfig = getRoomConfig(DEVICE_ID, device.name);
  const roomName = roomConfig.name;
  
  // Handle "clear" mode - clear manual mode, only apply profile if light is on
  if (CLEAR_MANUAL) {
    const wasManual = isManualMode(DEVICE_ID);
    setManualMode(DEVICE_ID, false);
    
    // Check if light is on
    const isOn = device.capabilitiesObj?.onoff?.value ?? false;
    
    if (wasManual) {
      const clearMessage = `[${roomName}] Manual mode cleared → auto`;
      if (SETTINGS.enableLogging) {
        log(clearMessage);
      }
      await notify(clearMessage);
    }
    
    // If light is off, just clear manual mode and exit
    if (!isOn) {
      if (SETTINGS.enableDetailedLogging) {
        log(`[${roomName}] Light is off - manual mode cleared, no profile applied`);
      }
      return {
        room: roomName,
        action: 'manual_mode_cleared',
        lightOff: true
      };
    }
    // Continue to apply profile if light is on
  }
  
  // Get current device state
  const currentBrightness = device.capabilitiesObj?.dim?.value ?? null;
  const currentTemperature = device.capabilitiesObj?.light_temperature?.value ?? null;
  
  // Find active profile for current time FIRST
  const activeProfile = findActiveProfile(roomConfig.profiles, currentMinutes);
  
  // Check mode logic
  if (CHECK_MANUAL && !FORCE_UPDATE && currentBrightness !== null) {
    
    // First: Check if device is in manual mode (persisted)
    if (isManualMode(DEVICE_ID)) {
      // Already in manual mode - skip silently (notification was sent when it was activated)
      if (SETTINGS.enableDetailedLogging) {
        const currentBrightnessPct = Math.round(currentBrightness * 100);
        const currentTempPct = currentTemperature !== null ? Math.round(currentTemperature * 100) : 'N/A';
        log(`[${roomName}] Skipped - manual mode (${currentBrightnessPct}% / ${currentTempPct})`);
      }
      
      return {
        room: roomName,
        skipped: true,
        reason: 'manual_mode',
        currentBrightness: currentBrightness,
        currentTemperature: currentTemperature
      };
    }
    
    // Check if values match active profile (within tolerance)
    const dimDiff = Math.abs(currentBrightness - activeProfile.brightness);
    const tempDiff = currentTemperature !== null 
      ? Math.abs(currentTemperature - activeProfile.temperature) 
      : 0;
    
    const isCorrect = dimDiff <= SETTINGS.tolerance && tempDiff <= SETTINGS.tolerance;
    
    if (isCorrect) {
      // Already at correct values - skip silently
      if (SETTINGS.enableDetailedLogging) {
        log(`[${roomName}] Skipped - already at ${activeProfile.name} values`);
      }
      return {
        room: roomName,
        skipped: true,
        reason: 'already_correct',
        profile: activeProfile.name
      };
    }
    
    // Values don't match active profile - check if they match LAST applied profile
    const lastProfileName = getLastProfile(DEVICE_ID);
    let matchesLastProfile = false;
    
    if (lastProfileName) {
      const lastProfile = roomConfig.profiles.find(p => p.name === lastProfileName);
      if (lastProfile) {
        const lastDimDiff = Math.abs(currentBrightness - lastProfile.brightness);
        const lastTempDiff = currentTemperature !== null 
          ? Math.abs(currentTemperature - lastProfile.temperature) 
          : 0;
        matchesLastProfile = lastDimDiff <= SETTINGS.tolerance && lastTempDiff <= SETTINGS.tolerance;
      }
    } else {
      // No lastProfile recorded yet - this is first check after script update
      // Don't set manual mode, just update to active profile
      if (SETTINGS.enableDetailedLogging) {
        log(`[${roomName}] No lastProfile recorded - initializing with ${activeProfile.name}`);
      }
      matchesLastProfile = true; // Treat as if it matches, so we update without setting manual mode
    }
    
    if (matchesLastProfile) {
      // Values match last profile (or no last profile) - just needs updating to new profile
      if (SETTINGS.enableDetailedLogging && lastProfileName) {
        log(`[${roomName}] Updating from ${lastProfileName} to ${activeProfile.name}`);
      }
      // Continue to apply the new profile (don't return, don't set manual mode)
    } else {
      // Values don't match last profile - this is manual adjustment
      setManualMode(DEVICE_ID, true);
      
      const currentBrightnessPct = Math.round(currentBrightness * 100);
      const currentTempPct = currentTemperature !== null ? Math.round(currentTemperature * 100) : 'N/A';
      const skipMessage = `[${roomName}] Manual mode activated (${currentBrightnessPct}% / ${currentTempPct})`;
      
      if (SETTINGS.enableLogging) {
        log(skipMessage);
      }
      await notify(skipMessage);
      
      return {
        room: roomName,
        skipped: true,
        reason: 'manual_adjustment_detected',
        currentBrightness: currentBrightness,
        currentTemperature: currentTemperature
      };
    }
  }
  
  // Light turned on (normal mode) or force/reset - clear manual mode
  if (!CHECK_MANUAL || FORCE_UPDATE) {
    const wasManual = isManualMode(DEVICE_ID);
    setManualMode(DEVICE_ID, false);
    if (wasManual) {
      const clearMessage = `[${roomName}] Manual mode cleared → auto`;
      if (SETTINGS.enableLogging) {
        log(clearMessage);
      }
      await notify(clearMessage);
    }
  }
  
  // Only use duration for periodic checks (light already on), not when light just turned on
  const useDuration = CHECK_MANUAL && !FORCE_UPDATE && !CLEAR_MANUAL;
  
  // Apply the lighting settings
  const result = await applyLighting(device, activeProfile.brightness, activeProfile.temperature, useDuration);
  
  // Remember which profile was applied (for check mode comparison)
  setLastProfile(DEVICE_ID, activeProfile.name);
  
  // Logging and notifications
  const brightnessPercent = Math.round(activeProfile.brightness * 100);
  const tempPercent = Math.round(activeProfile.temperature * 100);
  const tempDesc = activeProfile.temperature >= 0.7 ? 'warm' : 
                   activeProfile.temperature <= 0.4 ? 'cool' : 'neutral';
  
  const modeIndicator = FORCE_UPDATE ? ' [RESET]' : '';
  const weekendIndicator = roomConfig.usingWeekendProfile ? ' [Weekend]' : '';
  const message = `[${roomName}] ${activeProfile.name} → ${brightnessPercent}% / ${tempDesc}${weekendIndicator}${modeIndicator}`;
  
  // Only log when in check mode (not when light turns on)
  if (SETTINGS.enableLogging && CHECK_MANUAL) {
    log(message);
    
    if (SETTINGS.enableDetailedLogging) {
      const startTimeStr = activeProfile.startTime ?? `${activeProfile.startHour}:00`;
      const endTimeStr = activeProfile.endTime ?? `${activeProfile.endHour}:00`;
      log(`[${roomName}] ├─ Day: ${getDayName()} (${roomConfig.isWeekend ? 'weekend' : 'weekday'})`);
      log(`[${roomName}] ├─ Brightness: ${brightnessPercent}%`);
      log(`[${roomName}] ├─ Temperature: ${tempPercent}% (${tempDesc})`);
      log(`[${roomName}] ├─ Schedule: ${startTimeStr} - ${endTimeStr}`);
      log(`[${roomName}] └─ Temp supported: ${result.temperature ? 'Yes' : 'No'}`);
    }
  }
  
  // Send notification (only in check mode)
  if (CHECK_MANUAL) {
    await notify(message);
  }
  
  // Build message for return value
  const returnMessage = `${roomName}: ${activeProfile.name} → ${brightnessPercent}% / ${tempDesc}${weekendIndicator}`;
  
  // Return data for use in flow (e.g., for notifications)
  return {
    room: roomName,
    profile: activeProfile.name,
    brightness: activeProfile.brightness,
    temperature: activeProfile.temperature,
    time: currentTimeStr,
    day: getDayName(),
    isWeekend: roomConfig.isWeekend,
    usingWeekendProfile: roomConfig.usingWeekendProfile,
    skipped: false,
    forced: FORCE_UPDATE,
    message: returnMessage  // Use this in a notification flow card
  };
  
} catch (error) {
  log(`[AdaptiveLighting] ✗ ERROR: ${error.message}`);
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Device ID: ${DEVICE_ID}`);
    log(`[AdaptiveLighting] Stack: ${error.stack}`);
  }
  return false;
}