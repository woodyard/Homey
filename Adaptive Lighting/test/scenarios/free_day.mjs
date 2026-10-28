// AL_FreeDay (al_free_day.js 1.0): the flow condition B9 and E9 - Light flow use
// to set their daytime inactivity timeout when AL's Night ends (06:00 on working
// days, 07:30 on free days)
import { createEnv, light, setClock, ID } from '../mock.mjs';

const FREE_DAY = 'al_free_day.js';

// Room Heating's calendar as room_heating_config.js stores it (a JSON string)
const CALENDAR = JSON.stringify({
  schoolHolidays: [
    { from: '2026-10-12', to: '2026-10-16', name: 'Efterårsferie' },
    { from: '2026-12-21', to: '2027-01-01', name: 'Juleferie' },
    { from: '2027-03-22', to: '2027-03-29', name: 'Påskeferie' },
  ],
  publicHolidaysFixed: ['01-01', '06-05', '12-24', '12-25', '12-26', '12-31'],
}, null, 2);

// One condition-card run (no argument) on a fresh Homey; calendar null: no Config.Global
async function freeDay(iso, calendar = CALENDAR, args = []) {
  const env = createEnv([]);
  if (calendar !== null) env.store.set('Config.Global', calendar);
  setClock(iso);
  const result = await env.run(FREE_DAY, args);
  return { result, env };
}

export const scenarios = {
  async 'answers at the 06:00 and 07:30 timeout cards'(t) {
    const cases = [
      ['Wed 28 Oct 06:00 (working day)', '2026-10-28T06:00:00+01:00', false],
      ['Sat 31 Oct 06:00', '2026-10-31T06:00:00+01:00', true],
      ['Sun 1 Nov 07:30', '2026-11-01T07:30:00+01:00', true],
      ['Mon 2 Nov 06:00', '2026-11-02T06:00:00+01:00', false],
      ['Thu 24 Dec 06:00 (Juleaften)', '2026-12-24T06:00:00+01:00', true],
      ['Fri 25 Dec 07:30 (1. juledag)', '2026-12-25T07:30:00+01:00', true],
      ['Fri 1 Jan 06:00 (Nytårsdag)', '2027-01-01T06:00:00+01:00', true],
      ['Fri 26 Mar 06:00 (Langfredag)', '2027-03-26T06:00:00+01:00', true],
      ['Mon 29 Mar 06:00 (2. påskedag, after the clocks went forward)', '2027-03-29T06:00:00+02:00', true],
      ['Thu 6 May 07:30 (Kristi himmelfartsdag)', '2027-05-06T07:30:00+02:00', true],
      ['Mon 17 May 06:00 (2. pinsedag)', '2027-05-17T06:00:00+02:00', true],
      ['Wed 14 Oct 06:00 (school holiday only)', '2026-10-14T06:00:00+02:00', false],
      ['Thu 25 Mar 00:30 (Skærtorsdag; still Wednesday in UTC)', '2027-03-25T00:30:00+01:00', true],
      ['Thu 6 May 00:30 (Kristi himmelfartsdag; Friday after it is a working day)', '2027-05-06T00:30:00+02:00', true],
    ];
    for (const [label, iso, expected] of cases) {
      const { result } = await freeDay(iso);
      t.equal(result, expected, `${label}: ${expected}`);
    }
  },

  async 'noon rule: from 12:00 it answers for tomorrow, as AL'(t) {
    t.equal((await freeDay('2026-10-30T13:00:00+01:00')).result, true, 'Fri 13:00: Saturday ahead → true');
    t.equal((await freeDay('2026-11-01T13:00:00+01:00')).result, false, 'Sun 13:00: Monday ahead → false');
    t.equal((await freeDay('2026-12-23T11:59:00+01:00')).result, false, 'Wed 23 Dec 11:59 → false');
    t.equal((await freeDay('2026-12-23T12:00:00+01:00')).result, true, 'Wed 23 Dec 12:00: Juleaften ahead → true');
  },

  async 'agrees with the weekend set AL picks for E9 Loft (no school holidays)'(t) {
    const times = ['2026-10-14T07:00:00+02:00', '2026-10-31T07:00:00+01:00', '2026-12-24T07:00:00+01:00',
      '2026-12-28T07:00:00+01:00', '2027-03-29T07:00:00+02:00', '2027-05-07T07:00:00+02:00', '2026-12-23T22:30:00+01:00'];
    for (const iso of times) {
      const { result } = await freeDay(iso);
      const env = createEnv([light(ID.E9_LOFT, 'E9 Loft')]);
      env.store.set('Config.Global', CALENDAR);
      setClock(iso);
      const al = await env.run('adaptivelighting.js', ID.E9_LOFT);
      t.equal(result, al.usingWeekendProfile, `${iso}: AL_FreeDay ${result}, AL weekend set ${al.usingWeekendProfile}`);
    }
  },

  async 'no or unreadable calendar: Saturday and Sunday only'(t) {
    for (const [label, calendar] of [['missing', null], ['corrupt', '{not json'], ['without holiday keys', JSON.stringify({ tadoHomeId: 'x' })]]) {
      t.equal((await freeDay('2026-12-24T06:00:00+01:00', calendar)).result, false, `${label}: Juleaften is a working day`);
      t.equal((await freeDay('2026-10-31T06:00:00+01:00', calendar)).result, true, `${label}: Saturday is free`);
    }
  },

  async 'a holiday is logged; plain days are not'(t) {
    const { env } = await freeDay('2026-12-24T06:00:00+01:00');
    t.check(env.diag().some((l) => l.endsWith('FREEDAY | 2026-12-24 | Juleaften')), 'FREEDAY line for Juleaften', env.diag().join('\n'));
    const sat = await freeDay('2026-10-31T06:00:00+01:00');
    const wed = await freeDay('2026-10-28T06:00:00+01:00');
    t.equal([sat.env.diag().length, wed.env.diag().length], [0, 0], 'no lines on a Saturday or a working day');
  },

  async 'an argument is an error, not a silent answer'(t) {
    for (const args of [['school'], ['2026-12-24'], 'x']) {
      let error = null;
      const env = createEnv([]);
      setClock('2026-10-28T06:00:00+01:00');
      try { await env.run(FREE_DAY, args); } catch (e) { error = e.message; }
      t.check(error && error.includes('takes no argument'), `${JSON.stringify(args)}: throws`, error);
      t.check(env.diag().some((l) => l.includes('FREEDAY-BADARG')), `${JSON.stringify(args)}: FREEDAY-BADARG logged`);
    }
    for (const args of [[], [''], ['  '], undefined]) {
      const env = createEnv([]);
      setClock('2026-10-28T06:00:00+01:00');
      t.equal(await env.run(FREE_DAY, args), false, `${JSON.stringify(args)}: no argument, answers false`);
    }
  },
};
