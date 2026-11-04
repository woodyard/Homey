# Offline test harness

Runs `room_heating.js` under Node with a mocked Homey API (devices, zones, Logic variables,
notifications), a fixed clock (Wednesday 2026-01-21 10:00 Copenhagen unless a scenario moves it)
and a fixed set of devices for three rooms: Clara (two smart-plug radiators), Stue and Soveværelse
(one TADO valve each). Scenarios that move the clock move the sensors' default timestamps with it.
As in HomeyScript's sandbox, the script gets `wait(ms)` and `setTimeout` throws. A scenario with
`concurrent` runs several rooms at once.

    node harness.mjs ../room_heating.js clara_auto_cold          # one scenario, JSON trace
    node harness.mjs ../room_heating.js clara_auto_cold --logs   # plus the script's log output
    node harness.mjs ../room_heating.js clara_auto_cold --count-calls  # Homey API reads per run (stderr)
    ./run_all.sh ../room_heating.js out_new                      # every scenario into a directory
    node summary.mjs out_new                                     # one line per scenario
    node compare.mjs out_baseline out_new                        # semantic diff per scenario
    node check_status_fields.mjs ../room_heating.js              # window timestamps in HeatingStatus
    node check_waits.mjs ../room_heating.js                      # every wait works without setTimeout
    node harness.mjs ../room_heating.js stue_boost_active --then-status=../room_heating_status.js
                                                                 # then run the status script on the same mocks

To verify a refactor is behaviour-preserving, run the previous version into `out_baseline`,
the new version into `out_new`, and `node compare.mjs out_baseline out_new`. Flags:
`--ignore-baseline`, `--ignore-key=name,...` (drop a key anywhere) and `--ignore-global=substr,...`
(drop globals by key substring) hide fields that are expected to differ.

The trace records commands sent to devices, notifications, Logic variable writes, final device
state and the final globals (with volatile timestamps normalised). Log text is not part of the
trace, so wording changes do not show up as differences.
