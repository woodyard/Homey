// ====== HOMEY ADAPTIVE LIGHTING - CENTRALIZED SCRIPT ======
// Universal script for all rooms with per-room profiles and schedules
//
// Script Name: AdaptiveLighting
// Version:     2.19.0
// Date:        2026-03-31
// Author:      Henrik Skovgaard
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 2.19.0 2026-03-31  Parallel API calls + per-run caching for faster execution
//                    - Device fetch, sun times, and device list run in parallel
//                    - Cache getDevices() result to avoid duplicate API calls
//                    - findGroupMembers() reuses cached device list
//                    - Per-run device state cache: parse JSON once, reuse on repeat reads
//                    - Per-run registerDeviceKey cache: skip index lookup for known keys
//                    - Instant dim + temperature now run in parallel (like duration path)
//                    - Saturation reset + mode switch run in parallel
//                    - Button actions unchanged (single API call fast path)
//                    - Removed legacy migration code and legacy cycle-profile path
// 2.18.0 2026-03-31  Per-device state object (AL_Device_<key>.State)
//                    - Consolidated AL_DeviceStates, AL_Fade_<key>, and forced
//                      profile variables into one state object per device
//                    - Each device has its own global variable — O(1) read/write
//                      instead of parsing all devices on every state access
//                    - DEFAULT_DEVICE_STATE with manual, lastProfile, fadeEndTime,
//                      forcedProfile fields (deep-merged for forward compat)
//                    - FORCED_PROFILE_VARIABLES → FORCED_PROFILE_DEVICES Set
//                    - AL_DeviceKeys index for diagnostics enumeration
//                    - Auto-migration from legacy combined blob on first run
// 2.17.0 2026-03-30  Simplify normal mode: OFF→ON always applies profile
//                    - Removed 500ms wait + ManualRestoreUntil logic for normal mode
//                    - Only skip if fade is actively in progress (let restore handle it)
//                    - Once lights are off, any turn-on gets the profile. No exceptions.
//                    - Check mode unchanged (still uses isDeviceFading + manual mode)
// 2.16.1 2026-03-20  Fix lights snapping back to profile brightness during fade
//                    - Normal mode checks only _FadeActiveUntil (external fades)
//                    - Does NOT check AL_Fade_ (AL's own transitions would false-block)
//                    - Waits 500ms for RestoreSavedSettings to clear → then proceeds or skips
//                    - Check mode still uses full isDeviceFading() as before
//                    - Fixes v2.16.0 regression where fade actions triggered profile apply
// 2.16.0 2026-03-14  Fix mid-fade dim lights on motion detection
//                    - Normal mode (light turn-on) no longer skips for active fade
//                    - Only check mode (hourly updates) respects fade flag
//                    - Fixes lights stuck at 5-30% when entering room during fade-out
//                    - ManualRestoreUntil flag still protects manual brightness
// 2.15.1 2026-03-04  Persistent diagnostic logging (AL_DiagnostikLog)
//                    - Logs profile apply, fade-skip, and manual-restore-skip events
//                    - Shared log variable with GradualFadeOut and RestoreSavedSettings
//                    - Helps diagnose unexpected dim-light issues across profile transitions
// 2.15.0 2026-03-02  Preserve manual adjustments through fade/restore cycle
//                    - Checks _ManualRestoreUntil flag from RestoreSavedSettings
//                    - Skips profile application when manual settings were restored
//                    - Keeps manual mode active so user's brightness persists
//                    - Coordinated with GradualFadeOut v6.1 and RestoreSavedSettings v3.5
// 2.14.3 2026-01-14  Prevent "flash of bright light" when turning on
//                    - Set brightness/temperature WHILE light is off
//                    - Add 100ms delay for command processing
//                    - Then turn on light at correct level
//                    - Mimics Homey UI behavior (works the same way)
// 2.14.2 2026-01-14  Parallel group member control
//                    - Changed from sequential to parallel execution
//                    - All bulbs in group now change simultaneously
//                    - Uses Promise.all() with individual error handling
//                    - Eliminates visible cascade effect (5x speed improvement)
// 2.14.1 2026-01-10  Fix variable scope issue in clear mode
//                    - Moved activeProfile definition earlier in code flow
//                    - Clear mode now has access to activeProfile before using it
//                    - Fixes undefined/incorrect values during clear operation
//                    - Removed duplicate activeProfile declaration
// 2.14.0 2026-01-10  Verification and retry for clear/reset operations
//                    - Added verifyDeviceState() to check applied settings
//                    - Added applyLightingWithRetry() with up to 3 retry attempts
//                    - Clear mode now verifies settings were applied correctly
//                    - Force/reset mode uses verification and retry logic
//                    - Automatic retry with increasing delays (1s, 2s, 3s)
//                    - On verification failure: marks device as fading for 60s
//                    - Prevents false manual mode activation after clear/reset
//                    - Fixes issue where temperature didn't apply to groups
//                    - New settings: enableVerification, verificationRetries, etc.
// 2.13.21 2026-01-08 Use Homey's native sunrise/sunset times
//                    - Fetches sun times from Homey.geolocation API
//                    - Ensures consistency with Homey's own sunrise/sunset alerts
//                    - NOAA algorithm kept as fallback if API fails
//                    - Sun times cached per script execution for efficiency
// 2.13.20 2026-01-07 Skip profile on fade/restore for ALL modes (not just check)
//                    - Normal mode (light turn on) now also checks isDeviceFading()
//                    - Prevents AdaptiveLighting from overriding restored brightness
//                    - Fixes issue where waving mid-fade still applied profile
// 2.13.19 2026-01-07 Support bathroom fade script's new timestamp variable
//                    - isDeviceFading() now checks ${deviceId}_FadeActiveUntil
//                    - Prevents AdaptiveLighting from overriding restored brightness
//                    - Works with GradualFadeOut v5.0 and RestoreSavedSettings v3.1
// 2.13.18 2026-01-06 Fix light not turning on in normal mode
//                    - Normal mode now checks if light is off and turns it on
//                    - Ensures light is actually on before applying brightness/temp
//                    - Button actions already had this, now normal mode has it too
// 2.13.17 2026-01-05 Pre-load entire profile schedule for maximum speed
//                    - Light turn-on and clear now pre-load ALL 4 profiles
//                    - Cycling becomes trivial: just read from array
//                    - No calculation needed during ANY cycle
//                    - All cycles equally fast (ultra fast path)
//                    - Backward compatible with old single-profile format
// 2.13.16 2026-01-05 Pre-calculate first profile on light turn-on and clear
//                    - When light turns on, pre-loads first profile (Morning)
//                    - When clear mode used, also pre-loads first profile
//                    - Eliminates "cold start" delay on first cycle
//                    - Makes even the first profile cycle instant
//                    - Cached data ready as soon as light is on or reset
// 2.13.15 2026-01-05 Pre-calculate next profile for instant cycling
//                    - cycle-profile now uses cached next profile data
//                    - First cycle calculates and stores next profile settings
//                    - Subsequent cycles use pre-calculated data (fast path)
//                    - Eliminates room config lookup on repeated cycles
//                    - Major speed improvement for profile cycling
// 2.13.14 2026-01-05 Performance optimization for button actions
//                    - Button actions now execute immediately (fast path)
//                    - Skips time calculations, room config, profile checks
//                    - Reduces latency from button press to light change
//                    - Moved button handler before all other processing
// 2.13.13 2026-01-05 Button actions auto-turn-on light if off
//                    - brighten, dim-down, max, cycle-profile now turn on light first
//                    - Ensures button always has visible effect
//                    - Toggle remains as pure on/off switch
// 2.13.12 2026-01-05 Added button action argument modes
//                    - New "brighten" mode: +20% brightness
//                    - New "dim-down" mode: -20% brightness
//                    - New "max" mode: 100% brightness
//                    - New "toggle" mode: on/off toggle
//                    - Allows physical buttons to trigger script directly
//                    - All button logic now centralized in script
// 2.13.11 2026-01-05 Support for forced profile cycling via button controls
//                    - Added FORCED_PROFILE_VARIABLES configuration
//                    - New "cycle-profile" argument mode
//                    - Check mode skips if forced profile is active (0-3)
//                    - Clear mode also resets forced profile to -1
//                    - Light turn-on resets forced profile to auto mode
//                    - Uses HomeyScript global variables (no manual setup required)
// 2.13.10 2026-01-03 Fix fade tracking using global.set/get instead of tag()
//                    - tag() function was not persisting fade timestamps correctly
//                    - Switched to global.set/get (same as device states)
//                    - Fixes false manual mode during schedule transitions
//                    - Removed async/await from fade tracking functions
// 2.13.9 2026-01-02  Fix fade tracking not working on schedule changes
//                    - setDeviceFading() now called whenever duration > 0
//                    - Previously only tracked in check mode (useDuration)
//                    - Fixes false manual mode on schedule transitions
// 2.13.8 2026-01-02  Prevent false manual mode during fade transitions
//                    - Device-specific fade tracking (AL_Fade_<deviceKey>)
//                    - Check mode skips if device is currently fading
//                    - 5-second buffer after fade completes
//                    - Also checks bathroom fade script flag (deviceId_FadeActive)
//                    - Works for groups and individual devices
// 2.13.7 2025-12-28  Fix "clear" for groups - also clear group members
//                    - clearManualModeForGroup() clears all X/Y members
//                    - Prevents group from immediately returning to manual mode
//                    - Fixes issue where individual bulbs kept manual mode active
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
// CYCLE PROFILE (for button controls):
// 1. Trigger: Button pressed / Voice command / etc.
// 2. Action: HomeyScript → "Run script with argument"
// 3. Argument: "device-id cycle-profile"
//
// The "cycle-profile" mode cycles through forced profiles (Morning → Daytime → Evening → Night → Morning).
// Configure device IDs in FORCED_PROFILE_DEVICES.
// Uses unified device state (no manual variable setup required).
//
// BUTTON ACTIONS (for physical button controls):
// "device-id brighten"  → Increase brightness by 20%
// "device-id dim-down"  → Decrease brightness by 20%
// "device-id max"       → Set to 100% brightness
// "device-id toggle"    → Toggle light on/off
//
// ARGUMENT MODES:
//   "device-id"              Always apply profile, clear manual mode (for "turned on" triggers)
//   "device-id check"        Check first, skip if in manual/forced mode (for hourly updates)
//   "device-id force"        Always apply, clear manual mode (explicit reset)
//   "device-id reset"        Same as force
//   "device-id clear"        Clear manual mode and forced profile, apply time-based profile
//   "device-id cycle-profile" Cycle to next forced profile (for button controls)
//   "device-id brighten"     Increase brightness by 20% (for button controls)
//   "device-id dim-down"     Decrease brightness by 20% (for button controls)
//   "device-id max"          Set to 100% brightness (for button controls)
//   "device-id toggle"       Toggle light on/off (for button controls)
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
    { name: "Morning",  startTime: "06:00",              endTime: "sunrise+30>08:00",      brightness: 0.20, temperature: 0.55 },
    { name: "Daytime",  startTime: "sunrise+30>08:00",   endTime: "sunset-60>15:30<19:00", brightness: 0.55, temperature: 0.40 },
    { name: "Evening",  startTime: "sunset-60>15:30<19:00", endTime: "21:00",             brightness: 0.20, temperature: 0.70 },
    { name: "Night",    startTime: "21:00",              endTime: "06:00",                 brightness: 0.08, temperature: 0.70 }
  ],
  
  // Stue (living room) - reduced morning brightness, comfortable evening
  stue: [
    { name: "Morning",  startTime: "06:00",              endTime: "sunrise+30>08:00",      brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "sunrise+30>08:00",   endTime: "sunset-60>15:30<19:00", brightness: 0.80, temperature: 0.4 },
    { name: "Evening",  startTime: "sunset-60>15:30<19:00", endTime: "21:00",             brightness: 0.35, temperature: 0.9 },
    { name: "Night",    startTime: "21:00",              endTime: "06:00",                 brightness: 0.10, temperature: 0.9 }
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
    { name: "Morning",  startTime: "06:00", endTime: "08:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "08:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "20:00", brightness: 0.35, temperature: 0.7 },
    { name: "Night",    startTime: "20:00", endTime: "06:00", brightness: 0.05, temperature: 1.0 }
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
  ],
  
  // Bathroom weekend - gentler morning light, later start
  bathroomWeekend: [
    { name: "Morning",  startTime: "08:30", endTime: "10:00", brightness: 0.6,  temperature: 0.5 },
    { name: "Daytime",  startTime: "10:00", endTime: "21:00", brightness: 0.9,  temperature: 0.4 },
    { name: "Evening",  startTime: "21:00", endTime: "23:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "23:00", endTime: "07:00", brightness: 0.08, temperature: 1.0 }
  ],
  
  // Entrance weekend - softer morning light, later start
  entranceWeekend: [
    { name: "Morning",  startTime: "08:30", endTime: "10:00", brightness: 0.35, temperature: 0.8 },
    { name: "Daytime",  startTime: "10:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "23:00", brightness: 0.4,  temperature: 0.7 },
    { name: "Night",    startTime: "23:00", endTime: "07:00", brightness: 0.10, temperature: 1.0 }
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
  "fd754abf-4397-45f5-9a68-98d7f079fd7b": {
    name: "ST Loft",
    profiles: PROFILES.filament  // Gruppe med 5 filament pærer
  },
  "3f4e2391-3be6-44ee-b340-fcc3219853b2": {
    name: "ST Standerlampe",
    profiles: PROFILES.stue  // Gruppe med 2 pærer
  },
  // Stue Lyskæde fjernet - kun on/off, ingen dim

  // =====================================================================
  // SPISESTUE (Dining Room) - Kertemindegade 9
  // =====================================================================
  "18b6f5bf-1666-4bf1-92be-d9cb7e6b74c5": {
    name: "SS Loft",
    profiles: PROFILES.dining
  },
  "5ccf5881-f665-40f5-bd89-f61e1f926d4c": {
    name: "SS Bordlampe",
    profiles: PROFILES.dining
  },
  "cc30f76b-7634-489c-a721-541fdb49d46f": {
    name: "SS Light Perler",
    profiles: PROFILES.dining  // Twinkly
  },

  // =====================================================================
  // SOVEVÆRELSE (Bedroom) - Kertemindegade 9
  // =====================================================================
  "cbbd7c60-dc84-43c7-8f0f-790556fc9b14": {
    name: "SV Loft",
    profiles: PROFILES.bedroom,              // Weekdays
    weekendProfiles: PROFILES.bedroomWeekend // Weekends - later morning
  },

  // =====================================================================
  // KØKKEN (Kitchen) - Kertemindegade 9
  // =====================================================================
  "f097b38c-cfb0-4b83-8124-59e35f82cd0f": {
    name: "K Loft",
    profiles: PROFILES.kitchen  // Gruppe med 3 pærer
  },
  "0e5d845d-d8ea-4db6-8096-663b0a311e07": {
    name: "K Bord",
    profiles: PROFILES.kitchen  // Gruppe med 3 pærer
  },

  // =====================================================================
  // BADEVÆRELSE 9 (Bathroom) - Kertemindegade 9
  // =====================================================================
  "b8591f4d-a493-4de7-9745-c13cd07e033c": {
    name: "B9 Lys",
    profiles: PROFILES.bathroom,              // Weekdays
    weekendProfiles: PROFILES.bathroomWeekend // Weekends - gentler morning light
  },

  // =====================================================================
  // BADEVÆRELSE 7 (Bathroom) - Kertemindegade 7
  // =====================================================================
  "1ab9ca1f-60ca-44f9-8221-a03e10f005bf": {
    name: "B7 Lys",
    profiles: PROFILES.bathroom  // Gruppe
  },

  // =====================================================================
  // ENTRE 9 (Entrance) - Kertemindegade 9
  // =====================================================================
  "2656f184-8c87-4434-95a2-fdb3fc36bdd8": {
    name: "E9 Loft",
    profiles: PROFILES.entrance,              // Weekdays
    weekendProfiles: PROFILES.entranceWeekend // Weekends - softer morning light
  },
  "e339c184-ea11-4413-bd90-dac726861fd0": {
    name: "E9 Garderobe",
    profiles: PROFILES.entrance,              // Weekdays
    weekendProfiles: PROFILES.entranceWeekend // Weekends - softer morning light
  },

  // =====================================================================
  // ENTRE 7 (Entrance) - Kertemindegade 7
  // =====================================================================
  "b135fbd5-dda4-4957-9cce-6184fa5c731a": {
    name: "E7 Lys",
    profiles: PROFILES.entrance
  },

  // =====================================================================
  // OLIVERS VÆRELSE (Oliver's Room) - Kertemindegade 9
  // =====================================================================
  "1e87af68-506e-4c86-8bc9-ffc6a05f3ef0": {
    name: "O Loft",
    profiles: PROFILES.kidsRoom,
    weekendProfiles: PROFILES.kidsRoomWeekend  // Later bedtime on weekends
  },

  // =====================================================================
  // CLARAS VÆRELSE (Clara's Room) - Kertemindegade 7
  // =====================================================================
  "9b15cb64-bf61-494d-be49-f3dcd9dfd0bf": {
    name: "C Loft",
    profiles: PROFILES.kidsRoom,
    weekendProfiles: PROFILES.kidsRoomWeekend  // Later bedtime on weekends
  },
  "5acaab17-7864-4831-b6e2-72bd35588b21": {
    name: "C LightStrip",
    profiles: PROFILES.kidsRoom
  },
  "4c34d605-334b-4207-b9a3-1796829b0caf": {
    name: "C Light Svampelampe",
    profiles: PROFILES.kidsRoom  // Kun dim, ingen temperatur
  },

  // =====================================================================
  // ALTAN (Balcony)
  // =====================================================================
  "16a55a55-d67b-4b85-9562-cc4f11e12975": {
    name: "A Light Lyskæde",
    profiles: PROFILES.standard  // Twinkly
  }
};

// ====== FORCED PROFILE VARIABLES ======
// Maps device IDs to global variable names for forced profile tracking
// Variable value: -1 = auto (follow time-based schedule), 0-3 = forced profile index
// Profiles are indexed as: 0 = Morning, 1 = Daytime, 2 = Evening, 3 = Night
//
// Uses HomeyScript global variables (no manual setup required)
// Variables are automatically created when first used
//
// Usage with button controls:
// - Double-click top button: Run script with "deviceId cycle-profile"
// - Double-click bottom button: Run script with "deviceId clear" (resets to -1)
//
const FORCED_PROFILE_DEVICES = new Set([
  "1e87af68-506e-4c86-8bc9-ffc6a05f3ef0",  // Oliver's room
  // Add more device IDs here as needed:
  // "8938b436-6c9b-4b88-89c4-656ca842b1c8",  // Clara's room
]);

// ====== SCRIPT SETTINGS ======
const SETTINGS = {
  timezone: 'Europe/Copenhagen',
  latitude: 55.6761,             // København latitude (for sunrise/sunset fallback)
  longitude: 12.5683,            // København longitude (for sunrise/sunset fallback)
  enableLogging: true,           // Log to HomeyScript console
  enableDetailedLogging: false,  // Extra debug info in console
  enableNotifications: false,    // Send notifications to Homey timeline
  tolerance: 0.10,               // 10% tolerance when comparing values
  transitionDuration: 60,        // Fade time in SECONDS (60 = 1 min, 0 = instant)
                                 // Note: Only works on devices that support duration (Hue, IKEA, etc.)
  turnOnTransitionDuration: 1,   // Quick fade when turning on (1s masks hardware flash)
  enableVerification: true,      // Verify settings after clear/reset operations
  verificationRetries: 3,        // Max retry attempts for verification
  verificationDelay: 1500,       // Wait time before verification (ms)
  verificationTolerance: 0.10,   // Tolerance for verification (10%)
  failedVerificationBuffer: 60   // Fade buffer duration if verification fails (seconds)
};

// ====== SUN TIMES CACHE ======
// Populated once per script run by fetchSunTimesFromHomey()
let CACHED_SUN_TIMES = null;
let CACHED_ALL_DEVICES = null;

// ====== PERSISTENT DIAGNOSTIC LOG ======
// Shared log across GradualFadeOut, RestoreSavedSettings, and AdaptiveLighting.
// All three scripts append to the same global variable: AL_DiagnostikLog
// See GradualFadeOut header comment for full format and action descriptions.
// Max 500 lines retained. Read via: global.get('AL_DiagnostikLog')
function diagLog(entry) {
  const now = new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const logText = global.get('AL_DiagnostikLog') || '';
  const newEntry = `${now} | ${entry}\n`;
  const lines = (logText + newEntry).split('\n').filter(l => l.length > 0);
  const trimmed = lines.slice(-500).join('\n') + '\n';
  global.set('AL_DiagnostikLog', trimmed);
}

// ====== HELPER FUNCTIONS ======

/**
 * Fetch sunrise/sunset from Homey's native geolocation API
 * This ensures consistency with Homey's own sunrise/sunset triggers and alerts
 * Returns: { sunriseMinutes, sunsetMinutes } or null if failed
 */
async function fetchSunTimesFromHomey() {
  try {
    const location = await Homey.geolocation.getGeolocation();
    
    if (!location.sunrise || !location.sunset) {
      if (SETTINGS.enableDetailedLogging) {
        log('[AdaptiveLighting] Homey geolocation missing sunrise/sunset, using NOAA fallback');
      }
      return null;
    }
    
    // Homey returns sunrise/sunset as ISO strings
    const sunriseDate = new Date(location.sunrise);
    const sunsetDate = new Date(location.sunset);
    
    // Convert to Copenhagen local time (handles DST automatically)
    const sunriseStr = sunriseDate.toLocaleString('en-US', { 
      timeZone: 'Europe/Copenhagen',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const sunsetStr = sunsetDate.toLocaleString('en-US', { 
      timeZone: 'Europe/Copenhagen',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const [sunriseHours, sunriseMinutes] = sunriseStr.split(':').map(Number);
    const [sunsetHours, sunsetMinutes] = sunsetStr.split(':').map(Number);
    
    CACHED_SUN_TIMES = {
      sunriseMinutes: sunriseHours * 60 + sunriseMinutes,
      sunsetMinutes: sunsetHours * 60 + sunsetMinutes,
      source: 'homey'
    };
    
    if (SETTINGS.enableDetailedLogging) {
      log(`[AdaptiveLighting] Homey sun times: sunrise=${sunriseStr}, sunset=${sunsetStr}`);
    }
    
    return CACHED_SUN_TIMES;
  } catch (e) {
    if (SETTINGS.enableDetailedLogging) {
      log(`[AdaptiveLighting] Homey geolocation failed: ${e.message}, using NOAA fallback`);
    }
    return null;
  }
}

/**
 * Get sunrise and sunset times (uses cache, falls back to NOAA calculation)
 * Returns: { sunriseMinutes, sunsetMinutes }
 */
function getSunTimes(date) {
  // Return cached times if available (set by fetchSunTimesFromHomey)
  if (CACHED_SUN_TIMES) {
    return CACHED_SUN_TIMES;
  }
  
  // Fallback to NOAA calculation
  return getSunTimesNOAA(date);
}

/**
 * Calculate sunrise and sunset times using NOAA algorithm
 * Used as fallback when Homey API is unavailable
 */
function getSunTimesNOAA(date) {
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

// ====== UNIFIED DEVICE STATE ======
// One state object per device, stored in its own global variable.
// Key format: AL_Device_<deviceKey>.State (e.g. AL_Device_1e87af68.State)
// Each call only parses/serializes one device — no wasted work on other devices.

const AL_STATE_PREFIX = 'AL_Device_';
const AL_STATE_SUFFIX = '.State';
const AL_DEVICE_INDEX_KEY = 'AL_DeviceKeys';

const DEFAULT_DEVICE_STATE = {
  manual: false,          // Device in manual mode (user adjusted brightness/temp)
  lastProfile: null,      // Name of last applied profile
  fadeEndTime: 0,         // AL's own fade end timestamp (ms)
  forcedProfile: {
    index: -1,            // -1 = auto, 0-3 = forced profile
    profiles: null        // Cached profile schedule (array of 4)
  }
};

/**
 * Get the global variable key for a device's state
 */
function stateKey(deviceId) {
  return `${AL_STATE_PREFIX}${getDeviceKey(deviceId)}${AL_STATE_SUFFIX}`;
}

// Per-run cache: avoids repeated global.get + JSON.parse for the same device
const _stateRunCache = new Map();

/**
 * Get state for a single device (with default-merge for forward compat)
 * Only parses this one device's JSON — O(1) regardless of total device count
 * Cached per script run: subsequent reads for the same device return the cached object
 */
function getDeviceState(deviceId) {
  const key = stateKey(deviceId);
  if (_stateRunCache.has(key)) {
    return _stateRunCache.get(key);
  }

  let state;
  try {
    const raw = global.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = {
        ...DEFAULT_DEVICE_STATE,
        ...parsed,
        forcedProfile: { ...DEFAULT_DEVICE_STATE.forcedProfile, ...(parsed.forcedProfile || {}) }
      };
    }
  } catch (e) {
    // Parse error — return defaults
  }

  if (!state) {
    state = { ...DEFAULT_DEVICE_STATE, forcedProfile: { ...DEFAULT_DEVICE_STATE.forcedProfile } };
  }

  _stateRunCache.set(key, state);
  return state;
}

/**
 * Save state for a single device
 * Only serializes this one device's JSON — O(1)
 */
function saveDeviceState(deviceId, state) {
  global.set(stateKey(deviceId), JSON.stringify(state));
  registerDeviceKey(deviceId);
}

// Per-run cache: avoids repeated index reads for already-registered devices
const _registeredKeys = new Set();

/**
 * Register a device key in the device index (for diagnostics enumeration)
 * Lightweight: only updates index when a new device is first seen
 * Cached per run: skips global.get entirely for keys already confirmed
 */
function registerDeviceKey(deviceId) {
  const key = getDeviceKey(deviceId);
  if (_registeredKeys.has(key)) return;

  const index = getDeviceIndex();
  if (index.includes(key)) {
    _registeredKeys.add(key);
    return;
  }
  index.push(key);
  global.set(AL_DEVICE_INDEX_KEY, JSON.stringify(index));
  _registeredKeys.add(key);
}

/**
 * Get list of all known device keys (for diagnostics)
 */
function getDeviceIndex() {
  try {
    const data = global.get(AL_DEVICE_INDEX_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Check if device is in manual mode
 */
function isManualMode(deviceId) {
  return getDeviceState(deviceId).manual === true;
}

/**
 * Set manual mode for a device
 */
function setManualMode(deviceId, enabled) {
  const state = getDeviceState(deviceId);
  state.manual = enabled;
  saveDeviceState(deviceId, state);

  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Manual mode ${enabled ? 'enabled' : 'disabled'} for ${getDeviceKey(deviceId)}`);
  }
}

/**
 * Get last applied profile for a device
 */
function getLastProfile(deviceId) {
  return getDeviceState(deviceId).lastProfile || null;
}

/**
 * Set last applied profile for a device
 */
function setLastProfile(deviceId, profileName) {
  const state = getDeviceState(deviceId);
  state.lastProfile = profileName;
  state.manual = false; // Clear manual mode when profile is applied
  saveDeviceState(deviceId, state);

  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Last profile set to ${profileName} for ${getDeviceKey(deviceId)}`);
  }
}

/**
 * Mark device as fading (transition in progress)
 * @param {string} deviceId - Device ID
 * @param {number} duration - Fade duration in seconds
 */
function setDeviceFading(deviceId, duration) {
  const state = getDeviceState(deviceId);
  state.fadeEndTime = Date.now() + (duration * 1000) + 5000; // Add 5sec buffer
  saveDeviceState(deviceId, state);

  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Fade started for ${getDeviceKey(deviceId)} - ${duration}s + 5s buffer`);
  }
}

/**
 * Check if device is currently fading
 * Checks:
 * 1. Unified state fadeEndTime (AL's own transition tracking)
 * 2. External: GradualFadeOut timestamp (${deviceId}_FadeActiveUntil)
 * 3. External: GradualFadeOut legacy flag (${deviceId}_FadeActive)
 * @param {string} deviceId - Device ID
 * @returns {boolean} True if fade is in progress
 */
function isDeviceFading(deviceId) {
  const deviceKey = getDeviceKey(deviceId);

  // Check unified state fadeEndTime
  const state = getDeviceState(deviceId);
  const timestampFading = Date.now() < state.fadeEndTime;

  if (timestampFading && SETTINGS.enableDetailedLogging) {
    const remaining = Math.round((state.fadeEndTime - Date.now()) / 1000);
    log(`[AdaptiveLighting] Device ${deviceKey} still fading (${remaining}s remaining)`);
  }

  // Check external: GradualFadeOut timestamp-based tracking (v5.0+)
  const bathroomFadeUntil = global.get(`${deviceId}_FadeActiveUntil`) || 0;
  const bathroomFading = Date.now() < bathroomFadeUntil;

  if (bathroomFading && SETTINGS.enableDetailedLogging) {
    const remaining = Math.round((bathroomFadeUntil - Date.now()) / 1000);
    log(`[AdaptiveLighting] Device ${deviceKey} has external fade active (${remaining}s remaining)`);
  }

  // Check external: GradualFadeOut legacy flag-based tracking (backwards compat)
  const fadeActiveVar = `${deviceId}_FadeActive`;
  const flagFading = global.get(fadeActiveVar) === true;

  if (flagFading && SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Device ${deviceKey} has legacy FadeActive flag set`);
  }

  // Return true if ANY system indicates fading
  return timestampFading || bathroomFading || flagFading;
}

/**
 * Get forced profile data for a device from unified state
 * @param {string} deviceId - Device ID
 * @returns {object|null} Profile data {index, profiles} or null if auto mode / not configured
 */
function getForcedProfileData(deviceId) {
  if (!FORCED_PROFILE_DEVICES.has(deviceId)) {
    return null; // Device not configured for forced profiles
  }

  const state = getDeviceState(deviceId);
  const fp = state.forcedProfile;

  // Valid forced profile data has index 0-3
  if (fp && fp.index >= 0 && fp.index <= 3) {
    return fp;
  }
  return null; // Auto mode
}

/**
 * Get just the forced profile index
 * @param {string} deviceId - Device ID
 * @returns {number|null} Profile index (0-3) or null if auto mode
 */
function getForcedProfile(deviceId) {
  const data = getForcedProfileData(deviceId);
  return data ? data.index : null;
}

/**
 * Set forced profile with optional pre-calculated profile schedule
 * @param {string} deviceId - Device ID
 * @param {number} profileIndex - Profile index (-1 for auto, 0-3 for forced)
 * @param {array|object} profileData - Optional: Array of all profiles OR single profile object
 */
function setForcedProfile(deviceId, profileIndex, profileData = null) {
  if (!FORCED_PROFILE_DEVICES.has(deviceId)) {
    return; // Device not configured for forced profiles
  }

  const state = getDeviceState(deviceId);

  if (profileIndex === -1) {
    state.forcedProfile = {
      index: -1,
      profiles: Array.isArray(profileData) ? profileData : null
    };
  } else if (Array.isArray(profileData)) {
    state.forcedProfile = {
      index: profileIndex,
      profiles: profileData
    };
  } else {
    state.forcedProfile = { index: profileIndex, profiles: null };
  }

  saveDeviceState(deviceId, state);

  if (SETTINGS.enableDetailedLogging) {
    const mode = profileIndex === -1 ? 'auto' : `forced profile ${profileIndex}`;
    const scheduleInfo = Array.isArray(profileData) ? ` (full schedule pre-loaded)` : '';
    log(`[AdaptiveLighting] Set forced profile for ${getDeviceKey(deviceId)} to ${mode}${scheduleInfo}`);
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
 * Find group members by name pattern (e.g., "SV Light Loft" → "SV Light Loft 1/3", "SV Light Loft 2/3")
 */
async function findGroupMembers(groupName) {
  if (!CACHED_ALL_DEVICES) {
    CACHED_ALL_DEVICES = await Homey.devices.getDevices();
  }
  const members = [];

  for (const d of Object.values(CACHED_ALL_DEVICES)) {
    // Match "GroupName X/Y" pattern
    if (d.name.startsWith(groupName + ' ') && d.name !== groupName && d.class === 'light') {
      members.push(d);
    }
  }
  
  return members;
}

/**
 * Clear manual mode for a device and all its group members (if it's a group)
 * Per-device state: each write is O(1), no cross-device overhead
 */
async function clearManualModeForGroup(deviceId, deviceName) {
  const members = await findGroupMembers(deviceName);

  // Clear main device
  const state = getDeviceState(deviceId);
  state.manual = false;
  saveDeviceState(deviceId, state);

  // Clear group members
  for (const member of members) {
    const memberState = getDeviceState(member.id);
    memberState.manual = false;
    saveDeviceState(member.id, memberState);
  }

  if (members.length > 0 && SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Clearing manual mode for group ${deviceName} and ${members.length} members`);
    for (const member of members) {
      log(`[AdaptiveLighting] - Cleared ${member.name}`);
    }
  }
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

    // Run saturation reset and mode switch in parallel (independent operations)
    const preOps = [];
    if (currentSaturation !== undefined && currentSaturation > 0.1) {
      preOps.push(device.setCapabilityValue('light_saturation', 0));
      if (SETTINGS.enableDetailedLogging) {
        log(`[AdaptiveLighting] Reset saturation on ${device.name} from ${Math.round(currentSaturation * 100)}% to 0%`);
      }
    }
    if (currentMode === 'color') {
      preOps.push(device.setCapabilityValue('light_mode', 'temperature'));
      if (SETTINGS.enableDetailedLogging) {
        log(`[AdaptiveLighting] Switched ${device.name} from color to temperature mode`);
      }
    }
    if (preOps.length) await Promise.all(preOps);
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
  
  // Instant change (no duration) - run in parallel like the duration path
  const [dimOk, tempOk] = await Promise.all([
    device.setCapabilityValue('dim', brightness).then(() => true).catch(() => false),
    device.setCapabilityValue('light_temperature', temperature).then(() => true).catch(() => false)
  ]);
  return { brightness: dimOk, temperature: tempOk };
}

/**
 * Apply brightness and temperature to a device or group
 * Uses flow card action with duration for smooth transitions
 * @param {object} device - The device object
 * @param {number} brightness - Target brightness (0-1)
 * @param {number} temperature - Target color temperature (0-1)
 * @param {boolean} useDuration - Whether to use fade duration (false for instant)
 * @param {number} customDuration - Optional custom duration in seconds (overrides useDuration)
 */
async function applyLighting(device, brightness, temperature, useDuration = false, customDuration = null) {
  const duration = customDuration !== null ? customDuration : (useDuration ? SETTINGS.transitionDuration : 0); // seconds
  
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Applying: dim=${brightness}, temp=${temperature}, duration=${duration}s`);
  }
  
  // Mark devices as fading whenever we apply a fade (regardless of mode)
  // This ensures check mode knows to skip during the transition
  if (duration > 0) {
    setDeviceFading(device.id, duration);
  }
  
  // Find group members (if any)
  const members = await findGroupMembers(device.name);
  const isGroup = members.length > 0;
  
  if (isGroup) {
    // Mark all group members as fading
    if (duration > 0) {
      for (const member of members) {
        setDeviceFading(member.id, duration);
      }
    }
    
    // Apply to each member
    if (SETTINGS.enableDetailedLogging) {
      log(`[AdaptiveLighting] Group detected with ${members.length} members`);
    }
    
    // Apply to all members simultaneously
    const memberPromises = members.map(member =>
      applyToDevice(member, brightness, temperature, duration)
        .catch(e => {
          if (SETTINGS.enableDetailedLogging) {
            log(`[AdaptiveLighting] Member ${member.name} error: ${e.message}`);
          }
          return { error: true, member: member.name };
        })
    );
    
    await Promise.all(memberPromises);
    return { brightness: true, temperature: true };
    
  } else {
    // Single device
    return await applyToDevice(device, brightness, temperature, duration);
  }
}

/**
 * Verify device state matches expected values
 * For groups, checks the group's reported state
 * @param {object} device - Device object
 * @param {number} expectedBrightness - Expected brightness (0-1)
 * @param {number} expectedTemperature - Expected temperature (0-1)
 * @param {number} tolerance - Tolerance for comparison (default: SETTINGS.verificationTolerance)
 * @returns {object} { success: boolean, brightness: number, temperature: number, errors: [] }
 */
async function verifyDeviceState(device, expectedBrightness, expectedTemperature, tolerance = SETTINGS.verificationTolerance) {
  // Wait briefly for state to propagate
  await new Promise(resolve => setTimeout(resolve, SETTINGS.verificationDelay));
  
  // Re-fetch device to get latest state
  const freshDevice = await Homey.devices.getDevice({ id: device.id });
  
  const currentBrightness = freshDevice.capabilitiesObj?.dim?.value ?? null;
  const currentTemperature = freshDevice.capabilitiesObj?.light_temperature?.value ?? null;
  
  const errors = [];
  
  // Check brightness
  const brightnessDiff = currentBrightness !== null
    ? Math.abs(currentBrightness - expectedBrightness)
    : 0;
  
  const brightnessMatch = currentBrightness !== null && brightnessDiff <= tolerance;
  
  if (!brightnessMatch) {
    errors.push(`Brightness mismatch: expected ${Math.round(expectedBrightness * 100)}%, got ${Math.round(currentBrightness * 100)}%`);
  }
  
  // Check temperature (only if device supports it)
  const temperatureDiff = currentTemperature !== null
    ? Math.abs(currentTemperature - expectedTemperature)
    : 0;
  
  const temperatureMatch = currentTemperature !== null && temperatureDiff <= tolerance;
  
  if (!temperatureMatch && currentTemperature !== null) {
    errors.push(`Temperature mismatch: expected ${Math.round(expectedTemperature * 100)}%, got ${Math.round(currentTemperature * 100)}%`);
  }
  
  return {
    success: brightnessMatch && (temperatureMatch || currentTemperature === null),
    brightness: currentBrightness,
    temperature: currentTemperature,
    brightnessDiff,
    temperatureDiff,
    errors
  };
}

/**
 * Apply lighting with verification and retry
 * @param {object} device - Device object
 * @param {number} brightness - Target brightness
 * @param {number} temperature - Target temperature
 * @param {string} profileName - Profile name for logging
 * @param {boolean} useDuration - Whether to use fade duration
 * @returns {object} Result with verification status
 */
async function applyLightingWithRetry(device, brightness, temperature, profileName, useDuration = false) {
  const maxRetries = SETTINGS.verificationRetries;
  let attempt = 0;
  let lastError = null;
  
  while (attempt < maxRetries) {
    attempt++;
    
    if (attempt > 1 && SETTINGS.enableLogging) {
      log(`[${device.name}] Retry attempt ${attempt}/${maxRetries}`);
    }
    
    // Apply the lighting
    await applyLighting(device, brightness, temperature, useDuration);
    
    // Skip verification for fade operations (state will change gradually)
    if (useDuration) {
      return {
        success: true,
        attempts: attempt,
        skippedVerification: true
      };
    }
    
    // Skip verification if disabled
    if (!SETTINGS.enableVerification) {
      return {
        success: true,
        attempts: attempt,
        skippedVerification: true
      };
    }
    
    // Verify it worked
    const verification = await verifyDeviceState(device, brightness, temperature);
    
    if (verification.success) {
      if (attempt > 1 && SETTINGS.enableLogging) {
        log(`[${device.name}] ✓ Verification succeeded on attempt ${attempt}`);
      }
      return {
        success: true,
        attempts: attempt,
        verification
      };
    }
    
    // Verification failed
    lastError = verification.errors.join(', ');
    
    if (SETTINGS.enableLogging) {
      log(`[${device.name}] ✗ Verification failed (attempt ${attempt}): ${lastError}`);
    }
    
    // Wait before retry (longer each time: 1s, 2s, 3s)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  // All retries failed
  if (SETTINGS.enableLogging) {
    log(`[${device.name}] ✗ All ${maxRetries} attempts failed. Last error: ${lastError}`);
  }
  
  return {
    success: false,
    attempts: maxRetries,
    error: lastError,
    verification: null
  };
}

// ====== MAIN SCRIPT ======

// Handle args - can be string directly or array depending on HomeyScript context
// runWithArg passes argument as args (string), runCode may pass as args[0]
const argString = typeof args === 'string' ? args : 
                  (Array.isArray(args) ? args[0] : args?.[0]) || '';
const argParts = argString.toString().trim().split(/\s+/);
const DEVICE_ID = argParts[0] || "3f4e2391-3be6-44ee-b340-fcc3219853b2"; // Default: ST Standerlampe
const MODE_ARG = (argParts[1] || '').toLowerCase();

const CHECK_MANUAL = MODE_ARG === 'check' || MODE_ARG === 'hourly';
const FORCE_UPDATE = MODE_ARG === 'force' || MODE_ARG === 'reset';
const CLEAR_MANUAL = MODE_ARG === 'clear' || MODE_ARG === 'off';
const CYCLE_PROFILE = MODE_ARG === 'cycle-profile' || MODE_ARG === 'cycle';
const BUTTON_BRIGHTEN = MODE_ARG === 'brighten' || MODE_ARG === 'button-brighten';
const BUTTON_DIM = MODE_ARG === 'dim-down' || MODE_ARG === 'dim' || MODE_ARG === 'button-dim';
const BUTTON_MAX = MODE_ARG === 'max' || MODE_ARG === 'button-max';
const BUTTON_TOGGLE = MODE_ARG === 'toggle' || MODE_ARG === 'button-toggle';

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
  log(`[AdaptiveLighting] Modes: check, force/reset, cycle-profile, brighten, dim-down, max, toggle, clear`);
  return false;
}

try {
  // Get the device from Homey
  // For button actions: only fetch the device (fast path)
  // For all other modes: fetch device, sun times, and device list in parallel
  const isButtonMode = BUTTON_BRIGHTEN || BUTTON_DIM || BUTTON_MAX || BUTTON_TOGGLE;
  let device;
  if (isButtonMode) {
    device = await Homey.devices.getDevice({ id: DEVICE_ID });
  } else {
    const [_device, , _allDevices] = await Promise.all([
      Homey.devices.getDevice({ id: DEVICE_ID }),
      fetchSunTimesFromHomey(),
      Homey.devices.getDevices()
    ]);
    device = _device;
    CACHED_ALL_DEVICES = _allDevices;
  }

  // FAST PATH: Handle button actions immediately (no room config, no time calc, minimal overhead)
  if (isButtonMode) {
    const isOn = device.capabilitiesObj?.onoff?.value ?? false;
    
    if (BUTTON_BRIGHTEN) {
      if (!isOn) await device.setCapabilityValue('onoff', true);
      const currentBrightness = device.capabilitiesObj?.dim?.value ?? 0.5;
      const newBrightness = Math.min(1.0, currentBrightness + 0.2);
      await device.setCapabilityValue('dim', newBrightness);
      return { action: 'brighten', brightness: newBrightness };
    }
    
    if (BUTTON_DIM) {
      if (!isOn) await device.setCapabilityValue('onoff', true);
      const currentBrightness = device.capabilitiesObj?.dim?.value ?? 0.5;
      const newBrightness = Math.max(0.01, currentBrightness - 0.2);
      await device.setCapabilityValue('dim', newBrightness);
      return { action: 'dim', brightness: newBrightness };
    }
    
    if (BUTTON_MAX) {
      if (!isOn) await device.setCapabilityValue('onoff', true);
      await device.setCapabilityValue('dim', 1.0);
      return { action: 'max', brightness: 1.0 };
    }
    
    if (BUTTON_TOGGLE) {
      await device.setCapabilityValue('onoff', !isOn);
      return { action: 'toggle', state: !isOn };
    }
  }
  
  // Get room configuration (custom or default) - only needed for non-button actions
  const currentMinutes = getCurrentTimeInMinutes();
  const currentTimeStr = formatMinutesToTime(currentMinutes);
  const roomConfig = getRoomConfig(DEVICE_ID, device.name);
  const roomName = roomConfig.name;

  // Find active profile for current time (needed by clear mode and other operations)
  const activeProfile = findActiveProfile(roomConfig.profiles, currentMinutes);
  
  // Handle "cycle-profile" mode - cycle through forced profiles
  if (CYCLE_PROFILE) {
    // Check if light is off and turn it on
    const isOn = device.capabilitiesObj?.onoff?.value ?? false;
    if (!isOn) {
      await device.setCapabilityValue('onoff', true);
    }
    
    // Get cached profile schedule
    const cachedData = getForcedProfileData(DEVICE_ID);
    
    if (cachedData && cachedData.profiles && Array.isArray(cachedData.profiles)) {
      // ULTRA FAST PATH: Use pre-loaded profile schedule (no calculations!)
      const currentIndex = cachedData.index >= 0 ? cachedData.index : -1;
      const nextIndex = (currentIndex + 1) % 4;
      const nextProfile = cachedData.profiles[nextIndex];
      
      // Apply the profile instantly - just read from array!
      await device.setCapabilityValue('dim', nextProfile.brightness);
      try {
        await device.setCapabilityValue('light_temperature', nextProfile.temperature);
      } catch (e) {
        // Device might not support temperature
      }
      
      // Update index (keep the same profile schedule)
      setForcedProfile(DEVICE_ID, nextIndex, cachedData.profiles);
      
      setLastProfile(DEVICE_ID, nextProfile.name);
      await clearManualModeForGroup(DEVICE_ID, device.name);
      
      const brightnessPercent = Math.round(nextProfile.brightness * 100);
      const tempDesc = nextProfile.temperature >= 0.7 ? 'warm' : 
                       nextProfile.temperature <= 0.4 ? 'cool' : 'neutral';
      const message = `[${roomName}] ${nextProfile.name} mode activated → ${brightnessPercent}% / ${tempDesc} [Forced]`;
      
      if (SETTINGS.enableLogging) {
        log(message);
      }
      await notify(message);
      
      return {
        room: roomName,
        profile: nextProfile.name,
        profileIndex: nextIndex,
        brightness: nextProfile.brightness,
        temperature: nextProfile.temperature,
        forced: true,
        wasOff: !isOn,
        ultraFastPath: true,
        message: message
      };
    }
    
    // No cache yet - calculate full schedule from room config
    const currentIndex = cachedData ? cachedData.index : null;
    const nextIndex = currentIndex === null ? 0 : (currentIndex + 1) % 4;
    
    const profiles = roomConfig.profiles;
    if (nextIndex >= profiles.length) {
      log(`[AdaptiveLighting] ✗ ERROR: Profile index ${nextIndex} out of range for ${roomName}`);
      return false;
    }
    
    const profile = profiles[nextIndex];
    
    // Apply the profile
    await applyLighting(device, profile.brightness, profile.temperature, false);
    
    // Store full schedule for future instant cycling
    const profileSchedule = profiles.slice(0, 4).map(p => ({
      brightness: p.brightness,
      temperature: p.temperature,
      name: p.name
    }));
    
    setForcedProfile(DEVICE_ID, nextIndex, profileSchedule);
    
    await clearManualModeForGroup(DEVICE_ID, device.name);
    setLastProfile(DEVICE_ID, profile.name);
    
    const brightnessPercent = Math.round(profile.brightness * 100);
    const tempDesc = profile.temperature >= 0.7 ? 'warm' : 
                     profile.temperature <= 0.4 ? 'cool' : 'neutral';
    const message = `[${roomName}] ${profile.name} mode activated → ${brightnessPercent}% / ${tempDesc} [Forced]`;
    
    if (SETTINGS.enableLogging) {
      log(message + " (initialized full schedule)");
    }
    await notify(message);
    
    return {
      room: roomName,
      profile: profile.name,
      profileIndex: nextIndex,
      brightness: profile.brightness,
      temperature: profile.temperature,
      forced: true,
      wasOff: !isOn,
      initialized: true,
      message: message
    };
  }
  
  
  // Handle "clear" mode - clear manual mode for group and all members, only apply profile if light is on
  if (CLEAR_MANUAL) {
    const wasManual = isManualMode(DEVICE_ID);
    
    // Clear manual mode for group and all members
    await clearManualModeForGroup(DEVICE_ID, device.name);
    
    // Clear forced profile (reset to auto mode) and pre-calculate all profiles
    if (FORCED_PROFILE_DEVICES.has(DEVICE_ID)) {
      const profiles = roomConfig.profiles;
      
      // Extract brightness, temperature, and name for all 4 profiles
      const profileSchedule = profiles.slice(0, 4).map(p => ({
        brightness: p.brightness,
        temperature: p.temperature,
        name: p.name
      }));
      
      setForcedProfile(DEVICE_ID, -1, profileSchedule);
      
      if (SETTINGS.enableDetailedLogging) {
        log(`[${roomName}] Cleared forced profile and pre-calculated all profiles`);
      }
    }
    
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
    
    // Light is on - apply profile WITH VERIFICATION AND RETRY
    const result = await applyLightingWithRetry(
      device,
      activeProfile.brightness,
      activeProfile.temperature,
      activeProfile.name,
      false  // instant, no fade
    );
    
    if (result.success) {
      // Verification passed - safe to set lastProfile
      setLastProfile(DEVICE_ID, activeProfile.name);
      
      const brightnessPercent = Math.round(activeProfile.brightness * 100);
      const tempDesc = activeProfile.temperature >= 0.7 ? 'warm' :
                       activeProfile.temperature <= 0.4 ? 'cool' : 'neutral';
      
      let message = `[${roomName}] ${activeProfile.name} applied → ${brightnessPercent}% / ${tempDesc}`;
      if (result.attempts > 1) {
        message += ` (verified after ${result.attempts} attempts)`;
      }
      
      if (SETTINGS.enableLogging) {
        log(message);
      }
      
      return {
        room: roomName,
        profile: activeProfile.name,
        brightness: activeProfile.brightness,
        temperature: activeProfile.temperature,
        verified: true,
        attempts: result.attempts,
        message: message
      };
    } else {
      // Verification failed after all retries
      // Mark as fading for extended period to prevent false manual mode detection
      setDeviceFading(DEVICE_ID, SETTINGS.failedVerificationBuffer);
      
      const errorMsg = `[${roomName}] Failed to apply ${activeProfile.name}: ${result.error}`;
      log(errorMsg);
      await notify(errorMsg);
      
      // Don't set lastProfile - we don't know the actual state
      return {
        room: roomName,
        profile: activeProfile.name,
        verified: false,
        attempts: result.attempts,
        error: result.error,
        message: errorMsg
      };
    }
  }
  
  // Get current device state
  const currentBrightness = device.capabilitiesObj?.dim?.value ?? null;
  const currentTemperature = device.capabilitiesObj?.light_temperature?.value ?? null;
  
  // Skip if device is in a fade/restore operation
  // Check mode: uses isDeviceFading() which includes AL's own transition tracking
  // Normal mode: only checks _FadeActiveUntil (GradualFadeOut/watchdog external fades)
  //   AL's own AL_Fade_ timestamps must NOT block normal mode, since check-mode
  //   transitions (60s+5s) would falsely prevent profile application when entering a room.
  //   If _FadeActiveUntil is active, waits 500ms for RestoreSavedSettings to clear it.
  //   If cleared → motion triggered restore → proceed. If still active → skip.
  if (!FORCE_UPDATE && !CLEAR_MANUAL && CHECK_MANUAL && isDeviceFading(DEVICE_ID)) {
    if (SETTINGS.enableLogging) {
      log(`[${roomName}] ⸏ Skipping check - fade/restore in progress`);
    }
    diagLog(`AL-SKIP-FADE | ${roomName} | currentDim=${Math.round((currentBrightness ?? 0) * 100)}% | mode=check`);
    return {
      room: roomName,
      skipped: true,
      reason: 'fade_in_progress'
    };
  }

  // Normal mode: only skip if a fade is actively in progress
  // During a fade, RestoreSavedSettings handles the restore — AL stays out of the way.
  // Once the fade completes and lights are off, any turn-on always applies the profile.
  if (!FORCE_UPDATE && !CLEAR_MANUAL && !CHECK_MANUAL) {
    const externalFadeUntil = global.get(`${DEVICE_ID}_FadeActiveUntil`) || 0;
    if (Date.now() < externalFadeUntil) {
      if (SETTINGS.enableLogging) {
        log(`[${roomName}] ⸏ Skipping - fade in progress, restore will handle`);
      }
      diagLog(`AL-SKIP-FADE | ${roomName} | currentDim=${Math.round((currentBrightness ?? 0) * 100)}% | mode=normal (fade active)`);
      return {
        room: roomName,
        skipped: true,
        reason: 'fade_in_progress'
      };
    }
  }

  // Check mode logic
  if (CHECK_MANUAL && !FORCE_UPDATE && currentBrightness !== null) {
    
    // Note: fade check for check mode is handled above (before check mode block)

    // Check if device has a forced profile active
    const forcedProfileIndex = getForcedProfile(DEVICE_ID);
    if (forcedProfileIndex !== null) {
      if (SETTINGS.enableDetailedLogging) {
        const profileNames = ['Morning', 'Daytime', 'Evening', 'Night'];
        log(`[${roomName}] Skipped - forced profile active (${profileNames[forcedProfileIndex]})`);
      }
      return {
        room: roomName,
        skipped: true,
        reason: 'forced_profile_active',
        forcedProfile: forcedProfileIndex
      };
    }
    
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
  
  // Light turned on (normal mode) or force/reset - clear manual mode for group and members
  if (!CHECK_MANUAL || FORCE_UPDATE) {
    const wasManual = isManualMode(DEVICE_ID);
    await clearManualModeForGroup(DEVICE_ID, device.name);
    
    // Also reset forced profile to auto mode (light turning on = back to automatic)
    // BUT pre-calculate ALL profiles so cycling is instant
    if (FORCED_PROFILE_DEVICES.has(DEVICE_ID)) {
      const profiles = roomConfig.profiles;
      
      // Extract brightness, temperature, and name for all 4 profiles
      const profileSchedule = profiles.slice(0, 4).map(p => ({
        brightness: p.brightness,
        temperature: p.temperature,
        name: p.name
      }));
      
      // Store with index -1 (auto mode) but with full schedule pre-calculated
      setForcedProfile(DEVICE_ID, -1, profileSchedule);
      
      if (SETTINGS.enableDetailedLogging) {
        log(`[${roomName}] Pre-calculated all ${profileSchedule.length} profiles for instant cycling`);
      }
    }
    
    // Ensure light is on in normal mode (not check mode)
    if (!CHECK_MANUAL) {
      const isOn = device.capabilitiesObj?.onoff?.value ?? false;
      if (!isOn) {
        // Set brightness/temperature WHILE light is OFF (like Homey UI does)
        await applyLighting(device, activeProfile.brightness, activeProfile.temperature, false);

        // Small delay to ensure the bulb has processed the brightness/temperature commands
        await new Promise(resolve => setTimeout(resolve, 100));

        // NOW turn on the light - it should turn on at the correct level
        await device.setCapabilityValue('onoff', true);
        
        if (SETTINGS.enableDetailedLogging) {
          log(`[${roomName}] Set level to ${Math.round(activeProfile.brightness * 100)}% while off, then turned on`);
        }
        
        // Mark profile as applied
        setLastProfile(DEVICE_ID, activeProfile.name);
        
        // Return early to avoid duplicate applyLighting call
        const brightnessPercent = Math.round(activeProfile.brightness * 100);
        const tempDesc = activeProfile.temperature >= 0.7 ? 'warm' :
                         activeProfile.temperature <= 0.4 ? 'cool' : 'neutral';
        const weekendIndicator = roomConfig.usingWeekendProfile ? ' [Weekend]' : '';
        
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
          flashPrevented: true,
          message: `${roomName}: ${activeProfile.name} → ${brightnessPercent}% / ${tempDesc}${weekendIndicator}`
        };
      }
    }
    
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
  
  // Apply the lighting settings with verification for force/reset, or normal for other modes
  let verified = false;
  let attempts = 1;
  
  if (FORCE_UPDATE) {
    // Force/reset mode - use verification and retry
    const result = await applyLightingWithRetry(
      device,
      activeProfile.brightness,
      activeProfile.temperature,
      activeProfile.name,
      useDuration
    );
    
    verified = result.success;
    attempts = result.attempts;
    
    if (result.success) {
      // Verification passed - safe to set lastProfile
      setLastProfile(DEVICE_ID, activeProfile.name);
    } else {
      // Verification failed - mark as fading to prevent false manual mode
      setDeviceFading(DEVICE_ID, SETTINGS.failedVerificationBuffer);
      
      const errorMsg = `[${roomName}] Force/reset failed: ${result.error}`;
      log(errorMsg);
      await notify(errorMsg);
      
      // Don't set lastProfile - we don't know the actual state
      return {
        room: roomName,
        profile: activeProfile.name,
        verified: false,
        attempts: result.attempts,
        error: result.error,
        forced: FORCE_UPDATE
      };
    }
  } else {
    // Normal mode or check mode - use standard apply
    await applyLighting(device, activeProfile.brightness, activeProfile.temperature, useDuration);

    // Remember which profile was applied (for check mode comparison)
    setLastProfile(DEVICE_ID, activeProfile.name);
  }

  // Logging and notifications
  const brightnessPercent = Math.round(activeProfile.brightness * 100);
  const tempPercent = Math.round(activeProfile.temperature * 100);
  const tempDesc = activeProfile.temperature >= 0.7 ? 'warm' :
                   activeProfile.temperature <= 0.4 ? 'cool' : 'neutral';
  
  let modeIndicator = FORCE_UPDATE ? ' [RESET]' : '';
  if (verified && attempts > 1) {
    modeIndicator += ` (verified after ${attempts} attempts)`;
  }
  const weekendIndicator = roomConfig.usingWeekendProfile ? ' [Weekend]' : '';
  const message = `[${roomName}] ${activeProfile.name} → ${brightnessPercent}% / ${tempDesc}${weekendIndicator}${modeIndicator}`;

  diagLog(`AL-APPLY | ${roomName} | ${activeProfile.name} | dim=${brightnessPercent}% temp=${tempPercent}% | mode=${CHECK_MANUAL ? 'check' : FORCE_UPDATE ? 'force' : CLEAR_MANUAL ? 'clear' : 'normal'}${weekendIndicator}`);

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