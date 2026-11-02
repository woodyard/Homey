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

- **Homey**: lights whose values change when a command reaches them, motion and lux sensors,
  device flow cards (dim/temperature with duration), zones, and Logic variables with every call
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
- **Inspect**: `env.state(id)` (AL device state), `env.diag()` (AL_DiagnostikLog lines),
  `env.status()` (parsed AdaptiveLightingStatus), `env.dev(id)` (live capability values),
  `env.commands`, `env.logicCalls`, `env.logs`.
- `env.run(script, arg, { patch })` can switch a setting for one test, e.g.
  `{ patch: [['enableDetailedLogging: false', 'enableDetailedLogging: true']] }`.

## Scenarios

| File | Covers |
|---|---|
| `status.mjs` | AdaptiveLightingStatus: create once, no write when unchanged, no call on gated runs, manual/clear/forced, rebuild not merge, failure back-off, parallel first publish, hourly heartbeat, daylight + sun values |
| `manual_expiry.mjs` | Manual mode ends at Night: Evening keeps it, Night override sticks, overnight (>12 h), pre-2.29 state, forced profile, kitchen 22:00, light already near Night values, failed apply |
| `schedules.mjs` | Weekend set from Friday noon to Sunday noon; holidays from Room Heating's calendar (school holidays for the kids' rooms only, fixed and Easter-based public holidays for every room with weekend profiles, the reason in the log tag, Saturday/Sunday only without a readable calendar); sun colour across the seasons, entrance Daytime from 07:00 on weekdays (weekends unchanged), Claras værelse's two lights agree |
| `free_day.mjs` | `al_free_day.js` (AL_FreeDay, the B9/E9 timeout condition): answers at 06:00/07:30 on working days, weekends and public holidays (not school holidays), noon rule, agrees with AL's weekend set for E9 Loft, Saturday/Sunday only without a readable calendar, FREEDAY line on holidays, an argument throws (FREEDAY-BADARG) |
| `fade_watchdog.mjs` | GradualFadeOut "fade already in progress" guard, RestoreSavedSettings partial/missing-device logging, Room_watchdog error rate limit, AL-ERROR / AL-APPLY-FAIL, detailed logging in check mode |
| `dashboard.mjs` | `homey-dashboard/lib/adaptiveLighting.js`: badge mode from the published status, 30 s "Manual?" delay, tooltip text |
| `arguments.mjs` | Strict arguments: unknown mode / `off` / malformed id → BADARG and nothing changes, logged once an hour; no argument → default light + DEFAULT-ID line; every mode the live flows use still runs; GradualFadeOut/RestoreSavedSettings/Room_watchdog checks |
| `groups.mjs` | Group/Hue detection from the device driver: a Hue bulb without `button.migrate_v3` stays a single light (E9 Loft still turned off), renamed B9 bulbs found by name, zone fallback logged in GradualFadeOut/RestoreSavedSettings/Room_watchdog, AL-GROUP-NO-MEMBERS once an hour, Hue early start from the driver |
| `self_restore.mjs` | Occupied room: GradualFadeOut doesn't start a fade when the zone is already active, restores itself at fade end when no RestoreSavedSettings arrives (not when switched off by hand), no double restore, switch back on when someone comes in right after the off (failure logged); Room_watchdog restores each E9 light on motion (no wait when the door was already open), not on an open door alone, not a light switched off by hand |
| `overlapping_runs.mjs` | Two runs for one light at once (AL 2.31.0): a check or lux poll that starts during a turn-on, clear or cycle-profile backs off at its gate (AL-SKIP-BUSY), also when the other run's commands are still on their way; one already waiting stops at its first save (AL-SKIP-STALE) and the next poll is a full run (a newer lux reading is applied then); a check and a lux run at once: the winner's fade is recorded and the loser backs off, in both orders, and a check that changes nothing doesn't stop a lux run; a poll during the winner's fade still owes the full run; two cycle-profile presses step through two profiles; manual stays cleared, the button's forced profile and light stay, no false OVERRIDE line; a clear keeps what a turn-on saved during it; a dead lease expires after a minute; fade end and group bulbs still saved; runs one after another never back off |
| `early_ramp.mjs` | The poll before a profile change starts the ramp early (AL 2.31.1): the stored boundary is exact to the millisecond, the 19:45/19:50 polls stay quiet, the 19:55 poll ramps into Evening however late in its second the last run recorded, also when it fires up to 10 s early (11 s early waits for 20:00), and the 20:00 poll leaves the ramp alone; a light switched off and on during the ramp gets Evening at the 20:00 poll, as does one switched on without a ramp |
| `check_during_fade.mjs` | A check poll that overlaps the end of a GradualFadeOut fade (AL 2.31.3): its device read predates a RestoreSavedSettings restore or GradualFadeOut's off → AL-SKIP-FADE, not manual; a restore whose commands haven't landed → AL-SKIP-RESTORE for 30 s; the next poll is a full run, so a change by hand right after a restore is still caught; Evening still comes at 20:01 |
| `cleanup.mjs` | Dead flags gone (a leftover `_FadeActive` no longer blocks check mode; no `_SavedManualMode`/`_ManualRestoreUntil` writes) and `al_cleanup_globals.js`: dry run, real run keeps other scripts' keys, index rebuild, batches, empty device list |
| `platform.mjs` | Every script parses as a HomeyScript body and never calls `setTimeout`/`setInterval`; the shared GROUPS block is identical in all four scripts; the shared FREE DAYS block is identical in AdaptiveLighting and AL_FreeDay |

A scenario file exports `scenarios`, an object of `async (t) => {}` functions. `t.equal(actual,
expected, msg)` compares as JSON; `t.check(condition, msg, detail)` for anything else. Each
scenario starts from `createEnv([...devices])`, so nothing leaks between scenarios.

## Adding a test with a change

When a script changes behaviour, add or update the scenario in the same change, and bump the
script's version history as usual. A quick way to check a new test is real: break the code on
purpose in a copy (`--scripts=<copy>`) and make sure the test fails.
