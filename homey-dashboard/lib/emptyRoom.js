// What happens to a room's lights once it is empty, as the Homey flows do it, so the Lys tab
// can count down to it (read from the flows 20 Nov 2026; change both together):
//  - E9, B9, B7: zone inactive → a countdown of the Logic variable <code>_InactivitySeconds
//    (the flows change it by time of day) → GradualFadeOut, the lights fade off. E9 instead
//    dims (AdaptiveLighting "idle") while Mørkt from 12:00 to 22:00 (E9 - Light flow, AL 2.33.0).
//  - K: while Mørkt, AdaptiveLighting "idle" 3 min after the kitchen empties; while light,
//    GradualFadeOut after 30 min (K - Light flow).
//  - ST, SV, O (30 min) and C (20 min): zone inactive that long and not Mørkt → lights off.
//    While Mørkt they stay on (<code> - Light flow).
//  - E7: off after 1 min empty from 20:00 to 06:00, else after 5 min — unless Badeværelse 7 is
//    in use then (E7 - Inactive 1 / 5).
//  - A: no motion sensor; switched off at 22:30 (A - Turn off).
// SS has no automatic switch-off.
const B7_ZONE = '5477fed5-a59d-4196-96bc-0f3b14d3cff4';
export const EMPTY_ROOMS = {
  E9: { variable: 'E9_InactivitySeconds', dimsWhileDark: { from: 12 * 60, until: 22 * 60 } },
  B9: { variable: 'B9_InactivitySeconds' },
  B7: { variable: 'B7_InactivitySeconds' },
  K: { dark: { seconds: 180, action: 'dim' }, light: { seconds: 1800, action: 'off' } },
  ST: { light: { seconds: 1800, action: 'off' } },
  SV: { light: { seconds: 1800, action: 'off' } },
  O: { light: { seconds: 1800, action: 'off' } },
  C: { light: { seconds: 1200, action: 'off' } },
  E7: { night: { from: 20 * 60, until: 6 * 60, seconds: 60 }, seconds: 300, unlessActive: B7_ZONE },
};
// Lights switched off at a fixed time, whoever is there (minutes since midnight)
export const OFF_AT = { A: 22 * 60 + 30 };

/**
 * What the room's flow does when it has been empty this long: { seconds, action: 'dim'|'off' },
 * or null when it is unknown or nothing happens now. `vars`: { dark, inactivity: { name: s } }
 * from /api/homey/lighting; `nowMin`: Copenhagen minutes since midnight; `zones`: id → { active }.
 */
export function emptyRoomPlan(code, vars, nowMin, zones) {
  const room = EMPTY_ROOMS[code];
  if (!room) return null;
  if (room.unlessActive) {
    const z = zones && zones[room.unlessActive];
    if (z && z.active === true) return null;
  }
  if (room.night) {
    const n = room.night;
    const atNight = n.from > n.until ? (nowMin >= n.from || nowMin < n.until) : (nowMin >= n.from && nowMin < n.until);
    return { seconds: atNight ? n.seconds : room.seconds, action: 'off' };
  }
  if (!vars) return null;
  if (room.dark || room.light) {
    // Only when Mørkt is known: the wrong one would promise a switch-off that never comes
    if (vars.dark === true) return room.dark || null;
    if (vars.dark === false) return room.light || null;
    return null;
  }
  const dark = vars.dark === true;
  const seconds = Number((vars.inactivity || {})[room.variable]);
  if (!(seconds > 0)) return null;
  const w = room.dimsWhileDark;
  const dims = !!w && dark && nowMin >= w.from && nowMin < w.until;
  return { seconds, action: dims ? 'dim' : 'off' };
}

/** Seconds until a fixed-time switch-off (OFF_AT), or null for a room without one. */
export function secondsToOffAt(code, nowSecOfDay) {
  if (!(code in OFF_AT)) return null;
  const left = OFF_AT[code] * 60 - nowSecOfDay;
  return left > 0 ? left : null;
}

/**
 * When the room became empty: { since (ms), counting } — or null while someone is there or it is
 * not known. `since` is the latest of the motion sensors' last change (live, with every update)
 * and the zone going inactive (polled, so it can be minutes old — never earlier than the motion).
 * `counting` is false while the zone still reads active from something other than motion (an open
 * door): the flows' countdown starts only when the zone goes inactive.
 */
export function emptySince(motionDevs, zone) {
  if (motionDevs.some((d) => d.capabilities && d.capabilities.alarm_motion === true)) return null;
  const motionAt = Math.max(0, ...motionDevs
    .map((d) => (d.capTimes && d.capTimes.alarm_motion ? new Date(d.capTimes.alarm_motion).getTime() : 0))
    .filter((t) => Number.isFinite(t)));
  const zoneAt = zone && zone.activeLastUpdated ? new Date(zone.activeLastUpdated).getTime() : 0;
  if (zone && zone.active === true) {
    // Active since after the last motion: something else holds it (a door) — no countdown yet.
    // Active from before it: the poll is behind the motion sensor
    return motionAt > 0 ? { since: motionAt, counting: !(zoneAt > motionAt) } : null;
  }
  const since = Math.max(motionAt, zone && zone.active === false ? zoneAt : 0);
  return since > 0 ? { since, counting: true } : null;
}
