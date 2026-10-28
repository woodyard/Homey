// Every script must load in HomeyScript: parse as an async function body and
// never call setTimeout/setInterval (HomeyScript has neither — use await wait(ms))
import fs from 'node:fs';
import { scriptFiles, scriptPath } from '../mock.mjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Remove comments so version-history notes about setTimeout don't count
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

export const scenarios = {
  async 'all scripts parse as HomeyScript'(t) {
    for (const f of scriptFiles()) {
      let error = null;
      try { new AsyncFunction('args', 'Homey', 'global', 'log', 'wait', fs.readFileSync(scriptPath(f), 'utf8')); } catch (e) { error = e.message; }
      t.check(!error, `${f} parses`, error);
    }
  },

  async 'no setTimeout or setInterval calls'(t) {
    for (const f of scriptFiles()) {
      const code = stripComments(fs.readFileSync(scriptPath(f), 'utf8'));
      const hit = /\b(setTimeout|setInterval)\s*\(/.exec(code);
      t.check(!hit, `${f} uses wait() instead`, hit && `found ${hit[1]}(`);
    }
  },
};
