// Checks every wait in room_heating.js works in HomeyScript's sandbox (v10.27.1+).
// Usage: node check_waits.mjs ../room_heating.js
// The sandbox offers wait(ms) but no setTimeout, so a run that has to wait would throw. The
// harness now behaves the same way. Before 10.27.1 each case below failed on the box: a room
// that found the HeatingStatus lock taken published nothing, a boost that found the room busy was
// lost, and a command the device had not confirmed on the first read ended as an error.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = process.argv[2] || path.join(here, '..', 'room_heating.js');
const run = (scenario) => {
  const stdout = execFileSync('node', [path.join(here, 'harness.mjs'), script, scenario, '--logs'], { encoding: 'utf8' });
  const [json, logs = ''] = stdout.split('\n----- LOGS -----\n');
  return { ...JSON.parse(json), logs };
};
const lastStatus = (out) => out.logicWrites.at(-1)?.value || {};
const SANDBOX_ERROR = 'setTimeout is not defined';

const checks = [
  ['the script never calls setTimeout or setInterval', () => {
    const code = fs.readFileSync(script, 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    return /\b(setTimeout|setInterval)\s*\(/.test(code) ? 'found a call' : null;
  }],
  ['all rooms on the same cron each publish their entry', () => {
    const out = run('all_rooms_same_cron');
    const rooms = Object.keys(lastStatus(out));
    if (out.thrown) return `thrown: ${out.thrown}`;
    if (out.logs.includes('Diagnostics error')) return 'a run failed in logDiagnostics';
    if (out.logicWrites.length !== 3) return `${out.logicWrites.length} writes, expected 3`;
    return rooms.length === 3 ? null : `entries for ${rooms.join(', ') || 'no room'}, expected 3 rooms`;
  }],
  ['a room waits for the HeatingStatus lock and then publishes', () => {
    const out = run('clara_status_lock_busy');
    return lastStatus(out)['Claras værelse'] ? null : 'no entry written';
  }],
  ['a boost waits for a run in progress instead of being lost', () => {
    const out = run('clara_boost_waits_for_lock');
    if (out.thrown) return `thrown: ${out.thrown}`;
    return out.globals['Claras værelse.Heating.State']?.mode === 'boost' ? null : 'boost not active';
  }],
  ['an unconfirmed command is polled until its timeout, not an error', () => {
    const out = run('stue_verify_timeout');
    if (out.logs.includes(SANDBOX_ERROR)) return SANDBOX_ERROR;
    return out.logs.includes('Not verified within') ? null : 'did not reach the verification timeout';
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  const problem = check();
  if (problem) failed++;
  console.log(`${problem ? 'FAIL' : 'ok  '} ${name}${problem ? `: ${problem}` : ''}`);
}
console.log(`${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
