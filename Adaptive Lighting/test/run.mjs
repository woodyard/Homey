// Runs every scenario in ./scenarios against the scripts in ../ (or --scripts=<dir>).
//
//   node "Adaptive Lighting/test/run.mjs"                 # all scenarios
//   node "Adaptive Lighting/test/run.mjs" expiry status   # only files whose name contains a word
//   node "Adaptive Lighting/test/run.mjs" --verbose       # also print passing checks
//   node "Adaptive Lighting/test/run.mjs" --scripts=<dir> # test another copy of the scripts
//
// Exit code 1 when any check fails.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installClock, restoreClock, setScriptDir } from './mock.mjs';

// Homey's clock runs in UTC: the scripts' Copenhagen conversions must work
// there, not just on a PC in Danish time (00:00–02:00 is a different date in UTC)
process.env.TZ = 'UTC';

// The dashboard lib is an ES module in a package without "type": "module";
// Node says so on every import — not useful here
process.removeAllListeners('warning');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const scriptsArg = argv.find((a) => a.startsWith('--scripts='));
if (scriptsArg) setScriptDir(scriptsArg.slice('--scripts='.length));
const filters = argv.filter((a) => !a.startsWith('--'));

const files = fs.readdirSync(path.join(HERE, 'scenarios'))
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => !filters.length || filters.some((w) => f.includes(w)))
  .sort();

let passed = 0;
let failed = 0;
for (const file of files) {
  const mod = await import(pathToFileURL(path.join(HERE, 'scenarios', file)).href);
  for (const [name, fn] of Object.entries(mod.scenarios)) {
    const results = [];
    const t = {
      check(cond, msg, detail) { results.push({ ok: !!cond, msg, detail }); },
      equal(actual, expected, msg) {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        results.push({ ok, msg, detail: ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` });
      },
    };
    installClock();
    try {
      await fn(t);
    } catch (e) {
      results.push({ ok: false, msg: 'scenario threw', detail: e.stack || String(e) });
    } finally {
      restoreClock();
    }
    const bad = results.filter((r) => !r.ok);
    passed += results.length - bad.length;
    failed += bad.length;
    console.log(`${bad.length ? '✗' : '✓'} ${file.replace('.mjs', '')} › ${name} (${results.length - bad.length}/${results.length})`);
    for (const r of results) {
      if (!r.ok || verbose) console.log(`    ${r.ok ? '✓' : '✗'} ${r.msg}${r.detail ? `\n      ${r.detail}` : ''}`);
    }
  }
}

console.log(`\n${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
