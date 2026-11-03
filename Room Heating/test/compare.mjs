// Semantic comparison of two harness output directories.
// Usage: node compare.mjs <dirA> <dirB> [--ignore-device-state] [--ignore-null-commanded-temp]
// Prints one block per scenario that differs, listing JSON paths with A and B values.

import fs from 'node:fs';
import path from 'node:path';

const [,, dirA, dirB, ...flags] = process.argv;
const IGNORE_DEVICE_STATE = flags.includes('--ignore-device-state');
const IGNORE_NULL_CMD_TEMP = flags.includes('--ignore-null-commanded-temp');
const IGNORE_BASELINE = flags.includes('--ignore-baseline');
// --ignore-key=name[,name...] drops any object key with that name, anywhere in the trace
const IGNORE_KEYS = new Set(flags.filter(f => f.startsWith('--ignore-key=')).flatMap(f => f.slice(13).split(',')));

function dropKeys(o) {
  if (Array.isArray(o)) { o.forEach(dropKeys); return; }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (IGNORE_KEYS.has(k)) delete o[k]; else dropKeys(o[k]); }
}

// --ignore-global=substr[,substr...] drops globals whose key contains any of the substrings
const IGNORE_GLOBALS = flags.filter(f => f.startsWith('--ignore-global=')).flatMap(f => f.slice(16).split(','));

function normalise(j) {
  if (IGNORE_KEYS.size) dropKeys(j);
  const g = j.globals || {};
  for (const k of Object.keys(g)) {
    if (IGNORE_GLOBALS.some(s => k.includes(s))) { delete g[k]; continue; }
    if (IGNORE_DEVICE_STATE && k.includes('.Heating.Device.')) delete g[k];
    if (IGNORE_BASELINE && k.endsWith('.Heating.State') && g[k]?.baseline) delete g[k].baseline;
    if (k.endsWith('.Heating.State') && IGNORE_NULL_CMD_TEMP && g[k]?.baseline && g[k].baseline.commandedTargetTemp === null) {
      delete g[k].baseline.commandedTargetTemp;
    }
  }
  return j;
}

function diff(a, b, p, out) {
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) {
    out.push([p, a, b]); return;
  }
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p ? `${p}.${k}` : k, out);
    return;
  }
  if (a !== b) out.push([p, a, b]);
}

const files = new Set([...fs.readdirSync(dirA), ...fs.readdirSync(dirB)].filter(f => f.endsWith('.json')));
let differing = 0;
for (const f of [...files].sort()) {
  const pa = path.join(dirA, f), pb = path.join(dirB, f);
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) { console.log(`${f}: only in ${fs.existsSync(pa) ? 'A' : 'B'}`); differing++; continue; }
  const a = normalise(JSON.parse(fs.readFileSync(pa, 'utf8')));
  const b = normalise(JSON.parse(fs.readFileSync(pb, 'utf8')));
  const out = [];
  diff(a, b, '', out);
  if (out.length) {
    differing++;
    console.log(`\n### ${f.replace('.json', '')}`);
    for (const [p, va, vb] of out) console.log(`  ${p}\n    A: ${JSON.stringify(va)}\n    B: ${JSON.stringify(vb)}`);
  }
}
console.log(`\n${differing} of ${files.size} scenarios differ`);
