# Room Heating — changelog

Version history of the Room Heating HomeyScripts, newest first per script.
Each script keeps its current version in its header and points here.
With every change: bump the version in the script and add an entry here.

- [Room Heating](#room-heating) — `room_heating.js`
- [Room Heating Status](#room-heating-status) — `room_heating_status.js`
- [Room Heating Config](#room-heating-config) — `room_heating_config.js`
- [Cleanup Stale Globals](#cleanup-stale-globals) — `cleanup_stale_globals.js`
- [Add New Room Wizard](#add-new-room-wizard) — `add_new_room_wizard.js`

Room Heating was created 2025-12-31 by Henrik Skovgaard, based on Clara Heating v6.4.6.

## Room Heating

`room_heating.js`

### 10.25.1 — 2026-11-03 — 🐛 Silent sensor only while heating

- 10.24.0 called the room sensor silent when its last report was 60 minutes old. A
  settled room may not report for hours (Clara's room stayed at 20.8-21.0 for 24 h on
  29 Oct), so on a weekend Day the radiators could have been forced off at 21 against
  a target of 22 and kept off, with a false "silent" alert.
- Now the sensor counts as silent only when the heating has been on for the whole
  limit (sensorStaleMinutes, default 60) and the sensor has not reported once in that
  time: a heated room warms up, so a working sensor reports. That still catches the
  failure that matters (a dead sensor stuck at a low reading keeps the radiators on).
  Once silent, it stays silent until the sensor reports again.
- State: roomState.heatingSince (when the runs first saw the heating on) and
  roomState.sensorStaleSince replace roomState.sensorStale.
- Verified with test/ (97 scenarios): only the stale-sensor scenarios differ from
  10.25.0; new scenarios for a steady reading with the heat off (no alert) and for a
  sensor that is silent but the heating has run for less than the limit (keeps heating).
- Files modified: room_heating.js (v10.25.1), README.md, test/harness.mjs, CHANGELOG.md

### 10.25.0 — 2026-11-03 — 🔧 Fewer Homey reads, exception-only notifications, boost capped at 25°C

- Homey read once per run: all devices, all zones, the Logic variables and the TADO
  presence are fetched once and reused (a Clara run went from 26 API reads to 11;
  getDevices 4 -> 1, getZones 8 -> 1). Heating devices are still read fresh around
  commands. A boost/pause/cancel request that had to wait for the run lock reads again.
- HeatingStatus lock: all rooms run on the same 5-minute cron and each one read the
  shared HeatingStatus variable, added its entry and wrote it back, so one room could
  overwrite another's entry. The read-modify-write now runs under a HeatingStatus.Lock
  global (stale after 15 s).
- Inactivity evaluated once per run (it saves the inactive flag, so the second and third
  evaluation saw their own write). Fixes: the "Inactive" change was lost when an override
  expired in an empty room; manual mode cleared the inactive flag through the diagnostics.
- Effective target in HeatingStatus, the diagnostics log and the notification now uses
  the slot's effective inactivity offset (slot value or room default) - it read the slot
  field only; and override modes publish the mode's target (boost while away showed 17).
- 🔕 Notifications only for exceptions: window, away/home, boost/pause/manual, sensor,
  holiday list reminder. Routine changes (smart plug heat on/off, schedule steps,
  inactive/active) are only included when an exception is notified in the same run.
  GLOBAL_CONFIG.notifyRoutineChanges = true restores the old behaviour.
- 🌡️ Smart-plug boost heats to 25°C (room hysteresis around it) instead of running the
  radiators flat out for the full hour. The notification shows 25°C instead of MAX.
  New action in the diagnostics log: boost_at_target.
- 📚 Holiday list reminder: from 30 days before the last schoolHolidays range ends, one
  notification a week (shared by all rooms, Heating.HolidayListReminder global) until
  next school year's ranges are added.
- Removed: legacy-state migration (pre-10.16 globals, cleaned up in 10.23), the
  smart-plug branch of manual mode (manual is TADO only since 10.20), the hard-coded
  TADO home id fallback (now required in Config.Global).
- Version history moved out of the script header into this file.
- Verified with test/ (95 scenarios): 14 differ from v10.24.0, all intended - the 5
  routine-only notifications, 4 boost scenarios, the holiday reminder, the status lock
  wait, and 4 inactivity/effective-target scenarios. The harness was cleaned of fields
  from before 10.20 (verified baselines, lastRunTemp, the Skoleintra fetch mock);
  9 obsolete scenarios removed, 4 renamed after what they test since 10.21.
- Live flows: the window-closed countdown in C, O, ST and SV - Heating was still 610 s
  from the old 10-minute settle delay; now 1810 s so a run lands just after the 30 minutes.
- Files modified: room_heating.js (v10.25.0), room_heating_status.js (v5.0.1),
  room_heating_config.js (v1.5.0), README.md, CLAUDE.md, CHANGELOG.md, test/

### 10.24.0 — 2026-11-03 — 🌡️ Away never raises a target; smart plugs off while the room sensor is silent

- Away target: while TADO is in away mode the target is now the lower of the
  schedule's target and tadoAwayMinTemp. It used to be tadoAwayMinTemp outright,
  so Soveværelse (Night/Evening 15°C) was heated to 17°C whenever nobody was home.
  Applied everywhere the away target is used: normal control, resume, the
  HeatingStatus entry and the notification.
- Silent sensor: if the room temperature sensor has not reported for
  sensorStaleMinutes (room setting, default 60), the room is treated as having no
  reading. Smart-plug rooms switch the radiators OFF and keep them off until the
  sensor reports again (a sensor stuck at a low value would otherwise keep them on
  indefinitely). TADO rooms carry on, since the valve regulates on its own sensor;
  a stale reading there means Homey has lost touch with TADO.
  One notification when the sensor goes silent and one when it reports again
  (roomState.sensorStale). Boost, pause and manual modes are not affected.
  New action in the diagnostics log: sensor_stale_off.
- Why: a flat battery in a smart-plug room was the one failure with no limit on
  how long the radiators stay on.
- Verified with test/: 95 scenarios (6 new); only 5 of the new ones differ from
  v10.23.1 (sv_away_night sets 15°C instead of holding 17°C; clara_sensor_stale /
  _stale_already / _recovered, stue_sensor_stale). sv_away_day (20°C slot, away
  17°C) is unchanged. The harness now has a
  Soveværelse TADO room, and default sensor timestamps follow scenarios that
  move the clock.
- Files modified: room_heating.js (v10.24.0), README.md, test/harness.mjs, CHANGELOG.txt

### 10.23.1 — 2026-09-07 — 🔧 Diagnostics log capped at 500 lines (was 5000)

- Every global.set in HomeyScript rewrites the app's whole variable store. With
  four rooms each holding up to 5000 log lines (~300 KB per room) that store was
  around a megabyte, so every state save in every run rewrote a megabyte, and a
  burst of writes (the cleanup script) made the HomeyScript app unresponsive.
- The log is now kept at 500 lines. An oversized log from an earlier version is
  trimmed on the first run for that room, even if nothing new is logged.
- No other behaviour change; the entry format is unchanged. Verified with test/
  (89 scenarios identical).
- Files modified: room_heating.js (v10.23.1), CHANGELOG.txt

### 10.23.0 — 2026-09-07 — 📚 School days from the config, not from Skoleintra

- Removed the Skoleintra iCal fetch, its 1-hour cache (SchoolCalendar.Data /
  SchoolCalendar.CacheTime globals) and the iCal parsing. No network access left
  in the script.
- A school day is now: a weekday, not inside a schoolHolidays range from the
  config, not a public holiday (publicHolidaysFixed from the config plus the
  Easter-based ones computed in the script: skærtorsdag, langfredag, 2. påskedag,
  Kristi himmelfartsdag, 2. pinsedag), and the SchoolHoliday Logic variable is
  not on. The variable is an ad hoc "no school today" switch (sick day, study
  day) and affects today only; tomorrow is decided by the lists.
- Config 1.3.0: schoolHolidays, publicHolidaysFixed, schoolHolidayVariable added;
  icalCalendarId, schoolCalendarUrl, schoolCalendarCacheTTL, homeyLogicVars removed.
  The 2026/27 ranges are a Copenhagen-pattern starting point - verify against the
  school's plan. RUN room_heating_config.js ONCE to apply.
- Create a boolean Logic variable "SchoolHoliday" in Homey (Yes/No). If it does
  not exist the script treats it as No.
- school_day_check.js deleted (it wrote IsSchoolDay variables nothing reads).
  The two "C - Skoledag" flows on Homey can be deleted as well.
- Verified with test/: 89 scenarios identical to v10.22.0; new scenarios cover the
  override variable, a holiday range, a computed public holiday and the late
  evening slot before a weekday public holiday.
- Added cleanup_stale_globals.js: one-off script that removes the globals older
  versions wrote (individual state vars, queue state, display vars, calendar cache)
  and reports which keys actually disappeared. Keeps Config.*, .Heating.State,
  .Heating.RunLock and .Heating.DiagnostikLog.
- Files modified: room_heating.js (v10.23.0), room_heating_config.js (v1.3.0),
  README.md, cleanup_stale_globals.js (new), test/, CHANGELOG.txt; school_day_check.js deleted

### 10.22.0 — 2026-09-07 — 📊 HeatingStatus carries everything the status script needs; display globals dropped

- The HeatingStatus Logic variable entry per room now also contains: scheduleType,
  period {start,end,name}, effective slot settings with their source (slot/room),
  nextChange, lastAction. scheduledTarget is now always the schedule's target
  (it used to be 0 / 25 / the knob value during pause / boost / manual);
  effectiveTarget still reflects the active mode.
- Removed 15 display-only globals: .Temperature, .TemperatureLow/High,
  .EffectiveTemperature, .Heating.InactivityOffset, .Heating.Slot*,
  .Heating.ScheduleType, .Heating.CurrentPeriod, .Heating.PeriodName,
  .Heating.ActiveInactivity*, .Heating.LastUpdate, .Heating.CurrentTemp,
  .Heating.LastAction, .Heating.LastEffectiveTarget, .Heating.LastWindowOpen,
  .Heating.LastLogTime. The two the script used itself (previous target and slot
  name, for change notifications) moved into roomState.schedule; the diagnostics
  throttling values moved into roomState.diag. .Heating.DiagnostikLog stays.
- scheduleCtx is now resolved once per run at top level (with nextChange), so
  diagnostics can publish schedule info from every path, including override modes.
- Old globals are simply no longer written; stale values remain in Homey's global
  store until overwritten or cleared, and nothing reads them any more.
- Verified with test/: 86 scenarios, no behavioural difference from v10.21.0
  (one scenario needed its seed data moved from the old global to the new state field).
- Files modified: room_heating.js (v10.22.0), room_heating_status.js (v5.0.0),
  README.md, test/, CHANGELOG.txt

### 10.21.0 — 2026-09-07 — ⏳ Window settle delay is a fixed wait; stability early-exit removed

- After a long window opening, heating now waits exactly windowClosedDelay before
  resuming. The "resume early if the temperature has been stable for 10 min"
  logic is gone, together with the stale-sensor check and the LastRunTemp
  freezing it needed (source of fixes 10.14.1, 10.14.2, 10.14.5, 10.14.6).
- Config 1.2.0: windowClosedDelay 3600 -> 1800 for all rooms (30 min). The old
  60 min value was a safety maximum for the early-exit logic, not the intended
  wait. RUN room_heating_config.js ONCE to apply.
- roomState.lastRunTemp removed.
- Verified with test/: the only scenarios that differ are the settle ones:
  15 min after closing now waits regardless of stability, 31 min settles,
  the "window closed" notification says 30 min.
- Files modified: room_heating.js (v10.21.0), room_heating_config.js (v1.2.0),
  room_heating_status.js (v4.15.0), CHANGELOG.txt

### 10.20.0 — 2026-09-07 — 🔧 Manual detection: TADO only, one simple rule; smart plugs re-assert

- Smart plugs (Clara): manual-intervention detection removed. The script
  controls the plugs 99% of the time; a plug flipped by hand is simply put
  back by the schedule on the next run (within 5 min). Use the Boost/Pause
  flows for intentional changes. This removes the class of false "manual
  override" notifications that came from verifying Zigbee on/off states
  (v10.10.2, v10.12.1, v10.15.1, v10.15.2).
- TADO: detection reduced to one rule with two remembered numbers.
  The valve is "manual" when its target differs from what the script last
  commanded (baseline.commandedTargetTemp) AND has moved since the end of
  the previous run (baseline.lastSeenTargetTemp, recorded at the end of
  every run). Consequences:
    * A slow valve still showing the old target is not manual; the command
      is simply sent again.
    * A target set by TADO's own schedule (smart_schedule = true) is not a
      person; the script re-asserts its target.
    * While TADO is away, or right after a presence change, nothing is
      compared (TADO adjusts targets itself). commandedTargetTemp is
      cleared on presence transitions and when the script turns the valve off.
    * First run after this upgrade only records; detection starts on the
      run after that.
  Exit from manual mode is unchanged: 90 min timeout or smart_schedule
  turning true.
- Removed the verified-baseline machinery: verifiedOnOff, verifiedTargetTemp,
  commandedOnOff, lastChangeTime, the "establish initial baseline" path,
  baseline clearing in transitionMode, and the anyVerified/allMatch
  bookkeeping in setHeating, resumeNormalHeating and controlOverrideMode.
  Stored state is migrated on load (old baseline fields are dropped).
- controlOverrideMode and resumeNormalHeating now call setHeating() instead
  of carrying their own copies of the device loops. Commands are only sent
  when the device is not already in the requested state; resume no longer
  sends onoff=true to a valve that is already on.
- Fixed as a side effect: after a window settle delay, if the smart plugs
  were already in the correct state (nothing to send), the old code returned
  "not verified" and stayed in window_settle_retry indefinitely. The settle
  delay now clears as soon as the devices are in the resumed state.
- Verified with test/: 85 scenarios (10 new for the detection model).
  14 differ from v10.19.0, all intended: two plug-flip scenarios re-assert
  instead of entering manual, two knob-turn scenarios now enter manual,
  settle-already-correct now settles, six resume scenarios send one command
  instead of two, one debug-string format.
- room_heating.js: 2766 -> 2442 lines
- Files modified: room_heating.js (v10.20.0), room_heating_status.js (v4.14.0),
  README.md, test/harness.mjs, test/compare.mjs, CHANGELOG.txt

### 10.19.0 — 2026-09-07 — 🔧 Run guard replaces per-device command queue; single verification attempt

- Removed the per-device lock/queue/retry layer (device state globals
  ${zone}.Heating.Device.<id>.State, tryAcquireLock, queueCommand,
  waitForQueuePosition, processNextQueuedCommand, verifyDeviceStatus,
  sendCommandWithVerification, cleanupStaleDeviceStates). ~330 lines.
- Why: the queue only ever coordinated this script with itself, and its own
  30s x 3 verification made runs long enough to overlap in the first place.
- New: one run per room at a time via ${zone}.Heating.RunLock. A normal run
  that finds another in progress exits immediately (next trigger is at most
  5 min away). A boost/pause/cancel request waits for the lock (up to 125s,
  past the 120s stale threshold) so a button press is never dropped.
  The lock is released in a finally block on every exit path; a lock older
  than 120s is treated as abandoned (script killed mid-run).
- Room state is now loaded after the lock is acquired, so a waiting request
  sees the state left by the run it waited for.
- New sendCommand(): send once, poll for the reported value, no retries.
  Timeout 10s for smart plugs (Zigbee, local), 30s for TADO (cloud).
- To keep fewer retries from causing false manual detection on TADO, the
  baseline now also records commandedTargetTemp (mirror of the existing
  commandedOnOff for smart plugs, v10.15.2). If the TADO target differs from
  the verified baseline but matches what automation last sent, it is treated
  as delayed verification and the baseline is corrected, not as manual.
- detectManualIntervention no longer needs the "device mid-command" skip.
- Verified with test/: 75 scenarios (6 new: lock busy, lock stale, request
  waits for lock, verify timeout x2, TADO delayed verify). All differences
  from v10.18.0 are the intended ones: busy-queue run now sends both plug
  commands, verify-timeout runs send one attempt not three, delayed-verify
  run no longer enters manual mode, request run proceeds once the lock is stale.
- Files modified: room_heating.js (v10.19.0), room_heating_status.js (v4.13.0),
  README.md, test/harness.mjs, test/compare.mjs (new), CHANGELOG.txt

### 10.18.0 — 2026-09-07 — 🔄 Refactor: One code path for boost/pause/manual; schedule resolved once per run

- No behaviour change. Verified with an offline mock harness (test/harness.mjs):
  69 scenarios produce identical device commands, notifications, Logic writes
  and final room state before and after.
- activateBoostMode/activatePauseMode/activateManualOverrideMode -> activateMode(mode)
- checkBoostMode/checkPauseMode/checkManualOverrideMode -> checkModeExpiry()
- controlHeatingBoost/controlHeatingPause -> controlOverrideMode(mode)
- Removed dead cancelBoostMode/cancelPauseMode/cancelManualOverrideMode
  (main only ever called cancelAllOverrideModes)
- Main execution: the three near-identical "mode active" and "mode expired"
  blocks collapsed into one each; the schedule/slot selection block that was
  repeated five times is now resolveSchedule(), called once per run
- heatingStatusLabel() replaces three copies of the HEATING/IDLE vs ON/OFF ternary
- Deleted stale docs and one-off diagnostics: plans/, SLOT_INACTIVITY_TIMEOUT_FEATURE.md,
  UNIFIED_SLOT_OVERRIDE_SYSTEM.md, test_stue_zone_devices.js, test_tado_capabilities.js,
  inspect_tado_properties.js. Their still-relevant content is folded into README.md.
- Added test/ (mock harness, scenario runner) so later changes can be diffed the same way
- room_heating.js: 3419 -> 3066 lines
- Files modified: room_heating.js (v10.18.0), README.md (new), CHANGELOG.txt, test/ (new)

### 10.17.1 — 2026-07-06 — 🐛 Fix: createVariable signature so HeatingStatus auto-creates

- Homey.logic.createVariable expects { variable: { name, type, value } }
  (same wrapper shape as updateVariable); the flat form threw
  "Missing Parameter: variable".
- Files modified: room_heating.js (v10.17.1)

### 10.17.0 — 2026-07-06 — 📊 New: Publish per-room status to a Logic variable for the web dashboard

- Added publishHeatingStatus(): writes a compact per-room object into the
  "HeatingStatus" Logic variable (JSON keyed by zone name), created if missing.
- Called from logDiagnostics() before its early return, so it runs on every cycle.
- Exposes mode, modeExpires (boost/pause remaining), scheduled/effective target,
  currentTemp, heating on/off, windowOpen, inactive, away, updatedAt.
- Why: HomeyScript globals (the per-room state object) aren't readable over the
  Homey Web API; Logic variables are. Lets the dashboard show live heating status.
- Files modified: room_heating.js (v10.17.0)

### 10.16.0 — 2026-03-31 — 🔄 Refactor: Unified room state object (replaces 20+ scattered global variables)

- Root cause of recurring false manual detection bugs: mode and baseline state
  was spread across 20+ individual global.get()/global.set() calls (ManualOverrideMode,
  BoostMode, PauseMode, LastVerifiedOnOff, LastVerifiedTargetTemp, LastCommandedOnOff,
  WindowOpenTime, etc.). Each mode transition required manually clearing 5+ variables,
  and missing any single one caused false positives. The changelog has 15+ entries
  fixing this same category of bug.
- Solution: Single JSON state object per room stored as ${zoneName}.Heating.State:
  { mode, modeExpires, modeDetails, away, awaySince, baseline: { verifiedOnOff,
    verifiedTargetTemp, commandedOnOff, lastChangeTime }, window: { openSince,
    closedSince, timeoutHandled }, inactive, lastRunTemp, notification: { lastKey,
    lastTime } }
- transitionMode(state, newMode, params) handles ALL mode transitions, automatically
  clearing baselines — eliminates the entire class of "forgot to clear X" bugs
- Mode is now mutually exclusive by construction (one 'mode' field instead of 3 flags)
- Away mode transitions (both entering AND leaving) clear baselines in one place
  (fixes the specific v10.15.3 bug that triggered this refactor)
- Migration: First run auto-migrates from legacy individual variables to unified state
- Per-device command states (DeviceState.*) and display-only variables kept separate
- Files modified: room_heating.js (v10.16.0), CHANGELOG.txt

### 10.15.2 — 2026-03-27 — 🐛 Fix: False manual detection from cross-run race condition (commanded state tracking)

- Root cause: detectManualIntervention runs BEFORE controlHeating in each execution.
  When a command (e.g., turn OFF) succeeds but verification times out, the baseline
  stays stale (ON). The device physically turns OFF between runs. Next run:
  detectManualIntervention sees OFF vs baseline ON → false manual override.
- Fix: Store LastCommandedOnOff whenever automation sends a smart plug command.
  In detectManualIntervention, if device state differs from baseline but matches
  the last commanded state, treat as delayed verification (not manual intervention)
  and update the baseline accordingly.
- LastCommandedOnOff is set in: setHeating, resumeNormalHeating, controlHeatingBoost,
  controlHeatingPause — all places that command smart plug state changes.
- Files modified: room_heating.js (v10.15.2)

### 10.15.1 — 2026-03-26 — 🐛 Fix: False manual detection when smart plug command sent but not verified

- When setHeating() sent a command that succeeded but failed verification,
  the baseline was never updated (anyChanged=true, anyVerified=false gap)
- Next run would see actual device state != stale baseline → false manual override
- Most likely trigger: inactivity offset causing ON→OFF transition with Zigbee timeout
- Fix: Always check actual device states when baseline wasn't verified, not just when
  no changes were made. Merged the !anyChanged and anyChanged&&!anyVerified paths.
- Files modified: room_heating.js (v10.15.1)

### 10.15.0 — 2026-03-15 — 🔧 Auto-discover heating devices by zone (no more hardcoded device IDs)

- Smart plugs: discovers devices with virtualClass/class 'heater' (Plugged In = Heater)
- TADO valves: discovers devices with tado_heating_power capability
- Device IDs removed from room_heating_config.js — devices found dynamically at startup
- Eliminates stale device ID issues when devices are re-paired or replaced
- Files modified: room_heating.js (v10.15.0), room_heating_config.js

### 10.14.7 — 2026-03-15 — 🔕 Suppress duplicate notifications (30 min cooldown for identical changes)

- After a false motion trigger resets inactivity timer, the script would repeatedly
  try to turn on heating and send "Heat on" notifications until the 30-min timeout
- Now tracks last notification changes and timestamp per room via global state
- Identical notifications are suppressed for 30 minutes (logged as suppressed)
- Different changes (schedule, window, inactivity, etc.) still notify immediately
- Files modified: room_heating.js (v10.14.7)

### 10.14.6 — 2026-03-02 — 🐛 Fix: Freeze LastRunTemp during settle delay to prevent false stability

- LastRunTemp was updated on every script run, including during the settle delay
- This caused stability checks to compare against recent intermediate temps instead of the temp when the window closed
- Result: air declared "settled" after just 10 minutes despite 0.3°C rise (19.4→19.7°C)
- Fix: Skip LastRunTemp update while WindowClosedTime is set (settle delay active)
- Now stability correctly compares against the temperature recorded when the window closed
- Files modified: room_heating.js (v10.14.6)

### 10.14.5 — 2026-02-25 — 🐛 Fix: Window settle delay survives sensor flaps (don't clear on brief open)

### 10.14.4 — 2026-02-04 — 🐛 Fix: Robustly handle object-wrapped sensor values in logging and logic

- Detects if sensor value is an object (unexpected format change) and attempts to extract value
- Safe-guards diagnostics logging to stringify objects instead of printing [object Object]
- Fixes "Temp: [object Object]" error appearing in logs
- Files modified: room_heating.js (v10.14.4)

### 10.14.3 — 2026-02-04 — 🐛 Fix: [object Object] in notifications during override modes

- Files modified: room_heating.js (v10.14.3)

### 10.14.2 — 2026-02-03 — ⏳ Increase minimum smart settling time to 10 minutes

- Increased minSettlingTime from 120s (2 min) to 600s (10 min)
- Ensures system waits at least 10 minutes for air to settle before checking stability
- Even if temperature stabilizes quickly, system will wait the full 10 minutes
- Improved comfort by preventing premature heating resumption
- Files modified: room_heating.js (v10.14.2)

### 10.14.1 — 2026-02-03 — 🐛 Fix: Ensure smart settling logic uses fresh sensor data (check timestamp)

- Smart monitoring was resuming too early on stale sensor data (timestamp check added)
- Now requires sensorLastUpdated > windowClosedTime to consider stability
- Files modified: room_heating.js (v10.14.1)

### 10.14.0 — 2026-02-01 — 🌡️ Smart window settling: Resume heating early if temperature stabilizes

- New smart monitoring logic replaces fixed window closed delay
- When window closes, system now monitors temperature stability (every run)
- If temperature stabilizes (change < 0.2°C) after minimum 2 minutes, heating resumes early
- windowClosedDelay now acts as a safety MAXIMUM wait time (default increased to 30 min)
- Prevents freezing if sensor is noisy or unstable for long periods
- Ensures heating resumes as soon as air has settled, optimizing comfort and efficiency
- Updated config: Default windowClosedDelay increased from 10m (600s) to 30m (1800s)
- Files modified: room_heating.js (v10.14.0), room_heating_config.js (v1.0.7)

### 10.13.1 — 2026-01-27 — 🔇 Suppress excessive window open logging

- Modified logging logic to ignore window open events until the timeout is reached
- Helps suppress log spam from flapping contact sensors or brief window openings
- "Window: OPEN" is now only logged when the action is 'window_timeout_off'
- "window_open_skip" events are ignored for logging and status tracking
- Status script now shows School Calendar cache details (age and size) for verification
- Files modified: room_heating.js (v10.13.1), room_heating_status.js (v4.10.1)

### 10.13.0 — 2026-01-23 — 📚 Direct Skoleintra calendar fetch with caching

- Directly queries Clara's school calendar from Skoleintra (nsg.m.skoleintra.dk)
- Cached for 1 hour to avoid excessive API calls (configurable via schoolCalendarCacheTTL)
- Parses iCal format to check for events on specific dates (YYYYMMDD matching)
- Both isSchoolDay() and isSchoolDayTomorrow() now use cached calendar data
- Falls back to weekday detection if calendar unavailable
- Eliminates dependency on IcalCalendar flow cards and Homey Logic variables
- Can determine both today AND tomorrow school status in a single calendar fetch
- Calendar URL configured in GLOBAL_CONFIG.schoolCalendarUrl
- Cache stored in global variables: SchoolCalendar.Data, SchoolCalendar.CacheTime
- Status script also updated to use same cached calendar approach
- Files modified: room_heating_config.js (v1.0.6), room_heating.js (v10.13.0), room_heating_status.js (v4.10.0)

### 10.12.3 — 2026-01-23 — 🔔 Notify on slot name change even when temperature stays the same

- Previously, schedule change notifications only triggered when target temperature changed
- Problem: Stue Day→Evening transition has same temperature (22°C), so no notification was sent
- Now tracks previousSlotName and compares with current slot name
- Notifications trigger on EITHER temperature change OR slot name change
- When only slot name changes, notification shows: "Day → Evening • 22°C"
- Files modified: room_heating.js (lines 3138-3154)

### 10.12.2 — 2026-01-20 — 🐛 CRITICAL FIX: False manual override detection during window settle delay

- Fixed bug where closing a window triggered false "Manual override" notification
- Problem: Manual detection ran during window settle delay when TADO baseline is null/stale
- When window closes after timeout, system enters 10-min settle delay while baseline cleared
- Manual detection still ran during this period, comparing against null/stale baseline
- Result: "Window closed • Waiting 10min" → 30 seconds later → false "Manual override • 90 min"
- Especially occurred if schedule changed while window was open (baseline from different period)
- Solution: Skip manual detection entirely when WindowClosedTime is set (during settle delay)
- Added check in detectManualIntervention() to skip when windowClosedTime !== null
- Window settle is a known transitional state - don't detect changes during this period
- Similar to existing checks that skip detection when devices are 'sending' or 'verifying'
- Prevents false positives during the 10-minute air settle delay after window closes
- Affected: All TADO rooms (TADO baseline cleared when turned off for open window)
- Files modified: room_heating.js (lines 1207-1212)

### 10.12.1 — 2026-01-19 — 🐛 CRITICAL FIX: False positive manual intervention detection for smart plugs (five separate bugs)

- Fixed five separate bugs causing incorrect manual override detection for smart plug rooms (e.g., Clara)
- All bugs had same symptom: False "Manual override • 90 min" notification appearing unexpectedly

Bug #1: Away→home transition baseline not cleared
- Problem: Away→home transition only cleared LastVerifiedTargetTemp (TADO), not LastVerifiedOnOff (smart plugs)
- When arriving home, smart plug states changed based on hysteresis logic
- Old baseline from before away mode still stored → system detected change as manual intervention
- Result: "Home" notification followed 3 minutes later by false "Manual override • 90 min"
- Solution: Also clear LastVerifiedOnOff when returning from away mode (same as TADO baseline clearing)
- Files modified: room_heating.js (line 2647)

Bug #2: Cancel override modes don't clear stale baselines
- Problem: When cancelling override (manual/boost/pause), baseline from BEFORE override still stored
- During override, user manually changed device states (e.g., turned ON while baseline was OFF)
- Cancel → Resume tries to change state → Verification may fail → Baseline not updated → False detection!
- Result: Cancel override → 10 seconds later → "Manual override" (comparing new state vs old baseline)
- Solution: Clear baselines in all cancel functions BEFORE resuming (cancelManualOverrideMode, cancelBoostMode, cancelPauseMode)
- Resume then establishes fresh baseline based on actual post-resume state
- Files modified: room_heating.js (lines 452-459, 677-684, 1067-1074)

Bug #3: Resume only stores baseline if commands were verified
- Problem: resumeNormalHeating() only stored baseline if anyVerified=true (at least one device verified)
- Also needed to track anyCommandSent to distinguish "no changes needed" from "changes failed"
- Without tracking: Resume sends commands → verification fails → baseline not stored → false detection
- Solution: Track anyCommandSent separately from anyVerified, only check fallback if no commands sent
- Files modified: room_heating.js (lines 887-959)

Bug #4: Resume missing "no changes needed" baseline storage
- Problem: If all devices already in correct state → no commands sent → anyVerified=false → baseline not stored
- Missing logic: "If no commands sent (all already correct), verify state and store baseline"
- Result: Resume completes without baseline → 10 seconds later → false "Manual override"
- Solution: Added fallback baseline storage when no commands sent - verify all devices match expected state
- Mirrors same logic used in setHeating() function (lines 1835-1859)
- Files modified: room_heating.js (lines 933-959)

Bug #5: Missing initial baseline bootstrap on first run
- Problem: If no baseline exists (first run, or after clearing), system would skip manual detection
- Should establish initial baseline from current device state, then detect changes going forward
- Result: "No verified baseline state yet - skipping manual detection" message
- Solution: Added bootstrap logic to establish initial baseline from current device states
- Smart plugs: Read all devices, if all match → store as baseline
- TADO: Read current target if ON and not away → store as baseline
- Files modified: room_heating.js (lines 1186-1212, 1233-1269)

All five fixes ensure smart plugs have fresh baseline after any mode transition
- Affected: Smart plug rooms (Clara) in all override cancel/resume/away scenarios
- TADO rooms (Oliver, Soveværelse, Stue) - same fixes applied for consistency
- System now self-initializes baselines when missing instead of skipping detection
- Complements v10.9.1 fix which solved similar issue for TADO valves

### 10.12.0 — 2026-01-19 — 🔄 SMART SCHEDULE: Auto-exit manual override when device returns to schedule mode

- Manual override now monitors device.capabilitiesObj.onoff.smart_schedule property
- When smart_schedule becomes true, device has returned to automatic schedule mode
- System immediately exits manual override and resumes normal schedule operation
- Solves problem: System 90-min override vs user's shorter device manual control duration
- Example: User sets 30-min manual on device → At 30 min: device→auto → System exits early
- checkManualOverrideMode() is now async to check device property
- Returns reason: 'smart_schedule' (early exit) or 'timeout' (normal 90-min expiry)
- Enhanced logging shows which expiration type occurred
- Notification: "🔄 Device → auto • Override ended" vs "⏱️ Override ended"
- Only applies to TADO valves (smart plugs unchanged - no smart_schedule property)
- Respects user's device-level manual control duration instead of forcing 90 minutes
- Better synchronization between device and system manual control periods
- Safety: If property doesn't exist or check fails, falls back to normal 90-min timeout
- Function changes: checkManualOverrideMode() made async, manual expiry logging enhanced
- Files modified: room_heating.js (lines 1037-1113, 2788, 2850-2875)

### 10.11.0 — 2026-01-18 — ✨ RESUME: Set and verify temperature when resuming from any heating interruption

- Added new resumeNormalHeating() function for explicit resume logic with temperature verification
- When pause mode cancelled: TADO sets both onoff=true AND target_temperature with verification
- When pause mode expires: Explicit resume with temperature setting and verification
- When boost mode cancelled: TADO sets target back to schedule temperature with verification
- When boost mode expires: Explicit resume with temperature setting and verification
- When manual override cancelled: Explicit resume with temperature verification
- When manual override expires: Explicit resume with temperature setting and verification
- When window air settles: Uses same explicit resume logic with temperature verification
- When returning home from away: Explicit resume with temperature verification
- Smart plugs: Calculate correct state using hysteresis when resuming
- Debug notifications now show both onoff AND temperature changes during resume
- Example: "🐛 Verified: onoff=true" + "🐛 Verified: target_temperature=22°C"
- Prevents situation where only onoff shown but temperature not verified
- Resume logic respects away mode (uses away minimum) and inactivity (applies offset)
- Baseline (LastVerifiedTargetTemp) updated after resume to prevent false manual detection
- Functions updated: cancelPauseMode(), cancelBoostMode(), cancelManualOverrideMode(), cancelAllOverrideModes()
- Control heating: Away->home transition, window settle all use explicit resume
- Main execution: Cancel request, pause expiry, boost expiry, manual expiry all call explicit resume
- Significantly improves user confidence that heating is properly restored after any interruption

### 10.10.2 — 2026-01-18 — 🔧 OPTIMIZE: Store smart plug baseline once per room, not per device

- Fixed inefficiency where LastVerifiedOnOff was updated for each device in a room
- Now stores baseline ONCE after all devices in room are processed
- For smart plugs: Store after all devices verified OR if no changes and all match expected
- Prevents multiple baseline updates for same state (was updating 2-3 times per run)
- Baseline storage moved from per-device loop to after-loop logic
- More efficient, cleaner code, same functionality
- Smart plug rooms with multiple devices benefit most from this optimization

### 10.10.1 — 2026-01-18 — 🐛 DEBUG: Add debug notifications for queue and verification events

- New HeatingDebugMode Logic variable enables detailed debug notifications
- When enabled, sends notifications for command queue operations and verification
- Examples: "📝 Queued onoff=true", "✅ Verified in 48ms: onoff=true", "📤 Sending onoff=true"
- Helps troubleshoot command verification and queue behavior without checking logs
- Set HeatingDebugMode=true in Homey Logic to enable, false to disable
- Debug messages prefixed with room name for multi-room setups
- Only affects notifications - logging behavior unchanged

### 10.10.0 — 2026-01-18 — 🔧 VERIFIED-BASELINE: Only compare against verified device states for manual detection

- Changed manual detection to use LastVerifiedTargetTemp instead of ExpectedTargetTemp
- Only stores baseline when sendCommandWithVerification() confirms device accepted command
- Eliminates false positives from comparing against unverified expected values
- For TADO: Only updates LastVerifiedTargetTemp after target_temperature verification succeeds
- For smart plugs: Only updates LastVerifiedOnOff after all devices verified OR confirmed matching
- Manual detection now compares actual device state against last known VERIFIED state
- If no verified baseline exists, manual detection returns "not detected" (safe fallback)
- More reliable manual intervention detection - only triggers on actual device changes
- Debug: New log message "📝 Stored verified target: 22°C (baseline for manual detection)"
- Complements v10.9.0 state-based detection and verification system

### 10.9.2 — 2026-01-18 — 🔄 RETRY: Auto-retry TADO temperature commands up to 3 times if not verified

- Added retry logic to sendCommandWithVerification() function
- If temperature verification fails, automatically retries up to 3 times (configurable)
- 2-second delay between retry attempts to allow device to process
- Fixes issue where TADO sometimes sets to default 18.1°C instead of target temperature
- Example: Target 20.5°C fails verification → retry 1 → retry 2 → retry 3 → success
- Logs show: "🔄 Retry attempt 2/3: target_temperature = 20.5"
- Success message indicates attempts: "✅ Command verified successfully (after 2 attempts)"
- Applies to all device commands: onoff switches and target_temperature for TADO
- Smart plug commands also benefit from retry logic (though less likely to need it)
- Significantly improves reliability of TADO temperature setting
- Default maxRetries = 3, configurable via function parameter if needed

### 10.9.1 — 2026-01-18 — 🐛 CRITICAL FIX: False manual override when returning from away mode

- Fixed bug where returning home triggered manual override for TADO rooms
- Problem: ExpectedTargetTemp still contained away mode minimum (18.1°C)
- When TADO auto-adjusted to schedule (20.5°C), system detected difference as manual change
- Result: "Home" notification followed by incorrect "Manual override • 90 min" notification
- Solution: Clear ExpectedTargetTemp when transitioning from away→home
- TADO's automatic temperature restoration is no longer treated as manual intervention
- Affected: TADO valve rooms (Oliver, Soveværelse, Stue) returning from away mode
- Example prevented: Away 18.1°C → Home (TADO auto-sets 20.5°C) → false "Manual override"
- Now shows: Away → Home (correct behavior, no false manual override)
- Complements v10.6.6 and v10.6.7 fixes for away mode transition handling

### 10.9.0 — 2026-01-18 — ✅ Command verification & queue system + state-based detection

### 10.8.6 — 2026-01-17 — 🐛 Fix: Snowflake icon (❄️) shown incorrectly during manual override for TADO

- Fixed bug where snowflake appeared in manual override notification when TADO was IDLE
- Problem: Manual override notification showed 'OFF' for TADO when not actively heating
- TADO has three states: HEATING (actively heating), IDLE (on but not heating), OFF (turned off)
- Snowflake should only appear when heating is completely OFF, not when IDLE
- Manual override notification now matches normal schedule notification logic
- Now shows: HEATING (no icon), IDLE (no icon), OFF (❄️ snowflake)
- Example: Manual override at 22.5°C, room at 22.3°C → IDLE state → no snowflake
- Consistent with version 10.3.10 fix for normal notifications

### 10.8.5 — 2026-01-17 — 🐛 CRITICAL FIX: Grace period blocks legitimate manual control detection

- Fixed bug where 7-minute grace period prevented manual temperature changes from being detected
- Problem: Grace period was meant to prevent false positives from automation's own changes
- But it blocked ALL detection, including real user manual changes (e.g., 22°C → 22.5°C)
- Example: User changes temp → Grace period active → Detection skipped → Next run resets to schedule
- Result: Manual changes ignored, temperature reset back to schedule value
- Root cause: Grace period was a band-aid for not properly updating ExpectedTargetTemp
- Solution: Reduced grace period from 7 minutes to 30 seconds (0.5 minutes)
- 30 seconds only accounts for network/async delays, not blocking detection across script runs
- ExpectedTargetTemp is now properly maintained (thanks to v10.8.4 fixes)
- Now: Manual change 22→22.5°C detected within 30 seconds → Manual override activated
- System respects user's manual settings for 90 minutes as designed
- Grace period no longer spans multiple script runs (was 7 min > 5 min script interval)
- Trust ExpectedTargetTemp tracking: if actual ≠ expected after 30s → manual intervention!
- Manual override feature now works as originally intended

### 10.8.4 — 2026-01-17 — 🐛 CRITICAL FIX: Boost and pause modes cancelled by false manual override detection

- Fixed bug where boost/pause modes were cancelled shortly after activation
- Problem: controlHeatingBoost/Pause changed TADO temperature but didn't update ExpectedTargetTemp
- Next automatic script run (5 min later) detected difference and thought user made manual change
- Example: Boost sets 25°C → 5 min later → system sees 25°C vs expected 22°C → "manual override detected"
- Result: Boost activated → then immediately cancelled → left in manual override mode instead
- Solution 1: activateBoostMode() now pre-sets ExpectedTargetTemp to boost temperature (25°C)
- Solution 2: controlHeatingBoost() updates ExpectedTargetTemp when setting TADO temperature
- Solution 3: checkBoostMode() resets grace period when boost expires (prevents false detection after)
- Solution 4: Same fixes applied to pause mode (activatePauseMode, controlHeatingPause, checkPauseMode)
- Affected: All TADO valve rooms (Oliver, Soveværelse, Stue) using boost or pause modes
- Smart plug rooms (Clara) unaffected - only use on/off switches, not temperature tracking
- Now: Single "🚀 Boost activated" notification, boost runs for full 60 minutes without interference
- Manual intervention detection still works - only triggers for actual user-initiated changes

### 10.8.3 — 2026-01-17 — 🐛 CRITICAL FIX: TADO target must be recalculated from scratch on air settle

- Fixed bug where TADO was still set to wrong temperature (18.1°C instead of 22°C)
- Problem: effectiveTarget variable had been modified by away mode logic earlier in function
- Using modified effectiveTarget resulted in wrong temperature when resuming after window settle
- Solution: Start fresh with slot.target when resuming, then apply away/inactivity logic cleanly
- Now calculates: slot.target → apply away min (if away) → apply inactivity offset (if inactive)
- Example: slot.target=22°C, away min=18°C → if away then 18°C, if home+inactive then 20°C
- Ensures TADO gets absolutely correct temperature on first attempt when air settle completes
- Next script run will not need to correct the temperature

### 10.8.2 — 2026-01-17 — 🐛 CRITICAL FIX: TADO set to wrong target temperature after air settle delay

- Fixed bug where TADO was set to incorrect temperature when window settle delay completed
- Problem: Inactivity offset was applied AFTER TADO was resumed, not before
- Window settle logic ran before inactivity logic in code flow
- Result: TADO resumed with base target (22°C) instead of effective target (e.g., 20°C with -2°C offset)
- Example: Room inactive → window closes → wait 10 min → TADO resumed at 22°C (wrong!)
- Should be: Room inactive → window closes → wait 10 min → TADO resumed at 20°C (correct!)
- Solution: Calculate effective target (including inactivity offset) before resuming TADO
- Now applies inactivity offset immediately when air settle completes, before setting target
- Smart plug behavior unchanged (already correctly calculated in hysteresis logic)
- Ensures TADO gets correct temperature immediately when heating resumes

### 10.8.1 — 2026-01-17 — 🐛 CRITICAL FIX: "Air settled" notification not sent after window settle delay

- Fixed bug where "Air settled • Heat resumed" notification was not sent for TADO valves
- Problem: After window settle delay completed, code continued executing instead of returning
- TADO heating was resumed correctly, but notification changes were cleared/overridden
- Solution: Added explicit return 'window_settled_tado' for TADO valves after air settle
- Smart plugs continue to hysteresis logic (correct behavior - need to check temperature)
- Affects: TADO valve rooms (Oliver, Soveværelse, Stue) - now get proper notification
- Smart plug rooms (Clara) - behavior unchanged (already working correctly)
- Ensures users are notified when heating resumes after window closed delay

### 10.8.0 — 2026-01-17 — 🎛️ Unified slot-override architecture

- Introduced unified getEffectiveSetting() function for all slot-based overrides
- All settings (inactivity, window timeouts) now use same override pattern
- Slot values take precedence over room defaults when defined
- Added getSettingSource() helper for logging override source ('slot override' or 'room default')
- Replaces multiple ad-hoc override checks with consistent pattern
- Documentation: See UNIFIED_SLOT_OVERRIDE_ARCHITECTURE.md and UNIFIED_SLOT_OVERRIDE_SYSTEM.md
- Settings supporting slot overrides: inactivityOffset, inactivityTimeout, windowOpenTimeout, windowClosedDelay
- Benefits: More maintainable, consistent behavior, easier to add new overridable settings

### 10.7.0 — 2026-01-17 — ⏱️ Per-slot inactivity timeout support

- Added slot-level inactivityTimeout override capability
- Each schedule slot can now define custom inactivity timeout (overrides room default)
- Example: Night slot with 5min timeout, Day slot with 30min timeout
- Stored in global variable: SlotInactivityTimeout (null if using room default)
- Displayed in status showing effective value and source (slot vs room)
- Documentation: See SLOT_INACTIVITY_TIMEOUT_FEATURE.md
- Complements existing slot-level inactivityOffset override
- Enables fine-grained control over inactivity behavior per time period

### 10.6.13 — 2026-01-16 — 🐛 Fix: Schedule gap when Day ends before lateEvening starts

- Fixed bug where schedule had gap between Day end and lateEvening start on holidays
- Problem: Weekday Day ends 20:00, but lateEvening starts 21:00 (when no school tomorrow)
- Gap from 20:00-21:00 would use default slot (first Morning slot) instead of extending Day
- Solution: If lateEvening starts later than last base slot ends, extend last slot to match
- Example: Weekday Day (06:00-20:00) auto-extends to (06:00-21:00) when using lateEvening
- Only affects holiday/vacation days when school tomorrow = false
- Ensures smooth schedule transitions without unexpected temperature changes

### 10.6.12 — 2026-01-16 — 🔕 Suppress "air settled" and "heat resumed" notifications when in away mode

- "Air settled • Heat resumed" notifications are now suppressed during TADO away mode
- These notifications are not relevant when nobody is home
- Functionality unchanged - only notification suppression during away mode
- Log still records event with "(away mode - notification suppressed)" indicator

### 10.6.11 — 2026-01-15 — 🐛 CRITICAL FIX: Window settle delay triggered even for brief window openings

- Fixed bug where "Window closed • Waiting 10min" shown even if window only open for seconds
- Problem: Air settle delay started whenever window closed, regardless of how long it was open
- If window open < timeout, heating never turned off, so no need to wait for air to settle
- Solution: Only start settle delay if window was open long enough to trigger heating shutoff
- Example: Open window 5 sec → close → no delay (heating never affected)
- Example: Open window 6 min → close → 10 min delay (heating was off, air needs to settle)

### 10.6.10 — 2026-01-15 — 🐛 CRITICAL FIX: Window closed delay notification sent immediately

- Fixed bug where "Air settled" notification appeared immediately after "Window closed"
- Problem: WindowClosedTime could trigger premature completion check
- Solution: Added minimum 60-second threshold to prevent immediate double notifications
- Ensures script MUST wait at least 60 seconds before "Air settled" notification
- Prevents both notifications from being sent with identical timestamps

### 10.6.9 — 2026-01-15 — 🔍 Search child zones for motion and window sensors

- Added getZoneAndChildDevices() helper to search parent zone + all child zones
- Window sensors now detected in child zones (fixes "No window sensors found")
- Motion sensors now detected in child zones for proper activity tracking
- Supports complex zone hierarchies (e.g., "Stue / Spisestue" with "Stue" and "Spisestue" children)
- isWindowOpen() now searches child zones
- Backward compatible - works with both simple and hierarchical zone structures

### 10.6.8 — 2026-01-15 — 📊 CRITICAL FIX: Use TADO device temperature sensor directly by ID

- Fixed bug where TADO devices in different zones weren't found by zone filtering
- TADO rooms now get thermostat directly by device ID instead of filtering by zone
- Prioritizes TADO's built-in temperature sensor (more accurate at valve location)
- Falls back to zone sensors if TADO device not found or lacks temperature capability
- Affects: TADO valve rooms (Oliver, Soveværelse, Stue) - uses thermostat temperature
- Smart plug rooms (Clara) unchanged - continues using zone sensors
- Added detailed logging showing which sensor is used and current temperature value
- Fixes "TADO device has no temperature sensor" false warning

### 10.6.7 — 2026-01-14 — 🐛 CRITICAL FIX: Away mode transition check MUST happen BEFORE manual detection

- Fixed execution order bug causing false positive manual override when arriving home
- Problem: detectManualIntervention() called BEFORE grace period reset in controlHeating()
- When arriving home: TADO auto-adjusts temp → manual detection checks (stale grace) → false positive
- Then too late: controlHeating() resets grace period (after damage already done)
- Solution: Moved away→home transition check to MAIN EXECUTION before manual intervention detection
- Now: Check away status early → reset grace if transitioning → THEN check for manual intervention
- Result: Grace period properly set before detection runs, preventing false positives
- Execution order: 1) Away check + grace reset, 2) Manual detection, 3) Control heating
- This ensures TADO's automatic away→home adjustments are protected by grace period

### 10.6.6 — 2026-01-14 — 🐛 CRITICAL FIX: False positive manual override when returning from away mode

- Fixed bug where TADO rooms triggered manual override when arriving home
- Problem: TADO thermostats automatically adjust temperature when switching from away→home
- System compared new TADO target against stale away-mode ExpectedTargetTemp → false positive
- Example: Away at 18°C → TADO auto-adjusts to 20°C on arrival → detected as "manual" change
- Solution: Reset grace period timer (LastAutomationChangeTime) when returning from away mode
- 7-minute grace period prevents false detection during TADO's automatic adjustment
- Affects: TADO valve rooms (Oliver, Soveværelse) - smart plug rooms unaffected
- Prevents: "Home" notification → "Manual override" false positive sequence

### 10.6.5 — 2026-01-14 — 🐛 CRITICAL FIX: Grace period constantly reset causing false manual override detection

- Fixed bug where LastAutomationChangeTime was updated on EVERY script run, even when no changes made
- Problem: Script runs frequently (events: motion, window, schedule), constantly resetting grace period
- Grace period never actually expired, then suddenly did when timing aligned → false positive
- Between grace expiry, inactivity mode could toggle, changing target (21°C → 20°C with -1°C offset)
- System detected its own inactivity changes as manual intervention after grace expired
- Solution: Only update LastAutomationChangeTime when ACTUALLY making physical changes
- Also increased grace period from 2 to 7 minutes for additional safety margin
- Example prevented: "Air settled • Heat resumed" at 15:45 → "Manual override" at 15:50
- Grace period now properly protects against detecting automation's own temperature adjustments

### 10.6.4 — 2026-01-14 — 🐛 CRITICAL FIX: Clear expected target when TADO turned off

- Fixed bug where stale ExpectedTargetTemp values caused false positive manual override detection
- Problem: When TADO turned off, ExpectedTargetTemp was left with old value
- Later schedule changes would compare against stale expected value → false positive
- Example: System sets 20°C, turns off, schedule changes to 18°C → false "manual override"
- Solution: Clear ExpectedTargetTemp (set to null) when turning TADO off
- detectManualIntervention() already handles null values correctly (returns detected=false)
- Prevents: False manual override notifications when schedule changes while TADO is off

### 10.6.3 — 2026-01-13 — 🐛 CRITICAL FIX: False positive manual intervention detection

- Fixed bug where system detected its own temperature changes as manual interventions
- Problem: When turning TADO off (window open), stored currentTarget as expected value
- This caused false positive when system later calculated different target (e.g., due to schedule)
- Solution: Only store ExpectedTargetTemp when actively controlling (turnOn=true)
- Increased grace period from 30 seconds to 2 minutes (scripts run every 5 min)
- Now ALWAYS updates LastAutomationChangeTime when storing expected target
- Added detailed logging to track when expected values are stored
- Prevents: "Override ended → Manual override" notification loop when window closes

### 10.6.2 — 2026-01-13 — 🐛 CRITICAL FIX: Manual intervention detection not working when TADO already on

- Fixed bug where ExpectedTargetTemp was only stored when turning TADO on
- Now stores expected target on every heating control cycle (both on and off)
- Manual temperature changes now properly detected even when automation hasn't recently changed target
- Without this fix, manual intervention detection would fail if system was maintaining steady temperature
- Example: User changes Soveværelse from 21°C to 22°C now triggers manual override notification

### 10.6.1 — 2026-01-13 — 🐛 Fix diagnostics logging during manual override mode

- Manual override now logs actual TADO target temperature instead of 0°C
- Diagnostics now show correct target (e.g., 22°C) instead of "Target: 0°C"
- Fixes misleading log entries during manual override

### 10.6.0 — 2026-01-13 — 🤚 Add manual intervention detection and handling

- Detects manual temperature changes (TADO) and switch changes (smart plugs)
- Pauses automation for 90 minutes (configurable per room) when manual intervention detected
- Manual override has highest priority - cancels active boost/pause modes
- Auto-revert to schedule after timeout
- Cancel command now cancels boost, pause, AND manual override
- Boost/pause commands cancel manual override when activated
- Grace period (30 seconds) prevents detecting automation's own changes
- New global vars: ManualOverrideMode, ManualOverrideStartTime, ManualOverrideDuration, etc.
- New functions: activateManualOverrideMode(), cancelManualOverrideMode(), checkManualOverrideMode(), detectManualIntervention()
- Tracks expected values to detect changes: ExpectedTargetTemp (TADO), ExpectedOnOff (smart plugs)
- Notifications when manual override starts, ends, and is active

### 10.5.0 — 2026-01-12 — ⏸️ Add pause heating mode (opposite of boost)

- New "pause" argument: run('Clara', 'pause') forces heating OFF for 60 minutes
- Smart plugs: Turn off all radiators, ignore all conditions
- TADO valves: Turn completely OFF (onoff = false)
- Ignores temperature, schedule, window, inactivity, away mode during pause
- Latest call wins: pause cancels boost, boost cancels pause (mutually exclusive)
- Cancel command now cancels both boost and pause modes
- Automatic revert to schedule after 60 minutes
- New global vars: PauseMode, PauseStartTime, PauseDuration
- Notifications when pause starts, ends, and is active
- New functions: activatePauseMode(), cancelPauseMode(), checkPauseMode(), controlHeatingPause()

### 10.4.4 — 2026-01-09 — 🐛 Fix next schedule showing wrong day type

- getNextScheduleChange() now correctly determines tomorrow's schedule type
- Friday evening no longer shows "School" when Saturday uses weekend schedule
- Properly checks if tomorrow is weekend/school day/holiday
- Shows actual first period from tomorrow's schedule, not today's
- Example: Friday 20:27 now shows "Night" (weekend) not "School" (weekday)

### 10.4.3 — 2026-01-08 — 🔧 Fix Flow argument parsing

- Homey Flows pass "Clara, boost" as single string (not separate args)
- Script now splits comma-separated arguments automatically
- Works with both: Flow "Clara, boost" and HomeyScript run('Clara', 'boost')
- Example Flow input: "Clara, boost" or "oliver, cancel" (case-insensitive)

### 10.4.2 — 2026-01-08 — 🔧 Make room names case-insensitive

- Can now use 'clara' or 'Clara', 'oliver' or 'Oliver'  
- Fixes "Unknown room" error when using lowercase names
- Example: run('clara', 'boost') works same as run('Clara', 'boost')

### 10.4.1 — 2026-01-08 — 🛑 Add cancel boost function

- New "cancel" argument: run('Clara', 'cancel') cancels active boost
- Immediately clears boost mode and resumes schedule
- Notification sent when boost is cancelled
- Works even if boost not active (safe to call anytime)

### 10.4.0 — 2026-01-08 — 🚀 Add boost heating mode

- New "boost" argument: run('Clara', 'boost') activates boost for 60 minutes  
- Smart plugs: Turn on all radiators, ignore schedule and hysteresis
- TADO valves: Set to 25°C boost temperature
- Ignores window open, inactivity, away mode during boost
- Automatic revert to schedule after 60 minutes
- New global vars: BoostMode, BoostStartTime, BoostDuration
- Notifications when boost starts and ends

### 10.3.11 — 2026-01-08 — ⏳ Add window closed delay for air to settle

- New setting: windowClosedDelay (seconds, default 600 = 10 minutes)
- After window closes, heating waits before resuming
- Allows air to mix and settle for accurate temperature reading
- Prevents heating from working harder due to cold air near sensor
- New global var: WindowClosedTime tracks when window was closed
- New action: 'window_closed_waiting' during settle period
- Notification shows "Window closed • Waiting Xmin" then "Air settled • Heat resumed"

### 10.3.10 — 2026-01-05 — 📱 Fix snowflake icon appearing when TADO is IDLE

- Snowflake (❄️) now only shows when heating is OFF, not IDLE
- IDLE is normal for TADO - means valve is on but not actively heating
- "OFF" = heating completely turned off (e.g., window open)
- "IDLE" = heating ready but room at target (no icon needed)

### 10.3.9 — 2026-01-03 — 🛠️ CRITICAL FIX: Double checkInactivity() call caused wrong notification target

- checkInactivity() was called twice: once in controlHeating(), once before notification
- Between calls, zone could become active (e.g., person closing window)
- Second call returned different results, causing notification to show wrong target
- Example: TADO set to 20°C (with inactivity), but notification showed 21°C (no inactivity)
- Fix: Use stored EffectiveTemperature and InactivityMode flag instead of rechecking
- "IDLE" = heating ready but room at target (no icon needed)

### 10.3.8 — 2026-01-03 — 📱 Changed window icon to wind icon

- Changed open window icon from 🪟 to 💨 (wind/draft)
- More intuitive - immediately suggests "air coming in from outside"
- Icons: 💨=window open, 💤=inactive, ❄️=heating off, 🚶=away mode

### 10.3.7 — 2026-01-03 — 📱 Remove redundant temperature comparisons from notifications

- Removed "21.9 > 20.75°C" and "19.7 < 20.5°C" from heat on/off messages
- Temperature comparison is redundant (already shown in status: 🌡️21.9→20.5°C)
- "Heat on • 19.7 < 20.5°C" → "Heat on"
- "Heat off • 21.9 > 20.75°C" → "Heat off"
- "Inactive (20min) • -2°C → 20.5°C • Heat off • 21.9 > 20.75°C" → "Inactive (20min) • -2°C → 20.5°C • Heat off"

### 10.3.6 — 2026-01-03 — 📱 Condensed change descriptions (Option 2 - More Condensed)

- "Window opened • Heating turned off (open 75 sec)" → "Window (75s) • Heat off"
- "Schedule changed to 06:00-20:00 • Target: 20°C → 22.5°C" → "Schedule 06:00-20:00 • 20→22.5°C"
- "No activity detected (20+ min) • Target reduced by 2°C to 20.5°C" → "Inactive (20min) • -2°C → 20.5°C"
- "Activity detected - resumed • Target restored to 22.5°C" → "Active • → 22.5°C"
- "Nobody home detected (TADO) • Minimum temperature set: 18°C" → "Away • Min 18°C"
- "Someone arrived home (TADO)" → "Home"
- All messages now more compact while remaining clear

### 10.3.5 — 2026-01-03 — 📱 Use walking person icon for away mode (matches TADO app)

- Changed away mode icon from 🏠 to 🚶 (walking person)
- Matches TADO app's own away mode symbol
- Icons: 💨=window open, 💤=inactive, ❄️=heating off, 🚶=away mode

### 10.3.4 — 2026-01-03 — 📱 Icon-only alerts - removed all text after icons

- Icons are now standalone, self-explanatory symbols
- 💨 = window open
- 💤 = room inactive
- ❄️ = heating off
- 🚶 = away mode
- Ultra-clean, minimal notification format

### 10.3.3 — 2026-01-03 — 📱 Condensed notifications - only show alert icons

- Window icon only shown when OPEN (not when closed)
- Inactive icon only shown when room IS inactive (not when active)
- Heating icon only shown when NOT heating (OFF/IDLE, not when ON/HEATING)
- House icon only shown when in AWAY mode (not when HOME)
- Result: Normal operation shows just temperature, alerts show relevant icons

### 10.3.2 — 2026-01-03 — 📱 Compact notification format with icons

- Notifications now much more compact (3-4 lines vs 8-10 lines)
- Temperature display: "22.3→20°C" instead of separate lines
- Window: ✓ (closed) or ✗ (open) - removed redundant status text
- Inactivity: ✗ (active) or ✓ (inactive/sleeping)
- Heating: 🔥 for ON/HEATING, ❄️ for OFF/IDLE
- Added next schedule change time with target and period name
- All status on single line with icons for quick scanning

### 10.3.1 — 2026-01-02 — 📝 Add specific 'window_closed' action when window closes

### 10.3.0 — 2026-01-02 — 🛠️ CRITICAL: Fix missing log entries when window closes

### 10.2.9 — 2026-01-02 — 📝 Fix inconsistent action logging between TADO and smart plugs

### 10.2.8 — 2026-01-02 — 🔥 CRITICAL: Stop sending unnecessary commands to TADO!

### 10.2.7 — 2026-01-02 — 🛠️ CRITICAL FIX: effectiveTarget was undefined in logDiagnostics!

### 10.2.6 — 2026-01-02 — 🕐 Fix DST timezone bug in getDanishLocalTime()

### 10.2.5 — 2026-01-02 — 🛠️ Fix false schedule change notifications

### 10.2.4 — 2026-01-02 — 📝 Fix diagnostic log to track effectiveTarget instead of slot.target (BROKEN!)

### 10.2.3 — 2026-01-02 — 🪟 Add notification when window closes

### 10.2.2 — 2026-01-02 — 🛠️ Fix confusing notifications when window open

### 10.2.1 — 2026-01-02 — 🛠️ Fix window timeout flag reset when heating still on

### 10.2.0 — 2026-01-02 — 🔥 Use TADO onoff capability to turn off properly (BREAKING CHANGE)

### 10.1.6 — 2026-01-02 — 🔥 TADO window handling: Turn OFF instead of reducing temp

### 10.1.5 — 2026-01-02 — 🛠️ Fix TADO window handling and notification status

### 10.1.4 — 2025-12-31 — 🔧 Revert to getVariables() method - the working approach

### 10.1.3 — 2025-12-31 — 🔧 Consistent Logic variable access across all functions (BROKEN)

### 10.1.2 — 2025-12-31 — 🔧 Fix to use Homey's built-in Logic variables (not Better Logic)

### 10.1.1 — 2025-12-31 — 🔧 Fix HeatingEnabled to use Logic variable (not global script variable)

### 10.1.0 — 2025-12-31 — 🎚️ Global heating control via HeatingEnabled variable

### 10.0.1 — 2025-12-31 — 🛠️ Fix excessive window logging and notifications

### 10.0.0 — 2025-12-31 — 🔧 Configuration via global variables (BREAKING CHANGE)

### 9.0.0 — 2025-12-31 — 🎯 Per-room schedules and settings (BREAKING CHANGE)

### 8.0.1 — 2025-12-31 — 🛠️ Fix excessive logging bug

### 8.0.0 — 2025-12-31 — 🎯 Target-based temperature control (BREAKING CHANGE)

- Schedules now use single "target" temperature instead of low/high
- Smart plugs automatically calculate hysteresis range (±0.25°C default)
- TADO valves use target directly - handles heating power automatically
- Clearer configuration: "I want 22.5°C" not "low 22.25, high 22.75"
- Per-room hysteresis setting for smart plugs
- TADO always gets correct target (not away temp when just off)
- Simplified inactivity/away logic: target - offset
- Global vars: Temperature (target), TemperatureLow/High (calculated for smart plugs)

### 7.1.0 — 2025-12-31 — 🎯 Multi-room support with argument selection

### 7.0.0 — 2025-12-31 — 🌟 Zone-based generic implementation

## Room Heating Status

`room_heating_status.js`

### 5.0.1 — 2026-11-03 — 🔧 TADO home id from the config only

- The hard-coded fallback id is gone; TADO_HOME_ID comes from Config.Global.
- Version history moved out of the script header into this file.

### 5.0.0 — 2026-09-07 — 📊 Read live status from the HeatingStatus Logic variable (matches heating v10.22.0)

- Schedule, period, effective settings, next change, last action and last update
  come from HeatingStatus instead of the display globals (no longer written).
- Removed the duplicated school-calendar fetch and schedule computation (~250 lines):
  getCurrentScheduleInfo, getSchoolDayStatus, isSchoolDayTomorrow, getCompleteSchedule,
  getNextScheduleChange, the SchoolCalendar cache readers and helpers.
- SCHOOL DAY INFO section replaced by SCHEDULE TODAY, taken from the latest published room.
- Rooms without a published status show a hint to run the heating script once.
- Still reads ${zoneName}.Heating.State, .Heating.RunLock and .Heating.DiagnostikLog.
- 995 -> 730 lines. Smoke-tested with test/harness.mjs --then-status.
- Files modified: room_heating_status.js (v5.0.0)

### 4.15.0 — 2026-09-07 — ⏳ Drop lastRunTemp from DEFAULT_STATE (matches heating v10.21.0)

### 4.14.0 — 2026-09-07 — 🔧 Baseline shape matches heating v10.20.0

- DEFAULT_STATE.baseline is now { commandedTargetTemp, lastSeenTargetTemp }
- Files modified: room_heating_status.js (v4.14.0)

### 4.13.0 — 2026-09-07 — 🔧 Show run lock instead of device queue (matches heating v10.19.0)

- DEVICE QUEUE STATUS section and getDeviceState() removed
- New RUN LOCK section: free / run in progress (Ns) / stale lock
- DEFAULT_STATE gains baseline.commandedTargetTemp
- Files modified: room_heating_status.js (v4.13.0)

### 4.12.0 — 2026-03-31 — 🔄 Refactor: Read from unified state object (matches heating v10.16.0)

- Status script now reads mode/window/inactivity from ${zoneName}.Heating.State JSON
- Legacy individual globals (ManualOverrideMode, PauseMode, BoostMode, WindowOpenTime,
  WindowClosedTime, InactivityMode) are no longer written by heating script
- Added getRoomState() helper with DEFAULT_STATE merge (same pattern as room_heating.js)
- Remaining time for all modes now computed from roomState.modeExpires (simpler math)
- Window settle delay reads from roomState.window.closedSince
- Override mode check uses roomState.mode instead of separate boostActive/pauseActive vars
- Schedule globals (ScheduleType, Temperature, etc.) are still individual globals — unchanged
- Files modified: room_heating_status.js (v4.12.0), CHANGELOG.txt

### 4.11.0 — 2026-03-15 — 🔧 Auto-discover heating devices in status script (matches heating v10.15.0)

- getZoneDevices() now auto-discovers heating devices by zone instead of using hardcoded IDs
- Smart plugs: discovered via virtualClass/class 'heater'
- TADO valves: discovered via tado_heating_power capability
- Removed heatingDeviceIds parameter from getZoneDevices()
- Files modified: room_heating_status.js (v4.11.0)

### 4.10.1 — 2026-01-27 — 📊 Show school calendar cache info (matches heating v10.13.1)

### 4.10.0 — 2026-01-23 — 📚 Direct Skoleintra calendar fetch with caching (matches heating v10.13.0)

### 4.9.0 — 2026-01-18 — 📊 Show device queue status (matches heating v10.9.0)

### 4.8.0 — 2026-01-17 — 🎛️ Show unified slot-override architecture (matches heating v10.8.0)

### 4.7.0 — 2026-01-17 — ⏱️ Show per-slot inactivity timeout (matches heating v10.7.0)

### 4.6.3 — 2026-01-16 — 🐛 Fix: Schedule gap when Day ends before lateEvening starts (matches heating v10.6.13)

### 4.6.2 — 2026-01-15 — 🔍 Search child zones for motion and window sensors (matches heating v10.6.9)

- Added getZoneAndChildDevices() helper to search parent zone + all child zones
- Motion sensors now shown in DEVICES section even if in child zones
- Window sensors now detected in child zones
- Supports complex zone hierarchies (e.g., "Stue / Spisestue" with children)
- Backward compatible with simple zone structures

### 4.6.1 — 2026-01-15 — 📊 CRITICAL FIX: Get TADO devices directly by ID (matches heating v10.6.8)

- Fixed bug where TADO devices in different zones weren't shown in status
- TADO rooms now get thermostat directly by device ID instead of zone filtering
- Shows correct temperature sensor in DEVICES section (TADO device, not motion sensor)
- Heating devices now fetched directly by ID, works even if in different zone
- Ensures status displays match actual heating control behavior

### 4.6.0 — 2026-01-13 — 🤚 Show manual override mode status (matches heating v10.6.0)

- Displays manual override mode status when active
- Shows remaining override time
- Shows type of manual intervention (temperature or switch)
- Indicates manual override in current status section
- Shows how to cancel active manual override

### 4.5.0 — 2026-01-12 — ⏸️ Show pause mode status (matches heating v10.5.0)

- Displays pause mode status when active
- Shows remaining pause time
- Indicates pause override in current status section
- Shows how to cancel active pause

### 4.4.2 — 2026-01-09 — 📅 Show next schedule change (matches heating v10.4.4)

- Added "Next Schedule Change" section showing upcoming period transition
- Correctly determines tomorrow's schedule type (weekend/school/holiday)
- Shows time, target temperature, and period name for next change
- Matches fix in heating script for cross-day schedule transitions

### 4.4.1 — 2026-01-08 — 🛑 Show cancel instructions when boost active (matches heating v10.4.1)

- Displays how to cancel active boost
- Shows cancel command in boost status section

### 4.4.0 — 2026-01-08 — 🚀 Show boost mode status (matches heating v10.4.0)

- Displays boost mode status when active
- Shows remaining boost time
- Indicates boost override in current status section

### 4.3.0 — 2026-01-08 — ⏳ Show window settle delay status (matches heating v10.3.11)

- After window closes, shows "⏳ SETTLING (Xm Ys remaining)"
- Displays configured delay time from room settings
- Shows when heating will resume after air settles
- Displays configured delay time from room settings
- Shows when heating will resume after air settles

### 4.2.9 — 2026-01-04 — 🧹 Remove redundant motion sensor line from Activity section

- Motion sensor already shown in DEVICES section, no need to repeat

### 4.2.8 — 2026-01-03 — 📝 Fix extra space after snowflake icon

- Removed double space after ❄️ icon: "❄️  OFF" → "❄️ OFF"
- Applied to both CURRENT STATUS and DEVICES sections
- Consistent single space after all icons now

### 4.2.7 — 2026-01-03 — 🔥 Simplify heating status to overall state

- Smart plugs now show "Heating: 🔥 ON" or "Heating: ❄️ OFF" (not individual radiators)
- Individual radiator states shown in DEVICES section with on/off status
- CURRENT STATUS section now more concise

### 4.2.6 — 2026-01-03 — 📊 Window status on one line + devices table

- Window status now shows on single line: "Window: 🔴 OPEN (1038s)"
- Added new DEVICES section showing all zone devices
- Devices table shows: temperature, motion, window(s), and heating devices
- Multi-device types show count and list with dash prefix

### 4.2.5 — 2026-01-03 — 🧹 Remove redundant window sensor device listing

- Removed "- O Eve Door & Window: OPEN" line under window status
- Window status already shows if open/closed and duration
- Individual device names are redundant in this context

### 4.2.4 — 2026-01-03 — 📝 Fix window sensor device name alignment

- Added dash prefix to window sensor names for clarity
- Format: "                - O Eve Door & Window: OPEN"
- Makes it clear device name is a sub-detail under window status
- Preserves full device name (no truncation)

### 4.2.3 — 2026-01-02 — 📝 Remove extra space in radiator formatting

- Had extra space between padding and value causing misalignment
- "C Radiator 2:   " + " " + "🔥 ON" = 17 chars (wrong!)
- Now: "C Radiator 2:   " + "🔥 ON" = 16 chars (correct!)

### 4.2.2 — 2026-01-02 — 📝 Fix radiator alignment properly - padding AFTER colon!

### 4.2.1 — 2026-01-02 — 📝 Fix smart plug radiator names to use 15-char width (BROKEN - ugly!)

### 4.2.0 — 2026-01-02 — 📝 Standardize ALL label widths to 15 characters

### 4.1.7 — 2026-01-02 — 📝 Align temperature settings columns consistently

### 4.1.6 — 2026-01-02 — 🛠️ Remove confusing motion sensor timestamp

### 4.1.5 — 2026-01-02 — 🎯 Show both base and effective temperature (matches heating v10.2.5)

### 4.1.4 — 2026-01-02 — 🕐 Fix timezone issue in activity display

### 4.1.3 — 2025-12-31 — 🔧 Revert to getVariables() method (matches heating v10.1.4)

### 4.1.2 — 2025-12-31 — 🔧 Fix to use Homey's built-in Logic variables (matches heating v10.1.2)

### 4.1.1 — 2025-12-31 — 🔧 Fix HeatingEnabled to use Logic variable (matches heating v10.1.1)

### 4.1.0 — 2025-12-31 — 🎚️ Show HeatingEnabled global status (matches heating v10.1.0)

### 4.0.0 — 2025-12-31 — 🔧 Configuration via global variables (matches heating v10.0.0)

### 3.3.0 — 2025-12-31 — 🎯 Per-room configuration support (matches heating v9.0.0)

### 3.2.1 — 2025-12-31 — 🧹 Removed redundant inactivity section

### 3.2.0 — 2025-12-31 — 🎯 Target-based display (matches heating v8.0.0)

### 3.1.0 — 2025-12-31 — 🔄 Show ALL rooms automatically

### 3.0.0 — 2025-12-31 — 🌟 Zone-based multi-room implementation

## Room Heating Config

`room_heating_config.js`

### 1.6.2 — 2026-11-03 — ⏳ Oliver: 60 minutes before the room counts as empty

- Day slots (weekday, weekend, holiday) get inactivityTimeout 60 (was the room default 30).
- Why: on 3 Nov the target dropped to 19.5 at 16:26 while Oliver was home - sitting still
  at his desk, the motion sensor did not see him for 30 minutes - and at 17:03 he raised
  the valve to 23.5 by hand. Same reasoning as Soveværelse in 1.6.0.
- Files modified: room_heating_config.js (v1.6.2), CHANGELOG.md

### 1.6.1 — 2026-11-03 — 🐛 Correct HeatingEnabled advice

- The closing notes told you to switch heating off with global.set("HeatingEnabled",
  false), a HomeyScript global nothing reads. The heating script reads the Yes/No
  Logic variable HeatingEnabled, and the "Heating Master Off" flow turns radiators and
  TADO valves off while it is No. The notes now say that. No configuration change.
- Files modified: room_heating_config.js (v1.6.1), CHANGELOG.md

### 1.6.0 — 2026-11-03 — 🌡️ Oliver 22 after school, earlier Stue mornings, longer empty-room waits

From the config review (Homey data 27 Oct-3 Nov) and the family's answers:
- Oliver: school-day Day 20.5 -> 22 (21 when empty), 08:00-20:00. Weekends, holidays,
  times and the evening slots unchanged.
- Stue: school-day Morning 04:00-07:00 (was 05:00): the room never reached 22.5 by
  07:00 and was raised by hand at 05:30-06:00. Weekend and holiday kept identical:
  Night to 05:00, Morning 05:00-08:30, Day from 08:30 (was 06:00-08:00).
  Evening inactivityTimeout 15 -> 60 min: the Hue motion sensor does not see people
  sitting still on the sofa.
- Soveværelse: Day inactivityTimeout 60 min (was the room default 30) on all day
  types: the room is a home office Mon, Tue and Fri, and sitting still at the desk
  should not set it back. Temperatures unchanged.
- Clara: unchanged.
- Validation: the same 4 warnings as 1.5.0 (Clara and Oliver, Sunday 20-21).
- Files modified: room_heating_config.js (v1.6.0), CHANGELOG.md

### 1.5.0 — 2026-11-03 — ✨ Validation before saving; notifyRoutineChanges

- Errors stop the script before anything is saved: missing fields, times that are
  not HH:MM, a slot that does not start before it ends, a day schedule that does not
  start at 00:00 or has a gap or overlap between slots, holiday ranges with from after
  to, malformed MM-DD dates, missing tadoHomeId.
- Warnings are listed and saved: an evening slot that starts before a day schedule's
  last slot ends (that slot wins until it ends), an earlyEvening gap (the room falls
  back to the first slot of the day), unknown fields. The current config has 4: Clara
  and Oliver's earlyEvening starts 20:00 while weekend and holiday Day run to 21:00.
- GLOBAL_CONFIG.notifyRoutineChanges (default false), read by heating v10.25.0.
- Version history moved out of the script header into this file.

### 1.4.0 — 2026-10-13 — 🌡️ Clara on efterskole: school days hold 17°C

- weekday: one 'Efterskole' slot 00:00-14:00 at 17 (was Night 20 + School 22)
- weekday Day 14:00-20:00 at 21 with inactivityOffset 4 (17 empty, 21 when she is home on Friday)
- earlyEvening inactivityOffset 3 (17 when empty, 20 when she is home)
- Weekend, holiday and lateEvening unchanged

### 1.3.0 — 2026-09-07 — 📚 School days from schoolHolidays ranges + publicHolidaysFixed + SchoolHoliday Logic variable

- Removed icalCalendarId, schoolCalendarUrl, schoolCalendarCacheTTL, homeyLogicVars (Skoleintra no longer used)
- Holiday dates for 2026/27 are a Copenhagen-pattern starting point - verify against the school plan

### 1.2.0 — 2026-09-07 — ⏳ windowClosedDelay 3600 -> 1800 (fixed 30 min wait; heating v10.21.0 no longer exits early on stable temperature)

### 1.1.0 — 2026-03-15 — 🔧 Remove hardcoded device IDs (now auto-discovered by zone)

### 1.0.7 — 2026-02-01 — 🌡️ Update default windowClosedDelay to 30 min (for smart settling logic)

### 1.0.6 — 2026-01-23 — 📚 Add schoolCalendarUrl for direct Skoleintra calendar access

### 1.0.5 — 2026-01-17 — 🎛️ Unified slot-override architecture

- New room setting: inactivityOffset (default temperature reduction)
- Slot field now optional: inactivityOffset (uses room default if not specified)
- New optional slot field: windowOpenTimeout (override room default)
- New optional slot field: windowClosedDelay (override room default)
- Consistent override pattern: slot value || room default
- Reduces configuration repetition while maintaining flexibility
- All existing configs remain backward compatible

### 1.0.4 — 2026-01-17 — ⏱️ Add per-slot inactivityTimeout support

- New optional slot field: inactivityTimeout (minutes)
- Allows time slots to override room's default inactivityTimeout
- If not specified on slot, uses room setting (backward compatible)
- Example: School slot can wait 60 min, evening slot 15 min
- Provides fine-grained control over inactivity detection timing

### 1.0.3 — 2026-01-13 — 🤚 Add manualOverrideDuration setting for manual intervention handling

- New setting: manualOverrideDuration (minutes, default 90)
- Allows system to detect and respect manual temperature/switch changes
- After timeout, system automatically reverts to schedule
- Configurable per room (Clara: 90min, Oliver: 90min)

### 1.0.2 — 2026-01-08 — ⏳ Add windowClosedDelay setting for air settle time

- New setting: windowClosedDelay (seconds, default 600 = 10 minutes)
- After window closes, heating waits for air to settle before resuming
- Prevents heating from working harder due to cold air near sensor
- Configurable per room (Clara: 600s, Oliver: 600s)

### 1.0.1 — 2026-01-05 — 🕐 Fix evening slot start times to avoid gaps

- earlyEvening now starts at 20:00 (was 21:00) - matches end of weekday Day slot
- lateEvening now starts at 21:00 (was 22:00) - matches end of weekend Day slot
- Eliminates 1-hour gaps where system would fall back to Night schedule
- Clara: Day ends 20:00, Evening starts 20:00 (school tomorrow) or 21:00 (weekend)
- Oliver: Day ends 20:00, Evening starts 20:00 (school tomorrow) or 21:00 (weekend)

### 1.0.0 — 2025-12-31 — Initial version

- Single source of truth for all room configurations
- Saves to global variables: Config.Rooms (JSON string)
- Eliminates duplicate configuration in heating and status scripts

## Cleanup Stale Globals

`cleanup_stale_globals.js`

### 1.1.0 — 2026-09-07 — 🔧 Remove in batches with a pause per key; progress per key; "run again" hint

### 1.0.0 — 2026-09-07 — Initial version

## Add New Room Wizard

`add_new_room_wizard.js`

### 1.0.0 — 2026-01-13 — Initial version
