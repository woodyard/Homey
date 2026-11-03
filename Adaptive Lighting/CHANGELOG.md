# Adaptive Lighting — changelog

Version history of the Adaptive Lighting HomeyScripts, newest first per script.
Each script keeps its current version in its header and points here.
With every change: bump the version in the script and add an entry here.

- [AdaptiveLighting](#adaptivelighting) — `adaptivelighting.js`
- [GradualFadeOut](#gradualfadeout) — `gradualfadeout.js`
- [RestoreSavedSettings](#restoresavedsettings) — `restoresavedsettings.js`
- [Room_watchdog](#room_watchdog) — `room_watchdog.js`
- [AL_FreeDay](#al_freeday) — `al_free_day.js`
- [AL_CleanupGlobals](#al_cleanupglobals) — `al_cleanup_globals.js`
- [LightDiagnostics](#lightdiagnostics) — `lightdiagnostics.js`

## AdaptiveLighting

`adaptivelighting.js`

### 2.32.4 — 2026-11-03 — Four fixes

Idle floor never lifts the light above AL's own ramp:
  - 2 Nov: the 22:55 poll ramped the kitchen to Night 15 %
    (boundary 23:00); empty at 22:58, idle compared with
    the clock profile (Evening 70 %), so the 20 % floor
    applied and the kitchen stayed at 20 % all night (15 %
    vs 20 % is within tolerance for every later check)
  - While AL's own transition runs (fadeEndTime), the floor
    is also capped at the level it is heading to
    (lastApplied): 15 % at 22:58. A ramp up (05:55 to
    Morning) or wake's fade changes nothing. The AL-IDLE
    line says "min 15% (AL ramp)"
Sunrise/sunset 13 days off:
  - getSunTimesNOAA (on Homey the geolocation call gives
    no sun times, so every run uses these) computed
    its Julian day 13 days ahead. 30.10 the living room's
    "sunrise+30>08:00" was 08:08 (sunrise 07:38, true
    07:11); 3.11 Daytime at 08:16 instead of 08:00.
    Off by up to ~33 min around the equinoxes (sunrise
    late/sunset early in autumn, the reverse in spring),
    ~11 min at midwinter. Now within 2 min of the
    København times all year
  - Julian day from Date.UTC (noon), as solarElevationDeg
    already does (sun=… colour was never affected)
Wake takes over a GradualFadeOut fade that reads off:
  - Homey sets onoff false the moment GradualFadeOut's
    dim-to-0 card starts (insights, 3 Nov), and a Hue bulb
    reports itself on again only sometimes. A wake in those
    seconds logged "light off — idle cleared" and sent
    nothing, but its takeover had already cancelled the
    fade: GradualFadeOut skipped its off, RestoreSavedSettings
    found no fade, and someone who came in stayed at 0 %
  - During a takeover a bulb that reads off is fading: auto
    lights get the profile on every bulb, manual lights each
    snapshot bulb's dim; the dim card switches them on, as
    RestoreSavedSettings does. Logged "| read off mid-fade".
    An off by hand in those seconds comes back on (as with
    GradualFadeOut 6.19), and so does an auto light's bulb
    switched off by hand before or while idle (as with
    RestoreSavedSettings: AL keeps no per-bulb on/off for
    auto lights)
  - GradualFadeOut's own off at fade end (_AutoOffAt at or
    after the takeover) is still an off: flag cleared,
    _RestoredAt put back, nothing switched on
  - Other modes are unaffected: idle, normal and check skip
    while _FadeActiveUntil runs (lux runs go through the
    check), before reading onoff
Kids' rooms: Daytime at full, cool white:
  - AL_OverrideLog (20.10-03.11): 14 Daytime overrides in
    the kids' rooms (O Loft 6, C Loft + C LightStrip 8);
    12 went to 100 %, 10 of them to the coolest white
    (nu=100%/1, like Hue's "Energize"), from 80 % at
    0.50-0.70. The other 2 were O Loft dimmed at 16-17:30
  - PROFILES.kidsRoom / kidsRoomWeekend: Daytime 100 % at
    0.1 (was 80 % at 0.5). 100 %/0.01 is within the 10 %
    tolerance, so that choice no longer turns a light manual
  - O Loft, C Loft and C LightStrip lose sunTemperature
    (2.27.4): in winter it slid Daytime towards Evening's
    warm 0.7, away from what the kids pick
  - Morning, Evening and Night unchanged: wake-up and
    bedtime light stay the parents' call

### 2.32.3 — 2026-11-03 — Dining room Evening with the living room

- PROFILES.dining: Evening from "sunset-60>15:30<19:00",
  the stue/filament rule (was "sunset>17:00<19:00"). From
  November to February the dining room stayed on Daytime
  (70 %, cool) for 1½-2½ hours after the living room had
  gone to Evening (35 %, warm); today Evening at 15:30
  instead of 17:00. Summer unchanged (19:00)

### 2.32.2 — 2026-11-02 — Kitchen idle never below 20 %

- The living room's Night is 10 %, but it has more lamps
  (Standerlampe, five filament bulbs, light chain, TV), so
  the kitchen at 10 % looked darker. Idle blocks get
  minBrightness (default 0); the kitchen's is 0.2. Never
  above the light's own profile (kitchen Night 15 % stays
  15 %). The AL-IDLE line says "ref Night, min 20%"
- A manual light's per-bulb cap has the same floor
- Idle always sends its level while an AL transition runs:
  a check that backed off after sending its 05:55 ramp to
  Morning leaves only fadeEndTime, and with the floor the
  idle level could equal lastApplied — the empty kitchen
  then ended at 100 %

### 2.32.1 — 2026-11-02 — Kitchen brighter in the evening, B9 bright until 23:00

- AL_OverrideLog (19.10-02.11): the kitchen was turned up
  on 12 of 15 evenings (Night 15 % on 9, Evening 50 % on 3)
  and B9 to 100 % most evenings 21-24. The kitchen now
  dims itself when empty (2.32.0), so its profile only has
  to suit people in it
- PROFILES.kitchen: Evening 20:00-23:00 at 70 % (was
  20-22 at 50 %), Night from 23:00 (was 22:00)
- B9 Lys gets its own sets, bathroom9/bathroom9Weekend:
  Daytime until 23:00, Evening 23:00-00:00, Night from
  midnight (weekend Night until 07:30 as before).
  bathroomWeekend is gone (B9 was its only user); B7 keeps
  PROFILES.bathroom (Evening 21, Night 23)

### 2.32.0 — 2026-11-02 — Kitchen idle/wake: dim while the room is empty after dark

- New modes "<id> idle" (zone inactive 5 min while Mørkt,
  or Mørkt turns true while the kitchen is empty) and
  "<id> wake" (zone became active, wired in parallel with
  RestoreSavedSettings). Per room (ROOM_CONFIG[id].idle),
  K Loft and K Bord only; SETTINGS.enableIdle switches it
  off everywhere (check mode ignores a stored flag;
  wake still undoes it)
- Idle follows the living room: the target is the lowest
  brightness of the light's own profile, the reference set's
  profile now (idle.profiles = PROFILES.stue, plain values)
  and the level idle last set. While idle a light only goes
  down, never up, until wake (16:00 Daytime 100 % → 35 %,
  21:00 → 10 %, stays 10 % through 22:00 and 06:00). 30 s fade
- Check/lux/hourly runs keep the same rule while idle, also
  across profile boundaries (the reference's boundaries are
  polled for too), and still detect a change by hand: back
  at the light's own profile = woken (idle cleared, auto),
  anything else = manual + OVERRIDE "| while idle"
- A manual light keeps its scene: if the group is above the
  cap, each bulb that is on gets min(dim, cap); colour and
  temperature untouched. Every bulb that is on is noted,
  also below the cap. Wake puts each bulb's dim back
  (temperature/colour only after a restore flattened them)
- Wake: the light's own profile, uncapped, 1 s fade (or the
  snapshot for a manual light). It takes over a running
  GradualFadeOut fade right after its first save, before
  any await, so RestoreSavedSettings and wake can run in
  either order (a takeover that finds the light off puts
  _RestoredAt back; a manual light with no bulb snapshot
  leaves the fade to RestoreSavedSettings). The idle level
  is AL's own, not a change by hand. Logs its run time
- Idle and wake never switch anything on: only bulbs that
  are on are commanded (check runs while idle too), and an
  off light only loses the flag
- Turn-on, clear, force/reset and cycle-profile end idle
- Status: idle: true on the light's entry (schema stays 1)

### 2.31.3 — 2026-11-02 — A check that overlaps the end of a fade is no override

- A check poll reads the light, then waits for the slow
  device list before its fade test. When a GradualFadeOut
  fade ended in between (RestoreSavedSettings restored the
  light, or it was switched off), the poll compared the
  half-faded reading with what AL applied, set manual mode
  and logged an OVERRIDE; a restored light then skipped
  Evening until Night. Not reachable yet (B9/B7/E9 fade but
  run no check), but the kitchen will do both
- Check mode also skips when such a fade was running as
  the run started (AL-SKIP-FADE), and for
  restoreGraceSeconds (30 s) after a restore, whose
  commands can still be on their way (AL-SKIP-RESTORE …
  mode=check), as normal mode already did
- Either skip makes the next poll a full run, so a real
  change right after a restore is seen 5 min later, not
  at the 15-min resync

### 2.31.2 — 2026-11-02 — Entrance Daytime from 07:00 on weekdays

- PROFILES.entrance (E9 Loft, E9 Garderobe, E7 Lys):
  Morning 06:00-07:00 (was -09:00), Daytime 07:00-18:00
  (80 %, colour following the sun). Weekends unchanged
  (entranceWeekend: Morning 07:30, Daytime 10:00)

### 2.31.1 — 2026-10-30 — Profile changes ramp in early again

- The check poll before a profile change (19:55 for
  Evening at 20:00) is meant to start a 6-minute ramp
  that lands on schedule. It usually found the change
  "not due": the stored boundary had whole seconds plus
  the milliseconds of the run that saved it, and that
  run saves after the device fetch, later in its second
  than the next poll's gate. The change then came at the
  next poll as a 60 s fade (16 of 25 in two days of
  AL_DiagnostikLog, every evening dimming on 29.10)
- findNextBoundary is exact to the millisecond, and the
  look-ahead allows checkPollSlackSeconds (10) more, so a
  poll that fires a moment early still counts
- An instant apply (turn-on, clear, reset) ends AL's
  own running ramp (fadeEndTime). A light
  switched off and on during the ramp got the old
  profile, and the next poll skipped it as still fading,
  so the new profile waited for the 15-min resync

### 2.31.0 — 2026-10-29 — Overlapping runs for one light no longer undo each other

- A run read a light's state once and wrote the whole
  object back on every save. A check poll still waiting
  for Homey's device list when the light was turned on
  put the old state back: manual mode returned (K Bord
  stayed at 100 % until Night, the dashboard said
  Manual), a forced profile was wiped and the next check
  logged a false OVERRIDE
- Saves re-read the stored state and write only the
  fields they change (patchDeviceState). Each save that
  changes what the light shows or how AL treats it adds
  one to the state's new rev field; bookkeeping
  (schedule times, fullRunDue, a lease released) doesn't
- Turn-on, clear, reset and cycle-profile runs hold a
  lease on their light (state.busy) from their first
  line to their last; a check or lux run that starts
  meanwhile backs off at its gate, before any API call
  (AL-SKIP-BUSY, reason user_run_active). Its device
  values could predate their commands
- A check or lux run whose light another run saved after
  it read the state stops at its next save (the first
  comes right after the device fetch): AL-SKIP-STALE,
  reason state_changed
- A run that backs off sets fullRunDue, so the next
  check poll is a full run — a lux run that backed off
  may have held the newer reading
- Turn-on, clear, reset and cycle-profile runs always act

### 2.30.1 — 2026-10-28 — FREE DAYS is a shared block (no change in behaviour)

- The same block is in the new AL_FreeDay script
  (al_free_day.js), the flow condition B9 and E9 - Light
  flow use for their inactivity-timeout cards, so the
  flows switch when the weekend profiles do. The platform
  test checks the two copies are identical
- scheduleDay() reads date and hour from one clock reading
  (Intl formatToParts, h23) instead of two, so it no
  longer needs getCurrentTimeInMinutes()

### 2.30.0 — 2026-10-28 — Holidays use the weekend schedule

- Weekend profiles only knew Saturday and Sunday, so the
  kids got the school-night bedtime all through the autumn
  holiday, and everyone the weekday morning on Christmas
  Day or Easter Monday
- Free days from the calendar Room Heating keeps
  (global Config.Global, room_heating_config.js): the
  fixed public holidays (publicHolidaysFixed) and the
  Easter-based ones (computed as room_heating.js does)
  count for every room with weekendProfiles; the
  schoolHolidays ranges only for rooms with
  schoolHolidays: true (O Loft, C Loft, C LightStrip)
- Same noon rule as weekends: the evening before a free
  day gets the weekend bedtime, the evening of the last
  one the weekday bedtime
- No or unreadable Config.Global: Saturday/Sunday only,
  as before. The ad hoc SchoolHoliday Logic variable is
  not used (it means "no school today", not tonight)
- Log tag shows the reason: [Weekend: Efterårsferie]
- Not followed yet by B9/E9 - Light flow: their 06:00
  (Mon–Fri) and 07:30 (Sat/Sun) inactivity-timeout cards go
  by weekday, so 06:00–07:30 on a weekday holiday the Night
  light gets the daytime timeout (180 s / 120 s, not 30 / 60)

### 2.29.3 — 2026-10-28 — Group and Hue detection from the device driver

- Groups were found by name prefix only, and Hue by the
  button.migrate_v3 capability, which may not survive the
  move to the Hue Bridge Pro. New shared GROUPS block (the
  same in GradualFadeOut, RestoreSavedSettings and
  Room_watchdog): group = Homey's virtual group driver, Hue
  = the Philips Hue app's driver or button.migrate_v3
  (driverId/ownerUri/driverUri); with no driver info at
  all, a group is "lacks button.migrate_v3" as before
- findGroupMembers(device) now takes the device; members by
  name for anything that isn't a Hue bulb, so a group still
  works if its driver text looks unexpected (no zone
  fallback in AL). A driver-identified group without
  "<group> <n>" bulbs logs AL-GROUP-NO-MEMBERS
  (once an hour per group, AL_GroupWarningAt) — before, its
  commands silently went to the group device
- B9 and B7 bulbs renamed on Homey (B9 Wall 1–3 → B9 Lys
  1–3, B7 1–3 → B7 Lys 1–3), so AL now finds them

### 2.29.2 — 2026-10-28 — Strict argument checking

- An unknown mode (a typo in a flow card) matched no mode
  and ran as normal mode: clear manual, re-apply, switch
  the light on — silently, every poll. Now checked against
  KNOWN_MODES; anything else logs AL-BADARG and stops
  before any API call
- The device id must look like a Homey id (UUID), else
  AL-BADARG instead of a Not Found error later
- Removed the undocumented 'off' alias for clear (it
  cleared manual mode and left the light on)
- No argument still uses ST Standerlampe (editor test
  runs) but logs AL-DEFAULT-ID, so an empty flow card shows
- Each broken card (device id + mode; a lux value doesn't
  count) is logged at most once an hour — one timestamp per
  card in AL_LastArgWarning — so polls can't flood the log

### 2.29.1 — 2026-10-28 — Remove dead code and a dormant risk

- isDeviceFading no longer reads the legacy ${id}_FadeActive
  flag: nothing has written it since GradualFadeOut 5.0, and
  a leftover true would have made check mode skip that light
  forever (AL-SKIP-FADE on every poll)
- Removed unused getCurrentHour, getTimestamp and
  findMatchingProfile, the legacy startHour/endHour and
  numeric-hour profile support (every profile uses
  startTime/endTime) and the unread turnOnTransitionDuration
- Comments fixed: group members are found by name prefix (not
  button.migrate_v3); forced profiles are stored in device
  state; the normal-mode skip no longer waits 500 ms
- No behaviour change otherwise. Leftover keys can be removed
  with al_cleanup_globals.js

### 2.29.0 — 2026-10-27 — Manual mode ends at Night

- Since 2.12.0 manual mode lasted until the light was
  switched off and on (or force/clear/cycle), so a light
  turned up in the afternoon skipped bedtime dimming
- New SETTINGS.manualExpiresInto (['Night']): a check run
  that finds the schedule in one of these profiles, while
  the light is manual from an earlier profile, applies the
  profile with the normal 60 s transition (always — also
  when the override is already near its values, so it
  becomes lastProfile), then clears manual mode (group +
  members) and logs AL-MANUAL-EXPIRED. If the apply fails
  the light stays manual and the next full run retries
- "Earlier profile" = state.lastProfile, which is not
  updated while manual, so an override made during Night
  sticks. New state.manualSince: still manual more than
  12 h later (left on since last night) expires again;
  manual state from before 2.29 gets its clock started
- Only polled rooms (check mode); forced profiles are
  checked first and unaffected. [] restores 2.28 behaviour

### 2.28.0 — 2026-10-27 — Publish real per-light status for the dashboard

- The dashboard guessed Auto/Manual by comparing live
  values with a copied profile table, so lights scaled by
  daylight or coloured by the sun showed as "Manual"
- New Logic text variable AdaptiveLightingStatus (created
  on first publish): every configured light's mode
  (auto/manual/forced), profile, applied and scheduled
  values, daylight factor/lux, sun elevation, timestamps
- Rebuilt from the AL_Device_*.State globals each time,
  not merged, so parallel runs can't drop entries (Room
  Heating's read-modify-write HeatingStatus can)
- Written at the end of a run (try/finally) only when a
  shown field changed, or for the first run each hour
  (heartbeat). Gated/lux/button skips save no state and
  make no extra API call. Signature in AL_StatusSig,
  variable id cached in AL_StatusVarId; a short lock in
  AL_StatusVarLock stops two runs creating it twice
- lastApplied gains scheduledTemperature, sunElevation and
  via (run mode). A failed publish never affects the run;
  each distinct error is logged once as AL-PUBLISH-FAIL,
  and publishing pauses 10 min (AL_StatusRetryAt) so a
  lasting failure doesn't add API calls to every run. A
  non-text variable of the same name gets a clear error

### 2.27.4 — 2026-10-27 — Sun colour for the kids' rooms and the entrance

- O Loft, C Loft, C LightStrip, E9 Loft and E9 Garderobe
  get sunTemperature: STUE_SUN_TEMPERATURE (same 0–35°
  elevation curve). Daytime slides from the profile's own
  0.5 towards the room's Evening 0.7 when the sun is low:
  ~0.58 at noon in late October, ~0.64 at the December
  solstice, 0.5 from March to September
- O and C follow the sun through the day via the 5-minute
  check (drift gate); E9 has no poll and gets the colour at
  each turn-on
- Kitchen and bathrooms stay out: their Morning is cooler
  than a winter sun-adjusted Daytime, so 09:00 would step
  warmer instead of cooler. C Light Svampelampe is dim-only

### 2.27.3 — 2026-10-27 — Weekend evenings follow the next day

- Weekend profiles were picked by today's date, so Friday
  evening got the weekday bedtime (kids Night from 20:00,
  bedroom from 22:00) and Sunday evening the late weekend
  one (Evening until 21:00 / 23:00)
- isWeekend() → isWeekendSchedule(): before 12:00 today
  decides, from 12:00 tomorrow. Fri 12:00 – Sun 12:00
  runs the weekend set, Sun 12:00 – Fri 12:00 the weekday
  set. Mornings are unchanged
- Noon is invisible: every weekday/weekend pair has the
  same Daytime values. Kids' rooms also move the Daytime
  → Evening step: 19:00 on Friday (was 18:00), 18:00 on
  Sunday (was 19:00)
- Rooms with identical evenings in both sets (bathrooms,
  entrance) are unaffected
- A nextBoundaryAt stored before noon on Sunday may point
  at the weekend set's boundary; the 15-minute resync
  recomputes it, so a switch is at most ~15 min late

### 2.27.2 — 2026-10-27 — Claras værelse: both lights follow the same schedule

- C LightStrip gets weekendProfiles kidsRoomWeekend like
  C Loft. Before, at weekends the strip went to Night at
  20:00 while the ceiling light stayed on Evening until
  21:00, and the strip got Morning from 06:00 while the
  ceiling light was still on Night until 07:30
- C - Light flow gained the 5-minute check poll (C Loft +
  C LightStrip), like O/K/SS. Before, both lights kept
  the profile they got at turn-on and never moved to
  Evening or Night on their own

### 2.27.1 — 2026-10-27 — Errors reach AL_DiagnostikLog

- Flow runs never show the console, so a thrown error
  left no trace (the setTimeout crash went unseen from
  2.14 to 2.20). The top-level catch now also writes
  AL-ERROR | <room> | <mode> | <message>
- AL-APPLY-FAIL when a bulb doesn't take the brightness:
  group members that error or return dim=false, or a
  single light whose dim write fails. Before, member
  errors were swallowed and only shown with detailed
  logging. Temperature failures are ignored (dim-only
  bulbs always fail them); return values are unchanged
- AL-VERIFY-FAIL when clear/force verification fails after
  all retries (was console + disabled notification only)
- Fix: detailed logging threw "result is not defined" on
  every check/lux apply ("Temp supported" read a variable
  that only exists in the clear/force branches). Now reads
  the device's light_temperature capability

### 2.27.0 — 2026-10-19 — Override log for preset tuning (AL_OverrideLog)

- AL_DiagnostikLog holds ~1 day (500 lines, mostly E9
  fade/apply noise) and never recorded manual changes, so
  it could not answer "which presets do people correct?"
- New global AL_OverrideLog (max 1000 lines): one line
  each time a light is found at values that differ from
  what AL last applied. Written here when check mode
  activates manual mode (src=check), and by GradualFadeOut
  v6.12 / Room_Watchdog v2.11 when the light is switched
  off (src=fade / src=watchdog) — the only place a Hue
  dimmer switch override in a motion room is ever seen
- lastApplied gains `at` (epoch ms) so a line can say how
  long after AL's apply the override was found
- Same override is logged once: ${deviceId}_OverrideLogged
  holds the last logged signature (apply time + values)

### 2.26.0 — 2026-09-18 — Lux-driven colour for non-scaled profiles (Soveværelse Morning)

- Morning was fixed at 25% / warm 0.80 no matter how bright
  the room; with the curtains up and daylight pouring in the
  dim yellow light looked wrong. The calm level is wanted,
  the warm colour is not.
- New luminance fields: coolProfiles (default []), coolProfile
  (default 'Daytime'), tempStep (default 0.05). For listed
  profiles the temperature slides linearly from the
  profile's own value at darkBelow to coolProfile's value at
  brightAbove; brightness untouched. Sun temperature still
  wins for profiles listed in both blocks.
- When coolProfile is itself sun-managed, the cool end is
  its sun-adjusted colour (Daytime at 09:00 in September
  is ~0.62, not 0.50), so a bright Morning ends exactly
  where Daytime starts. The stored cool end is a snapshot;
  slow sun drift is caught by the 15-minute resync.
- SV Loft: coolProfiles ['Morning'] → 0.80 with curtains
  drawn, the sun-adjusted Daytime colour in a sunlit room.
  A sunlit Daytime ends at 24% anyway, so the 09:00
  boundary becomes invisible in both brightness and colour.
- lastApplied gains luxDim / luxTemp; the lux gate now
  compares a temperature delta (tempStep) as well as the
  brightness delta, and skips outright for profiles that
  follow lux in neither (Evening/Night). Before, Morning
  stored factor 1 and every sensor report during a bright
  morning woke a full device fetch that applied nothing.
- Check mode uses tempStep as the "already correct" colour
  tolerance for lux-colour profiles; "already correct" runs
  backfill the new bookkeeping without sending a command
- Diag: AL-APPLY lines gain "luxtemp=0.63 (0.8→0.5)"
- Bright room beats low sun: new luminance field
  brightOverridesSun (default false). For sun-managed
  profiles the colour slides from the sun-elevation value
  at darkBelow to the profile's own cool value at
  brightAbove. Trigger: sun blasting into the bedroom at
  19° elevation while the script held SV Loft at 0.64 —
  the elevation curve never reaches its cool end in
  Copenhagen between September and March (max ~33°).
  Drawn curtains / dull afternoons keep the warm sun
  colour. Morning's cool end follows the same override.
  lastApplied.sun gains blend/blendTo so the 5-minute
  drift gate predicts the blended colour (otherwise every
  poll during a bright morning would wake a full run).
  Enabled for Soveværelse; Stue unchanged (one line to add).
- Bedroom Daytime colour 0.5 → 0.3 (~5000 K) so a sunlit
  room gets a bulb that blends with the daylight

### 2.25.0 — 2026-09-05 — Soveværelse: daylight brightness + sun temperature

- SV Loft gets a luminance block on SV Motion and the
  same sun-temperature block as Stue
- Thresholds from a week of Insights: the bedroom sensor
  reads 15–170 lx with curtains open (peaks in morning
  sun), 1–6 lx with them drawn, lamps add ~14 lx at 56%.
  darkBelow 15 / brightAbove 100 / minFactor 0.4
- Bedroom colour slides 0.50 (Daytime) → 0.80 (Evening)
  with sun elevation, same 35° ceiling as Stue
- SV flow gained the "luminance changed" → lux trigger

### 2.24.1 — 2026-09-05 — Arm the sun-drift gate even when nothing needs applying

- First live run: ST Loft was within the 0.05 step of its
  sun temperature, so the full check applied nothing and
  never stored the cool/warm ends → the 5-minute drift
  gate stayed disarmed and the light depended on the
  15-minute resync alone
- "Already correct" runs for sun/daylight-managed profiles
  now record the CURRENT values plus the sun ends in
  lastApplied (no light command), so the gate can predict
  drift from what the light actually shows

### 2.24.0 — 2026-09-04 — Sun-based colour temperature (seasonal daylight colour)

- Opt-in per room: ROOM_CONFIG[...].sunTemperature =
  { highElevation, lowElevation, profiles, warmProfile,
    step }. Global switch SETTINGS.enableSunTemperature.
  Off / absent = profile temperatures exactly as before.
- For the listed profiles (default Daytime) the colour
  temperature follows solar elevation: the profile's own
  (cool) temperature at/above highElevation, the
  warmProfile's (Evening) temperature at/below
  lowElevation, linear in between. Season falls out of
  the elevation: a Copenhagen December noon peaks near
  11°, June near 58°, so winter days stay warmer.
- Elevation from the NOAA solar-position formulas
  (pure math, no API); brightness scaling untouched
- Check mode uses sunTemperature.step as the temperature
  tolerance for sun-managed profiles; the 5-minute gate
  also wakes a full run when the predicted temperature
  has drifted >= step from what was last applied
- lastApplied stores the cool/warm ends so the gate can
  predict without the profile table
- Enabled for Stue (ST Loft + ST Standerlampe)
- Diag: AL-APPLY lines gain "sun=12.3°" when active

### 2.23.1 — 2026-09-04 — Finer daylight steps + wider Stue range

- First live test: curtains up/down moved the sensor
  28↔156 lx but the resulting brightness changes (±7-8%)
  fell inside the 10% manual-detection tolerance and
  were skipped, so the light sat still at 47%
- New luminance.step (default 0.04): minimum brightness
  change worth acting on for daylight-managed profiles.
  Used by the lux gate AND as the "already correct"
  tolerance in check mode for those profiles. Manual
  detection still uses SETTINGS.tolerance (10%) against
  the last applied value.
- Stue thresholds: darkBelow 60→40, brightAbove 250→200
  so dull/rainy days still produce a visible swing

### 2.23.0 — 2026-09-04 — "lux" mode: react to luminance changes immediately

- New argument "device-id lux <value>" for a flow
  triggered by the sensor's "luminance changed" card
  (pass the new value as the tag). Behaves like check
  mode but replaces the time gate with a lux gate.
- Lux gate (no API call): recomputes the daylight factor
  from the passed value and only does a full run when
  the resulting brightness differs from what was last
  applied by more than SETTINGS.tolerance. Skips
  silently when the room has no luminance block, is in
  manual mode, or AL's own fade is still running.
- lastApplied now also stores factor, scheduledBrightness
  and lux so the gate can compare without the profile table
- Without a value ("device-id lux") it falls back to a
  full check run

### 2.22.0 — 2026-09-04 — Daylight-aware brightness from a room luminance sensor

- Opt-in per room: ROOM_CONFIG[...].luminance = { sensorId,
  darkBelow, brightAbove, minFactor, profiles, ... }
- Global kill switch SETTINGS.enableLuminance — set false
  (or remove a room's luminance block) and behaviour is
  exactly the pre-2.22 logic
- Brightness of the listed profiles (default: Daytime) is
  multiplied by a factor that falls linearly from 1.0 at
  darkBelow lux to minFactor at brightAbove lux;
  temperature is never touched
- Sensor read from the already-fetched device list (no
  extra API call); stale readings (> maxAgeMinutes) or a
  missing sensor fall back to factor 1.0
- The room's own lamp is subtracted from the reading
  (lampLuxAtFull × current dim) to damp the feedback loop
- Device state now stores lastApplied {brightness,
  temperature}; check mode compares against that instead
  of the profile table, so a daylight-scaled light is not
  mistaken for a manual adjustment. Re-scaling happens on
  the periodic full check when the factor drifts > 10%
- Enabled for Stue: ST Loft + ST Standerlampe via ST Motion
- Diag: AL-APPLY lines gain "lux=… factor=…" when active

### 2.21.0 — 2026-09-04 — Schedule-aware check mode (flows now poll every 5 min)

- Check mode used to run every minute per light from the
  ST/K/SV/O/SS flows (9 script runs + 3 full device dumps
  per minute). Flows now trigger every 5 minutes.
- Cheap gate before ANY API call: a check run exits at
  once unless the next profile boundary is inside the
  coming poll window, or checkResyncMinutes have passed
  since the last full run (manual-mode detection)
- Early transition: when the next boundary falls before
  the next poll, the new profile is started NOW with a
  hardware fade that ends transitionDuration after the
  boundary — so the change still lands on schedule
  (Zigbee bulbs handle multi-minute transitions natively)
- Early transition only for Hue devices (bulb or group of
  Hue bulbs, detected via button.migrate_v3); other lights
  (e.g. Twinkly SS Light Perler) keep the old catch-up
  behaviour at the poll after the boundary
- Per-device state gains nextBoundaryAt + lastFullCheckAt
- New settings: checkPollMinutes (5), checkResyncMinutes (15)
- Diag: AL-APPLY "(early)" marks a pre-boundary transition

### 2.20.0 — 2026-09-04 — Respect a just-completed restore + fix setTimeout crash

- Normal mode (light turned on) now also skips when
  RestoreSavedSettings restored the light within the
  last restoreGraceSeconds (30s), not only while
  _FadeActiveUntil is still in the future
- Closes the race seen in E9: on re-entry mid-fade the
  zone flow runs RestoreSavedSettings and a "turn on"
  in parallel; restore cleared the fade flag first, the
  resulting "turned on" trigger then found no fade and
  applied the profile over the restored values
- Logged as AL-SKIP-RESTORE in AL_DiagnostikLog
- Replaced setTimeout (not defined in HomeyScript) with
  wait(): verifyDeviceState + retry backoff threw on
  every clear/force run, and the normal-mode "set level
  while off, then turn on" path threw before turning
  the light on

### 2.19.1 — 2026-05-10 — Align weekend Morning start to 07:30 + close coverage gap

- bathroomWeekend / entranceWeekend Morning: 08:30 → 07:30
  and Night endTime extended 07:00 → 07:30 (closes 90-min
  gap that fell back to Night: bathroom 8% / entrance 10%)
- kidsRoomWeekend Morning: 08:30 → 07:30 (Night 08:30 → 07:30)
- standardWeekend Morning: 08:00 → 07:30 (Night 08:00 → 07:30)

### 2.19.0 — 2026-03-31 — Parallel API calls + per-run caching for faster execution

- Device fetch, sun times, and device list run in parallel
- Cache getDevices() result to avoid duplicate API calls
- findGroupMembers() reuses cached device list
- Per-run device state cache: parse JSON once, reuse on repeat reads
- Per-run registerDeviceKey cache: skip index lookup for known keys
- Instant dim + temperature now run in parallel (like duration path)
- Saturation reset + mode switch run in parallel
- Button actions unchanged (single API call fast path)
- Removed legacy migration code and legacy cycle-profile path

### 2.18.0 — 2026-03-31 — Per-device state object (AL_Device_<key>.State)

- Consolidated AL_DeviceStates, AL_Fade_<key>, and forced
  profile variables into one state object per device
- Each device has its own global variable — O(1) read/write
  instead of parsing all devices on every state access
- DEFAULT_DEVICE_STATE with manual, lastProfile, fadeEndTime,
  forcedProfile fields (deep-merged for forward compat)
- FORCED_PROFILE_VARIABLES → FORCED_PROFILE_DEVICES Set
- AL_DeviceKeys index for diagnostics enumeration
- Auto-migration from legacy combined blob on first run

### 2.17.0 — 2026-03-30 — Simplify normal mode: OFF→ON always applies profile

- Removed 500ms wait + ManualRestoreUntil logic for normal mode
- Only skip if fade is actively in progress (let restore handle it)
- Once lights are off, any turn-on gets the profile. No exceptions.
- Check mode unchanged (still uses isDeviceFading + manual mode)

### 2.16.1 — 2026-03-20 — Fix lights snapping back to profile brightness during fade

- Normal mode checks only _FadeActiveUntil (external fades)
- Does NOT check AL_Fade_ (AL's own transitions would false-block)
- Waits 500ms for RestoreSavedSettings to clear → then proceeds or skips
- Check mode still uses full isDeviceFading() as before
- Fixes v2.16.0 regression where fade actions triggered profile apply

### 2.16.0 — 2026-03-14 — Fix mid-fade dim lights on motion detection

- Normal mode (light turn-on) no longer skips for active fade
- Only check mode (hourly updates) respects fade flag
- Fixes lights stuck at 5-30% when entering room during fade-out
- ManualRestoreUntil flag still protects manual brightness

### 2.15.1 — 2026-03-04 — Persistent diagnostic logging (AL_DiagnostikLog)

- Logs profile apply, fade-skip, and manual-restore-skip events
- Shared log variable with GradualFadeOut and RestoreSavedSettings
- Helps diagnose unexpected dim-light issues across profile transitions

### 2.15.0 — 2026-03-02 — Preserve manual adjustments through fade/restore cycle

- Checks _ManualRestoreUntil flag from RestoreSavedSettings
- Skips profile application when manual settings were restored
- Keeps manual mode active so user's brightness persists
- Coordinated with GradualFadeOut v6.1 and RestoreSavedSettings v3.5

### 2.14.3 — 2026-01-14 — Prevent "flash of bright light" when turning on

- Set brightness/temperature WHILE light is off
- Add 100ms delay for command processing
- Then turn on light at correct level
- Mimics Homey UI behavior (works the same way)

### 2.14.2 — 2026-01-14 — Parallel group member control

- Changed from sequential to parallel execution
- All bulbs in group now change simultaneously
- Uses Promise.all() with individual error handling
- Eliminates visible cascade effect (5x speed improvement)

### 2.14.1 — 2026-01-10 — Fix variable scope issue in clear mode

- Moved activeProfile definition earlier in code flow
- Clear mode now has access to activeProfile before using it
- Fixes undefined/incorrect values during clear operation
- Removed duplicate activeProfile declaration

### 2.14.0 — 2026-01-10 — Verification and retry for clear/reset operations

- Added verifyDeviceState() to check applied settings
- Added applyLightingWithRetry() with up to 3 retry attempts
- Clear mode now verifies settings were applied correctly
- Force/reset mode uses verification and retry logic
- Automatic retry with increasing delays (1s, 2s, 3s)
- On verification failure: marks device as fading for 60s
- Prevents false manual mode activation after clear/reset
- Fixes issue where temperature didn't apply to groups
- New settings: enableVerification, verificationRetries, etc.

### 2.13.21 — 2026-01-08 — Use Homey's native sunrise/sunset times

- Fetches sun times from Homey.geolocation API
- Ensures consistency with Homey's own sunrise/sunset alerts
- NOAA algorithm kept as fallback if API fails
- Sun times cached per script execution for efficiency

### 2.13.20 — 2026-01-07 — Skip profile on fade/restore for ALL modes (not just check)

- Normal mode (light turn on) now also checks isDeviceFading()
- Prevents AdaptiveLighting from overriding restored brightness
- Fixes issue where waving mid-fade still applied profile

### 2.13.19 — 2026-01-07 — Support bathroom fade script's new timestamp variable

- isDeviceFading() now checks ${deviceId}_FadeActiveUntil
- Prevents AdaptiveLighting from overriding restored brightness
- Works with GradualFadeOut v5.0 and RestoreSavedSettings v3.1

### 2.13.18 — 2026-01-06 — Fix light not turning on in normal mode

- Normal mode now checks if light is off and turns it on
- Ensures light is actually on before applying brightness/temp
- Button actions already had this, now normal mode has it too

### 2.13.17 — 2026-01-05 — Pre-load entire profile schedule for maximum speed

- Light turn-on and clear now pre-load ALL 4 profiles
- Cycling becomes trivial: just read from array
- No calculation needed during ANY cycle
- All cycles equally fast (ultra fast path)
- Backward compatible with old single-profile format

### 2.13.16 — 2026-01-05 — Pre-calculate first profile on light turn-on and clear

- When light turns on, pre-loads first profile (Morning)
- When clear mode used, also pre-loads first profile
- Eliminates "cold start" delay on first cycle
- Makes even the first profile cycle instant
- Cached data ready as soon as light is on or reset

### 2.13.15 — 2026-01-05 — Pre-calculate next profile for instant cycling

- cycle-profile now uses cached next profile data
- First cycle calculates and stores next profile settings
- Subsequent cycles use pre-calculated data (fast path)
- Eliminates room config lookup on repeated cycles
- Major speed improvement for profile cycling

### 2.13.14 — 2026-01-05 — Performance optimization for button actions

- Button actions now execute immediately (fast path)
- Skips time calculations, room config, profile checks
- Reduces latency from button press to light change
- Moved button handler before all other processing

### 2.13.13 — 2026-01-05 — Button actions auto-turn-on light if off

- brighten, dim-down, max, cycle-profile now turn on light first
- Ensures button always has visible effect
- Toggle remains as pure on/off switch

### 2.13.12 — 2026-01-05 — Added button action argument modes

- New "brighten" mode: +20% brightness
- New "dim-down" mode: -20% brightness
- New "max" mode: 100% brightness
- New "toggle" mode: on/off toggle
- Allows physical buttons to trigger script directly
- All button logic now centralized in script

### 2.13.11 — 2026-01-05 — Support for forced profile cycling via button controls

- Added FORCED_PROFILE_VARIABLES configuration
- New "cycle-profile" argument mode
- Check mode skips if forced profile is active (0-3)
- Clear mode also resets forced profile to -1
- Light turn-on resets forced profile to auto mode
- Uses HomeyScript global variables (no manual setup required)

### 2.13.10 — 2026-01-03 — Fix fade tracking using global.set/get instead of tag()

- tag() function was not persisting fade timestamps correctly
- Switched to global.set/get (same as device states)
- Fixes false manual mode during schedule transitions
- Removed async/await from fade tracking functions

### 2.13.9 — 2026-01-02 — Fix fade tracking not working on schedule changes

- setDeviceFading() now called whenever duration > 0
- Previously only tracked in check mode (useDuration)
- Fixes false manual mode on schedule transitions

### 2.13.8 — 2026-01-02 — Prevent false manual mode during fade transitions

- Device-specific fade tracking (AL_Fade_<deviceKey>)
- Check mode skips if device is currently fading
- 5-second buffer after fade completes
- Also checks bathroom fade script flag (deviceId_FadeActive)
- Works for groups and individual devices

### 2.13.7 — 2025-12-28 — Fix "clear" for groups - also clear group members

- clearManualModeForGroup() clears all X/Y members
- Prevents group from immediately returning to manual mode
- Fixes issue where individual bulbs kept manual mode active

### 2.13.6 — 2025-12-26 — Fix timezone handling for Copenhagen time

- getCurrentTimeInMinutes() now correctly uses CET/CEST
- getCurrentDayOfWeek() now correctly uses CET/CEST
- Fixes 1-hour offset where script was using UTC instead of local time

### 2.13.5 — 2025-12-26 — Fix temperature not applying correctly on color bulbs

- Reset saturation to 0 when applying temperature
- Ensures pure white light without color mixing
- Fixes issue where temperature ended up wrong (e.g. 76 vs 90)

### 2.13.4 — 2025-12-21 — Gentler morning light across all rooms

- Reduced morning brightness (except bathroom/kitchen)
- Warmer morning temperature (0.7) for soft wake-up
- Updated: kidsRoom, entrance, dining, standard profiles
- Evening→Night changed to 21:30 for stue/filament

### 2.13.3 — 2025-12-20 — Fix "clear" mode for lights that are off

- "clear" on a turned-off light only clears manual mode
- Does not turn on the light

### 2.13.2 — 2025-12-17 — Improved notifications

- Only notify FIRST time entering manual mode
- Notify when exiting manual mode (→ auto)
- No repeated "Skipped - manual mode" notifications

### 2.13.1 — 2025-12-17 — Handle missing lastProfile gracefully

- If no lastProfile exists, initialize without setting manual mode
- Fixes false positives after script update

### 2.13.0 — 2025-12-17 — Improved manual mode detection with lastProfile tracking

- Remembers which profile was last applied to each device
- Manual mode only set if values don't match LAST profile
- Prevents false positives when profile changes
- Storage changed from AL_ManualModes to AL_DeviceStates

### 2.12.1 — 2025-12-17 — Fix false manual mode detection

- Only sets manual mode if values don't match ANY profile
- Profile changes (e.g., Morning→Daytime) are now handled correctly
- "clear" now also applies profile (instant)

### 2.12.0 — 2025-12-16 — Persistent manual mode tracking

- Uses HomeyScript global storage to remember manual mode
- Manual mode persists until light turns on, force, or clear
- "clear" argument clears manual mode AND applies profile
- Data stored in AL_ManualModes global variable

### 2.11.3 — 2025-12-16 — Reduced logging noise

- No logging when light turns on (normal mode)
- Only logs in "check" mode (periodic updates)
- Still logs manual adjustment skips

### 2.11.2 — 2025-12-16 — Combined min+max constraints for sunrise/sunset

- "sunset>17:00<19:00" = sunset, min 17:00, max 19:00
- Updated filament and stue profiles

### 2.11.1 — 2025-12-16 — Min/max constraints for sunrise/sunset

- "sunset>18:00" = sunset, but at least 18:00
- "sunrise<08:00" = sunrise, but at most 08:00
- Updated filament, stue, dining profiles

### 2.11.0 — 2025-12-16 — Sunrise/sunset support

- Added getSunTimes() function (NOAA algorithm)
- Use "sunrise" or "sunset" in startTime/endTime
- Supports offsets: "sunset-30", "sunrise+60"
- Added latitude/longitude to SETTINGS

### 2.10.5 — 2025-12-15 — Simultaneous dim and temperature fade

- Both now fade together using Promise.all()
- Total fade time is 60s (not 120s)

### 2.10.4 — 2025-12-15 — Fix temperature flow card ID

- Instant change when light turns on
- Fade duration only for periodic updates (check mode)

### 2.10.2 — 2025-12-15 — Fix check mode logic

- Now correctly skips if already at active profile values
- Checks against active profile first, then manual adjustment

### 2.10.1 — 2025-12-14 — Fix color mode handling

- Switches light_mode from "color" to "temperature" before applying
- Refactored applyToDevice helper function

### 2.10.0 — 2025-12-14 — Group duration support

- Detects groups by name pattern (e.g., "Name X/Y")
- Applies duration to each individual bulb in group
- Uses correct flow card URI format

### 2.9.1 — 2025-12-14 — Fixed transition duration using flow card action

- Duration is top-level property, not inside args
- Works on Hue, IKEA and other supported devices

### 2.9.0 — 2025-12-14 — Added transition duration support

- transitionDuration setting (default: 60 seconds)
- Smooth fade when changing profiles (if device supports it)

### 2.8.0 — 2025-12-14 — Added Homey notification support

- Uses correct URI format from EVE script
- enableNotifications setting (default: true)

### 2.7.0 — 2025-12-14 — Added weekend profile support

- Optional weekendProfiles for Saturday/Sunday
- Pre-built weekend variants for bedroom and kids room
- Logs show [Weekend] indicator when using weekend profile

### 2.6.0 — 2025-12-14 — Changed to startTime/endTime with "HH:MM" format

### 2.5.1 — 2025-12-14 — Fixed args handling for runWithArg

### 2.5.0 — 2025-12-14 — Improved argument modes for different use cases

### 2.4.0 — 2025-12-14 — Added "force" argument to reset manually adjusted lights

### 2.3.0 — 2025-12-14 — Added manual adjustment detection for hourly updates

### 2.2.0 — 2025-12-14 — Cleaned up config - only groups and standalone devices

### 2.1.0 — 2025-12-14 — Added filament bulb profile with reduced brightness

### 2.0.0 — 2025-12-14 — Complete rewrite with centralized room configuration

- Per-room lighting profiles
- Per-room schedules
- Fallback to default profiles
- Dynamic room name detection
- All Kertemindegade devices pre-configured

### 1.0.0 — 2025-xx-xx — Initial version with hardcoded device ID

## GradualFadeOut

`gradualfadeout.js`

### 6.20 — 2026-11-03 — No fade for a light switched on while nobody is seen

- The countdown armed when the room empties keeps running
  when the light is switched on (Hue switch, app, voice)
  while the motion sensor misses the person, and faded it a
  minute later. E9, 2 Nov: on at 09:00:48, FADE-SAVE at
  09:01:35 — 47 s, where E9's day countdown is 180 s
- Before saving: the room's primary light was switched on
  less than UNSEEN_MIN_ON (900 s) ago and nobody has been
  seen since → FADE-SKIP-UNSEEN, nothing saved or sent.
  Room_watchdog fades it 900 s after the turn-on, or the
  room's timeout after the next motion
- Read exactly as Room_watchdog 2.17 does: its ROOMS and
  TURN-ON blocks are now in both scripts (change both
  together). Seen = motion now, a motion change from 60 s
  before the turn-on, or the E9 door changing then; a turn-on
  within 180 s of an automatic off (flip-back) is faded; AL's
  turn-on run still holding its lease = switched on just now
- Only while the room's primary light is on (the watchdog
  checks a room through it); E9 Loft and E9 Garderobe get
  one answer. A light outside ROOMS, or a motion sensor that
  can't be read → faded as before
- Not covered (nor by the watchdog): a Hue switch press that
  brightens or changes scene on a light already on records
  no turn-on, so the countdown still fades it

### 6.19 — 2026-11-03 — Zone active at fade end: restore even when onoff reads off

- 6.16 left a light that read off alone, as "switched off by
  hand". But Homey sets onoff false the moment a dim-to-0
  fade starts (insights, 3 Nov: B9 07:51, E9 11:31 with
  nobody home), and a Hue bulb reports itself on again only
  sometimes. So someone who came in could be left at ~0 %
- An off by hand during the fade in an occupied room now
  comes back on; press off once more

### 6.18 — 2026-11-03 — Stamp ${deviceId}_AutoOffAt at FADE-OFF

- Room_watchdog 2.17 gives a light switched on while nobody
  is seen 15 minutes. A turn-on within 3 minutes of this off
  is a late Hue/Zigbee report or someone pressing on right
  after it, not a fresh switch-on: the watchdog reads the
  stamp and gives it the room's normal timeout instead
- Also at the "already off/very dim" off (FADE-SKIP at
  ≤5 %), which switches the light off without a fade

### 6.17 — 2026-10-28 — Group detection from the device driver

- Shared GROUPS block (same as AdaptiveLighting 2.29.3): a
  group is Homey's virtual group driver, not "lacks
  button.migrate_v3". If that capability disappeared (Hue
  Bridge Pro), E9 Loft would have been treated as a group,
  its zone fallback would fade E9 Garderobe and E9 Loft
  would never be turned off
- A single Hue bulb skips the device-list fetch entirely
- The zone fallback (group without "<group> <n>" bulbs) is
  logged as FADE-ZONE-FALLBACK

### 6.16 — 2026-10-28 — Never leave an occupied room at ~0%

- Zone already active before the fade starts (the countdown
  fired just as someone moved, so RestoreSavedSettings ran
  first and skipped): FADE-ABORT, nothing is dimmed. The
  countdown starts again when the room empties
- Zone active at fade end used to return FADE-HOLD at once,
  trusting the zone-active flow's RestoreSavedSettings. When
  none came (slow, or a flow without the card, as B7 had)
  the light stayed at ~0% until the person left. Now the
  restore window is kept open and the script waits up to
  HOLD_WAIT_SECONDS (10 s); if no restore arrives it
  restores the saved brightness/colour itself
  (FADE-SELF-RESTORE), as RestoreSavedSettings would — unless
  the light was switched off by hand meanwhile (onoff false;
  a dim-to-0 fade leaves it true). A restore that does
  arrive → FADE-HOLD as before
- Verify step: light off 3 s after the off but zone active
  (someone came in between the zone check and the off — the
  flow's "turn lights on" saw the lights still on) → switch
  it back on; its "turned on" flow runs AdaptiveLighting
- Run time in that rare case: up to ~10 s longer

### 6.15 — 2026-10-28 — Strict argument checking

- Every id in the argument must look like a Homey device id
  (UUID); otherwise FADE-BADARG and nothing is faded
- No argument still fades B9 Lys (editor test runs) but logs
  FADE-DEFAULT-ID, so an empty flow card shows up

### 6.14 — 2026-10-28 — Stop writing ${deviceId}_SavedManualMode

- RestoreSavedSettings only turned it into _ManualRestoreUntil,
  which nothing has read since AdaptiveLighting 2.17.0. The
  FADE-SAVE line still shows manual= (read from AL's state)

### 6.13 — 2026-10-27 — Don't start while another fade is running

- If countdown_to_zero fired while a watchdog fade (or an
  earlier run) was still dimming the light, the save step
  overwrote _SavedDim/_SavedTemp/_FadeTargets with the
  half-faded values, and a following restore brought the
  light back too dim. Seen as possible in E9, where the door
  can hold the zone active after the last motion
- Now: _FadeActiveUntil in the future → FADE-SKIP "fade
  already in progress", nothing saved, nothing sent. Same
  guard Room_watchdog has had since 2.x. RestoreSavedSettings
  zeroes the flag, so a restored fade never blocks
- The override check no longer needs its own mid-fade test

### 6.12 — 2026-10-19 — Log overrides to AL_OverrideLog before fading

- Compares the light's values with AdaptiveLighting's
  lastApplied; a difference (dim > 10 points, colour > 15)
  is an override — Hue dimmer switch, app, voice, button —
  and gets one src=fade line for preset tuning
- Motion rooms (E9/B9/B7) never run AL's check mode, so
  switch-off is the only moment their overrides are seen
- Skipped while AL's own transition or a previous fade is
  still running (values are in between, not overridden)

### 6.11 — 2026-09-04 — Cache fade targets for a faster restore

- Saves the exact bulbs being faded (id + name) in
  ${deviceId}_FadeTargets so RestoreSavedSettings v4.2
  can restore by ID without fetching any devices
- Aborts before sending the fade if a restore already
  happened during the (slow) member lookup — previously
  the fade command was sent anyway and undid the restore

### 6.10 — 2026-07-06 — Fix: setTimeout is not defined in HomeyScript

- The post-fade wait and 3s verify wait used
  `new Promise(r => setTimeout(r, ...))`; HomeyScript has
  no setTimeout, so every run threw ("setTimeout is not
  defined") right after starting the hardware fade — the
  light dimmed to 0 but onoff was never set false and
  _FadeActiveUntil was left stale (seen as FADE-ERROR in
  AL_DiagnostikLog for E9 Loft/Garderobe + B9 Lys)
- Switched both waits to the built-in async wait(ms)

### 6.9 — 2026-07-05 — Multi-device argument + log silent cancel path

- args[0] can now be a comma-separated device ID list;
  each device is faded/turned off in parallel within the
  SAME script invocation (Promise.all), instead of one
  script per device
- Reduces concurrent long-running scripts touching the
  same room (e.g. E9 Loft + E9 Garderobe), which lowers
  the chance of two independent fade/restore cycles
  racing on the same device's hardware transition
- "Cancelled by restore" early-exit now also calls
  diagLog() (was log()-only, invisible in
  AL_DiagnostikLog) - records whether the exit was a
  real _RestoredAt restore or a bare cleared flag, so a
  stalled/raced fade can be told apart from a genuine
  motion-triggered cancel

### 6.8 — 2026-06-10 — Turn-off completion logging + verify/resend

- Logs FADE-OFF when the turn-off actually executes, so a
  dead script run (no FADE-OFF) is distinguishable from a
  turn-off that got undone afterwards
- 3s later re-checks the device: if Homey still shows it on
  (lost command or late Zigbee report flipping state back)
  resends off — unless the zone is active or a restore ran

### 6.7 — 2026-06-10 — Skip fade entirely when the light is already off

- An off light can still report dim>0, so the dim-to-0
  flow card could briefly switch it on to "fade" it
- Also avoids saving state and opening a restore window
  for a light that was never on

### 6.6 — 2026-06-10 — Restore wins: hold turn-off when zone is active at fade end

- If someone walks in (door/motion) during the fade, skip
  the turn-off and LEAVE the fade window open so the
  pending RestoreSavedSettings restores brightness
- Restore window buffer extended 2s → 15s: restore often
  executes ~10s after the zone-active trigger and used to
  miss the window entirely (fast-path skip, no restore)

### 6.5 — 2026-06-10 — Reliable turn-off: check _RestoredAt instead of flag==0

- RestoreSavedSettings' stale-cleanup used to zero an
  already-expired _FadeActiveUntil right around wake-up,
  mimicking the "restore cancelled me" signal — turn-off
  was skipped and lights stuck at mid-fade dim
- Now skips turn-off only if a real restore happened
  (_RestoredAt >= fade start) or flag was genuinely cleared
- Turn-off failures now logged to AL_DiagnostikLog

### 6.4 — 2026-04-19 — Explicitly turn off lights after fade completes

- Waits for fade duration, then sets onoff:false on all targets
- Re-checks _FadeActiveUntil: if cleared by RestoreSavedSettings
  (motion returned), skips turn-off
- Fixes watchdog firing as backup because normal flow never
  actually turned lights off (only set dim=0, onoff stayed true)

### 6.3 — 2026-03-31 — Read manual mode from per-device state variable

- Reads AL_Device_<key>.State instead of combined AL_DeviceStates
- Faster: only parses one device's state, not the entire blob

### 6.2 — 2026-03-04 — Persistent diagnostic logging (AL_DiagnostikLog)

- Logs fade events with timestamp, device, brightness, manual mode
- Shared log variable with RestoreSavedSettings and AdaptiveLighting
- Helps diagnose unexpected dim-light issues across profile transitions

### 6.1 — 2026-03-02 — Save manual mode state for restore coordination

- Reads AdaptiveLighting's manual mode flag before fade
- Stores as _SavedManualMode for restoresavedsettings.js
- Enables preserving user adjustments on motion re-detection

### 6.0 — 2026-02-25 — Fix: use Flow Card action for hardware fade

- setCapabilityValue ignores duration option in HomeyScript
- Group device has duration:false, members have duration:true
- Must target individual members via runFlowCardAction
- URI format: homey:device:ID, not homey:flowcardaction:...
- Zone-based fallback for groups with different member names
  (e.g. "B9 Lys" → "B9 Wall 1/2/3")

### 5.2 — 2026-02-10 — Switch to setCapabilityValue with duration (BROKEN)

- More direct control than Flow Card
- Fixes issue where duration was ignored on some devices

### 5.1 — 2026-01-14 — Parallel fade for group members

- All bulbs start fading simultaneously
- Uses Promise.all() for parallel execution
- Smoother, more synchronized fade effect

### 5.0 — 2026-01-07 — Complete rewrite using hardware fade

- Uses Homey flow card with duration (bulb handles fade)
- Script exits immediately (non-blocking)
- Supports groups (applies fade to individual members)
- Uses timestamp instead of boolean for fadeActive
- Timestamp auto-expires (no stale flags)
- Smooth, precise timing regardless of API latency

### 4.1 — 2026-01-07 — Fix race condition with RestoreSavedSettings

### 4.0 — 2025-12-22 — Reusable for any device, accepts device ID as argument

## RestoreSavedSettings

`restoresavedsettings.js`

### 4.6 — 2026-10-28 — Group detection from the device driver

- Fallback path (no cached fade targets) uses the shared
  GROUPS block (same as AdaptiveLighting 2.29.3): group =
  Homey's virtual group driver, not "lacks
  button.migrate_v3"; a single Hue bulb skips the device-list
  fetch; the zone fallback is logged as RESTORE-ZONE-FALLBACK

### 4.5 — 2026-10-28 — Strict argument checking

- The argument must look like a Homey device id (UUID);
  otherwise RESTORE-BADARG and nothing happens
- No argument still restores B9 Lys (editor test runs) but
  logs RESTORE-DEFAULT-ID, so an empty flow card shows up

### 4.4 — 2026-10-28 — Remove the dead manual-mode hand-off

- _SavedManualMode (from GradualFadeOut/watchdog) was turned
  into _ManualRestoreUntil, which nothing has read since
  AdaptiveLighting 2.17.0. Neither is written any more; the
  RESTORE line's manual= now comes from AL's own state
- Log line no longer claims "AdaptiveLighting will respect
  restored values" (the real guard is _RestoredAt +
  restoreGraceSeconds)

### 4.3 — 2026-10-27 — Errors reach AL_DiagnostikLog

- The outer catch only logged to the console, which flow
  runs never show — now also RESTORE-ERROR | <id> |
  unexpected: <message>
- Fallback path: "device not found" logs RESTORE-ERROR
  (the light was left faded with no trace)
- RESTORE-PARTIAL | <name> | n/m failed: <bulbs> when only
  some bulbs fail; RESTORE-ERROR when all fail. Cached path
  logged all-failed only, fallback group path logged nothing

### 4.2 — 2026-09-04 — Faster restore: use fade targets cached by GradualFadeOut

- GradualFadeOut/watchdog v6.11/v2.10 now save the exact
  list of bulbs they faded in ${deviceId}_FadeTargets
- Restore reads that list and sends the restore commands
  straight away: no getDevice() and no getDevices() (the
  full device dump was the slowest step, and B9 always hit
  it because "B9 Lys" needs the zone fallback)
- Flag clear + _RestoredAt now happen before ANY API call,
  so AdaptiveLighting can't read a half-updated state
- Dim and temperature are sent in parallel per bulb
- Old discovery path kept as fallback when no cached
  targets exist (e.g. restore raced the fade-out's
  member lookup)

### 4.1 — 2026-06-10 — Explicit restore marker; keep expired fade flag intact

- Real restore now sets ${deviceId}_RestoredAt timestamp
- Fast path no longer zeroes _FadeActiveUntil: the stale
  cleanup raced GradualFadeOut/watchdog's post-fade check,
  which read flag==0 as "restore happened" and skipped the
  final turn-off (lights stuck at mid-fade dim until the
  watchdog cleaned up minutes later)

### 4.0 — 2026-04-19 — Cancel hardware fade via flow card (not setCapabilityValue)

- Plain setCapabilityValue('dim', X) doesn't interrupt an
  in-progress Zigbee move_to_level transition on many bulbs
- Now uses runFlowCardAction with duration: 0.5s to force a
  new hardware transition that overrides the running fade
- Fixes lights continuing to fade when motion returns mid-fade

### 3.9 — 2026-03-20 — Fast path: skip without API call when no fade active

- Checks _FadeActiveUntil BEFORE fetching device from Homey
- No-fade skip now avoids Homey.devices.getDevice() entirely
- Saves ~200-500ms per call in the common case (no active fade)
- Removed verbose logging from skip path

### 3.8 — 2026-03-20 — Clear stale saved values when fade has expired

- On skip (no active fade), clears _SavedDim, _SavedTemp, _SavedManualMode
- Prevents stale values from being accidentally restored later

### 3.7 — 2026-03-04 — Persistent diagnostic logging (AL_DiagnostikLog)

- Logs restore events with timestamp, device, brightness, manual mode
- Shared log variable with GradualFadeOut and AdaptiveLighting
- Helps diagnose unexpected dim-light issues across profile transitions

### 3.6 — 2026-03-02 — Zone-based fallback for group member detection

- Name-based matching fails for B9 ("B9 Lys" vs "B9 Wall 1/2/3")
- Zone fallback finds members in same zone when names don't match
- Matches GradualFadeOut v6.0 group detection logic
- Ensures hardware fade is properly cancelled on all member bulbs

### 3.5 — 2026-03-02 — Preserve manual mode on restore

- Reads _SavedManualMode flag set by GradualFadeOut
- Sets short-lived _ManualRestoreUntil timestamp
- Signals AdaptiveLighting to skip profile application
- Ensures user's manual brightness adjustments survive fade/restore

### 3.4 — 2026-02-04 — Fix race condition with AdaptiveLighting

- Clear fade timestamp BEFORE restoring settings
- Ensures AdaptiveLighting sees cleared flag when triggered by turn-on

### 3.3 — 2026-01-14 — Parallel restore for group members

- All bulbs restore simultaneously
- Uses Promise.all() for parallel execution
- Instant, synchronized restore

### 3.2 — 2026-01-09 — Fix restore skip logic

- Only restore if fade is ACTUALLY active (timestamp not expired)
- Prevents restoring old values from expired fades
- Fixes issue where old saved brightness was restored on motion

### 3.1 — 2026-01-07 — Extend timestamp instead of clearing

- Prevents AdaptiveLighting from overriding restored values
- 3 second buffer allows "light turned on" trigger to complete
- Then timestamp expires and normal operation resumes

### 3.0 — 2026-01-07 — Updated for hardware fade (timestamp-based)

- Uses fadeActiveUntil timestamp instead of boolean
- Timestamp auto-expires (no stale flags)
- Restores to group members for smooth cancel
- No race condition with GradualFadeOut

### 2.1 — 2024-12-22 — Added detailed error handling and logging

## Room_watchdog

`room_watchdog.js`

### 2.19 — 2026-11-03 — ROOMS and the turn-on reading shared with GradualFadeOut 6.20

- The 2.17 known limit is fixed there: a countdown armed when
  the room emptied no longer fades a light switched on while
  nobody is seen (E9, 2 Nov: on at 09:00:48, FADE-SAVE at
  09:01:35). GradualFadeOut logs FADE-SKIP-UNSEEN and leaves
  the light to this script's 900 s
- A ROOMS block and a TURN-ON block (SEEN_BEFORE_ON,
  UNSEEN_MIN_ON, AUTO_OFF_WINDOW, turnOnInfo(lightId)) are now
  the same in both scripts; change both together. Behaviour
  here unchanged

### 2.18 — 2026-11-03 — Motion at fade end: restore even when onoff reads off (as GradualFadeOut 6.19)

- 2.15 left a light that read off alone, as "switched off by
  hand". But Homey sets onoff false the moment a dim-to-0
  fade starts, so someone who came in could be left at ~0 %
- An off by hand during the fade with motion in the room
  now comes back on; press off once more

### 2.17 — 2026-11-03 — A light switched on while nobody is seen gets 15 minutes

- B9, 3 Nov: the Hue dimmer switch turned B9 Lys on at
  07:23:24; neither motion sensor had changed since
  06:51:41, so the 07:24:00 run logged idle=1939s and faded
  the light 36 s after it came on. The person was first seen
  at 07:26:13
- Turn-on time: AdaptiveLighting's lastApplied.at when via is
  "normal" (B7/B9/E9 run AL only from "turned on") and it is
  at most a minute ahead; else unknown. Not onoff.lastChanged
  (probably not in HomeyScript's capabilitiesObj) nor
  lastUpdated (moves on every same-value report). While AL's
  turn-on run holds its lease → decide next minute. A lease
  more than 65 s ahead (AL's run 60 s) is ignored: a clock
  step or a corrupt state must not block the fade for good
- Idle counts from the latest of the last motion, the turn-on
  and (E9) the door's last change
- Seen: turn-on unknown (exactly as 2.16), a motion change
  from SEEN_BEFORE_ON (60 s) before the turn-on, or in E9 the
  door (E9 Dør) changing then (read only when motion hasn't
  seen anyone). A door that can't be read or has no change
  time is not seen (WATCHDOG-ERROR naming it, at most every
  10 min)
- Not seen: no fade before UNSEEN_MIN_ON (900 s) after the
  turn-on (less only under the flapping cap); one
  WATCHDOG-UNSEEN line per turn-on, and WATCHDOG-FADE says
  "(nobody seen since on)". Seen later → the room's
  threshold from that motion, as before
- Flapping cap: a light that keeps coming back on while
  nobody is seen is faded at the latest UNSEEN_MAX_HOLD
  (1800 s) after the first unseen turn-on of the stretch. A
  turn-on continues the stretch only with the same last
  motion (E9: door untouched), no automatic off in between,
  and within the 1800 s; else it starts a new stretch with
  its full 900 s (a night visit faded at 03:15 must not cut
  the 07:23 one short). One record per room
  (AL_WatchdogUnseen_<room>), written only when it changes
- Flip-back: on within AUTO_OFF_WINDOW (180 s) of
  GradualFadeOut's (6.18) or the watchdog's own off
  (${id}_AutoOffAt, now stamped at WATCHDOG-OFF and at the
  "already very dim" off) — a late Hue/Zigbee report or
  someone pressing on right after — gets the room's
  threshold from the turn-on, never the flapping cap, no
  UNSEEN line, and WATCHDOG-FADE says "(flip-back after
  auto-off)"
- No motion timestamp but a turn-on: faded 900 s after it
  (was "no motion timestamp available" for ever)
- Before fading: wait 5 s, then read the light, the motion
  sensors, a fade in progress and AL's state again. Off,
  motion, a fade started (GradualFadeOut) or a turn-on
  started or recorded meanwhile → no fade, the next minute
  decides; otherwise the fade uses the fresh light values

### 2.16 — 2026-10-28 — Group detection from the device driver

- Shared GROUPS block (same as AdaptiveLighting 2.29.3): a
  group is Homey's virtual group driver, not "lacks
  button.migrate_v3"; the zone fallback (still excluding the
  extra lights) is logged as WATCHDOG-ZONE-FALLBACK

### 2.15 — 2026-10-28 — Never leave an occupied room at ~0% (as GradualFadeOut 6.16)

- Motion at fade end: keep the restore window open, wait up
  to HOLD_WAIT_SECONDS (10 s) for RestoreSavedSettings, and
  restore what it didn't (WATCHDOG-SELF-RESTORE), each light
  — primary and extra lights — to its own saved values.
  No wait when the zone was already active at fade start
  (E9 door open: no zone trigger, so no restore can come).
  A light switched off by hand during the fade stays off
- Zone active WITHOUT motion (an open door): no restore,
  turn-off skipped as before. A door left ajar keeps the
  zone active; restoring would fade and restore every couple
  of minutes. A later minute turns the light off
- Verify step: light off 3 s after the off and motion now →
  switch it back on (motion only, for the same reason)

### 2.14 — 2026-10-28 — Log missing or unknown room arguments

- An unknown room returned an error string only (invisible
  in flow runs); now WATCHDOG-BADARG in AL_DiagnostikLog
- No argument still checks B9 (editor test runs) but logs
  WATCHDOG-DEFAULT. Each argument at most once per
  ERROR_LOG_INTERVAL (one timestamp per argument in
  AL_WatchdogArgWarningAt) — the flow runs every minute

### 2.13 — 2026-10-28 — Stop writing ${id}_SavedManualMode (primary and extra lights)

- Same as GradualFadeOut 6.14: its only reader turned it into
  _ManualRestoreUntil, unread since AdaptiveLighting 2.17.0.
  WATCHDOG-FADE still shows manual= from AL's state

### 2.12 — 2026-10-27 — Errors reach AL_DiagnostikLog

- The script had no top-level catch: an unknown light or
  motion-sensor id (e.g. after re-pairing for the Hue Bridge
  Pro) threw on every run and left no trace, silently
  disabling that room's safety net
- Main body wrapped in try/catch → WATCHDOG-ERROR | <room> |
  <message>, at most once per room per ERROR_LOG_INTERVAL
  (10 min; last time in AL_WatchdogErrorAt_<room>)
- The B7/B9/E9 flows now only run the watchdog while some
  light in the zone is on (was every minute, ~4,300 runs/day)

### 2.11 — 2026-10-19 — Log overrides to AL_OverrideLog before fading

- Same check as GradualFadeOut v6.12: the primary light's
  values vs AdaptiveLighting's lastApplied; a difference
  gets one src=watchdog line for preset tuning

### 2.10 — 2026-09-04 — Cache fade targets for a faster restore

- Saves the bulbs being faded in ${deviceId}_FadeTargets
  (primary light: its members; each extra light: itself)
  so RestoreSavedSettings v4.2 can restore by ID without
  fetching any devices — matches GradualFadeOut v6.11

### 2.9 — 2026-07-06 — Fix: setTimeout is not defined in HomeyScript

- The post-fade wait and 3s verify wait used
  `new Promise(r => setTimeout(r, ...))`; HomeyScript has
  no setTimeout, so the watchdog threw right after starting
  the fade and never reached the turn-off — leaving the
  backup path as dead as the primary fade
- Switched both waits to the built-in async wait(ms)

### 2.8 — 2026-07-05 — Log the silent "cancelled by restore" exit

- That branch only called log() before, invisible in
  AL_DiagnostikLog - now also diagLogs whether the exit
  was a real _RestoredAt restore or a bare cleared flag,
  so a stalled/raced fade can be told apart from a
  genuine motion-triggered cancel

### 2.7 — 2026-06-10 — Turn-off completion logging + verify/resend

- Logs WATCHDOG-OFF when the turn-off actually executes
- 3s later re-checks the primary light: if Homey still
  shows it on (lost command or late Zigbee report),
  resends off — unless the room became active

### 2.6.1 — 2026-06-10 — Docs: setup comment said "Every 2 minutes" — the actual flows trigger every 1 minute

### 2.6 — 2026-06-10 — Restore wins: hold turn-off when room is active at fade end

- Motion or zone activity (door) at fade end now skips the
  turn-off and LEAVES the fade window open, so the pending
  RestoreSavedSettings restores brightness (previously the
  flags were zeroed, making the late restore a no-op)
- Restore window buffer extended 2s → 15s (matches
  GradualFadeOut v6.6)

### 2.5 — 2026-06-10 — Reliable turn-off + error visibility

- Skip turn-off via _RestoredAt marker instead of flag==0
  (expired flags used to be zeroed by restore's stale
  cleanup, faking a "restore happened" signal)
- Re-checks motion sensors right before turn-off: a person
  returning while the zone stayed active (e.g. door kept it
  active) fires no restore, so don't turn off on them
- Fade/turn-off/target-collection failures now logged to
  AL_DiagnostikLog (WATCHDOG-ERROR) instead of swallowed

### 2.4 — 2026-03-31 — Read manual mode from per-device state variable

- Reads AL_Device_<key>.State instead of combined AL_DeviceStates
- Faster: only parses one device's state, not the entire blob

### 2.3 — 2026-03-30 — Skip turn-off if fade was cancelled by motion

- After fade wait, checks if _FadeActiveUntil was cleared
- RestoreSavedSettings clears flag on motion → watchdog skips turn-off
- Prevents turning off lights when someone walked in during fade

### 2.2 — 2026-03-30 — Explicitly turn off lights after fade completes

- Waits for fade duration, then sets onoff:false on all targets
- No longer relies on next watchdog cycle to clean up

### 2.1 — 2026-03-20 — Add 60s grace period on top of inactivity threshold

- Prevents watchdog from racing with the normal inactivity flow
- Watchdog now triggers at inactivitySeconds + 60s

### 2.0 — 2026-03-19 — Refactored from B9-only to multi-room support

### 1.0 — 2026-03-19 — Initial version - B9 safety net

## AL_FreeDay

`al_free_day.js`

### 1.0 — 2026-10-28 — Initial version (with AdaptiveLighting 2.30.1)

## AL_CleanupGlobals

`al_cleanup_globals.js`

### 1.0 — 2026-10-28 — Initial version (with AdaptiveLighting 2.29.1)

## LightDiagnostics

`lightdiagnostics.js`

### 1.5 — 2026-10-28 — Drop dead flags: the legacy ${id}_FadeActive (not written since GradualFadeOut 5.0) and ${id}_SavedManualMode (not written since GradualFadeOut 6.14 / watchdog 2.13 — the manual flag is AL's own, shown above)

### 1.4 — 2026-03-31 — Show full device picture including GradualFadeOut state

- Shows SavedDim, SavedTemp, FadeActiveUntil, SavedManualMode
- Raw state dump includes both AL state and external variables

### 1.3 — 2026-03-31 — Per-device state variables (AL_Device_<key>.State)

- Reads device index from AL_DeviceKeys
- Reads each device state individually
- Shows forced profile index when active

### 1.2 — 2026-03-31 — Read unified device state (fadeEndTime, forcedProfile)

### 1.1 — Initial — Basic diagnostics for manual mode and fade timers

