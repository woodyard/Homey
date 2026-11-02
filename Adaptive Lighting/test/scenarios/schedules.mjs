// Profile selection: weekend switch at noon (2.27.3), holidays (2.30.0),
// sun colour (2.24/2.27.4), Claras værelse's two lights agreeing (2.27.2)
import { createEnv, light, setClock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';

// One normal (turn-on) run on a fresh Homey at a given time; globals: values to seed
async function turnOn(id, name, iso, globals = {}, lightOptions = {}) {
  const env = createEnv([light(id, name, lightOptions)]);
  for (const [key, value] of Object.entries(globals)) env.store.set(key, value);
  setClock(iso);
  return env.run(AL, id);
}

// Room Heating's calendar as room_heating_config.js stores it (a JSON string)
const CALENDAR = {
  'Config.Global': JSON.stringify({
    schoolHolidays: [
      { from: '2026-10-12', to: '2026-10-16', name: 'Efterårsferie' },
      { from: '2026-12-21', to: '2027-01-01', name: 'Juleferie' },
      { from: '2027-02-15', to: '2027-02-19', name: 'Vinterferie' },
      { from: '2027-03-22', to: '2027-03-29', name: 'Påskeferie' },
      { from: '2027-05-07', to: '2027-05-07', name: 'Fredag efter Kristi himmelfart' },
    ],
    publicHolidaysFixed: ['01-01', '06-05', '12-24', '12-25', '12-26', '12-31'],
  }, null, 2),
};

export const scenarios = {
  async 'weekend profiles run from Friday noon to Sunday noon'(t) {
    // [time, O Loft profile, SV Loft profile, weekend set?]
    const cases = [
      ['Fri 11:30', '2026-10-30T11:30:00+01:00', 'Daytime', 'Daytime', false],
      ['Fri 12:30', '2026-10-30T12:30:00+01:00', 'Daytime', 'Daytime', true],    // 11:30 in UTC
      ['Fri 18:30', '2026-10-30T18:30:00+01:00', 'Daytime', 'Daytime', true],
      ['Fri 20:30', '2026-10-30T20:30:00+01:00', 'Evening', 'Evening', true],
      ['Fri 22:30', '2026-10-30T22:30:00+01:00', 'Night', 'Evening', true],
      ['Sat 07:00', '2026-10-31T07:00:00+01:00', 'Night', 'Night', true],
      ['Sat 20:30', '2026-10-31T20:30:00+01:00', 'Evening', 'Evening', true],
      ['Sun 07:00', '2026-11-01T07:00:00+01:00', 'Night', 'Night', true],
      ['Sun 18:30', '2026-11-01T18:30:00+01:00', 'Evening', 'Daytime', false],
      ['Sun 20:30', '2026-11-01T20:30:00+01:00', 'Night', 'Evening', false],
      ['Sun 22:30', '2026-11-01T22:30:00+01:00', 'Night', 'Night', false],
      ['Mon 07:00', '2026-11-02T07:00:00+01:00', 'Morning', 'Morning', false],
    ];
    for (const [label, iso, oProfile, svProfile, weekend] of cases) {
      const o = await turnOn(ID.O_LOFT, 'O Loft', iso);
      const sv = await turnOn(ID.SV_LOFT, 'SV Loft', iso);
      t.equal([o.profile, sv.profile, o.usingWeekendProfile, sv.usingWeekendProfile],
        [oProfile, svProfile, weekend, weekend], `${label}: O ${oProfile}, SV ${svProfile}, ${weekend ? 'weekend' : 'weekday'} set`);
    }
  },

  async "school holidays: the kids' rooms get the weekend set, other rooms don't"(t) {
    // Efterårsferie Mon 12 – Fri 16 Oct 2026 (CEST). [time, O Loft, SV Loft, O weekend set?, SV weekend set?]
    const cases = [
      ['Sun 11 Oct 20:30', '2026-10-11T20:30:00+02:00', 'Evening', 'Evening', true, false],
      ['Sun 11 Oct 22:30', '2026-10-11T22:30:00+02:00', 'Night', 'Night', true, false],
      ['Wed 14 Oct 07:00', '2026-10-14T07:00:00+02:00', 'Night', 'Morning', true, false],
      ['Thu 15 Oct 20:30', '2026-10-15T20:30:00+02:00', 'Evening', 'Evening', true, false],
      ['Fri 16 Oct 07:00', '2026-10-16T07:00:00+02:00', 'Night', 'Morning', true, false],
      ['Sun 18 Oct 20:30', '2026-10-18T20:30:00+02:00', 'Night', 'Evening', false, false],
      ['Mon 19 Oct 07:00', '2026-10-19T07:00:00+02:00', 'Morning', 'Morning', false, false],
      ['Mon 19 Oct 00:30', '2026-10-19T00:30:00+02:00', 'Night', 'Night', false, false],   // UTC: still Sunday
      ['Sun 18 Oct 00:30', '2026-10-18T00:30:00+02:00', 'Night', 'Night', true, true],     // UTC: Saturday
      ['Sun 20 Dec 20:30', '2026-12-20T20:30:00+01:00', 'Evening', 'Evening', true, false],
    ];
    for (const [label, iso, oProfile, svProfile, oWeekend, svWeekend] of cases) {
      const o = await turnOn(ID.O_LOFT, 'O Loft', iso, CALENDAR);
      const sv = await turnOn(ID.SV_LOFT, 'SV Loft', iso, CALENDAR);
      t.equal([o.profile, sv.profile, o.usingWeekendProfile, sv.usingWeekendProfile],
        [oProfile, svProfile, oWeekend, svWeekend], `${label}: O ${oProfile}, SV ${svProfile}`);
    }
    const o = await turnOn(ID.O_LOFT, 'O Loft', '2026-10-11T20:30:00+02:00', CALENDAR);
    t.check(o.message.endsWith('[Weekend: Efterårsferie]'), 'tag names the school holiday', o.message);
    for (const [id, name] of [[ID.C_LOFT, 'C Loft'], [ID.C_LIGHTSTRIP, 'C LightStrip']]) {
      const r = await turnOn(id, name, '2026-10-11T20:30:00+02:00', CALENDAR);
      t.equal([r.profile, r.usingWeekendProfile], ['Evening', true], `${name}: school holidays too`);
    }
  },

  async 'public holidays: every room with weekend profiles gets the weekend set'(t) {
    // Easter 2027 is 28 March: Kristi himmelfartsdag Thu 6 May, 2. pinsedag Mon 17 May
    const cases = [
      ['Wed 23 Dec 22:30', '2026-12-23T22:30:00+01:00', 'Evening', true, 'Juleaften'],
      ['Thu 24 Dec 07:00', '2026-12-24T07:00:00+01:00', 'Night', true, 'Juleaften'],
      ['Thu 31 Dec 22:30', '2026-12-31T22:30:00+01:00', 'Evening', true, 'Nytårsdag'],
      ['Wed 24 Mar 22:30', '2027-03-24T22:30:00+01:00', 'Evening', true, 'Skærtorsdag'],
      ['Thu 25 Mar 00:30', '2027-03-25T00:30:00+01:00', 'Night', true, 'Skærtorsdag'],      // UTC: still Wednesday
      ['Thu 25 Mar 22:30', '2027-03-25T22:30:00+01:00', 'Evening', true, 'Langfredag'],
      ['Sun 28 Mar 22:30', '2027-03-28T22:30:00+02:00', 'Evening', true, '2. påskedag'],     // the night clocks go forward
      ['Mon 29 Mar 07:00', '2027-03-29T07:00:00+02:00', 'Night', true, '2. påskedag'],
      ['Mon 29 Mar 22:30', '2027-03-29T22:30:00+02:00', 'Night', false, null],
      ['Thu 2 Apr 2026 22:30', '2026-04-02T22:30:00+02:00', 'Evening', true, 'Langfredag'],    // Easter 2026: 5 April
      ['Sun 1 Apr 2029 22:30', '2029-04-01T22:30:00+02:00', 'Evening', true, '2. påskedag'],   // Easter 2029: 1 April
      ['Wed 5 May 22:30', '2027-05-05T22:30:00+02:00', 'Evening', true, 'Kristi himmelfartsdag'],
      ['Thu 6 May 22:30', '2027-05-06T22:30:00+02:00', 'Night', false, null],
      ['Sun 16 May 22:30', '2027-05-16T22:30:00+02:00', 'Evening', true, '2. pinsedag'],
      ['Mon 17 May 07:00', '2027-05-17T07:00:00+02:00', 'Night', true, '2. pinsedag'],
      ['Mon 17 May 22:30', '2027-05-17T22:30:00+02:00', 'Night', false, null],
      ['Thu 4 Jun 2026 22:30', '2026-06-04T22:30:00+02:00', 'Evening', true, 'Grundlovsdag'],
    ];
    for (const [label, iso, svProfile, weekend, reason] of cases) {
      const sv = await turnOn(ID.SV_LOFT, 'SV Loft', iso, CALENDAR);
      t.equal([sv.profile, sv.usingWeekendProfile], [svProfile, weekend], `${label}: SV ${svProfile}`);
      if (reason) t.check(sv.message.endsWith(`[Weekend: ${reason}]`), `${label}: tag names ${reason}`, sv.message);
    }
    // The school-only Friday after Kristi himmelfart: kids weekend, bedroom weekday
    const o = await turnOn(ID.O_LOFT, 'O Loft', '2027-05-06T20:30:00+02:00', CALENDAR);
    t.equal([o.profile, o.usingWeekendProfile], ['Evening', true], 'Thu 6 May 20:30: O Evening (school-free Friday)');
    // The tag on the light-off path (flash prevented: values recorded, light left off)
    const off = await turnOn(ID.SV_LOFT, 'SV Loft', '2026-12-23T22:30:00+01:00', CALENDAR, { on: false });
    t.check(off.flashPrevented === true && off.message.endsWith('[Weekend: Juleaften]'), 'light off: tag names Juleaften', JSON.stringify(off));
    // A plain weekend keeps the plain tag
    const sat = await turnOn(ID.SV_LOFT, 'SV Loft', '2026-10-31T07:00:00+01:00', CALENDAR);
    t.check(sat.message.endsWith('[Weekend]'), 'Saturday: plain [Weekend] tag', sat.message);
  },

  async 'no or unreadable holiday calendar: Saturday and Sunday only'(t) {
    for (const [label, globals] of [['missing', {}], ['corrupt', { 'Config.Global': '{not json' }], ['null', { 'Config.Global': 'null' }],
      ['without holiday keys', { 'Config.Global': JSON.stringify({ tadoHomeId: 'x' }) }]]) {
      const o = await turnOn(ID.O_LOFT, 'O Loft', '2026-10-11T20:30:00+02:00', globals);
      const sv = await turnOn(ID.SV_LOFT, 'SV Loft', '2026-12-23T22:30:00+01:00', globals);
      t.equal([o.profile, o.usingWeekendProfile, sv.profile, sv.usingWeekendProfile], ['Night', false, 'Night', false],
        `${label}: autumn holiday and Christmas Eve run the weekday set`);
      const fri = await turnOn(ID.SV_LOFT, 'SV Loft', '2026-10-30T22:30:00+01:00', globals);
      t.equal(fri.usingWeekendProfile, true, `${label}: Friday evening is still weekend`);
    }
  },

  async "sun colour for the kids' rooms and the entrance; kitchen unchanged"(t) {
    const lights = [[ID.O_LOFT, 'O Loft'], [ID.C_LOFT, 'C Loft'], [ID.C_LIGHTSTRIP, 'C LightStrip'],
      [ID.E9_LOFT, 'E9 Loft'], [ID.E9_GARDEROBE, 'E9 Garderobe']];
    const cases = [
      ['27 Oct 12:00', '2026-10-27T12:00:00+01:00', 0.58],
      ['27 Oct 15:30', '2026-10-27T15:30:00+01:00', 0.65],
      ['21 Dec 12:00', '2026-12-21T12:00:00+01:00', 0.64],
      ['22 Jun 12:00', '2026-06-22T12:00:00+02:00', 0.5],
    ];
    for (const [label, iso, temp] of cases) {
      const got = [];
      for (const [id, name] of lights) got.push((await turnOn(id, name, iso)).temperature);
      t.equal(got, lights.map(() => temp), `${label}: Daytime colour ${temp}`);
      const k = await turnOn(ID.K_LOFT, 'K Loft', iso);
      t.equal(k.temperature, 0.4, `${label}: kitchen stays 0.4`);
    }
  },

  async 'entrance: Daytime from 07:00 on weekdays, weekends unchanged'(t) {
    const cases = [
      ['Mon 06:30', '2026-11-02T06:30:00+01:00', ['Morning', 0.4]],
      ['Mon 07:00', '2026-11-02T07:00:00+01:00', ['Daytime', 0.8]],
      ['Mon 08:30', '2026-11-02T08:30:00+01:00', ['Daytime', 0.8]],
      ['Sat 08:30', '2026-10-31T08:30:00+01:00', ['Morning', 0.35]],
      ['Sat 10:00', '2026-10-31T10:00:00+01:00', ['Daytime', 0.8]],
    ];
    for (const [label, iso, expected] of cases) {
      for (const [id, name] of [[ID.E9_LOFT, 'E9 Loft'], [ID.E9_GARDEROBE, 'E9 Garderobe']]) {
        const r = await turnOn(id, name, iso);
        t.equal([r.profile, r.brightness], expected, `${label}: ${name} ${expected[0]} ${expected[1] * 100} %`);
      }
    }
  },

  async "Claras værelse: both lights pick the same profile"(t) {
    for (const [label, iso] of [['Fri 20:30', '2026-10-30T20:30:00+01:00'], ['Sat 06:30', '2026-10-31T06:30:00+01:00'], ['Sun 20:30', '2026-11-01T20:30:00+01:00']]) {
      const loft = await turnOn(ID.C_LOFT, 'C Loft', iso);
      const strip = await turnOn(ID.C_LIGHTSTRIP, 'C LightStrip', iso);
      t.equal([strip.profile, strip.brightness], [loft.profile, loft.brightness], `${label}: C LightStrip matches C Loft (${loft.profile})`);
    }
  },
};
