// ====== HOMEY ADAPTIVE LIGHTING - CENTRALIZED SCRIPT ======
// Universal script for all rooms with per-room profiles and schedules
//
// Script Name: AdaptiveLighting
// Version:     2.30.1
// Date:        2026-10-28
// Author:      Henrik Skovgaard
//
// VERSION HISTORY:
// -------------------------------------------------------------------------
// 2.30.1 2026-10-28  FREE DAYS is a shared block (no change in behaviour)
//                    - The same block is in the new AL_FreeDay script
//                      (al_free_day.js), the flow condition B9 and E9 - Light
//                      flow use for their inactivity-timeout cards, so the
//                      flows switch when the weekend profiles do. The platform
//                      test checks the two copies are identical
//                    - scheduleDay() reads date and hour from one clock reading
//                      (Intl formatToParts, h23) instead of two, so it no
//                      longer needs getCurrentTimeInMinutes()
// 2.30.0 2026-10-28  Holidays use the weekend schedule
//                    - Weekend profiles only knew Saturday and Sunday, so the
//                      kids got the school-night bedtime all through the autumn
//                      holiday, and everyone the weekday morning on Christmas
//                      Day or Easter Monday
//                    - Free days from the calendar Room Heating keeps
//                      (global Config.Global, room_heating_config.js): the
//                      fixed public holidays (publicHolidaysFixed) and the
//                      Easter-based ones (computed as room_heating.js does)
//                      count for every room with weekendProfiles; the
//                      schoolHolidays ranges only for rooms with
//                      schoolHolidays: true (O Loft, C Loft, C LightStrip)
//                    - Same noon rule as weekends: the evening before a free
//                      day gets the weekend bedtime, the evening of the last
//                      one the weekday bedtime
//                    - No or unreadable Config.Global: Saturday/Sunday only,
//                      as before. The ad hoc SchoolHoliday Logic variable is
//                      not used (it means "no school today", not tonight)
//                    - Log tag shows the reason: [Weekend: Efterårsferie]
//                    - Not followed yet by B9/E9 - Light flow: their 06:00
//                      (Mon–Fri) and 07:30 (Sat/Sun) inactivity-timeout cards go
//                      by weekday, so 06:00–07:30 on a weekday holiday the Night
//                      light gets the daytime timeout (180 s / 120 s, not 30 / 60)
// 2.29.3 2026-10-28  Group and Hue detection from the device driver
//                    - Groups were found by name prefix only, and Hue by the
//                      button.migrate_v3 capability, which may not survive the
//                      move to the Hue Bridge Pro. New shared GROUPS block (the
//                      same in GradualFadeOut, RestoreSavedSettings and
//                      Room_watchdog): group = Homey's virtual group driver, Hue
//                      = the Philips Hue app's driver or button.migrate_v3
//                      (driverId/ownerUri/driverUri); with no driver info at
//                      all, a group is "lacks button.migrate_v3" as before
//                    - findGroupMembers(device) now takes the device; members by
//                      name for anything that isn't a Hue bulb, so a group still
//                      works if its driver text looks unexpected (no zone
//                      fallback in AL). A driver-identified group without
//                      "<group> <n>" bulbs logs AL-GROUP-NO-MEMBERS
//                      (once an hour per group, AL_GroupWarningAt) — before, its
//                      commands silently went to the group device
//                    - B9 and B7 bulbs renamed on Homey (B9 Wall 1–3 → B9 Lys
//                      1–3, B7 1–3 → B7 Lys 1–3), so AL now finds them
// 2.29.2 2026-10-28  Strict argument checking
//                    - An unknown mode (a typo in a flow card) matched no mode
//                      and ran as normal mode: clear manual, re-apply, switch
//                      the light on — silently, every poll. Now checked against
//                      KNOWN_MODES; anything else logs AL-BADARG and stops
//                      before any API call
//                    - The device id must look like a Homey id (UUID), else
//                      AL-BADARG instead of a Not Found error later
//                    - Removed the undocumented 'off' alias for clear (it
//                      cleared manual mode and left the light on)
//                    - No argument still uses ST Standerlampe (editor test
//                      runs) but logs AL-DEFAULT-ID, so an empty flow card shows
//                    - Each broken card (device id + mode; a lux value doesn't
//                      count) is logged at most once an hour — one timestamp per
//                      card in AL_LastArgWarning — so polls can't flood the log
// 2.29.1 2026-10-28  Remove dead code and a dormant risk
//                    - isDeviceFading no longer reads the legacy ${id}_FadeActive
//                      flag: nothing has written it since GradualFadeOut 5.0, and
//                      a leftover true would have made check mode skip that light
//                      forever (AL-SKIP-FADE on every poll)
//                    - Removed unused getCurrentHour, getTimestamp and
//                      findMatchingProfile, the legacy startHour/endHour and
//                      numeric-hour profile support (every profile uses
//                      startTime/endTime) and the unread turnOnTransitionDuration
//                    - Comments fixed: group members are found by name prefix (not
//                      button.migrate_v3); forced profiles are stored in device
//                      state; the normal-mode skip no longer waits 500 ms
//                    - No behaviour change otherwise. Leftover keys can be removed
//                      with al_cleanup_globals.js
// 2.29.0 2026-10-27  Manual mode ends at Night
//                    - Since 2.12.0 manual mode lasted until the light was
//                      switched off and on (or force/clear/cycle), so a light
//                      turned up in the afternoon skipped bedtime dimming
//                    - New SETTINGS.manualExpiresInto (['Night']): a check run
//                      that finds the schedule in one of these profiles, while
//                      the light is manual from an earlier profile, applies the
//                      profile with the normal 60 s transition (always — also
//                      when the override is already near its values, so it
//                      becomes lastProfile), then clears manual mode (group +
//                      members) and logs AL-MANUAL-EXPIRED. If the apply fails
//                      the light stays manual and the next full run retries
//                    - "Earlier profile" = state.lastProfile, which is not
//                      updated while manual, so an override made during Night
//                      sticks. New state.manualSince: still manual more than
//                      12 h later (left on since last night) expires again;
//                      manual state from before 2.29 gets its clock started
//                    - Only polled rooms (check mode); forced profiles are
//                      checked first and unaffected. [] restores 2.28 behaviour
// 2.28.0 2026-10-27  Publish real per-light status for the dashboard
//                    - The dashboard guessed Auto/Manual by comparing live
//                      values with a copied profile table, so lights scaled by
//                      daylight or coloured by the sun showed as "Manual"
//                    - New Logic text variable AdaptiveLightingStatus (created
//                      on first publish): every configured light's mode
//                      (auto/manual/forced), profile, applied and scheduled
//                      values, daylight factor/lux, sun elevation, timestamps
//                    - Rebuilt from the AL_Device_*.State globals each time,
//                      not merged, so parallel runs can't drop entries (Room
//                      Heating's read-modify-write HeatingStatus can)
//                    - Written at the end of a run (try/finally) only when a
//                      shown field changed, or for the first run each hour
//                      (heartbeat). Gated/lux/button skips save no state and
//                      make no extra API call. Signature in AL_StatusSig,
//                      variable id cached in AL_StatusVarId; a short lock in
//                      AL_StatusVarLock stops two runs creating it twice
//                    - lastApplied gains scheduledTemperature, sunElevation and
//                      via (run mode). A failed publish never affects the run;
//                      each distinct error is logged once as AL-PUBLISH-FAIL,
//                      and publishing pauses 10 min (AL_StatusRetryAt) so a
//                      lasting failure doesn't add API calls to every run. A
//                      non-text variable of the same name gets a clear error
// 2.27.4 2026-10-27  Sun colour for the kids' rooms and the entrance
//                    - O Loft, C Loft, C LightStrip, E9 Loft and E9 Garderobe
//                      get sunTemperature: STUE_SUN_TEMPERATURE (same 0–35°
//                      elevation curve). Daytime slides from the profile's own
//                      0.5 towards the room's Evening 0.7 when the sun is low:
//                      ~0.58 at noon in late October, ~0.64 at the December
//                      solstice, 0.5 from March to September
//                    - O and C follow the sun through the day via the 5-minute
//                      check (drift gate); E9 has no poll and gets the colour at
//                      each turn-on
//                    - Kitchen and bathrooms stay out: their Morning is cooler
//                      than a winter sun-adjusted Daytime, so 09:00 would step
//                      warmer instead of cooler. C Light Svampelampe is dim-only
// 2.27.3 2026-10-27  Weekend evenings follow the next day
//                    - Weekend profiles were picked by today's date, so Friday
//                      evening got the weekday bedtime (kids Night from 20:00,
//                      bedroom from 22:00) and Sunday evening the late weekend
//                      one (Evening until 21:00 / 23:00)
//                    - isWeekend() → isWeekendSchedule(): before 12:00 today
//                      decides, from 12:00 tomorrow. Fri 12:00 – Sun 12:00
//                      runs the weekend set, Sun 12:00 – Fri 12:00 the weekday
//                      set. Mornings are unchanged
//                    - Noon is invisible: every weekday/weekend pair has the
//                      same Daytime values. Kids' rooms also move the Daytime
//                      → Evening step: 19:00 on Friday (was 18:00), 18:00 on
//                      Sunday (was 19:00)
//                    - Rooms with identical evenings in both sets (bathrooms,
//                      entrance) are unaffected
//                    - A nextBoundaryAt stored before noon on Sunday may point
//                      at the weekend set's boundary; the 15-minute resync
//                      recomputes it, so a switch is at most ~15 min late
// 2.27.2 2026-10-27  Claras værelse: both lights follow the same schedule
//                    - C LightStrip gets weekendProfiles kidsRoomWeekend like
//                      C Loft. Before, at weekends the strip went to Night at
//                      20:00 while the ceiling light stayed on Evening until
//                      21:00, and the strip got Morning from 06:00 while the
//                      ceiling light was still on Night until 07:30
//                    - C - Light flow gained the 5-minute check poll (C Loft +
//                      C LightStrip), like O/K/SS. Before, both lights kept
//                      the profile they got at turn-on and never moved to
//                      Evening or Night on their own
// 2.27.1 2026-10-27  Errors reach AL_DiagnostikLog
//                    - Flow runs never show the console, so a thrown error
//                      left no trace (the setTimeout crash went unseen from
//                      2.14 to 2.20). The top-level catch now also writes
//                      AL-ERROR | <room> | <mode> | <message>
//                    - AL-APPLY-FAIL when a bulb doesn't take the brightness:
//                      group members that error or return dim=false, or a
//                      single light whose dim write fails. Before, member
//                      errors were swallowed and only shown with detailed
//                      logging. Temperature failures are ignored (dim-only
//                      bulbs always fail them); return values are unchanged
//                    - AL-VERIFY-FAIL when clear/force verification fails after
//                      all retries (was console + disabled notification only)
//                    - Fix: detailed logging threw "result is not defined" on
//                      every check/lux apply ("Temp supported" read a variable
//                      that only exists in the clear/force branches). Now reads
//                      the device's light_temperature capability
// 2.27.0 2026-10-19  Override log for preset tuning (AL_OverrideLog)
//                    - AL_DiagnostikLog holds ~1 day (500 lines, mostly E9
//                      fade/apply noise) and never recorded manual changes, so
//                      it could not answer "which presets do people correct?"
//                    - New global AL_OverrideLog (max 1000 lines): one line
//                      each time a light is found at values that differ from
//                      what AL last applied. Written here when check mode
//                      activates manual mode (src=check), and by GradualFadeOut
//                      v6.12 / Room_Watchdog v2.11 when the light is switched
//                      off (src=fade / src=watchdog) — the only place a Hue
//                      dimmer switch override in a motion room is ever seen
//                    - lastApplied gains `at` (epoch ms) so a line can say how
//                      long after AL's apply the override was found
//                    - Same override is logged once: ${deviceId}_OverrideLogged
//                      holds the last logged signature (apply time + values)
// 2.26.0 2026-09-18  Lux-driven colour for non-scaled profiles (Soveværelse Morning)
//                    - Morning was fixed at 25% / warm 0.80 no matter how bright
//                      the room; with the curtains up and daylight pouring in the
//                      dim yellow light looked wrong. The calm level is wanted,
//                      the warm colour is not.
//                    - New luminance fields: coolProfiles (default []), coolProfile
//                      (default 'Daytime'), tempStep (default 0.05). For listed
//                      profiles the temperature slides linearly from the
//                      profile's own value at darkBelow to coolProfile's value at
//                      brightAbove; brightness untouched. Sun temperature still
//                      wins for profiles listed in both blocks.
//                    - When coolProfile is itself sun-managed, the cool end is
//                      its sun-adjusted colour (Daytime at 09:00 in September
//                      is ~0.62, not 0.50), so a bright Morning ends exactly
//                      where Daytime starts. The stored cool end is a snapshot;
//                      slow sun drift is caught by the 15-minute resync.
//                    - SV Loft: coolProfiles ['Morning'] → 0.80 with curtains
//                      drawn, the sun-adjusted Daytime colour in a sunlit room.
//                      A sunlit Daytime ends at 24% anyway, so the 09:00
//                      boundary becomes invisible in both brightness and colour.
//                    - lastApplied gains luxDim / luxTemp; the lux gate now
//                      compares a temperature delta (tempStep) as well as the
//                      brightness delta, and skips outright for profiles that
//                      follow lux in neither (Evening/Night). Before, Morning
//                      stored factor 1 and every sensor report during a bright
//                      morning woke a full device fetch that applied nothing.
//                    - Check mode uses tempStep as the "already correct" colour
//                      tolerance for lux-colour profiles; "already correct" runs
//                      backfill the new bookkeeping without sending a command
//                    - Diag: AL-APPLY lines gain "luxtemp=0.63 (0.8→0.5)"
//                    - Bright room beats low sun: new luminance field
//                      brightOverridesSun (default false). For sun-managed
//                      profiles the colour slides from the sun-elevation value
//                      at darkBelow to the profile's own cool value at
//                      brightAbove. Trigger: sun blasting into the bedroom at
//                      19° elevation while the script held SV Loft at 0.64 —
//                      the elevation curve never reaches its cool end in
//                      Copenhagen between September and March (max ~33°).
//                      Drawn curtains / dull afternoons keep the warm sun
//                      colour. Morning's cool end follows the same override.
//                      lastApplied.sun gains blend/blendTo so the 5-minute
//                      drift gate predicts the blended colour (otherwise every
//                      poll during a bright morning would wake a full run).
//                      Enabled for Soveværelse; Stue unchanged (one line to add).
//                    - Bedroom Daytime colour 0.5 → 0.3 (~5000 K) so a sunlit
//                      room gets a bulb that blends with the daylight
// 2.25.0 2026-09-05  Soveværelse: daylight brightness + sun temperature
//                    - SV Loft gets a luminance block on SV Motion and the
//                      same sun-temperature block as Stue
//                    - Thresholds from a week of Insights: the bedroom sensor
//                      reads 15–170 lx with curtains open (peaks in morning
//                      sun), 1–6 lx with them drawn, lamps add ~14 lx at 56%.
//                      darkBelow 15 / brightAbove 100 / minFactor 0.4
//                    - Bedroom colour slides 0.50 (Daytime) → 0.80 (Evening)
//                      with sun elevation, same 35° ceiling as Stue
//                    - SV flow gained the "luminance changed" → lux trigger
// 2.24.1 2026-09-05  Arm the sun-drift gate even when nothing needs applying
//                    - First live run: ST Loft was within the 0.05 step of its
//                      sun temperature, so the full check applied nothing and
//                      never stored the cool/warm ends → the 5-minute drift
//                      gate stayed disarmed and the light depended on the
//                      15-minute resync alone
//                    - "Already correct" runs for sun/daylight-managed profiles
//                      now record the CURRENT values plus the sun ends in
//                      lastApplied (no light command), so the gate can predict
//                      drift from what the light actually shows
// 2.24.0 2026-09-04  Sun-based colour temperature (seasonal daylight colour)
//                    - Opt-in per room: ROOM_CONFIG[...].sunTemperature =
//                      { highElevation, lowElevation, profiles, warmProfile,
//                        step }. Global switch SETTINGS.enableSunTemperature.
//                      Off / absent = profile temperatures exactly as before.
//                    - For the listed profiles (default Daytime) the colour
//                      temperature follows solar elevation: the profile's own
//                      (cool) temperature at/above highElevation, the
//                      warmProfile's (Evening) temperature at/below
//                      lowElevation, linear in between. Season falls out of
//                      the elevation: a Copenhagen December noon peaks near
//                      11°, June near 58°, so winter days stay warmer.
//                    - Elevation from the NOAA solar-position formulas
//                      (pure math, no API); brightness scaling untouched
//                    - Check mode uses sunTemperature.step as the temperature
//                      tolerance for sun-managed profiles; the 5-minute gate
//                      also wakes a full run when the predicted temperature
//                      has drifted >= step from what was last applied
//                    - lastApplied stores the cool/warm ends so the gate can
//                      predict without the profile table
//                    - Enabled for Stue (ST Loft + ST Standerlampe)
//                    - Diag: AL-APPLY lines gain "sun=12.3°" when active
// 2.23.1 2026-09-04  Finer daylight steps + wider Stue range
//                    - First live test: curtains up/down moved the sensor
//                      28↔156 lx but the resulting brightness changes (±7-8%)
//                      fell inside the 10% manual-detection tolerance and
//                      were skipped, so the light sat still at 47%
//                    - New luminance.step (default 0.04): minimum brightness
//                      change worth acting on for daylight-managed profiles.
//                      Used by the lux gate AND as the "already correct"
//                      tolerance in check mode for those profiles. Manual
//                      detection still uses SETTINGS.tolerance (10%) against
//                      the last applied value.
//                    - Stue thresholds: darkBelow 60→40, brightAbove 250→200
//                      so dull/rainy days still produce a visible swing
// 2.23.0 2026-09-04  "lux" mode: react to luminance changes immediately
//                    - New argument "device-id lux <value>" for a flow
//                      triggered by the sensor's "luminance changed" card
//                      (pass the new value as the tag). Behaves like check
//                      mode but replaces the time gate with a lux gate.
//                    - Lux gate (no API call): recomputes the daylight factor
//                      from the passed value and only does a full run when
//                      the resulting brightness differs from what was last
//                      applied by more than SETTINGS.tolerance. Skips
//                      silently when the room has no luminance block, is in
//                      manual mode, or AL's own fade is still running.
//                    - lastApplied now also stores factor, scheduledBrightness
//                      and lux so the gate can compare without the profile table
//                    - Without a value ("device-id lux") it falls back to a
//                      full check run
// 2.22.0 2026-09-04  Daylight-aware brightness from a room luminance sensor
//                    - Opt-in per room: ROOM_CONFIG[...].luminance = { sensorId,
//                      darkBelow, brightAbove, minFactor, profiles, ... }
//                    - Global kill switch SETTINGS.enableLuminance — set false
//                      (or remove a room's luminance block) and behaviour is
//                      exactly the pre-2.22 logic
//                    - Brightness of the listed profiles (default: Daytime) is
//                      multiplied by a factor that falls linearly from 1.0 at
//                      darkBelow lux to minFactor at brightAbove lux;
//                      temperature is never touched
//                    - Sensor read from the already-fetched device list (no
//                      extra API call); stale readings (> maxAgeMinutes) or a
//                      missing sensor fall back to factor 1.0
//                    - The room's own lamp is subtracted from the reading
//                      (lampLuxAtFull × current dim) to damp the feedback loop
//                    - Device state now stores lastApplied {brightness,
//                      temperature}; check mode compares against that instead
//                      of the profile table, so a daylight-scaled light is not
//                      mistaken for a manual adjustment. Re-scaling happens on
//                      the periodic full check when the factor drifts > 10%
//                    - Enabled for Stue: ST Loft + ST Standerlampe via ST Motion
//                    - Diag: AL-APPLY lines gain "lux=… factor=…" when active
// 2.21.0 2026-09-04  Schedule-aware check mode (flows now poll every 5 min)
//                    - Check mode used to run every minute per light from the
//                      ST/K/SV/O/SS flows (9 script runs + 3 full device dumps
//                      per minute). Flows now trigger every 5 minutes.
//                    - Cheap gate before ANY API call: a check run exits at
//                      once unless the next profile boundary is inside the
//                      coming poll window, or checkResyncMinutes have passed
//                      since the last full run (manual-mode detection)
//                    - Early transition: when the next boundary falls before
//                      the next poll, the new profile is started NOW with a
//                      hardware fade that ends transitionDuration after the
//                      boundary — so the change still lands on schedule
//                      (Zigbee bulbs handle multi-minute transitions natively)
//                    - Early transition only for Hue devices (bulb or group of
//                      Hue bulbs, detected via button.migrate_v3); other lights
//                      (e.g. Twinkly SS Light Perler) keep the old catch-up
//                      behaviour at the poll after the boundary
//                    - Per-device state gains nextBoundaryAt + lastFullCheckAt
//                    - New settings: checkPollMinutes (5), checkResyncMinutes (15)
//                    - Diag: AL-APPLY "(early)" marks a pre-boundary transition
// 2.20.0 2026-09-04  Respect a just-completed restore + fix setTimeout crash
//                    - Normal mode (light turned on) now also skips when
//                      RestoreSavedSettings restored the light within the
//                      last restoreGraceSeconds (30s), not only while
//                      _FadeActiveUntil is still in the future
//                    - Closes the race seen in E9: on re-entry mid-fade the
//                      zone flow runs RestoreSavedSettings and a "turn on"
//                      in parallel; restore cleared the fade flag first, the
//                      resulting "turned on" trigger then found no fade and
//                      applied the profile over the restored values
//                    - Logged as AL-SKIP-RESTORE in AL_DiagnostikLog
//                    - Replaced setTimeout (not defined in HomeyScript) with
//                      wait(): verifyDeviceState + retry backoff threw on
//                      every clear/force run, and the normal-mode "set level
//                      while off, then turn on" path threw before turning
//                      the light on
// 2.19.1 2026-05-10  Align weekend Morning start to 07:30 + close coverage gap
//                    - bathroomWeekend / entranceWeekend Morning: 08:30 → 07:30
//                      and Night endTime extended 07:00 → 07:30 (closes 90-min
//                      gap that fell back to Night: bathroom 8% / entrance 10%)
//                    - kidsRoomWeekend Morning: 08:30 → 07:30 (Night 08:30 → 07:30)
//                    - standardWeekend Morning: 08:00 → 07:30 (Night 08:00 → 07:30)
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
// PERIODIC UPDATE (to adjust lights that are already on):
// 1. Trigger: "Every 5 minutes" (must match SETTINGS.checkPollMinutes)
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
//   "device-id check"        Check first, skip if in manual/forced mode (for periodic updates)
//   "device-id lux <value>"  Luminance changed: re-scale if the daylight factor moved enough
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
    { name: "Daytime",  startTime: "09:00", endTime: "20:00", brightness: 0.6,  temperature: 0.3 }, // ~5000 K: blends with daylight (was 0.5)
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
    { name: "Daytime",  startTime: "11:00", endTime: "20:00", brightness: 0.6,  temperature: 0.3 }, // ~5000 K: blends with daylight (was 0.5)
    { name: "Evening",  startTime: "20:00", endTime: "23:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "23:00", endTime: "09:00", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Kids room weekend - later morning and bedtime
  kidsRoomWeekend: [
    { name: "Morning",  startTime: "07:30", endTime: "10:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "10:00", endTime: "19:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "19:00", endTime: "21:00", brightness: 0.35, temperature: 0.7 },
    { name: "Night",    startTime: "21:00", endTime: "07:30", brightness: 0.05, temperature: 1.0 }
  ],
  
  // Standard weekend - later morning
  standardWeekend: [
    { name: "Morning",  startTime: "07:30", endTime: "10:00", brightness: 0.35, temperature: 0.7 },
    { name: "Daytime",  startTime: "10:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "23:00", brightness: 0.30, temperature: 0.7 },
    { name: "Night",    startTime: "23:00", endTime: "07:30", brightness: 0.15, temperature: 0.9 }
  ],
  
  // Bathroom weekend - gentler morning light, later start
  bathroomWeekend: [
    { name: "Morning",  startTime: "07:30", endTime: "10:00", brightness: 0.6,  temperature: 0.5 },
    { name: "Daytime",  startTime: "10:00", endTime: "21:00", brightness: 0.9,  temperature: 0.4 },
    { name: "Evening",  startTime: "21:00", endTime: "23:00", brightness: 0.25, temperature: 0.8 },
    { name: "Night",    startTime: "23:00", endTime: "07:30", brightness: 0.08, temperature: 1.0 }
  ],

  // Entrance weekend - softer morning light, later start
  entranceWeekend: [
    { name: "Morning",  startTime: "07:30", endTime: "10:00", brightness: 0.35, temperature: 0.8 },
    { name: "Daytime",  startTime: "10:00", endTime: "18:00", brightness: 0.8,  temperature: 0.5 },
    { name: "Evening",  startTime: "18:00", endTime: "23:00", brightness: 0.4,  temperature: 0.7 },
    { name: "Night",    startTime: "23:00", endTime: "07:30", brightness: 0.10, temperature: 1.0 }
  ]
};

// ====== DAYLIGHT (LUMINANCE) SCALING ======
// Per-room opt-in: add a `luminance` block to a ROOM_CONFIG entry. Missing
// fields take these defaults. Only `sensorId` is required.
//   factor = 1.0            when adjusted lux <= darkBelow
//   factor = minFactor      when adjusted lux >= brightAbove
//   linear in between;      brightness = profile.brightness * factor
// Adjusted lux = sensor lux - lampLuxAtFull * (this light's current dim), so the
// lamp seeing itself in the sensor does not pull its own brightness down.
const DAYLIGHT_DEFAULTS = {
  enabled: true,
  darkBelow: 60,          // lux — below this the room needs the full profile
  brightAbove: 250,       // lux — above this daylight dominates
  minFactor: 0.4,         // never dim below 40% of the profile brightness
  minBrightness: 0.05,    // absolute floor after scaling
  step: 0.04,             // smallest brightness change (absolute) worth acting on
  profiles: ['Daytime'],  // profile names whose BRIGHTNESS is scaled (Evening/Night never)
  coolProfiles: [],       // profile names whose COLOUR slides cooler with daylight:
                          //   own temperature at darkBelow → coolProfile's at brightAbove
  coolProfile: 'Daytime', // profile that supplies the cool end for coolProfiles
  tempStep: 0.05,         // smallest temperature change (0–1 scale) worth acting on
  brightOverridesSun: false, // true: for sun-managed profiles the colour slides from the
                          //   sun-elevation value at darkBelow to the profile's own cool
                          //   value at brightAbove — a sunlit room beats a low sun
  lampLuxAtFull: 25,      // sensor reading caused by this room's lights at 100%
  maxAgeMinutes: 60       // ignore a sensor reading older than this
};

// ====== SUN-BASED COLOUR TEMPERATURE ======
// Per-room opt-in: add a `sunTemperature` block to a ROOM_CONFIG entry.
//   elevation >= highElevation → the profile's own temperature (cool daylight)
//   elevation <= lowElevation  → the warmProfile's temperature (e.g. Evening)
//   linear in between. Only the listed profiles are affected.
// Seasons come for free: the sun's maximum elevation is ~58° in June and ~11°
// in December at 55.7°N, so winter daylight stays warm all day.
const SUN_TEMPERATURE_DEFAULTS = {
  enabled: true,
  highElevation: 35,      // degrees — full "cool" daytime colour from here up
  lowElevation: 0,        // degrees — full "warm" colour at the horizon
  profiles: ['Daytime'],  // profiles whose temperature follows the sun
  warmProfile: 'Evening', // whose temperature is the warm end (per room)
  step: 0.05              // smallest temperature change (0–1 scale) worth acting on
};

const STUE_SUN_TEMPERATURE = {
  highElevation: 35,
  lowElevation: 0,
  profiles: ['Daytime'],
  warmProfile: 'Evening'
};

// Stue: ST Motion sits in the living room and sees 30–400 lx of daylight while
// the lamps add ~10 lx at evening levels (Insights, Sep 2026)
const STUE_LUMINANCE = {
  sensorId: 'b88fc1cd-cd4f-447e-960b-03fb51951ca4', // ST Motion
  darkBelow: 40,
  brightAbove: 200,
  minFactor: 0.4,
  profiles: ['Daytime']
};

// Soveværelse: SV Motion sees 15–170 lx with the curtains open, 1–6 lx drawn;
// SV Loft adds ~14 lx at 56% (Insights, Aug/Sep 2026). Dimmer room, lower bands.
// Morning keeps its calm 25% but the colour slides from its warm 0.80 (curtains
// drawn) to Daytime's 0.50 (room full of daylight) — warm dim light looks wrong
// in a sunlit room. Brightness is untouched: a sunlit Daytime ends at 24% anyway.
const SV_LUMINANCE = {
  sensorId: '47172014-0488-43a7-93c6-920ad01113b3', // SV Motion
  darkBelow: 15,
  brightAbove: 100,
  minFactor: 0.4,
  profiles: ['Daytime'],
  coolProfiles: ['Morning'],
  coolProfile: 'Daytime',
  brightOverridesSun: true   // sun blasting in at 19° elevation: bulb must go cool, not stay at 0.64
};
const SV_SUN_TEMPERATURE = STUE_SUN_TEMPERATURE; // same elevation curve; ends come from the bedroom profiles

// ====== ROOM CONFIGURATION ======
// Only groups and standalone devices - individual bulbs in groups are excluded.
// A group's bulbs are found by name prefix: group "ST Loft" → "ST Loft 1",
// "ST Loft 2", … (class light). See findGroupMembers.
//
const ROOM_CONFIG = {
  
  // =====================================================================
  // STUE (Living Room) - Kertemindegade 9
  // =====================================================================
  "fd754abf-4397-45f5-9a68-98d7f079fd7b": {
    name: "ST Loft",
    profiles: PROFILES.filament,  // Gruppe med 5 filament pærer
    luminance: STUE_LUMINANCE,    // Daytime brightness follows daylight (ST Motion)
    sunTemperature: STUE_SUN_TEMPERATURE // Daytime colour follows sun elevation
  },
  "3f4e2391-3be6-44ee-b340-fcc3219853b2": {
    name: "ST Standerlampe",
    profiles: PROFILES.stue,      // Gruppe med 2 pærer
    luminance: STUE_LUMINANCE,    // Daytime brightness follows daylight (ST Motion)
    sunTemperature: STUE_SUN_TEMPERATURE // Daytime colour follows sun elevation
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
    weekendProfiles: PROFILES.bedroomWeekend, // Weekends - later morning
    luminance: SV_LUMINANCE,                 // Daytime brightness follows daylight (SV Motion)
    sunTemperature: SV_SUN_TEMPERATURE       // Daytime colour follows sun elevation
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
    profiles: PROFILES.entrance,               // Weekdays
    weekendProfiles: PROFILES.entranceWeekend, // Weekends - softer morning light
    sunTemperature: STUE_SUN_TEMPERATURE       // Daytime colour follows sun elevation
  },
  "e339c184-ea11-4413-bd90-dac726861fd0": {
    name: "E9 Garderobe",
    profiles: PROFILES.entrance,               // Weekdays
    weekendProfiles: PROFILES.entranceWeekend, // Weekends - softer morning light
    sunTemperature: STUE_SUN_TEMPERATURE       // Daytime colour follows sun elevation
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
    schoolHolidays: true,                      // school holidays use the weekend schedule too
    weekendProfiles: PROFILES.kidsRoomWeekend, // Later bedtime on weekends
    sunTemperature: STUE_SUN_TEMPERATURE       // Daytime colour follows sun elevation
  },

  // =====================================================================
  // CLARAS VÆRELSE (Clara's Room) - Kertemindegade 7
  // =====================================================================
  "9b15cb64-bf61-494d-be49-f3dcd9dfd0bf": {
    name: "C Loft",
    profiles: PROFILES.kidsRoom,
    schoolHolidays: true,                      // school holidays use the weekend schedule too
    weekendProfiles: PROFILES.kidsRoomWeekend, // Later bedtime on weekends
    sunTemperature: STUE_SUN_TEMPERATURE       // Daytime colour follows sun elevation
  },
  "5acaab17-7864-4831-b6e2-72bd35588b21": {
    name: "C LightStrip",
    profiles: PROFILES.kidsRoom,
    schoolHolidays: true,                      // school holidays use the weekend schedule too
    weekendProfiles: PROFILES.kidsRoomWeekend, // Same weekend bedtime as C Loft
    sunTemperature: STUE_SUN_TEMPERATURE       // Daytime colour follows sun elevation
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

// ====== FORCED PROFILES ======
// Devices that can be forced to one profile with "deviceId cycle-profile"
// (each run steps 0 = Morning → 1 = Daytime → 2 = Evening → 3 = Night);
// "deviceId clear" or turning the light on returns to the schedule (-1).
// Stored in the device's state (forcedProfile.index); no setup needed.
// Wire the two modes to a button in the room's light flow to use them.
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
  enableVerification: true,      // Verify settings after clear/reset operations
  verificationRetries: 3,        // Max retry attempts for verification
  verificationDelay: 1500,       // Wait time before verification (ms)
  verificationTolerance: 0.10,   // Tolerance for verification (10%)
  failedVerificationBuffer: 60,  // Fade buffer duration if verification fails (seconds)
  restoreGraceSeconds: 30,       // Normal mode skips profile apply this long after
                                 // RestoreSavedSettings restored the light (the
                                 // "turned on" trigger can arrive several seconds late)
  checkPollMinutes: 5,           // How often the flows run "check" (every_nth minute)
                                 // Must match the flow trigger — used for the
                                 // boundary look-ahead and the cheap gate
  manualExpiresInto: ['Night'],  // Manual mode ends (check mode) when the schedule
                                 // reaches one of these profiles; [] = never (pre-2.29)
  checkResyncMinutes: 15,        // Force a full check run at least this often even
                                 // when no boundary is near (manual-mode detection,
                                 // recovery after restarts / config changes)
  enableLuminance: true,         // Master switch for luminance-based daylight scaling.
                                 // false = ignore every room's luminance block and
                                 // behave exactly like v2.21 (pure schedule)
  enableSunTemperature: true     // Master switch for sun-elevation colour temperature.
                                 // false = ignore every room's sunTemperature block
                                 // and use the profile temperatures as-is
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

// ====== OVERRIDE LOG ======
// One line each time a light is found at values that differ from what AL last
// applied — an override from a Hue switch, the app, voice or a button. Input
// for tuning the presets; kept apart from AL_DiagnostikLog so routine fade/apply
// noise cannot push it out. Shared with GradualFadeOut (src=fade) and
// Room_Watchdog (src=watchdog); this script writes src=check. Max 1000 lines.
// Format: "DD.MM, HH.MM.SS | dag | OVERRIDE | Lampe | Profil | AL=40%/70 | nu=100%/1 | Δdim=+60 Δtemp=-69 | src=fade | 26m efter AL"
// Read via: log(global.get('AL_OverrideLog'))
function overrideLog(deviceId, name, profileName, applied, dim, temp, source, extra = '') {
  const pct = v => (typeof v === 'number' ? Math.round(v * 100) : null);
  // Log each override once: a fade after a restore sees the same values again
  const signature = `${applied.at || 0}|${pct(dim)}|${pct(temp)}`;
  const sigKey = `${deviceId}_OverrideLogged`;
  if (global.get(sigKey) === signature) return;
  global.set(sigKey, signature);

  const nowDate = new Date();
  const stamp = nowDate.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const day = nowDate.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', weekday: 'short' }).replace('.', '');
  const signed = v => (v > 0 ? `+${v}` : `${v}`);
  const tempStr = v => (pct(v) === null ? 'N/A' : pct(v));
  const dTemp = (pct(temp) !== null && pct(applied.temperature) !== null) ? signed(pct(temp) - pct(applied.temperature)) : 'N/A';
  const since = applied.at ? ` | ${Math.round((Date.now() - applied.at) / 60000)}m efter AL` : '';
  const entry = `${stamp} | ${day} | OVERRIDE | ${name} | ${profileName || '?'} | AL=${pct(applied.brightness)}%/${tempStr(applied.temperature)} | nu=${pct(dim)}%/${tempStr(temp)} | Δdim=${signed(pct(dim) - pct(applied.brightness))} Δtemp=${dTemp} | src=${source}${since}${extra}`;

  const logText = global.get('AL_OverrideLog') || '';
  const lines = (logText + entry + '\n').split('\n').filter(l => l.length > 0);
  global.set('AL_OverrideLog', lines.slice(-1000).join('\n') + '\n');
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

// ====== FREE DAYS — same block in adaptivelighting.js and al_free_day.js;
// change both together ======
// Weekends and holidays, from the calendar Room Heating keeps
// (room_heating_config.js → global Config.Global, a JSON string):
// schoolHolidays [{ from, to, name }] and publicHolidaysFixed ['MM-DD']; the
// Easter-based public holidays are computed as room_heating.js does. Missing or
// unreadable Config.Global → plain Saturday/Sunday.

let _holidayConfig;  // read once per run
function holidayConfig() {
  if (_holidayConfig !== undefined) return _holidayConfig;
  try {
    const stored = global.get('Config.Global');
    const cfg = typeof stored === 'string' ? JSON.parse(stored) : stored;
    _holidayConfig = cfg && typeof cfg === 'object' ? cfg : null;
  } catch (e) {
    _holidayConfig = null;
  }
  return _holidayConfig;
}

// Log names for Room Heating's fixed free days (other dates: 'Helligdag')
const FIXED_HOLIDAY_NAMES = {
  '01-01': 'Nytårsdag', '06-05': 'Grundlovsdag', '12-24': 'Juleaften',
  '12-25': '1. juledag', '12-26': '2. juledag', '12-31': 'Nytårsaften'
};

/** Easter Sunday as a UTC date (Gregorian, anonymous algorithm — as room_heating.js) */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Danish public holidays that move with Easter: [{ date: 'YYYY-MM-DD', name }] */
function easterBasedHolidays(year) {
  const easter = easterSunday(year).getTime();
  const at = (days, name) => ({ date: new Date(easter + days * 86400000).toISOString().slice(0, 10), name });
  return [at(-3, 'Skærtorsdag'), at(-2, 'Langfredag'), at(1, '2. påskedag'),
    at(39, 'Kristi himmelfartsdag'), at(50, '2. pinsedag')];
}

/**
 * The calendar day the schedule follows: before 12:00 today, from 12:00
 * tomorrow — an evening belongs to the next morning, so Friday evening gets the
 * weekend bedtime and Sunday evening the weekday one. Daytime is identical in
 * every weekday/weekend pair, so the switch at noon is invisible.
 * Date and hour come from one clock reading in Copenhagen time.
 * @returns {{ iso: string, dow: number }} 0 = Sunday
 */
function scheduleDay() {
  const now = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', hourCycle: 'h23'
  }).formatToParts(new Date());
  for (const p of parts) now[p.type] = Number(p.value);
  const offset = now.hour >= 12 ? 1 : 0;
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
  return { iso: date.toISOString().slice(0, 10), dow: date.getUTCDay() };
}

/**
 * Why the schedule day is a free day ('Weekend', a holiday's name), or null.
 * Public holidays count for every room; school holidays only when asked
 * (AL: rooms with schoolHolidays: true — the kids' rooms)
 */
function freeDayReason(includeSchoolHolidays = false) {
  const day = scheduleDay();
  if (day.dow === 0 || day.dow === 6) return 'Weekend';
  const cfg = holidayConfig();
  if (!cfg) return null;
  const monthDay = day.iso.slice(5);
  if (Array.isArray(cfg.publicHolidaysFixed) && cfg.publicHolidaysFixed.includes(monthDay)) {
    return FIXED_HOLIDAY_NAMES[monthDay] || 'Helligdag';
  }
  const easterHoliday = easterBasedHolidays(Number(day.iso.slice(0, 4))).find(h => h.date === day.iso);
  if (easterHoliday) return easterHoliday.name;
  if (includeSchoolHolidays && Array.isArray(cfg.schoolHolidays)) {
    const range = cfg.schoolHolidays.find(r => r && day.iso >= r.from && day.iso <= r.to);
    if (range) return range.name || 'Skoleferie';
  }
  return null;
}
// ====== end of shared FREE DAYS block ======

/** Log tag for a room on its weekend set: ' [Weekend]', ' [Weekend: Juleaften]', or '' */
function weekendTag(roomConfig) {
  if (!roomConfig.usingWeekendProfile) return '';
  return roomConfig.freeDay === 'Weekend' ? ' [Weekend]' : ` [Weekend: ${roomConfig.freeDay}]`;
}

/** Is today a free day for every room with weekend profiles? (published status; no school holidays) */
function isWeekendSchedule() {
  return freeDayReason() !== null;
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
  manualSince: 0,         // Epoch ms when check mode set manual (0 = unknown / before 2.29)
  lastProfile: null,      // Name of last applied profile
  fadeEndTime: 0,         // AL's own fade end timestamp (ms)
  nextBoundaryAt: 0,      // Epoch ms of the next profile start (check-mode gate)
  lastFullCheckAt: 0,     // Epoch ms of the last full (non-gated) check run
  lastApplied: null,      // { at, brightness, temperature, factor, scheduledBrightness, lux,
                          //   luxDim, luxTemp, sun } AL last sent (daylight-scaled)
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
  _alStateDirty = true;
}

// Set by any state save this run — the status publish at the end only looks
// at the state when something was saved (gated skips save nothing)
let _alStateDirty = false;

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
  if (enabled) state.manualSince = Date.now();
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
function setLastProfile(deviceId, profileName, brightness = null, temperature = null, daylightMeta = null) {
  const state = getDeviceState(deviceId);
  state.lastProfile = profileName;
  if (typeof brightness === 'number') {
    state.lastApplied = {
      at: Date.now(),                                        // when AL applied/confirmed these values
      brightness,
      temperature: typeof temperature === 'number' ? temperature : null,
      // Daylight bookkeeping for the "lux" gate (factor 1 when not scaled)
      factor: typeof daylightMeta?.daylightFactor === 'number' ? daylightMeta.daylightFactor : 1,
      scheduledBrightness: typeof daylightMeta?.scheduledBrightness === 'number' ? daylightMeta.scheduledBrightness : brightness,
      lux: typeof daylightMeta?.lux === 'number' ? daylightMeta.lux : null,
      luxDim: daylightMeta?.luxDim === true,                 // brightness follows lux
      luxTemp: daylightMeta?.luxTemp
        ? { cool: daylightMeta.luxTemp.cool, warm: daylightMeta.luxTemp.warm } // colour follows lux
        : null,
      // Sun-temperature bookkeeping (only when the applied profile was sun-managed)
      sun: typeof daylightMeta?.sunCool === 'number'
        ? {
            cool: daylightMeta.sunCool,
            warm: daylightMeta.sunWarm,
            // Bright-room override snapshot (absent when not overriding)
            ...(typeof daylightMeta.sunBlend === 'number'
              ? { blend: daylightMeta.sunBlend, blendTo: daylightMeta.sunBlendTo }
              : {})
          }
        : null,
      // For the published status (AdaptiveLightingStatus): the profile's own
      // colour before sun/lux adjustment, the sun elevation and the run mode
      scheduledTemperature: typeof daylightMeta?.scheduledTemperature === 'number'
        ? daylightMeta.scheduledTemperature
        : (typeof temperature === 'number' ? temperature : null),
      sunElevation: typeof daylightMeta?.sunElevation === 'number' ? daylightMeta.sunElevation : null,
      via: MODE_ARG || 'normal'
    };
  }
  saveDeviceState(deviceId, state);
}

// ====== PUBLISHED STATUS (AdaptiveLightingStatus) ======
// One Logic text variable holding every configured light's real state, for the
// dashboard: mode (auto/manual/forced), profile and the values AL actually
// applied after daylight/sun adjustment. Format:
//   { v, schema: 1, publishedAt, weekend, lights: { <full device id>: {
//       name, mode, forced?, profile, bri, temp, schedBri, schedTemp, factor?,
//       lux?, sunEl?, via, at, fadeUntil, next } } }
// Rebuilt from the AL_Device_*.State globals on every publish (never merged
// into the old value), so parallel runs for different lights can't erase each
// other's entries. Written only when a visible field changed, plus once an hour
// as a heartbeat — runs that save no state make no API call at all.
const AL_VERSION = '2.30.1';
const AL_STATUS_VAR = 'AdaptiveLightingStatus';

function buildALStatus() {
  const round2 = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : null);
  const lights = {};
  for (const [id, cfg] of Object.entries(ROOM_CONFIG)) {
    let state;
    try {
      const raw = global.get(stateKey(id));
      if (!raw) continue;                       // never run by AL (no flow calls it)
      state = JSON.parse(raw);
    } catch (e) { continue; }
    const la = state.lastApplied || {};
    const forcedIndex = state.forcedProfile?.index ?? -1;
    const mode = FORCED_PROFILE_DEVICES.has(id) && forcedIndex >= 0 ? 'forced'
               : state.manual === true ? 'manual' : 'auto';
    const entry = {
      name: cfg.name,
      mode,
      profile: state.lastProfile || null,
      bri: round2(la.brightness),
      temp: round2(la.temperature),
      schedBri: round2(la.scheduledBrightness),
      schedTemp: round2(la.scheduledTemperature),
      via: la.via || null,
      at: la.at || null,
      fadeUntil: state.fadeEndTime || 0,
      next: state.nextBoundaryAt ? Math.round(state.nextBoundaryAt / 60000) * 60000 : null
    };
    if (mode === 'forced') entry.forced = forcedIndex;
    if (typeof la.factor === 'number' && la.factor !== 1) entry.factor = round2(la.factor);
    if (typeof la.lux === 'number') entry.lux = Math.round(la.lux);
    if (typeof la.sunElevation === 'number') entry.sunEl = Math.round(la.sunElevation * 10) / 10;
    lights[id] = entry;
  }
  return lights;
}

// Returns true when written, false when deferred (another run is creating the
// variable right now — this run's state is picked up by the next publish)
async function writeStatusVar(value) {
  const cachedId = global.get('AL_StatusVarId');
  let cachedError = null;
  if (cachedId) {
    try {
      await Homey.logic.updateVariable({ id: cachedId, variable: { value } });
      return true;
    } catch (e) { cachedError = e; /* deleted or recreated — look it up by name below */ }
  }
  // Several lights' runs can get here at the same moment on the first publish.
  // global.get/set are synchronous, so this lock lets only one of them look up
  // and create the variable — two createVariable calls would make duplicates
  if (Date.now() < (global.get('AL_StatusVarLock') || 0)) return false;
  global.set('AL_StatusVarLock', Date.now() + 30000);
  try {
    const variables = await Homey.logic.getVariables();
    let foundId = null;
    let foundType = null;
    for (const [id, v] of Object.entries(variables)) {
      if (v.name === AL_STATUS_VAR) { foundId = v.id || id; foundType = v.type; break; }
    }
    if (foundId && foundType && foundType !== 'string') {
      throw new Error(`Logic variable ${AL_STATUS_VAR} exists but is a ${foundType}, not text — delete it and AL recreates it`);
    }
    // Same variable that just refused the update: the problem isn't a stale id
    if (cachedError && foundId === cachedId) throw cachedError;
    if (foundId) {
      await Homey.logic.updateVariable({ id: foundId, variable: { value } });
      global.set('AL_StatusVarId', foundId);
    } else {
      const created = await Homey.logic.createVariable({ variable: { name: AL_STATUS_VAR, type: 'string', value } });
      if (created?.id) global.set('AL_StatusVarId', created.id);
    }
    return true;
  } finally {
    global.set('AL_StatusVarLock', 0);
  }
}

/**
 * Publish AdaptiveLightingStatus if this run changed something visible.
 * Never throws: a failed publish must not affect the lighting run.
 */
async function publishALStatusIfChanged() {
  if (!_alStateDirty) return;
  // Back off after a failure, so a lasting problem doesn't add failing API
  // calls to every full run
  if (Date.now() < (global.get('AL_StatusRetryAt') || 0)) return;
  try {
    const lights = buildALStatus();
    // Signature: only what the dashboard shows. at/fadeUntil/via change on
    // re-applies of the same values; the hour bucket makes the hourly heartbeat
    const visible = Object.entries(lights).map(([id, l]) => [id, l.mode, l.forced, l.profile, l.bri, l.temp, l.next]);
    const sig = JSON.stringify([Math.floor(Date.now() / 3600000), visible]);
    if (global.get('AL_StatusSig') === sig) return;
    const written = await writeStatusVar(JSON.stringify({
      v: AL_VERSION, schema: 1, publishedAt: Date.now(), weekend: isWeekendSchedule(), lights
    }));
    if (!written) return;
    global.set('AL_StatusSig', sig);
    if (global.get('AL_StatusPublishError')) global.set('AL_StatusPublishError', null);
  } catch (e) {
    // Retry in 10 minutes; log each distinct error once
    try {
      global.set('AL_StatusRetryAt', Date.now() + 10 * 60000);
      if (global.get('AL_StatusPublishError') !== e.message) {
        global.set('AL_StatusPublishError', e.message);
        diagLog(`AL-PUBLISH-FAIL | ${e.message}`);
      }
    } catch (e2) { /* ignore */ }
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
 * 2. External: GradualFadeOut/watchdog timestamp (${deviceId}_FadeActiveUntil)
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

  return timestampFading || bathroomFading;
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
 * Parse a profile time ("HH:MM" or "sunrise"/"sunset" with offset and limits)
 * to minutes since midnight
 */
function parseTimeToMinutes(time) {
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
 * Check if two values are approximately equal (within tolerance)
 */
function approxEqual(a, b, tolerance = SETTINGS.tolerance) {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Find the appropriate lighting profile for the current time
 */
function findActiveProfile(profiles, currentMinutes) {
  for (const profile of profiles) {
    const startMinutes = parseTimeToMinutes(profile.startTime);
    const endMinutes = parseTimeToMinutes(profile.endTime);
    
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
 * Read the room's luminance sensor and turn it into a brightness factor.
 * Never throws; every failure path returns { active: false, reason }.
 * Uses CACHED_ALL_DEVICES (fetched anyway in non-button modes) — no API call.
 */
function getDaylight(roomConfig, device) {
  if (!SETTINGS.enableLuminance) return { active: false, reason: 'disabled' };
  if (!roomConfig.luminance) return { active: false, reason: 'not configured' };
  const c = { ...DAYLIGHT_DEFAULTS, ...roomConfig.luminance };
  if (c.enabled === false) return { active: false, reason: 'room disabled' };
  if (!c.sensorId) return { active: false, reason: 'no sensorId' };

  const sensor = CACHED_ALL_DEVICES ? CACHED_ALL_DEVICES[c.sensorId] : null;
  const cap = sensor?.capabilitiesObj?.measure_luminance;
  if (!cap || typeof cap.value !== 'number') return { active: false, reason: 'sensor/lux unavailable' };

  const updated = new Date(cap.lastUpdated ?? cap.lastChanged ?? 0).getTime();
  if (updated > 0 && Date.now() - updated > c.maxAgeMinutes * 60000) {
    return { active: false, reason: `stale (${Math.round((Date.now() - updated) / 60000)} min)` };
  }

  // Subtract what this light itself contributes to the reading
  const isOn = device?.capabilitiesObj?.onoff?.value === true;
  const ownDim = isOn ? (device?.capabilitiesObj?.dim?.value || 0) : 0;
  const luxAdjusted = Math.max(0, cap.value - c.lampLuxAtFull * ownDim);

  const factor = daylightFactorFor(luxAdjusted, c);

  return { active: true, lux: cap.value, luxAdjusted: Math.round(luxAdjusted), factor, config: c };
}

/** Piecewise-linear lux → factor (1.0 at darkBelow … minFactor at brightAbove) */
function daylightFactorFor(luxAdjusted, c) {
  let factor;
  if (luxAdjusted <= c.darkBelow) factor = 1;
  else if (luxAdjusted >= c.brightAbove) factor = c.minFactor;
  else factor = 1 - (1 - c.minFactor) * (luxAdjusted - c.darkBelow) / (c.brightAbove - c.darkBelow);
  return Math.round(factor * 100) / 100;
}

/** Lux position 0 (at/below darkBelow) … 1 (at/above brightAbove), derived from the factor */
function daylightPositionFor(factor, c) {
  const span = Math.max(0.01, 1 - c.minFactor);
  return Math.max(0, Math.min(1, (1 - factor) / span));
}

/** Colour for a cool-managed profile: warm (own) at darkBelow → cool at brightAbove */
function daylightTemperatureFor(factor, warm, cool, c) {
  const t = daylightPositionFor(factor, c);
  return Math.round((warm + (cool - warm) * t) * 100) / 100;
}

/**
 * Return the profile adjusted for daylight, or the profile itself when nothing
 * applies:
 *   - profiles in `luminance.profiles`     → brightness scaled by the factor
 *   - profiles in `luminance.coolProfiles` → temperature slides from the
 *     profile's own (warm) value to `coolProfile`'s value as the room brightens
 * Both can apply to the same profile. Runs before applySunTemperature, which
 * wins on temperature for profiles listed in both blocks.
 * When `sun` is passed and coolProfile is itself sun-managed, the cool end is
 * that profile's sun-adjusted colour — so a bright Morning ends exactly where
 * Daytime will start, and the boundary is invisible.
 */
function applyDaylight(profile, daylight, roomConfig, sun = null) {
  if (!profile || !daylight || !daylight.active) return profile;
  const c = daylight.config;
  let out = profile;

  if (c.profiles.includes(profile.name)) {
    // Always tag the profile (luxDim/factor feed the lux gate even at factor 1,
    // otherwise a dark→bright swing would never wake a re-scale)
    const scaled = daylight.factor < 1
      ? Math.max(c.minBrightness, Math.round(profile.brightness * daylight.factor * 100) / 100)
      : profile.brightness;
    out = { ...out, brightness: scaled, scheduledBrightness: profile.brightness, luxDim: true, daylightFactor: daylight.factor, lux: daylight.lux };
  }

  if (c.coolProfiles.includes(profile.name) && roomConfig) {
    const coolSrc = roomConfig.profiles.find(p => p.name === c.coolProfile);
    if (coolSrc && typeof coolSrc.temperature === 'number' && coolSrc.name !== profile.name) {
      const warm = profile.temperature;
      let cool = coolSrc.temperature;
      if (sun?.active && sun.config.profiles.includes(coolSrc.name)) {
        const sunWarmSrc = roomConfig.profiles.find(p => p.name === sun.config.warmProfile);
        if (sunWarmSrc && typeof sunWarmSrc.temperature === 'number') {
          cool = sunTemperatureFor(sun.elevation, coolSrc.temperature, sunWarmSrc.temperature, sun.config);
          if (c.brightOverridesSun) {
            // Mirror applySunTemperature: a bright room pulls coolProfile to its own cool value
            const pos = daylightPositionFor(daylight.factor, c);
            cool = Math.round((cool + (coolSrc.temperature - cool) * pos) * 100) / 100;
          }
        }
      }
      const temperature = daylightTemperatureFor(daylight.factor, warm, cool, c);
      out = { ...out, temperature, scheduledTemperature: warm, luxTemp: { cool, warm }, daylightFactor: daylight.factor, lux: daylight.lux };
    }
  }

  return out;
}

/** Short diag suffix, e.g. " | lux=180 factor=0.62 | sun=12.3°" — empty when neither applies */
function daylightTag(profile) {
  let tag = '';
  if (typeof profile?.daylightFactor === 'number') tag += ` | lux=${profile.lux} factor=${profile.daylightFactor}`;
  if (profile?.luxTemp) tag += ` luxtemp=${profile.temperature} (${profile.luxTemp.warm}→${profile.luxTemp.cool})`;
  if (typeof profile?.sunElevation === 'number') tag += ` | sun=${profile.sunElevation}°`;
  return tag;
}

/**
 * Solar elevation in degrees (NOAA solar position, refraction ignored).
 * Pure math — safe to call from the cheap gates.
 */
function solarElevationDeg(date, lat, lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const gml = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const gma = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const seoc = Math.sin(gma * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * gma * rad) * (0.019993 - 0.000101 * jc)
    + Math.sin(3 * gma * rad) * 0.000289;
  const stl = gml + seoc;
  const omega = (125.04 - 1934.136 * jc) * rad;
  const sal = stl - 0.00569 - 0.00478 * Math.sin(omega);
  const moe = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const oc = moe + 0.00256 * Math.cos(omega);
  const decl = Math.asin(Math.sin(oc * rad) * Math.sin(sal * rad));
  const y = Math.tan(oc * rad / 2) ** 2;
  const eqt = 4 * (y * Math.sin(2 * gml * rad) - 2 * ecc * Math.sin(gma * rad)
    + 4 * ecc * y * Math.sin(gma * rad) * Math.cos(2 * gml * rad)
    - 0.5 * y * y * Math.sin(4 * gml * rad) - 1.25 * ecc * ecc * Math.sin(2 * gma * rad)) / rad;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (((utcMinutes + eqt + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * rad;
  const cosZen = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZen))) / rad;
}

/** Interpolate temperature between warm (low sun) and cool (high sun) */
function sunTemperatureFor(elevation, cool, warm, c) {
  const span = Math.max(0.1, c.highElevation - c.lowElevation);
  const t = Math.max(0, Math.min(1, (elevation - c.lowElevation) / span));
  return Math.round((warm + (cool - warm) * t) * 100) / 100;
}

/** Room's sun-temperature setup, or { active: false } */
function getSunTemperature(roomConfig) {
  if (!SETTINGS.enableSunTemperature) return { active: false, reason: 'disabled' };
  if (!roomConfig.sunTemperature) return { active: false, reason: 'not configured' };
  const c = { ...SUN_TEMPERATURE_DEFAULTS, ...roomConfig.sunTemperature };
  if (c.enabled === false) return { active: false, reason: 'room disabled' };
  const elevation = Math.round(solarElevationDeg(new Date(), SETTINGS.latitude, SETTINGS.longitude) * 10) / 10;
  return { active: true, elevation, config: c };
}

/**
 * Return the profile with sun-adjusted temperature, or the profile itself when
 * not applicable. Brightness is never changed here.
 */
function applySunTemperature(profile, sun, roomConfig) {
  if (!profile || !sun || !sun.active) return profile;
  if (!sun.config.profiles.includes(profile.name)) return profile;
  const warmSrc = roomConfig.profiles.find(p => p.name === sun.config.warmProfile);
  if (!warmSrc || typeof warmSrc.temperature !== 'number') return profile;
  const cool = profile.temperature;
  const warm = warmSrc.temperature;
  const sunTemp = sunTemperatureFor(sun.elevation, cool, warm, sun.config);
  let temperature = sunTemp;
  let luxMeta = {};
  // Bright-room override: applyDaylight tagged the profile with daylightFactor
  // when the room's luminance block is active. Slide from the sun colour at
  // darkBelow to the profile's own cool colour at brightAbove.
  const lc = { ...DAYLIGHT_DEFAULTS, ...(roomConfig.luminance || {}) };
  if (lc.brightOverridesSun && typeof profile.daylightFactor === 'number') {
    const pos = daylightPositionFor(profile.daylightFactor, lc);
    temperature = Math.round((sunTemp + (cool - sunTemp) * pos) * 100) / 100;
    // luxTemp lets the lux gate predict the colour from a new lux value;
    // sunBlend/sunBlendTo let the 5-minute drift gate predict it from elevation
    luxMeta = { luxTemp: { cool, warm: sunTemp }, sunBlend: pos, sunBlendTo: cool };
  }
  return { ...profile, temperature, scheduledTemperature: cool, sunElevation: sun.elevation, sunCool: cool, sunWarm: warm, ...luxMeta };
}

// ====== GROUPS — same block in adaptivelighting.js, gradualfadeout.js,
// restoresavedsettings.js and room_watchdog.js; change all four together ======
// A Homey group uses the virtual group driver, a Hue bulb comes from the
// Philips Hue app. Homey reports the driver in driverId (e.g.
// "homey:virtualdrivergroup:driver", "homey:app:nl.philips.hue:bulb"), and in
// ownerUri/driverUri depending on the API version; all three are read. Only a
// device without any driver info falls back to the old rule (Hue bulbs have
// button.migrate_v3, groups don't), which may not survive a move to the Hue
// Bridge Pro
function driverOf(device) {
  return [device?.driverId, device?.ownerUri, device?.driverUri].filter(Boolean).join(' ').toLowerCase();
}
function isGroupDevice(device) {
  const driver = driverOf(device);
  return driver ? driver.includes('virtualdrivergroup') : !device?.capabilities?.includes('button.migrate_v3');
}
// Either sign is enough: only the Philips Hue app adds button.migrate_v3
function isHueBulb(device) {
  return driverOf(device).includes('nl.philips.hue') || !!device?.capabilities?.includes('button.migrate_v3');
}
// A light's bulbs: lights named "<name> <n>" ("B9 Lys 1") — never for a Hue
// bulb, which is a single light. With zoneFallback, a group (by driver) whose
// bulbs aren't named that way gets every other light in its zone (viaZone: log
// it — a bulb is probably misnamed). Name matching doesn't need the driver, so
// a group whose driver text looks unexpected still finds its bulbs
function groupMembers(device, allDevices, { zoneFallback = true, exclude = [] } = {}) {
  if (isHueBulb(device)) return { members: [], viaZone: false };
  const lights = Object.values(allDevices || {}).filter(d => d.class === 'light' && d.id !== device.id);
  const byName = lights.filter(d => typeof d.name === 'string' && d.name.startsWith(device.name + ' '));
  if (byName.length > 0 || !zoneFallback || !isGroupDevice(device)) return { members: byName, viaZone: false };
  const byZone = lights.filter(d => d.zone === device.zone && !exclude.includes(d.id));
  return { members: byZone, viaZone: byZone.length > 0 };
}
// ====== end of shared GROUPS block ======

/**
 * Hue bulb, or a group whose members are all Hue bulbs. Uses the cached device
 * list — no API call.
 */
async function isHueDevice(device) {
  if (isHueBulb(device)) return true;
  const members = await findGroupMembers(device);
  return members.length > 0 && members.every(isHueBulb);
}

/**
 * Find the next profile start after currentMinutes (today, else first tomorrow)
 * @returns {{ minutes: number, profile: object, msFromNow: number }|null}
 *   minutes may exceed 1440 when the boundary is tomorrow
 */
function findNextBoundary(profiles, currentMinutes) {
  let best = null;
  let earliest = null;
  for (const profile of profiles) {
    const start = parseTimeToMinutes(profile.startTime);
    if (start > currentMinutes && (!best || start < best.minutes)) best = { minutes: start, profile };
    if (!earliest || start < earliest.minutes) earliest = { minutes: start, profile };
  }
  if (!best && earliest) best = { minutes: earliest.minutes + 1440, profile: earliest.profile };
  if (!best) return null;
  const secondsIntoMinute = new Date().getSeconds();
  best.msFromNow = ((best.minutes - currentMinutes) * 60 - secondsIntoMinute) * 1000;
  return best;
}

/**
 * Remember when the next boundary is and that a full run happened now.
 * Read by the check-mode gate at the top of the script (before any API call).
 * @param {number} fromMinutes - compute the boundary after this local time
 */
function recordSchedule(deviceId, profiles, fromMinutes) {
  const next = findNextBoundary(profiles, fromMinutes);
  const state = getDeviceState(deviceId);
  state.lastFullCheckAt = Date.now();
  // msFromNow is relative to fromMinutes; shift it back to real "now"
  state.nextBoundaryAt = next ? Date.now() + next.msFromNow + ((fromMinutes - getCurrentTimeInMinutes()) * 60000) : 0;
  saveDeviceState(deviceId, state);
  return next;
}

/**
 * Get room configuration or create default
 * Returns weekend profiles if it's weekend and they exist
 */
function getRoomConfig(deviceId, deviceName) {
  const config = ROOM_CONFIG[deviceId];
  const freeDay = freeDayReason(config?.schoolHolidays === true);
  const weekend = freeDay !== null;

  if (config) {
    // Check for weekend-specific profiles (weekends and holidays)
    const profiles = (weekend && config.weekendProfiles)
      ? config.weekendProfiles
      : (config.profiles || DEFAULT_PROFILES);

    return {
      name: config.name || deviceName,
      profiles: profiles,
      isWeekend: weekend,
      freeDay,                      // 'Weekend', a holiday's name, or null
      usingWeekendProfile: weekend && !!config.weekendProfiles,
      luminance: config.luminance || null,
      sunTemperature: config.sunTemperature || null
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
 * A group's bulbs by name ("SV Loft" → "SV Loft 1", "SV Loft 2", "SV Loft 3").
 * No zone fallback here: a group without name-matched bulbs gets the commands
 * itself, and AL-GROUP-NO-MEMBERS is logged (at most once an hour per group)
 */
async function findGroupMembers(device) {
  if (!CACHED_ALL_DEVICES) {
    CACHED_ALL_DEVICES = await Homey.devices.getDevices();
  }
  const { members } = groupMembers(device, CACHED_ALL_DEVICES, { zoneFallback: false });
  if (members.length === 0 && isGroupDevice(device)) {
    let warned = {};
    try { warned = JSON.parse(global.get('AL_GroupWarningAt') || '{}') || {}; } catch (e) { warned = {}; }
    const key = getDeviceKey(device.id);
    if (!(Date.now() - (warned[key] || 0) < 3600000)) {
      warned[key] = Date.now();
      global.set('AL_GroupWarningAt', JSON.stringify(warned));
      diagLog(`AL-GROUP-NO-MEMBERS | ${device.name} | no "${device.name} <n>" lights — commands go to the group device`);
    }
  }
  return members;
}

/**
 * Clear manual mode for a device and all its group members (if it's a group)
 * Per-device state: each write is O(1), no cross-device overhead
 */
async function clearManualModeForGroup(deviceId, device) {
  const members = await findGroupMembers(device);

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
    log(`[AdaptiveLighting] Clearing manual mode for group ${device.name} and ${members.length} members`);
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
  const members = await findGroupMembers(device);
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
    
    const results = await Promise.all(memberPromises);

    // Members that didn't take the brightness (unreachable bulb, Zigbee error).
    // temperature:false is normal for dim-only bulbs and is ignored
    const failed = members.filter((m, i) => results[i].error || results[i].brightness === false);
    if (failed.length > 0) {
      diagLog(`AL-APPLY-FAIL | ${device.name} | ${failed.length}/${members.length} members failed: ${failed.map(m => m.name).join(', ')}`);
    }
    return { brightness: true, temperature: true };

  } else {
    // Single device
    const result = await applyToDevice(device, brightness, temperature, duration);
    if (result.brightness === false) {
      diagLog(`AL-APPLY-FAIL | ${device.name} | dim not accepted`);
    }
    return result;
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
  // NOTE: HomeyScript has no setTimeout — use the built-in async wait(ms)
  await wait(SETTINGS.verificationDelay);
  
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
      await wait(1000 * attempt);
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
const DEFAULT_DEVICE_ID = "3f4e2391-3be6-44ee-b340-fcc3219853b2"; // ST Standerlampe — for test runs in the HomeyScript editor
const DEVICE_ID = argParts[0] || DEFAULT_DEVICE_ID;
const MODE_ARG = (argParts[1] || '').toLowerCase();

// Every mode the script understands, aliases included. Anything else is a typo
// in a flow card: logged and ignored — never run as normal mode
const KNOWN_MODES = new Set(['', 'check', 'hourly', 'lux', 'force', 'reset', 'clear',
  'cycle-profile', 'cycle', 'brighten', 'button-brighten', 'dim-down', 'dim', 'button-dim',
  'max', 'button-max', 'toggle', 'button-toggle']);
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LUX_MODE = MODE_ARG === 'lux';
const LUX_VALUE = LUX_MODE ? parseFloat(argParts[2]) : NaN;   // NaN = not passed → full run
const CHECK_MANUAL = MODE_ARG === 'check' || MODE_ARG === 'hourly' || LUX_MODE;
const FORCE_UPDATE = MODE_ARG === 'force' || MODE_ARG === 'reset';
const CLEAR_MANUAL = MODE_ARG === 'clear';
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

// A flow card polling every 5 minutes with the same mistake would otherwise
// fill AL_DiagnostikLog — log each broken card at most once an hour. Keyed on
// device id + mode (a lux card's third word changes on every trigger), one entry
// per key so two broken cards don't keep evicting each other
function diagLogArgOnce(entry) {
  const key = `${argParts[0] || ''} ${MODE_ARG}`;
  const now = Date.now();
  let seen = {};
  try { seen = JSON.parse(global.get('AL_LastArgWarning') || '{}'); } catch (e) { /* corrupt — start over */ }
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};
  if (typeof seen[key] === 'number' && now - seen[key] < 3600000) return;
  for (const k of Object.keys(seen)) {
    if (typeof seen[k] !== 'number' || now - seen[k] >= 3600000) delete seen[k];
  }
  seen[key] = now;
  global.set('AL_LastArgWarning', JSON.stringify(seen));
  diagLog(entry);
}

if (!argParts[0]) {
  diagLogArgOnce(`AL-DEFAULT-ID | no argument — using ST Standerlampe (editor test run?)`);
}
const badArg = !DEVICE_ID_PATTERN.test(DEVICE_ID) ? 'not a device id'
  : !KNOWN_MODES.has(MODE_ARG) ? 'unknown mode' : null;
if (badArg) {
  log(`[AdaptiveLighting] ✗ Bad argument "${argString}": ${badArg} — nothing changed`);
  log(`[AdaptiveLighting] Usage: "deviceId [mode]"`);
  log(`[AdaptiveLighting] Modes: check, lux, force/reset, clear, cycle-profile, brighten, dim-down, max, toggle`);
  diagLogArgOnce(`AL-BADARG | "${argString}" | ${badArg}`);
  return false;
}

try {
  // Get the device from Homey
  // For button actions: only fetch the device (fast path)
  // For all other modes: fetch device, sun times, and device list in parallel
  const isButtonMode = BUTTON_BRIGHTEN || BUTTON_DIM || BUTTON_MAX || BUTTON_TOGGLE;

  // CHECK-MODE GATE: the flows poll every checkPollMinutes. Nothing can change
  // between profile boundaries, so skip the (expensive) device fetch unless the
  // next boundary is inside the coming poll window, or a periodic full run is
  // due. Runs before any API call — costs one global.get.
  if (LUX_MODE) {
    // LUX GATE: triggered by "luminance changed". Decide from the passed value
    // alone whether a re-scale is worthwhile; no API call on the skip path.
    const luxCfg = ROOM_CONFIG[DEVICE_ID]?.luminance;
    if (!SETTINGS.enableLuminance || !luxCfg || luxCfg.enabled === false) {
      return { skipped: true, reason: 'luminance_not_enabled' };
    }
    const gateState = getDeviceState(DEVICE_ID);
    if (gateState.manual) return { skipped: true, reason: 'manual_mode' };
    if (Date.now() < gateState.fadeEndTime) return { skipped: true, reason: 'fade_in_progress' };
    const last = gateState.lastApplied;
    if (!isNaN(LUX_VALUE) && last && typeof last.factor === 'number') {
      const c = { ...DAYLIGHT_DEFAULTS, ...luxCfg };
      // A profile that follows lux in neither brightness nor colour (Evening,
      // Night) can never need a re-scale — skip without a device fetch
      if (!last.luxDim && !last.luxTemp) {
        return { skipped: true, reason: 'profile_not_lux_managed', lux: LUX_VALUE };
      }
      const luxAdjusted = Math.max(0, LUX_VALUE - c.lampLuxAtFull * (last.brightness || 0));
      const newFactor = daylightFactorFor(luxAdjusted, c);
      const sched = typeof last.scheduledBrightness === 'number' ? last.scheduledBrightness : last.brightness;
      const brightnessDelta = last.luxDim ? Math.abs(newFactor - last.factor) * sched : 0;
      const temperatureDelta = last.luxTemp
        ? Math.abs(daylightTemperatureFor(newFactor, last.luxTemp.warm, last.luxTemp.cool, c)
                 - daylightTemperatureFor(last.factor, last.luxTemp.warm, last.luxTemp.cool, c))
        : 0;
      if (brightnessDelta < c.step && temperatureDelta < c.tempStep) {
        return { skipped: true, reason: 'lux_change_too_small', lux: LUX_VALUE, factor: newFactor, lastFactor: last.factor };
      }
    }
    // Significant change (or nothing to compare against) → fall through to a full check run
  } else if (CHECK_MANUAL) {
    const gateState = getDeviceState(DEVICE_ID);
    const gateNow = Date.now();
    const pollMs = SETTINGS.checkPollMinutes * 60000;
    const resyncDue = gateNow - (gateState.lastFullCheckAt || 0) >= SETTINGS.checkResyncMinutes * 60000;
    const boundaryNear = !gateState.nextBoundaryAt || gateNow >= gateState.nextBoundaryAt - pollMs;
    // Sun-temperature drift: predict from elevation (pure math) and wake a full
    // run when the colour should have moved by >= step since the last apply
    let tempDriftDue = false;
    const sunCfg = ROOM_CONFIG[DEVICE_ID]?.sunTemperature;
    const lastSun = gateState.lastApplied?.sun;
    if (SETTINGS.enableSunTemperature && sunCfg && sunCfg.enabled !== false && lastSun && !gateState.manual) {
      const c = { ...SUN_TEMPERATURE_DEFAULTS, ...sunCfg };
      const elevation = solarElevationDeg(new Date(), SETTINGS.latitude, SETTINGS.longitude);
      let predicted = sunTemperatureFor(elevation, lastSun.cool, lastSun.warm, c);
      if (typeof lastSun.blend === 'number' && typeof lastSun.blendTo === 'number') {
        // Bright-room override was active: the applied colour sits between the
        // sun colour and blendTo at the last lux position (lux changes are the
        // lux trigger's job; here only the elevation drift matters)
        predicted = Math.round((predicted + (lastSun.blendTo - predicted) * lastSun.blend) * 100) / 100;
      }
      tempDriftDue = Math.abs(predicted - (gateState.lastApplied.temperature ?? predicted)) >= c.step;
    }
    if (!resyncDue && !boundaryNear && !tempDriftDue) {
      return {
        skipped: true,
        reason: 'not_due',
        nextBoundaryIn: Math.round((gateState.nextBoundaryAt - gateNow) / 60000)
      };
    }
  }

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
  const scheduledProfile = findActiveProfile(roomConfig.profiles, currentMinutes);

  // Daylight scaling (no-op unless the room has a luminance block and
  // SETTINGS.enableLuminance is true). Everything below uses activeProfile,
  // so the scaled brightness flows through normal/check/force/clear alike.
  const daylight = getDaylight(roomConfig, device);
  const sun = getSunTemperature(roomConfig);
  const activeProfile = applySunTemperature(applyDaylight(scheduledProfile, daylight, roomConfig, sun), sun, roomConfig);
  if (daylight.active && SETTINGS.enableDetailedLogging) {
    log(`[${roomName}] Daylight: ${daylight.lux} lx (adj ${daylight.luxAdjusted}) → factor ${daylight.factor}`);
  }
  if (sun.active && SETTINGS.enableDetailedLogging) {
    log(`[${roomName}] Sun elevation ${sun.elevation}° → temperature ${activeProfile.temperature}`);
  }

  // Remember the next boundary + this full run (feeds the check-mode gate)
  if (!CYCLE_PROFILE) {
    recordSchedule(DEVICE_ID, roomConfig.profiles, currentMinutes);
  }
  
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
      
      setLastProfile(DEVICE_ID, nextProfile.name, nextProfile.brightness, nextProfile.temperature, nextProfile);
      await clearManualModeForGroup(DEVICE_ID, device);
      
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
    
    await clearManualModeForGroup(DEVICE_ID, device);
    setLastProfile(DEVICE_ID, profile.name, profile.brightness, profile.temperature, profile);
    
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
    await clearManualModeForGroup(DEVICE_ID, device);
    
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
      setLastProfile(DEVICE_ID, activeProfile.name, activeProfile.brightness, activeProfile.temperature, activeProfile);
      
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
      diagLog(`AL-VERIFY-FAIL | ${roomName} | ${activeProfile.name} | clear | ${result.error}`);
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
  // Check mode: uses isDeviceFading() — AL's own transition (state.fadeEndTime)
  //   or a GradualFadeOut/watchdog fade (_FadeActiveUntil)
  // Normal mode (below) only looks at the external fade and the restore marker:
  //   AL's own fadeEndTime must NOT block it, since a check-mode transition
  //   (60 s + 5 s) would otherwise prevent the profile when entering the room
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

  // Normal mode: skip if a fade is in progress OR a restore just happened.
  // During a fade, RestoreSavedSettings handles the restore — AL stays out of the way.
  // RestoreSavedSettings clears _FadeActiveUntil and sets _RestoredAt in the same
  // tick; a "turned on" trigger that arrives after that (zone "turn on" card,
  // bulb reporting on again after the restore command) must not override the
  // values that were just restored. Once the fade completes and lights are
  // off, _RestoredAt is stale and any turn-on applies the profile as before.
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

    const restoredAt = global.get(`${DEVICE_ID}_RestoredAt`) || 0;
    const restoredAgoMs = Date.now() - restoredAt;
    if (restoredAt > 0 && restoredAgoMs >= 0 && restoredAgoMs < SETTINGS.restoreGraceSeconds * 1000) {
      if (SETTINGS.enableLogging) {
        log(`[${roomName}] ⸏ Skipping - restored ${Math.round(restoredAgoMs / 1000)}s ago, keeping restored values`);
      }
      diagLog(`AL-SKIP-RESTORE | ${roomName} | currentDim=${Math.round((currentBrightness ?? 0) * 100)}% | restored ${Math.round(restoredAgoMs / 1000)}s ago | mode=normal`);
      return {
        room: roomName,
        skipped: true,
        reason: 'recently_restored'
      };
    }
  }

  // Check mode logic
  // Set when this check run ends manual mode (see manualExpiresInto below);
  // manual is cleared only after the new profile has been applied
  let manualExpired = false;
  let manualExpiredFrom = null;

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
    
    // Manual mode ends when the schedule reaches a profile in manualExpiresInto
    // (bedtime dimming still happens). Once per profile change: lastProfile is
    // not updated while manual, so it is the profile AL last set before the
    // override — an override made during Night itself sticks. Still manual
    // more than 12 h later (light left on since last night) counts as a new night
    if (isManualMode(DEVICE_ID)) {
      const manualState = getDeviceState(DEVICE_ID);
      // Manual state from before 2.29 has no timestamp: start the 12 h clock now
      if (!manualState.manualSince) {
        manualState.manualSince = Date.now();
        saveDeviceState(DEVICE_ID, manualState);
      }
      const expiresInto = Array.isArray(SETTINGS.manualExpiresInto) ? SETTINGS.manualExpiresInto : [];
      const newProfile = manualState.lastProfile !== activeProfile.name;
      const fromLastNight = Date.now() - manualState.manualSince > 12 * 3600000;
      if (expiresInto.includes(activeProfile.name) && (newProfile || fromLastNight)) {
        manualExpired = true;
        manualExpiredFrom = manualState.lastProfile || '?';
      }
    }

    // First: Check if device is in manual mode (persisted)
    if (!manualExpired && isManualMode(DEVICE_ID)) {
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
    
    // Check if values match active profile (within tolerance).
    // Daylight-managed profiles use the finer luminance.step for brightness so
    // that small daylight adjustments are actually applied; the 10% tolerance
    // is kept for temperature and for manual-adjustment detection below.
    const daylightManaged = daylight.active && daylight.config.profiles.includes(scheduledProfile.name);
    const dimTolerance = daylightManaged ? daylight.config.step : SETTINGS.tolerance;
    const sunManaged = sun.active && sun.config.profiles.includes(scheduledProfile.name);
    const luxTempManaged = daylight.active && !!activeProfile.luxTemp;
    const tempTolerance = sunManaged ? sun.config.step
                        : luxTempManaged ? daylight.config.tempStep
                        : SETTINGS.tolerance;
    const dimDiff = Math.abs(currentBrightness - activeProfile.brightness);
    const tempDiff = currentTemperature !== null 
      ? Math.abs(currentTemperature - activeProfile.temperature) 
      : 0;
    
    // The run that ends manual mode always applies, so the new profile becomes
    // lastProfile even when the override already sits near its values —
    // otherwise a later override during Night would count as an earlier one
    const isCorrect = !manualExpired && dimDiff <= dimTolerance && tempDiff <= tempTolerance;
    
    if (isCorrect) {
      // Already at the active profile. If the next boundary falls before the
      // next poll, start the upcoming profile NOW with a fade that ends
      // transitionDuration after the boundary — lands on schedule despite the
      // 5-minute polling.
      const upcoming = findNextBoundary(roomConfig.profiles, currentMinutes);
      const pollMs = SETTINGS.checkPollMinutes * 60000;
      // Only Hue bulbs (and groups of them) are known to honour multi-minute
      // transitions; for anything else an early start would just be an early
      // instant change, so leave those to the normal catch-up path.
      const supportsLongFade = await isHueDevice(device);
      if (upcoming && supportsLongFade && upcoming.msFromNow <= pollMs && upcoming.profile.name !== activeProfile.name) {
        const next = applySunTemperature(applyDaylight(upcoming.profile, daylight, roomConfig, sun), sun, roomConfig);
        const sameValues = approxEqual(next.brightness, activeProfile.brightness)
          && approxEqual(next.temperature, activeProfile.temperature);
        if (sameValues) {
          // Nothing visible changes at this boundary — just track it
          setLastProfile(DEVICE_ID, next.name, next.brightness, next.temperature, next);
        } else {
          const secsToBoundary = Math.max(0, Math.round(upcoming.msFromNow / 1000));
          const fadeSeconds = secsToBoundary + SETTINGS.transitionDuration;
          await applyLighting(device, next.brightness, next.temperature, true, fadeSeconds);
          setLastProfile(DEVICE_ID, next.name, next.brightness, next.temperature, next);
          // The gate should now look past this boundary
          recordSchedule(DEVICE_ID, roomConfig.profiles, upcoming.minutes);

          const bPct = Math.round(next.brightness * 100);
          const tPct = Math.round(next.temperature * 100);
          const bTime = formatMinutesToTime(upcoming.minutes % 1440);
          const message = `[${roomName}] ${next.name} → ${bPct}% / ${tPct}% (early: boundary ${bTime} in ${secsToBoundary}s, fade ${fadeSeconds}s)`;
          diagLog(`AL-APPLY | ${roomName} | ${next.name} | dim=${bPct}% temp=${tPct}% | mode=check (early, boundary ${bTime}, fade ${fadeSeconds}s)${daylightTag(next)}`);
          if (SETTINGS.enableLogging) log(message);
          await notify(message);
          return {
            room: roomName,
            profile: next.name,
            brightness: next.brightness,
            temperature: next.temperature,
            early: true,
            boundary: bTime,
            fadeSeconds,
            skipped: false,
            message
          };
        }
      }

      // Already at correct values. For sun/daylight-managed profiles make sure
      // the bookkeeping the gates rely on exists (first run after an upgrade,
      // or the light was already within tolerance so nothing was applied):
      // record what the light actually shows plus the sun ends. No command sent.
      if ((sunManaged || daylightManaged || luxTempManaged)) {
        const la = getDeviceState(DEVICE_ID).lastApplied;
        const needsMeta = !la
          || (sunManaged && !la.sun)
          || (daylightManaged && (typeof la.factor !== 'number' || !la.luxDim))
          || (luxTempManaged && !la.luxTemp);
        if (needsMeta) {
          setLastProfile(DEVICE_ID, activeProfile.name, currentBrightness, currentTemperature, activeProfile);
        }
      }

      // Skip silently
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
    
    // Values don't match active profile - check if they match what AL LAST APPLIED.
    // Prefer the stored values (daylight-scaled brightness lives there); fall back
    // to the profile table by name for states written before v2.22.
    const lastProfileName = getLastProfile(DEVICE_ID);
    const lastApplied = getDeviceState(DEVICE_ID).lastApplied;
    let matchesLastProfile = false;

    if (lastApplied && typeof lastApplied.brightness === 'number') {
      const lastDimDiff = Math.abs(currentBrightness - lastApplied.brightness);
      const lastTempDiff = (currentTemperature !== null && typeof lastApplied.temperature === 'number')
        ? Math.abs(currentTemperature - lastApplied.temperature)
        : 0;
      matchesLastProfile = lastDimDiff <= SETTINGS.tolerance && lastTempDiff <= SETTINGS.tolerance;
    } else if (lastProfileName) {
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
    // Manual mode just ended: the light still shows the override, which must not
    // be detected as a new one — apply the new profile
    if (manualExpired) matchesLastProfile = true;

    if (matchesLastProfile) {
      // Values match last profile (or no last profile) - just needs updating to new profile
      if (SETTINGS.enableDetailedLogging && lastProfileName) {
        log(`[${roomName}] Updating from ${lastProfileName} to ${activeProfile.name}`);
      }
      // Continue to apply the new profile (don't return, don't set manual mode)
    } else {
      // Values don't match last profile - this is manual adjustment
      setManualMode(DEVICE_ID, true);
      if (lastApplied && typeof lastApplied.brightness === 'number') {
        overrideLog(DEVICE_ID, roomName, lastProfileName, lastApplied, currentBrightness, currentTemperature, 'check',
          daylight.active ? ` | lux=${daylight.lux}` : '');
      }
      
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
    await clearManualModeForGroup(DEVICE_ID, device);
    
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
        await wait(100);

        // NOW turn on the light - it should turn on at the correct level
        await device.setCapabilityValue('onoff', true);
        
        if (SETTINGS.enableDetailedLogging) {
          log(`[${roomName}] Set level to ${Math.round(activeProfile.brightness * 100)}% while off, then turned on`);
        }
        
        // Mark profile as applied
        setLastProfile(DEVICE_ID, activeProfile.name, activeProfile.brightness, activeProfile.temperature, activeProfile);
        
        // Return early to avoid duplicate applyLighting call
        const brightnessPercent = Math.round(activeProfile.brightness * 100);
        const tempDesc = activeProfile.temperature >= 0.7 ? 'warm' :
                         activeProfile.temperature <= 0.4 ? 'cool' : 'neutral';
        const weekendIndicator = weekendTag(roomConfig);
        
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
      setLastProfile(DEVICE_ID, activeProfile.name, activeProfile.brightness, activeProfile.temperature, activeProfile);
    } else {
      // Verification failed - mark as fading to prevent false manual mode
      setDeviceFading(DEVICE_ID, SETTINGS.failedVerificationBuffer);
      
      const errorMsg = `[${roomName}] Force/reset failed: ${result.error}`;
      log(errorMsg);
      diagLog(`AL-VERIFY-FAIL | ${roomName} | ${activeProfile.name} | force | ${result.error}`);
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
    setLastProfile(DEVICE_ID, activeProfile.name, activeProfile.brightness, activeProfile.temperature, activeProfile);

    // Manual mode ends only now that the new profile is applied — if the apply
    // threw, the light stays manual and the next full run tries again
    if (manualExpired) {
      await clearManualModeForGroup(DEVICE_ID, device);
      diagLog(`AL-MANUAL-EXPIRED | ${roomName} | ${manualExpiredFrom} → ${activeProfile.name}`);
      if (SETTINGS.enableLogging) log(`[${roomName}] Manual mode ended → ${activeProfile.name}`);
    }
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
  const weekendIndicator = weekendTag(roomConfig);
  const message = `[${roomName}] ${activeProfile.name} → ${brightnessPercent}% / ${tempDesc}${weekendIndicator}${modeIndicator}`;

  diagLog(`AL-APPLY | ${roomName} | ${activeProfile.name} | dim=${brightnessPercent}% temp=${tempPercent}% | mode=${CHECK_MANUAL ? 'check' : FORCE_UPDATE ? 'force' : CLEAR_MANUAL ? 'clear' : 'normal'}${weekendIndicator}${daylightTag(activeProfile)}`);

  // Only log when in check mode (not when light turns on)
  if (SETTINGS.enableLogging && CHECK_MANUAL) {
    log(message);
    
    if (SETTINGS.enableDetailedLogging) {
      const startTimeStr = activeProfile.startTime;
      const endTimeStr = activeProfile.endTime;
      log(`[${roomName}] ├─ Day: ${getDayName()} (${roomConfig.isWeekend ? 'weekend' : 'weekday'})`);
      log(`[${roomName}] ├─ Brightness: ${brightnessPercent}%`);
      log(`[${roomName}] ├─ Temperature: ${tempPercent}% (${tempDesc})`);
      log(`[${roomName}] ├─ Schedule: ${startTimeStr} - ${endTimeStr}`);
      log(`[${roomName}] └─ Temp supported: ${device.capabilitiesObj?.light_temperature !== undefined ? 'Yes' : 'No'}`);
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
  // Flow runs never show the console — leave a trace in the shared log.
  // Guarded so a failing log write can't replace the original error
  try {
    diagLog(`AL-ERROR | ${ROOM_CONFIG[DEVICE_ID]?.name || String(DEVICE_ID).substring(0, 8)} | ${MODE_ARG || 'normal'} | ${error.message}`);
  } catch (e) { /* ignore */ }
  if (SETTINGS.enableDetailedLogging) {
    log(`[AdaptiveLighting] Device ID: ${DEVICE_ID}`);
    log(`[AdaptiveLighting] Stack: ${error.stack}`);
  }
  return false;
} finally {
  // Every exit path, including errors after a partial state write. Completes
  // normally, so the run's own return value is kept
  await publishALStatusIfChanged();
}