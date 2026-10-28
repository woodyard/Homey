// Per-room thermal model for the Rooms 2.0 forecast.
//
// One physical model for every room, heated or not:
//
//   dT/dt = k·(T_out − T) + c + g·u
//
//   k  — outdoor coupling (1/min); 1/k is the room's time constant toward outdoors
//   c  — average internal gains (people, appliances, sun) in °C/min
//   g  — radiator authority: how fast the room warms at full heating output, °C/min
//   u  — heating output 0..1 (tado valve "heating power" %, or smart-plug duty)
//
// Forecasting: the room drifts passively; when the thermostat is calling for heat
// (room below the effective target) the radiator adds up to g·dt but never lifts the
// room above the target — a modulating valve holds at the setpoint. When the room is
// already warmer than the setpoint (a mild day, a low night setpoint) the radiator is
// simply off and the room drifts, which is what actually happens.
//
// Learning: k, c, g are fit by least squares over the last ~7 days of Insights (hourly
// averages) of the room's temperature, the outdoor temperature and the room's heating
// output. When the heating never ran that week (summer, mild autumn) g cannot be
// identified and the default is kept; k and c still are.

export const ROOM_MODEL_DEFAULTS = {
  k: 1 / 1800,  // τ ≈ 30 h toward outdoors (the fitted rooms sit at ~30–70 h)
  c: 0,         // no net internal gains
  g: 0.04,      // ≈ 2.4 °C/h gross at full radiator output (≈ 2 °C/h net on a cold day)
  learned: false,
  gLearned: false,
  samples: 0,
};

function toPts(entries) {
  return (entries || [])
    .map((e) => ({ ms: new Date(e.t).getTime(), v: e.v }))
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
}

// Value of a sorted series at `ms` — nearest sample within `maxGapMs`, else null.
function nearest(pts, ms, maxGapMs, cursor) {
  while (cursor.i < pts.length - 1 && pts[cursor.i + 1].ms <= ms) cursor.i++;
  const a = pts[cursor.i];
  const b = pts[cursor.i + 1];
  const best = b && Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a;
  return best && Math.abs(best.ms - ms) <= maxGapMs ? best.v : null;
}

// Solve the (small) normal equations A·x = b by Gaussian elimination.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let cc = col; cc <= n; cc++) M[r][cc] -= f * M[col][cc];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function leastSquares(rows, ys) {
  const p = rows[0].length;
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  rows.forEach((x, i) => {
    for (let r = 0; r < p; r++) {
      b[r] += x[r] * ys[i];
      for (let c = 0; c < p; c++) A[r][c] += x[r] * x[c];
    }
  });
  return solve(A, b);
}

/**
 * Fit the room model from a week of Insights entries.
 * @param indoorEntries   [{t, v}] room temperature
 * @param outdoorEntries  [{t, v}] outdoor temperature
 * @param heatEntries     [{t, v}] heating output 0..1 (already normalised), or null/[]
 */
export function estimateRoomModel(indoorEntries, outdoorEntries, heatEntries) {
  const tin = toPts(indoorEntries);
  const tout = toPts(outdoorEntries);
  const heat = toPts(heatEntries);
  if (tin.length < 24 || tout.length < 12) return ROOM_MODEL_DEFAULTS;

  const rows = [];
  const ys = [];
  const co = { i: 0 };
  const ch = { i: 0 };
  let uMax = 0;
  for (let i = 1; i < tin.length; i++) {
    const dtMin = (tin[i].ms - tin[i - 1].ms) / 60000;
    if (dtMin < 5 || dtMin > 90) continue;
    const midMs = (tin[i].ms + tin[i - 1].ms) / 2;
    const to = nearest(tout, midMs, 45 * 60000, co);
    if (to == null) continue;
    const u = heat.length ? nearest(heat, midMs, 45 * 60000, ch) : 0;
    if (u == null) continue;
    const tinMid = (tin[i].v + tin[i - 1].v) / 2;
    const uc = Math.min(1, Math.max(0, u));
    uMax = Math.max(uMax, uc);
    rows.push([to - tinMid, 1, uc]);
    ys.push((tin[i].v - tin[i - 1].v) / dtMin);
  }
  if (rows.length < 24) return ROOM_MODEL_DEFAULTS;

  // Only fit g when the heating actually ran; otherwise it is unidentifiable.
  const fitG = uMax >= 0.1;
  const sol = leastSquares(fitG ? rows : rows.map((r) => [r[0], r[1]]), ys);
  if (!sol || sol.some((v) => !Number.isFinite(v))) return ROOM_MODEL_DEFAULTS;
  let [k, c, g] = sol;
  if (k <= 0) return { ...ROOM_MODEL_DEFAULTS, samples: rows.length };
  k = Math.min(0.05, Math.max(1 / 6000, k));          // τ between 20 min and 100 h
  c = Math.min(0.01, Math.max(-0.01, c));             // gains within ±0.6 °C/h
  const gOk = fitG && Number.isFinite(g) && g > 0.002;
  g = gOk ? Math.min(0.1, Math.max(0.005, g)) : ROOM_MODEL_DEFAULTS.g;
  return { k, c, g, learned: true, gLearned: gOk, samples: rows.length };
}

/**
 * Forecast the room from `startMin` to midnight.
 * @param targetAt   (m) => effective thermostat target at minute m, or null when the
 *                   heating is off / paused / the room is unheated
 * @param outdoorAt  (m) => outdoor °C at minute m, or null when unknown
 */
export function predictRoom({ startMin, startTemp, params, targetAt, outdoorAt, stepMin = 10 }) {
  if (startTemp == null) return [];
  const p = params || ROOM_MODEL_DEFAULTS;
  const points = [{ m: startMin, v: startTemp }];
  let T = startTemp;
  for (let m = startMin + stepMin; m <= 1440; m += stepMin) {
    const to = outdoorAt ? outdoorAt(m) : null;
    const passive = T + stepMin * ((to != null ? p.k * (to - T) : 0) + p.c);
    const target = targetAt ? targetAt(m) : null;
    T = target != null && passive < target ? Math.min(target, passive + stepMin * p.g) : passive;
    points.push({ m, v: T });
  }
  return points;
}
