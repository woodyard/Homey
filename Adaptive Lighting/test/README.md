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
  recorded. Devices can be made unreachable (`env.unreachable.add(id)`).
- **global**: one in-memory store shared by all script runs in a scenario, like HomeyScript's.
- **Clock**: `setClock('2026-10-27T21:00:00+01:00')` sets what `new Date()` and `Date.now()`
  return inside the scripts. Use Copenhagen local time with its offset (+01:00 winter,
  +02:00 summer). `wait()` returns at once.
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
| `schedules.mjs` | Weekend set from Friday noon to Sunday noon, sun colour across the seasons, Claras værelse's two lights agree |
| `fade_watchdog.mjs` | GradualFadeOut "fade already in progress" guard, RestoreSavedSettings partial/missing-device logging, Room_watchdog error rate limit, AL-ERROR / AL-APPLY-FAIL, detailed logging in check mode |
| `dashboard.mjs` | `homey-dashboard/lib/adaptiveLighting.js`: badge mode from the published status, 30 s "Manual?" delay, tooltip text |
| `platform.mjs` | Every script parses as a HomeyScript body and never calls `setTimeout`/`setInterval` |

A scenario file exports `scenarios`, an object of `async (t) => {}` functions. `t.equal(actual,
expected, msg)` compares as JSON; `t.check(condition, msg, detail)` for anything else. Each
scenario starts from `createEnv([...devices])`, so nothing leaks between scenarios.

## Adding a test with a change

When a script changes behaviour, add or update the scenario in the same change, and bump the
script's version history as usual. A quick way to check a new test is real: break the code on
purpose in a copy (`--scripts=<copy>`) and make sure the test fails.
