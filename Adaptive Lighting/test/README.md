# Offline tests

Runs the Adaptive Lighting HomeyScripts under Node against a mocked Homey, so a change can be
checked before it is copied to Homey. **Run it before pasting a script into HomeyScript.**

    node "Adaptive Lighting/test/run.mjs"                    # everything (~2 s)
    node "Adaptive Lighting/test/run.mjs" expiry status      # only scenario files containing a word
    node "Adaptive Lighting/test/run.mjs" --verbose          # also list passing checks
    node "Adaptive Lighting/test/run.mjs" --scripts=<dir>    # test another copy of the scripts

It prints one line per scenario and exits with code 1 if any check fails. Needs Node 18+, no
packages.

## How it works

`mock.mjs` runs a script file the way HomeyScript does: the file body inside an async function
with `args`, `Homey`, `global`, `log` and `wait`. `setTimeout` and `setInterval` are replaced by
functions that throw, because HomeyScript has neither (that crashed three scripts in 2026).

- **Homey**: lights whose values change when a command reaches them, motion, door contact and lux sensors,
  device flow cards (dim/temperature with duration, also listed in `env.cards`), zones, and Logic variables with every call
  recorded. Devices can be made unreachable (`env.unreachable.add(id)`). With
  `env.deviceListDelayMs = 50`, `getDevices` answers 50 real ms later and `getDevice`/`getDevices`
  return copies of the devices as they were when asked (as Homey's API does), so two runs for
  one light overlap the way they do on a busy Homey. `env.commandDelayMs = 40` makes each device
  command land 40 real ms after it is sent.
- **global**: one in-memory store shared by all script runs in a scenario, like HomeyScript's
  (`get`, `set`, `keys`; `set(key, undefined)` removes the key).
- **Clock**: `setClock('2026-10-27T21:00:00+01:00')` sets what `new Date()` and `Date.now()`
  return inside the scripts. Use Copenhagen local time with its offset (+01:00 winter,
  +02:00 summer). The runner sets TZ=UTC like Homey, so 00:00–02:00 Copenhagen is the
  previous day in UTC, as on the real box. `wait()` returns at once; with `env.waitAdvancesClock = true` it moves
  the clock forward, and `env.onWait = async (ms) => {}` lets a test act during a wait
  (motion appearing, a restore arriving).
- **Inspect**: `env.state(id)` (AL device state; `env.setState(id, state)` stores one without
  running AL), `env.diag()` (AL_DiagnostikLog lines),
  `env.status()` (parsed AdaptiveLightingStatus), `env.dev(id)` (live capability values),
  `env.commands`, `env.logicCalls`, `env.logs`.
- `env.run(script, arg, { patch })` can switch a setting for one test, e.g.
  `{ patch: [['enableDetailedLogging: false', 'enableDetailedLogging: true']] }`. Scripts are
  loaded with LF line endings (a Windows checkout has CRLF), so patch targets use `\n`.

## Scenarios

| File | Covers |
|---|---|
| `status.mjs` | AdaptiveLightingStatus: create once, no write when unchanged, no call on gated runs, manual/clear/forced, rebuild not merge, failure back-off, parallel first publish, hourly heartbeat, daylight + sun values |
| `manual_expiry.mjs` | Manual mode ends at Night: Evening keeps it, Night override sticks, overnight (>12 h), pre-2.29 state, forced profile, kitchen 22:00, light already near Night values, failed apply |
| `schedules.mjs` | Weekend set from Friday noon to Sunday noon; holidays from Room Heating's calendar (school holidays for the kids' rooms only, fixed and Easter-based public holidays for every room with weekend profiles, the reason in the log tag, Saturday/Sunday only without a readable calendar); sun colour across the seasons (entrance; the kids' rooms have none since 2.32.4), the kids' rooms' Daytime at 100 %/0.1 all year with the kids' 100 %/coolest not counted as manual (other kids' profiles unchanged), entrance Daytime from 07:00 on weekdays (weekends unchanged), kitchen Evening 20-23 at 70 % and B9 bright until 23:00 with Night from midnight (B7 unchanged), Claras værelse's two lights agree; sun-based boundaries (sunrise+30, sunset-60) within 2 min of the true København times in every season — AL computes sunrise/sunset itself, the mock's geolocation gives none, as on Homey (13 days off before 2.32.4) |
| `free_day.mjs` | `al_free_day.js` (AL_FreeDay, the B9/E9 timeout condition): answers at 06:00/07:30 on working days, weekends and public holidays (not school holidays), noon rule, agrees with AL's weekend set for E9 Loft, Saturday/Sunday only without a readable calendar, FREEDAY line on holidays, an argument throws (FREEDAY-BADARG) |
| `fade_watchdog.mjs` | GradualFadeOut "fade already in progress" guard, RestoreSavedSettings partial/missing-device logging, Room_watchdog error rate limit, AL-ERROR / AL-APPLY-FAIL, detailed logging in check mode |
| `dashboard.mjs` | `homey-dashboard/lib/adaptiveLighting.js`: badge mode from the published status, 30 s "Manual?" delay, tooltip text, sunrise/sunset within 2 min of the true København times (1.18.3) |
| `arguments.mjs` | Strict arguments: unknown mode / `off` / malformed id → BADARG and nothing changes, logged once an hour; no argument → default light + DEFAULT-ID line; every mode the live flows use still runs; GradualFadeOut/RestoreSavedSettings/Room_watchdog checks |
| `groups.mjs` | Group/Hue detection from the device driver: a Hue bulb without `button.migrate_v3` stays a single light (E9 Loft still turned off), renamed B9 bulbs found by name, zone fallback logged in GradualFadeOut/RestoreSavedSettings/Room_watchdog, AL-GROUP-NO-MEMBERS once an hour, Hue early start from the driver |
| `self_restore.mjs` | Occupied room: GradualFadeOut doesn't start a fade when the zone is already active, restores itself at fade end when no RestoreSavedSettings arrives (also when onoff reads off — Homey sets it off as the fade starts, 6.19), no double restore, switch back on when someone comes in right after the off (failure logged); Room_watchdog restores each E9 light on motion (no wait when the door was already open), not on an open door alone, also when onoff reads off (2.18) |
| `overlapping_runs.mjs` | Two runs for one light at once (AL 2.31.0): a check or lux poll that starts during a turn-on, clear or cycle-profile backs off at its gate (AL-SKIP-BUSY), also when the other run's commands are still on their way; one already waiting stops at its first save (AL-SKIP-STALE) and the next poll is a full run (a newer lux reading is applied then); a check and a lux run at once: the winner's fade is recorded and the loser backs off, in both orders, and a check that changes nothing doesn't stop a lux run; a poll during the winner's fade still owes the full run; two cycle-profile presses step through two profiles; manual stays cleared, the button's forced profile and light stay, no false OVERRIDE line; a clear keeps what a turn-on saved during it; a dead lease expires after a minute; fade end and group bulbs still saved; runs one after another never back off |
| `early_ramp.mjs` | The poll before a profile change starts the ramp early (AL 2.31.1): the stored boundary is exact to the millisecond, the 19:45/19:50 polls stay quiet, the 19:55 poll ramps into Evening however late in its second the last run recorded, also when it fires up to 10 s early (11 s early waits for 20:00), and the 20:00 poll leaves the ramp alone; a light switched off and on during the ramp gets Evening at the 20:00 poll, as does one switched on without a ramp |
| `check_during_fade.mjs` | A check poll that overlaps the end of a GradualFadeOut fade (AL 2.31.3): its device read predates a RestoreSavedSettings restore or GradualFadeOut's off → AL-SKIP-FADE, not manual; a restore whose commands haven't landed → AL-SKIP-RESTORE for 30 s; the next poll is a full run, so a change by hand right after a restore is still caught; Evening still comes at 20:01 |
| `idle_wake.mjs` | Kitchen idle/wake (AL 2.32.0), K Bord/K Loft as virtual groups of three Hue bulbs: idle follows the living room (16:00 Daytime → stue Evening 35 %, a sun-based reference boundary recorded by idle itself, polled for and ramped into) and only goes down until wake (21:00 → the kitchen's 20 % floor, never above its own profile: Night 15 % stays 15 %, a manual scene capped at 20 % too; kept at 23:00 and 06:00, an up-ramp replaced, a down-ramp caps the floor where it is heading (2 Nov replay: 22:55 ramp to Night 15 %, empty at 22:58 → 15 %, not 20 %; wake's fade up leaves it at 20 %, 2.32.4), a part-way ramp read is no change by hand); wake restores the own profile with a 1 s fade and logs its run time; never a command to a bulb that is off (idle, wake and check runs while idle; auto and manual lights — except a wake that takes over a GradualFadeOut fade, which like RestoreSavedSettings restores every bulb); manual scenes capped per bulb (decided on the group, colour untouched, every bulb noted also below the cap) and restored exactly, temperature/colour only after a RestoreSavedSettings restore; a change by hand while idle (check or wake) → manual + OVERRIDE "\| while idle", back at the profile → a wake; one no check had seen when idle runs → manual, OVERRIDE src=idle; the level of an idle run that died before its record is no change by hand; turn-on/clear/force/cycle-profile end idle (not a skipped turn-on); races (wake during idle's fetch, zone lookup or commands, auto and manual, check STALE/BUSY, a failed wake repaired); idle switched off with a flag stored; a forced-profile light never idles (even with an idle block); GradualFadeOut morning off and RestoreSavedSettings/wake in either order (from 10 % and 35 %, manual scenes above and below the cap), a takeover that finds the light switched off by GradualFadeOut puts `_RestoredAt` back, a restore older than 30 s is no restore; every GradualFadeOut scenario again with Homey's onoff (`[Homey onoff]`: the dim-to-0 card reports the bulbs off at once, AL 2.32.4): a wake that reads the light off mid-fade still takes over — every bulb on at Morning (also the two that read off when one Hue bulb reported itself on again), a manual scene's snapshot bulbs back at their own dims (a bulb off before idle stays off), logged "\| read off mid-fade" |
| `watchdog_turn_on.mjs` | Room_watchdog 2.17–2.19 / GradualFadeOut 6.18–6.20, a light switched on while nobody is seen: the 3 Nov B9 replay (Hue switch at 07:23:24, real B9 Motion timeline: held, 180 s once seen, GradualFadeOut at 07:32:57; a lost countdown still caught at 07:34); unseen → 900 s from the turn-on (B9 day and night), one WATCHDOG-UNSEEN line, its record written once, no 5 s wait while holding; zone-flow turn-on and a slow AL record keep 180 s; seen later → 180 s from that motion; AL's lease (also taken during getVariables) → next minute, a dead one or one further ahead than AL's 60 s ignored; a turn-on more than a minute ahead or from another AL mode ignored; no motion timestamp → 900 s, the next day 900 s again (both unknown as 2.16); E9 door seen and counted as activity, not read when motion saw the turn-on, an unreadable door or one without a change time → not seen, one WATCHDOG-ERROR per 10 min naming it; flip-back after GradualFadeOut's and the watchdog's own off (`_AutoOffAt`, also the watchdog's "already very dim" off) → room threshold from the turn-on, no UNSEEN line, no stretch record, 4 min later a new turn-on, one from before the off is none; flapping capped 1800 s after the first unseen turn-on, a flip-back right after the cap fade gets the room threshold; a stretch ends at a new motion, an automatic off, the E9 door or after 1800 s (the 3 Nov press after a 06:55 unseen turn-on faded at 07:10 → 900 s; an off by hand and on within 30 min stays capped); the 5 s re-check before the fade (a turn-on, motion, an off by hand or GradualFadeOut's fade meanwhile → no fade; the fade saves the values read after the wait); GradualFadeOut stamps `_AutoOffAt` at FADE-OFF and its very-dim off only; GradualFadeOut 6.20 and a countdown armed before the turn-on (the 2.17 known limit): B9 switched on 70 s after the room emptied → FADE-SKIP-UNSEEN, nothing saved or sent, the watchdog fades it at 900 s; the 2 Nov E9 replay (on at 09:00:48, countdown at 09:01:35) leaves both lights to the watchdog, the sensors read once; still faded when someone was seen (a motion change from 60 s before the turn-on, either B9 sensor, motion now, the E9 door), the turn-on is 900 s old, a flip-back, another AL mode, a motion sensor that can't be read, a light outside ROOMS or E9 Garderobe on alone; AL's lease held with nobody seen → left to the watchdog |
| `cleanup.mjs` | Dead flags gone (a leftover `_FadeActive` no longer blocks check mode; no `_SavedManualMode`/`_ManualRestoreUntil` writes) and `al_cleanup_globals.js`: dry run, real run keeps other scripts' keys, index rebuild, batches, empty device list |
| `platform.mjs` | Every script parses as a HomeyScript body and never calls `setTimeout`/`setInterval`; the shared GROUPS block is identical in all four scripts; the ROOMS and TURN-ON blocks are identical in Room_watchdog and GradualFadeOut; the shared FREE DAYS block is identical in AdaptiveLighting and AL_FreeDay |

A scenario file exports `scenarios`, an object of `async (t) => {}` functions. `t.equal(actual,
expected, msg)` compares as JSON; `t.check(condition, msg, detail)` for anything else. Each
scenario starts from `createEnv([...devices])`, so nothing leaks between scenarios.

## Adding a test with a change

When a script changes behaviour, add or update the scenario in the same change, and bump the script's version in its header and add an entry to [CHANGELOG.md](../CHANGELOG.md). A quick way to check a new test is real: break the code on
purpose in a copy (`--scripts=<copy>`) and make sure the test fails.
