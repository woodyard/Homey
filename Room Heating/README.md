# Room Heating

Per-room heating control for Homey, written as HomeyScript. One script controls every room; the room is chosen by argument. Supports smart-plug radiators (on/off with hysteresis) and TADO valves (target temperature).

## Files

| File | Purpose |
|------|---------|
| `room_heating.js` | The control script. Run with a room name, optionally followed by `boost`, `pause` or `cancel`. |
| `room_heating_config.js` | Room configuration. Edit the `ROOMS` object and run the script once to save it to the `Config.Rooms` global. It checks the configuration first: errors (missing fields, gaps or overlaps between slots, bad dates) stop it before anything is saved; warnings (an evening slot that starts before the day's last slot ends) are listed and saved. |
| `room_heating_status.js` | Prints a status overview for all rooms, from the `HeatingStatus` Logic variable plus live device reads. |
| `add_new_room_wizard.js` | Lists zones and devices to help fill in a new room entry. |
| `cleanup_stale_globals.js` | One-off: removes globals that older versions of the heating script wrote (run once after upgrading past 10.23.0). |
| `CHANGELOG.md` | Version history of every script, newest first. The scripts carry only their current version. |
| `test/` | Mock harness that runs the script offline against fixed scenarios. See below. |

## How it runs

Each room has an Advanced Flow that runs the script with the room name as argument. Triggers: every 5 minutes, zone active, zone inactive for N minutes, window contact open or closed, TADO presence change, and two countdown timers that fire at the window timeouts. Boost, Pause and Reset flows per room run the script with `<room>, boost`, `<room>, pause` or `<room>, cancel`.

Only one run per room executes at a time, guarded by a `<zoneName>.Heating.RunLock` global. A normal run that finds another in progress exits at once; a boost, pause or cancel request waits for its turn so it is never dropped.

A `HeatingEnabled` Logic variable set to false makes the script exit immediately. A `SchoolHoliday` Logic variable set to true makes today count as a holiday. A `HeatingDebugMode` Logic variable set to true sends mode transitions and command verification events as timeline notifications.

## Configuration

Each room in `ROOMS` has:

- `zoneName`: the Homey zone. Heating devices, temperature sensor, motion and window sensors are discovered in this zone and its child zones.
- `heating.type`: `smart_plug` or `tado_valve`. Smart plugs also take `hysteresis` (default 0.5).
- `schedules`: `weekday`, `weekend` and `holiday` slot lists, plus `earlyEvening` (school tomorrow) and `lateEvening` (no school tomorrow). Each slot has `start`, `end`, `target` and `name`.
- `settings`: room defaults for `tadoAwayMinTemp`, `inactivityTimeout` (minutes), `inactivityOffset` (degrees), `windowOpenTimeout` (seconds), `windowClosedDelay` (seconds) and `manualOverrideDuration` (minutes). Optional `sensorStaleMinutes` (default 60): how long the heating may run without a single report from the room temperature sensor before the sensor counts as silent.
- `tadoAwayMinTemp` is the target while away applies to the room, unless the schedule already asks for less: away never raises a target.
- Away applies to a room only while TADO says away AND the room is not in use. When TADO goes away, every room goes to the away target, even one with recent activity: activity from before that (the people leaving, a zone still active) does not count. Activity that starts after TADO went away - someone TADO does not track - brings back the normal schedule in that room; once it has been unused for the slot's `inactivityTimeout` it falls back to the away target, and again only newer activity can pause it.

### Slot overrides

Any slot may override `inactivityTimeout`, `inactivityOffset`, `windowOpenTimeout` or `windowClosedDelay`. The effective value is the slot value if present, otherwise the room default. An `inactivityOffset` of 0 disables the inactivity reduction for that slot.

### School days

A school day is a weekday that is not in one of the `schoolHolidays` date ranges in the config, not a public holiday (`publicHolidaysFixed` in the config, plus the Easter-based Danish holidays computed by the script), and not overridden by the `SchoolHoliday` Logic variable. The holiday ranges are edited once a year from the school's plan. The variable is for ad hoc days and affects today only; tomorrow, which decides the evening slot, comes from the lists.

## Behaviour

On every run the script, in order:

1. Exits if `HeatingEnabled` is false. Reminds once a week, from 30 days before the last `schoolHolidays` range ends, that next school year's holidays should be added.
2. Clears verification baselines if TADO presence changed since the last run.
3. TADO rooms only: checks whether someone turned the valve. The target counts as manual when it differs from what the script last commanded and has moved since the end of the previous run. A slow valve, TADO's own schedule, or an away-mode adjustment is not manual. Smart-plug rooms skip this step; a plug flipped by hand is put back by the schedule on the next run.
4. Handles `cancel`, `pause` and `boost` arguments.
5. If an override mode is active, applies it and exits. If it just expired, resumes the schedule.
6. Otherwise checks the room temperature sensor. It counts as silent when the heating has been on for `sensorStaleMinutes` and the sensor has not reported once in that time (a heated room warms up, so a working sensor reports; a steady reading with the heating off is not a fault). A silent sensor in a smart-plug room keeps the radiators off until it reports again; a TADO room carries on. Both notify once when the sensor goes silent and once when it reports again.
7. Otherwise runs normal control: away target, window open timeout, a fixed settle delay after a long window opening (`windowClosedDelay`, 30 minutes by default), inactivity offset, then hysteresis (smart plug) or target set (TADO).

Device commands are sent once and polled for up to 10 seconds (smart plug) or 30 seconds (TADO) for the reported value. There are no retries; a valve that applies a command late still shows the old target on the next run, which is recognised as slow rather than manual.

Modes are mutually exclusive: `auto`, `boost` (60 min, TADO at 25°C; smart plugs heat until the room reaches 25°C, with the room's hysteresis), `pause` (60 min, all heat off) and `manual` (TADO only, default 90 min, automation does nothing). Manual mode ends early when the valve's smart-schedule flag turns true.

Each run reads all devices, zones, Logic variables and the TADO presence once and reuses them; heating devices are read fresh around commands.

## Notifications

A run collects its changes into one timeline notification, and an identical one within 30 minutes is suppressed. Only exceptions trigger a notification: window open/closed/settled, away/home, boost, pause, manual override and its end, a silent temperature sensor, and the holiday list reminder. Routine changes (smart plugs switching on/off, schedule steps, the room going inactive or active) are only included when an exception is notified in the same run. Set `notifyRoutineChanges: true` in `GLOBAL_CONFIG` to notify them on their own too.

## State

All per-room state lives in one JSON global, `<zoneName>.Heating.State`: mode and expiry, away flag, the last commanded and last seen TADO target, window timestamps, inactivity flag, previous schedule target and slot name, diagnostics throttling, and notification dedup. The run lock lives in `<zoneName>.Heating.RunLock` and is null between runs. `HeatingStatus.Lock` serialises the rooms' writes to the shared `HeatingStatus` variable, and `Heating.HolidayListReminder` records when the holiday list reminder was last sent. A history of significant events is appended to `<zoneName>.Heating.DiagnostikLog`.

On every run the script publishes a per-room status object into the `HeatingStatus` Logic variable (JSON keyed by zone name): mode, schedule type, current period, effective slot settings, next change, scheduled and effective target, current temperature, heating, window (with `windowOpenSince` and, while the settle delay runs, `windowClosedSince`), inactivity, away, last action and timestamp. The web dashboard and the status script both read it; nothing else is written for display.

## Testing offline

`test/harness.mjs` runs the script under Node with a mocked Homey API, fixed clock and fixed devices, and prints the commands sent, notifications, and final state as JSON. `test/run_all.sh <script> <outdir>` runs every scenario and `test/compare.mjs <dirA> <dirB>` lists semantic differences per scenario. To check a change, run the old and new script into two directories and compare them:

```bash
cd "Room Heating/test" && ./run_all.sh ../room_heating.js out_new && node compare.mjs out_baseline out_new
```
