// Checks the window timestamps published in HeatingStatus (v10.27.0+).
// Usage: node check_status_fields.mjs ../room_heating.js
// windowOpenSince is set while the window is open, windowClosedSince only while the settle
// delay runs; both reflect the state after this run's window logic. Runs that skip the window
// logic publish the stored values, which can disagree with windowOpen (the boost scenarios).
// The harness normalises a timestamp to 'T', so 'T' means "set" and null means "not set".

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = process.argv[2] || path.join(here, '..', 'room_heating.js');

const expectations = [
  // scenario, room, windowOpenSince, windowClosedSince, lastAction, windowOpen
  ['clara_auto_ok', 'Claras værelse', null, null],
  ['clara_window_open_new', 'Claras værelse', 'T', null],             // opened this run
  ['clara_window_open_timeout', 'Claras værelse', 'T', null, 'window_timeout_off'],
  ['stue_window_still_open', 'Stue / Spisestue', 'T', null, 'window_open_skip'],
  ['clara_window_closed_long', 'Claras værelse', null, 'T', 'window_closed_waiting'],   // settle starts this run
  ['clara_window_closed_brief', 'Claras værelse', null, null],         // too short for a settle delay
  ['clara_settle_waiting', 'Claras værelse', null, 'T', 'window_closed_waiting'],
  ['stue_settle_waiting', 'Stue / Spisestue', null, 'T', 'window_closed_waiting'],
  ['clara_settle_done', 'Claras værelse', null, null],                 // settle ended this run
  ['clara_boost_active', 'Claras værelse', null, null],
  ['clara_boost_window_opened', 'Claras værelse', null, null, undefined, true],   // open, not yet recorded
  ['clara_boost_window_closed', 'Claras værelse', 'T', null, undefined, false],   // closed, record still set
];

let failed = 0;
for (const [scenario, room, open, closed, action, windowOpen] of expectations) {
  const out = JSON.parse(execFileSync('node', [path.join(here, 'harness.mjs'), script, scenario], { encoding: 'utf8' }));
  const writes = out.logicWrites.filter(w => w.value && w.value[room]);
  const entry = writes.length ? writes[writes.length - 1].value[room] : null;
  const problems = [];
  if (!entry) problems.push('no HeatingStatus entry');
  else {
    if (!('windowOpenSince' in entry)) problems.push('windowOpenSince missing');
    else if (entry.windowOpenSince !== open) problems.push(`windowOpenSince=${entry.windowOpenSince}, expected ${open}`);
    if (!('windowClosedSince' in entry)) problems.push('windowClosedSince missing');
    else if (entry.windowClosedSince !== closed) problems.push(`windowClosedSince=${entry.windowClosedSince}, expected ${closed}`);
    if (action && entry.lastAction !== action) problems.push(`lastAction=${entry.lastAction}, expected ${action}`);
    if (windowOpen !== undefined && entry.windowOpen !== windowOpen) problems.push(`windowOpen=${entry.windowOpen}, expected ${windowOpen}`);
  }
  if (problems.length) { failed++; console.log(`FAIL ${scenario}: ${problems.join('; ')}`); }
  else console.log(`ok   ${scenario} (open=${open}, closed=${closed}, action=${entry.lastAction})`);
}
console.log(`${expectations.length - failed}/${expectations.length} passed`);
process.exit(failed ? 1 : 0);
