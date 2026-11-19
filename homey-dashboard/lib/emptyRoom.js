// What happens to a room's lights once it is empty, as the Homey flows do it, so the Lys tab
// can count down to it. Only rooms whose timing the dashboard can know are listed:
//  - E9, B9, B7: zone inactive → a countdown of the Logic variable <code>_InactivitySeconds
//    (the flows change it by time of day) → GradualFadeOut, the lights fade off. E9 instead
//    dims (AdaptiveLighting "idle") while Mørkt from 12:00 to 22:00 (E9 - Light flow, AL 2.33.0).
//  - K: AdaptiveLighting "idle" 3 min after the kitchen empties, while Mørkt (K - Light flow).
// Other rooms switch off after a fixed time in their flows that the dashboard does not read:
// they get the "no motion" line only.
export const EMPTY_ROOMS = {
  E9: { variable: 'E9_InactivitySeconds', dimsWhileDark: { from: 12 * 60, until: 22 * 60 } },
  B9: { variable: 'B9_InactivitySeconds' },
  B7: { variable: 'B7_InactivitySeconds' },
  K: { seconds: 180, onlyWhileDark: true },
};

/**
 * What the room's flow does when it has been empty this long: { seconds, action: 'dim'|'off' },
 * or null when it is unknown or nothing happens now. `vars`: { dark, inactivity: { name: s } }
 * from /api/homey/lighting; `nowMin`: Copenhagen minutes since midnight.
 */
export function emptyRoomPlan(code, vars, nowMin) {
  const room = EMPTY_ROOMS[code];
  if (!room || !vars) return null;
  const dark = vars.dark === true;
  if (room.onlyWhileDark) return dark ? { seconds: room.seconds, action: 'dim' } : null;
  const seconds = Number((vars.inactivity || {})[room.variable]);
  if (!(seconds > 0)) return null;
  const w = room.dimsWhileDark;
  const dims = !!w && dark && nowMin >= w.from && nowMin < w.until;
  return { seconds, action: dims ? 'dim' : 'off' };
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
