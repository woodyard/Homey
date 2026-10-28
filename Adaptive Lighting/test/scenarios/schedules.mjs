// Profile selection: weekend switch at noon (2.27.3), sun colour (2.24/2.27.4),
// Claras værelse's two lights agreeing (2.27.2)
import { createEnv, light, setClock, ID } from '../mock.mjs';

const AL = 'adaptivelighting.js';

// One normal (turn-on) run on a fresh Homey at a given time
async function turnOn(id, name, iso) {
  const env = createEnv([light(id, name)]);
  setClock(iso);
  return env.run(AL, id);
}

export const scenarios = {
  async 'weekend profiles run from Friday noon to Sunday noon'(t) {
    // [time, O Loft profile, SV Loft profile, weekend set?]
    const cases = [
      ['Fri 11:30', '2026-10-30T11:30:00+01:00', 'Daytime', 'Daytime', false],
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

  async "Claras værelse: both lights pick the same profile"(t) {
    for (const [label, iso] of [['Fri 20:30', '2026-10-30T20:30:00+01:00'], ['Sat 06:30', '2026-10-31T06:30:00+01:00'], ['Sun 20:30', '2026-11-01T20:30:00+01:00']]) {
      const loft = await turnOn(ID.C_LOFT, 'C Loft', iso);
      const strip = await turnOn(ID.C_LIGHTSTRIP, 'C LightStrip', iso);
      t.equal([strip.profile, strip.brightness], [loft.profile, loft.brightness], `${label}: C LightStrip matches C Loft (${loft.profile})`);
    }
  },
};
