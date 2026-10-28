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

  async 'the shared GROUPS block is identical in all four scripts'(t) {
    const blockOf = (f) => {
      const s = fs.readFileSync(scriptPath(f), 'utf8').replace(/\r\n/g, '\n');
      const a = s.indexOf('// ====== GROUPS — same block');
      const e = s.indexOf('// ====== end of shared GROUPS block ======');
      return a >= 0 && e > a ? s.slice(a, e) : null;
    };
    const files = ['adaptivelighting.js', 'gradualfadeout.js', 'restoresavedsettings.js', 'room_watchdog.js'];
    const ref = blockOf(files[0]);
    t.check(ref, 'adaptivelighting.js has the block');
    for (const f of files.slice(1)) t.check(blockOf(f) === ref, `${f} has the same block`);
  },

  async 'the shared FREE DAYS block is identical in AdaptiveLighting and AL_FreeDay'(t) {
    const blockOf = (f) => {
      const s = fs.readFileSync(scriptPath(f), 'utf8').replace(/\r\n/g, '\n');
      const a = s.indexOf('// ====== FREE DAYS — same block');
      const e = s.indexOf('// ====== end of shared FREE DAYS block ======');
      return a >= 0 && e > a ? s.slice(a, e) : null;
    };
    const ref = blockOf('adaptivelighting.js');
    t.check(ref, 'adaptivelighting.js has the block');
    t.check(blockOf('al_free_day.js') === ref, 'al_free_day.js has the same block');
  },

  async 'no setTimeout or setInterval calls'(t) {
    for (const f of scriptFiles()) {
      const code = stripComments(fs.readFileSync(scriptPath(f), 'utf8'));
      const hit = /\b(setTimeout|setInterval)\s*\(/.exec(code);
      t.check(!hit, `${f} uses wait() instead`, hit && `found ${hit[1]}(`);
    }
  },
};
