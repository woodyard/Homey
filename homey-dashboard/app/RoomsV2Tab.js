'use client';

// Rooms 2.0 — experimental redesign of the Rooms view (the original Rooms tab is kept).
// One full-width row per room:
//  • Lights panel: each bulb as a live glowing tile + the room's adaptive-lighting
//    schedule drawn as a 24h "day ribbon" (sky gradient, brightness curve coloured by
//    white balance, sunrise/sunset + now markers). Phase chips apply a phase directly.
//  • Climate panel: today's measured temperature since midnight, the room_heating
//    schedule drawn on the same graph (slot bands + target step line), and a dashed
//    prediction for the rest of the day (physical room model: drift toward outdoors +
//    gains, radiator lifts toward the effective target — honouring boost/pause/manual
//    modes — but never above it; see lib/thermal.js). Inline heating controls.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AL_ROOMS, getSunTimes, phaseList, isActive, activePhase, resolveLightMode, describeLightStatus, tempColor,
  fmtMinutes, copenhagenMinutesNow, isWeekendNow, isWeekendScheduleNow,
} from '../lib/adaptiveLighting';
import {
  HEATING_ROOMS, HEATING_ACTIONS, heatingDaySlots, heatingSlot, guessHeatFlow,
} from '../lib/heating';
import { estimateRoomModel, ROOM_MODEL_DEFAULTS, predictRoom } from '../lib/thermal';

const HIST_POLL_MS = 5 * 60 * 1000;   // temperature history refresh
const STATUS_POLL_MS = 15 * 1000;     // heating status refresh
const PRED_STEP_MIN = 10;             // prediction resolution
const BOOST_TARGET = 25;

// The home is a fixed location (Kertemindegade, København) — the Weather tab follows
// the client device's location, so the room forecast must NOT reuse that. These match
// the coordinates the adaptive-lighting schedule already uses.
const HOME_LAT = 55.6761;
const HOME_LON = 12.5683;

function roomNameFromPath(path) {
  const parts = (path || '').split(' > ');
  return parts[parts.length - 1] || path;
}


function cmpZoneOrder(a, b) {
  const A = a || [];
  const B = b || [];
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = i < A.length ? A[i] : -1;
    const y = i < B.length ? B[i] : -1;
    if (x !== y) return x - y;
  }
  return 0;
}

function todayMidnightMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------- lights ----

// Smoothed 24h brightness model for a profile set: samples every STEP minutes plus a
// cool→warm gradient stop per phase. Used by the combined chart’s lighting overlay.
function brightnessModel(profiles, sun) {
  const STEP = 10;
  const n = 1440 / STEP + 1;
  const phases = phaseList(profiles, sun);
  const phaseAt = (m) => phases.find((p) => isActive(p, m)) || phases[0];
  let samples = Array.from({ length: n }, (_, i) => phaseAt(Math.min(1439, i * STEP)).brightness);
  for (let pass = 0; pass < 3; pass++) {
    samples = samples.map((v, i) => {
      const a = samples[(i - 1 + n) % n];
      const b = samples[(i + 1) % n];
      return (a + v * 2 + b) / 4;
    });
  }
  const stops = [];
  phases.forEach((p) => {
    const segs = p.end <= 1440 ? [[p.start, p.end]] : [[p.start, 1440], [0, p.end - 1440]];
    segs.forEach(([s, e]) => stops.push({ at: (s + e) / 2 / 1440, color: tempColor(p.temperature) }));
  });
  stops.sort((a, b) => a.at - b.at);
  return { STEP, samples, stops };
}

// ---------------------------------------------------------------- status ----

function fmtAgo(ts) {
  if (!ts) return null;
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

const STATUS_ICON = {
  socket: '🔌', tv: '📺', mediaplayer: '🔊', coffeemachine: '☕', fridge: '🧊', freezer: '❄️',
  washer: '🧺', vacuumcleaner: '🤖', heater: '🔥', curtain: '🪟', fan: '🌀', other: '🏠',
};

function batteryColor(pct) {
  return pct <= 20 ? '#dc2626' : pct <= 50 ? '#b45309' : '#16a34a';
}

function otherStateText(caps) {
  if (caps.display_status) return String(caps.display_status);
  if (caps.operational_state != null) return `state ${caps.operational_state}`;
  if (caps.windowcoverings_set != null) return `${Math.round(caps.windowcoverings_set * 100)}%`;
  return null;
}

const STATUS_LABEL = { fontSize: 10.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 0 4px' };
const STATUS_ROW = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0', minWidth: 0 };

// Left card: room status — motion inactivity, open windows/doors with duration,
// batteries, and any devices not covered by the lights/heating sections.
function StatusPanel({ room, zone, onControl, heatingWindowOpen }) {
  const motionDevs = room.devices.filter((d) => 'alarm_motion' in (d.capabilities || {}));
  const motionActive = motionDevs.some((d) => !!d.capabilities.alarm_motion);
  const motionTs = motionDevs
    .map((d) => (d.capTimes || {}).alarm_motion)
    .filter(Boolean)
    .sort()
    .pop() || (zone && zone.activeLastUpdated) || null;

  const contacts = room.devices.filter((d) => 'alarm_contact' in (d.capabilities || {}));
  const batteries = room.devices
    .filter((d) => d.capabilities && d.capabilities.measure_battery != null)
    .sort((a, b) => a.capabilities.measure_battery - b.capabilities.measure_battery);

  const heatingIds = new Set(room.heating
    ? [room.heating.thermostatId, ...(room.heating.plugIds || [])].filter(Boolean) : []);
  const others = room.devices.filter((d) => (
    !['light', 'sensor', 'thermostat', 'button'].includes(d.class)
    && d.virtualClass !== 'light' // re-classed plugs live in the lights section
    && !heatingIds.has(d.id)
  ));

  return (
    <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '12px 14px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        📋 Status
      </div>

      {(motionDevs.length > 0 || contacts.length > 0 || heatingWindowOpen) && (
        <div>
          <div style={STATUS_LABEL}>Activity</div>
          {heatingWindowOpen && (
            <div style={STATUS_ROW} title="Reported by the heating system — the physical sensor may sit in a sub-zone">
              <span style={{ color: '#b45309' }}>🪟 Window open — heating paused</span>
            </div>
          )}
          {motionDevs.length > 0 && (
            <div style={STATUS_ROW}>
              {motionActive
                ? <span style={{ color: '#16a34a' }}>🏃 Active now</span>
                : (
                  <span style={{ color: '#6b7280' }} title={motionTs ? `No motion since ${new Date(motionTs).toLocaleString()}` : undefined}>
                    💤 Inactive{fmtAgo(motionTs) ? ` for ${fmtAgo(motionTs)}` : ''}
                  </span>
                )}
            </div>
          )}
          {contacts.map((d) => {
            const open = !!d.capabilities.alarm_contact;
            const since = (d.capTimes || {}).alarm_contact;
            const icon = /vindue|window/i.test(d.name) ? '🪟' : '🚪';
            return (
              <div key={d.id} style={STATUS_ROW} title={since ? `Last change ${new Date(since).toLocaleString()}` : undefined}>
                <span style={{ flex: 'none' }}>{icon}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span style={{ marginLeft: 'auto', color: open ? '#b45309' : '#9ca3af', whiteSpace: 'nowrap' }}>
                  {open ? `open${fmtAgo(since) ? ` · ${fmtAgo(since)}` : ''}` : 'closed'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div style={STATUS_LABEL}>Devices</div>
          {others.map((d) => {
            const caps = d.capabilities || {};
            const stateText = otherStateText(caps);
            const unavailable = d.available === false;
            return (
              <div key={d.id} style={{ ...STATUS_ROW, opacity: unavailable ? 0.55 : 1 }}
                title={unavailable ? `${d.name}: unavailable (unpowered or unreachable)` : undefined}>
                <span style={{ flex: 'none' }}>{STATUS_ICON[d.virtualClass || d.class] || '🏠'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {unavailable && <span style={{ fontSize: 12 }} title="Unavailable">⚠️</span>}
                  {stateText && <span style={{ color: '#9ca3af', fontSize: 11, whiteSpace: 'nowrap' }}>{stateText}</span>}
                  {'onoff' in caps && onControl
                    ? (
                      <MiniToggle
                        on={!!caps.onoff} onChange={(v) => onControl(d.id, { onoff: v })} disabled={!!d.alwaysOn || unavailable}
                        title={unavailable ? `${d.name}: unavailable`
                          : d.alwaysOn ? `${d.name}: always on` : `${d.name}: turn ${caps.onoff ? 'off' : 'on'}`}
                      />
                    )
                    : !stateText && <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {batteries.length > 0 && (
        <div>
          <div style={STATUS_LABEL}>Batteries</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {batteries.map((d) => {
              const pct = d.capabilities.measure_battery;
              return (
                <span key={d.id} title={d.name} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f8f9fa',
                  border: '1px solid #eef0f2', color: batteryColor(pct), whiteSpace: 'nowrap',
                }}>
                  🔋 {Math.round(pct)}% <span style={{ color: '#6b7280' }}>{d.name}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {motionDevs.length === 0 && contacts.length === 0 && !heatingWindowOpen
        && others.length === 0 && batteries.length === 0 && (
        <div style={{ color: '#c0c6cf', fontSize: 12, marginTop: 10 }}>Nothing to report.</div>
      )}
    </div>
  );
}

// Compact on/off switch (same look as the Rooms tab toggle, smaller).
// `disabled` greys it out — used for "Always on" devices that cannot be switched off.
function MiniToggle({ on, onChange, title, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-disabled={disabled || undefined}
      title={disabled ? (title || 'Always on — cannot be switched off') : (title || (on ? 'Turn off' : 'Turn on'))}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
      style={{
        width: 32, height: 19, borderRadius: 999, border: 'none', padding: 0,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        background: on ? '#16a34a' : '#cbd5e1', position: 'relative', transition: 'background .15s', flex: 'none',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 15 : 2, width: 15, height: 15, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

// A single bulb as a glowing tile with live state. `al` is resolveLightMode's
// { mode, guess, st } for lights AdaptiveLighting manages, else null.
const LIGHT_MODE_LABEL = { auto: 'Auto', manual: 'Manual', drift: 'Manual?', forced: 'Forced', off: 'Off', unknown: '—' };
function LightTile({ device, al, onToggle }) {
  const mode = al ? al.mode : null;
  const c = device.capabilities || {};
  const on = !!c.onoff;
  const unavailable = device.available === false;
  let color;
  if (c.light_mode === 'color' && c.light_hue != null) {
    color = `hsl(${Math.round((c.light_hue || 0) * 360)} ${Math.round((c.light_saturation != null ? c.light_saturation : 1) * 100)}% 55%)`;
  } else if (c.light_temperature != null) {
    color = tempColor(c.light_temperature);
  } else {
    color = tempColor(0.6);
  }
  const dim = c.dim;
  const modeColor = mode === 'manual' || mode === 'drift' ? '#b45309'
    : mode === 'auto' ? '#16a34a' : mode === 'forced' ? '#2563eb' : '#9ca3af';
  const modeText = mode
    ? `${mode === 'forced' && al.st?.profile ? `Forced ${al.st.profile}` : LIGHT_MODE_LABEL[mode] || mode}${al.guess ? ' (guessed)' : ''}`
    : '';
  const alText = al && al.st ? describeLightStatus(al.st) : '';
  return (
    <div
      title={unavailable
        ? `${device.name}: unavailable (unpowered or unreachable)`
        : `${device.name}: ${on ? (dim != null ? `${Math.round(dim * 100)}%` : 'on') : 'off'}${modeText ? ` · ${modeText}` : ''}${alText ? `\nScript: ${alText}` : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 9,
        border: '1px solid #e3e6ea', background: on ? '#fffdf7' : '#f8f9fa', minWidth: 0,
        opacity: unavailable ? 0.55 : 1,
      }}
    >
      {unavailable && <span style={{ flex: 'none', fontSize: 12 }} title="Unavailable">⚠️</span>}
      <span style={{
        width: 14, height: 14, borderRadius: '50%', flex: 'none',
        background: on ? color : '#e2e5e9',
        boxShadow: on ? `0 0 ${4 + (dim != null ? dim * 8 : 6)}px ${color}` : 'none',
        border: '1px solid rgba(0,0,0,0.12)',
      }} />
      <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</span>
      {/* The switch itself shows on/off — only the dim % adds information. */}
      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
        {on && dim != null ? `${Math.round(dim * 100)}%` : ''}
      </span>
      {mode && <span style={{ width: 7, height: 7, borderRadius: '50%', background: modeColor, flex: 'none', opacity: al.guess ? 0.5 : 1 }} title={modeText} />}
      {onToggle && 'onoff' in c && (
        <MiniToggle
          on={on} onChange={onToggle} disabled={!!device.alwaysOn || unavailable}
          title={unavailable ? `${device.name}: unavailable`
            : device.alwaysOn ? `${device.name}: always on` : `${device.name}: turn ${on ? 'off' : 'on'}`}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------- climate ----

// Effective thermostat target for minute m of today, or null when the heating is not
// calling (pause). Boost/pause/manual run on the real clock until they expire, then
// the schedule applies. For the rest of the *current* slot the device's actual
// setpoint is used: it already includes the inactivity offset / away minimum that the
// schedule alone doesn't know about. Later slots use their scheduled target.
function makeTargetAt({ startMin, slots, status, deviceTarget, weekend, roomKey }) {
  if (!slots.length) return () => null;
  const mode = status && status.mode && status.mode !== 'auto' ? status.mode : null;
  const modeUntil = mode && status.modeExpires
    ? Math.max(0, Math.round((status.modeExpires - Date.now()) / 60000)) : 0;
  const curSlot = heatingSlot(roomKey, weekend, Math.min(startMin, 1439));
  return (m) => {
    const sinceNow = m - startMin;
    if (mode === 'boost' && sinceNow <= modeUntil) return BOOST_TARGET;
    if (mode === 'pause' && sinceNow <= modeUntil) return null;
    if (mode === 'manual' && sinceNow <= modeUntil && deviceTarget != null) return deviceTarget;
    const slot = heatingSlot(roomKey, weekend, Math.min(m, 1439));
    if (!slot) return null;
    if (!mode && curSlot && slot.start === curSlot.start && deviceTarget != null) return deviceTarget;
    return slot.target;
  };
}

// Outdoor °C at minute m: the hourly forecast (interpolated), falling back to the
// latest outdoor reading held constant; null when neither is known.
function makeOutdoorAt(outdoor, outsideNow) {
  return (m) => {
    if (outdoor && outdoor.length) {
      if (m <= outdoor[0].m) return outdoor[0].v;
      for (let i = 1; i < outdoor.length; i++) {
        if (m <= outdoor[i].m) {
          const a = outdoor[i - 1];
          const b = outdoor[i];
          return a.v + ((m - a.m) / Math.max(1, b.m - a.m)) * (b.v - a.v);
        }
      }
      return outdoor[outdoor.length - 1].v;
    }
    return outsideNow;
  };
}

// Normalised heating output (0..1) of a heating room over the week: the tado valve's
// heating power %, or the summed power draw of the room's radiator plugs relative to
// their weekly peak (a peak under 50 W means the plugs never really heated).
function heatingOutput(hr, heatSeries) {
  if (hr.thermostatId) {
    const s = heatSeries.find((x) => x.deviceId === hr.thermostatId && x.logId === 'tado_heating_power');
    return s ? (s.entries || []).map((e) => ({ t: e.t, v: e.v / 100 })) : null;
  }
  const plugs = heatSeries.filter((x) => (hr.plugIds || []).includes(x.deviceId) && x.logId === 'energy_power');
  if (!plugs.length) return null;
  const sum = new Map();
  plugs.forEach((s) => (s.entries || []).forEach((e) => sum.set(e.t, (sum.get(e.t) || 0) + e.v)));
  const peak = Math.max(0, ...sum.values());
  return [...sum].map(([t, v]) => ({ t, v: peak < 50 ? 0 : v / peak }));
}

// Light centered moving average to take the sensor-quantisation jaggies (0.1° steps)
// out of the measured line without visibly shifting it.
function smoothPoints(points, window = 9) {
  if (points.length < window) return points;
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sum += points[j].v;
      n++;
    }
    return { m: p.m, v: sum / n };
  });
}

const SERIES_COLORS = ['#2563eb', '#0891b2', '#0f766e', '#db2777'];
const TARGET_COLOR = '#9333ea'; // scheduled heating target — distinct from the orange light curve

function ClimateChart({ series, slots, prediction, nowMin, lighting, uid }) {
  const W = 920;
  const H = 260;
  const M = { l: 40, r: lighting ? 34 : 14, t: 26, b: 22 };
  const [hover, setHover] = useState(null);

  const x = (m) => M.l + (m / 1440) * (W - M.l - M.r);

  // Optional adaptive-lighting overlay: brightness on a 0–100% right-hand axis.
  const light = lighting ? brightnessModel(lighting.profiles, lighting.sun) : null;
  const yb = (b) => H - M.b - b * (H - M.t - M.b);

  const allVals = [
    ...series.flatMap((s) => s.points.map((p) => p.v)),
    ...prediction.map((p) => p.v),
    ...slots.map((s) => s.target),
  ];
  const hasTemp = allVals.length > 0;
  if (!hasTemp && !light) return <div style={{ color: '#9ca3af', fontSize: 12.5, padding: '30px 0', textAlign: 'center' }}>No temperature data yet today.</div>;
  const yMin = hasTemp ? Math.floor(Math.min(...allVals) - 1) : 0;
  const yMax = hasTemp ? Math.ceil(Math.max(...allVals) + 1) : 1;
  const y = (v) => M.t + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - M.t - M.b);

  const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.m).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');

  // Target step line across the day.
  const targetPath = slots.map((s, i) => (
    `${i ? 'L' : 'M'} ${x(s.start).toFixed(1)} ${y(s.target).toFixed(1)} L ${x(s.end).toFixed(1)} ${y(s.target).toFixed(1)}`
  )).join(' ');

  const yTicks = [];
  if (hasTemp) for (let v = yMin; v <= yMax; v += (yMax - yMin) > 8 ? 2 : 1) yTicks.push(v);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const m = Math.max(0, Math.min(1440, ((px - M.l) / (W - M.l - M.r)) * 1440));
    const closest = (pts) => {
      if (!pts || !pts.length) return null;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.m - m) < Math.abs(best.m - m)) best = p;
      return Math.abs(best.m - m) <= 45 ? best : null;
    };
    const slot = slots.find((s) => m >= s.start && m < s.end) || null;
    setHover({
      m,
      px: Math.max(M.l, Math.min(W - M.r, px)),
      actual: closest(series[0] && series[0].points),
      pred: m > nowMin ? closest(prediction) : null,
      slot,
      light: light ? light.samples[Math.round(m / light.STEP)] : null,
    });
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* schedule slot bands + labels */}
        {slots.map((s, i) => (
          <g key={`${s.name}-${s.start}`}>
            <rect x={x(s.start)} y={M.t - 16} width={x(s.end) - x(s.start)} height={H - M.t - M.b + 16}
              fill={i % 2 ? 'rgba(37,99,235,0.045)' : 'rgba(37,99,235,0.018)'} />
            {(x(s.end) - x(s.start)) > 52 && (
              <text x={(x(s.start) + x(s.end)) / 2} y={M.t - 5} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {s.name} {s.target}°{s.offset > 0 ? ` (−${s.offset}° idle)` : ''}
              </text>
            )}
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#eef0f3" />
            <text x={M.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="#9ca3af">{v}°</text>
          </g>
        ))}
        {/* adaptive-lighting overlay: brightness area (right axis) behind the temp curves */}
        {light && (() => {
          const curve = light.samples
            .map((b, i) => `${i ? 'L' : 'M'} ${x(i * light.STEP).toFixed(1)} ${yb(b).toFixed(1)}`).join(' ');
          const area = `${curve} L ${x(1440).toFixed(1)} ${H - M.b} L ${M.l} ${H - M.b} Z`;
          const sunrise = lighting.sun.sunriseMinutes;
          const sunset = lighting.sun.sunsetMinutes;
          return (
            <g>
              <defs>
                <linearGradient id={`cmb-${uid}`} x1="0" x2="1" y1="0" y2="0">
                  {light.stops.map((s, i) => <stop key={i} offset={`${(s.at * 100).toFixed(1)}%`} stopColor={s.color} />)}
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#cmb-${uid})`} opacity="0.20" />
              <path d={curve} fill="none" stroke={`url(#cmb-${uid})`} strokeWidth="1.6" opacity="0.8" />
              {/* dim the night hours */}
              <rect x={M.l} y={M.t - 16} width={x(sunrise) - M.l} height={H - M.t - M.b + 16} fill="rgba(100,116,139,0.10)" />
              <rect x={x(sunset)} y={M.t - 16} width={W - M.r - x(sunset)} height={H - M.t - M.b + 16} fill="rgba(100,116,139,0.10)" />
              {/* sun / moon markers */}
              {[[sunrise, '☀️'], [sunset, '🌙']].map(([m, icon]) => (
                <g key={icon}>
                  <line x1={x(m)} x2={x(m)} y1={M.t - 6} y2={H - M.b} stroke="#f3c96b" strokeDasharray="2 3" />
                  <text x={x(m)} y={H - M.b - 5} textAnchor="middle" fontSize="10">{icon}</text>
                </g>
              ))}
              {/* right-hand brightness axis */}
              {[0, 0.5, 1].map((b) => (
                <text key={b} x={W - M.r + 4} y={yb(b) + 3.5} fontSize="9.5" fill="#c0c6cf">{Math.round(b * 100)}%</text>
              ))}
            </g>
          );
        })()}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 6} fontSize="10.5" fill="#9ca3af"
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {String(h).padStart(2, '0')}
          </text>
        ))}
        {/* scheduled target step line */}
        {slots.length > 0 && (
          <path d={targetPath} fill="none" stroke={TARGET_COLOR} strokeWidth="1.8" strokeDasharray="1 0" opacity="0.85" />
        )}
        {/* measured lines since midnight */}
        {series.map((s, i) => s.points.length > 1 && (
          <path key={s.key} d={linePath(s.points)} fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={i === 0 ? 2.6 : 1.5} opacity={i === 0 ? 1 : 0.55}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* prediction */}
        {prediction.length > 1 && (
          <path d={linePath(prediction)} fill="none" stroke="#2563eb" strokeWidth="2"
            strokeDasharray="5 5" opacity="0.65" />
        )}
        {/* now marker */}
        <line x1={x(nowMin)} x2={x(nowMin)} y1={M.t - 16} y2={H - M.b} stroke="#ef4444" strokeWidth="1.6" />
        <circle cx={x(nowMin)} cy={M.t - 16} r="2.6" fill="#ef4444" />
        {hover && (
          <line x1={hover.px} x2={hover.px} y1={M.t - 16} y2={H - M.b} stroke="#475569" strokeWidth="1" strokeDasharray="4 4" />
        )}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', top: 4, left: `${Math.max(8, Math.min(84, (hover.px / W) * 100))}%`,
          transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.97)', border: '1px solid #dbe3ef',
          borderRadius: 8, boxShadow: '0 6px 18px rgba(15,23,42,0.12)', padding: '7px 10px',
          fontSize: 11.5, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2,
        }}>
          <b>{fmtMinutes(hover.m)}</b>
          {hover.slot && <span style={{ color: TARGET_COLOR }}> · {hover.slot.name} → {hover.slot.target}°</span>}
          {hover.actual && <span style={{ color: '#2563eb' }}> · measured {hover.actual.v.toFixed(1)}°</span>}
          {hover.pred && <span style={{ color: '#6b7280' }}> · forecast {hover.pred.v.toFixed(1)}°</span>}
          {hover.light != null && <span style={{ color: '#b45309' }}> · 💡 {Math.round(hover.light * 100)}%</span>}
        </div>
      )}
    </div>
  );
}

function heatBtn(actionKey, disabled) {
  const c = actionKey === 'boost' ? '#ea580c' : actionKey === 'pause' ? '#6b7280' : '#2563eb';
  return {
    padding: '4px 11px', borderRadius: 999, border: `1px solid ${c}`, background: '#fff', color: c,
    fontSize: 11.5, whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
  };
}

const HEAT_MODE = {
  boost: { label: '🔥 Boost', bg: '#fff1e6', color: '#ea580c' },
  pause: { label: '⏸ Paused', bg: '#f1f2f4', color: '#6b7280' },
  manual: { label: '✋ Manual', bg: '#fff7ed', color: '#b45309' },
};

// ------------------------------------------------------------------ tab ----

export default function RoomsV2Tab({ devices, zones, flows, alStatus, onControl, onReload }) {
  const sun = useMemo(() => getSunTimes(new Date()), []);
  const nowMin = copenhagenMinutesNow();
  const weekend = isWeekendNow();                 // heating schedules
  const lightWeekend = isWeekendScheduleNow();    // lighting: evenings follow the next day

  const [histSensors, setHistSensors] = useState([]);
  const [histSeries, setHistSeries] = useState([]);
  const [weekSeries, setWeekSeries] = useState([]); // ~7 days: room primaries + outdoor
  const [heatSeries, setHeatSeries] = useState([]); // ~7 days: heating output logs (tado power / plug watts)
  const [outForecast, setOutForecast] = useState([]); // today's outdoor °C, [{m, v}]
  const [heatStatus, setHeatStatus] = useState({});
  const [heatingEnabled, setHeatingEnabled] = useState(null);
  const [heatMapping, setHeatMapping] = useState({});
  const [busy, setBusy] = useState(() => new Set());
  const [applying, setApplying] = useState(null);
  const [err, setErr] = useState('');

  // Heating status (mode / windowOpen / away / effectiveTarget per zone).
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/homey/heating').then((r) => r.json())
      .then((j) => { if (!cancelled) { setHeatingEnabled(j.heatingEnabled); if (j.status) setHeatStatus(j.status); } })
      .catch(() => {});
    load();
    try { setHeatMapping(JSON.parse(localStorage.getItem('heating_flows') || '{}')); } catch { /* ignore */ }
    const iv = setInterval(load, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Temperature history: sensor list once, then today's series for every sensor.
  useEffect(() => {
    let cancelled = false;
    let iv;
    async function load() {
      try {
        const r = await fetch('/api/homey/temperatures');
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(data.error || `temperature sensors failed (${r.status})`);
        const sensors = data.sensors || [];
        setHistSensors(sensors);
        if (!sensors.length) return;
        // The API caps at 40 logs per request — fetch today's series in chunks and merge.
        const keys = sensors.map((s) => s.key);
        const chunks = [];
        for (let i = 0; i < keys.length; i += 40) chunks.push(keys.slice(i, i + 40));
        const merged = [];
        let chunkError = null;
        for (const chunk of chunks) {
          try {
            const r2 = await fetch(`/api/homey/temperatures?period=last24Hours&ids=${encodeURIComponent(chunk.join(','))}`);
            const data2 = await r2.json();
            if (cancelled) return;
            if (!r2.ok) throw new Error(data2.error || `temperature history failed (${r2.status})`);
            merged.push(...(data2.series || []));
          } catch (e) {
            chunkError = e; // keep whatever the other chunks delivered
          }
        }
        setHistSeries(merged);
        if (chunkError && !merged.some((s) => (s.entries || []).length)) throw chunkError;
        // Week of history for learning: one primary sensor per room (thermostat sensor
        // preferred), heating-room sensors, and the outdoor sensor(s).
        const weekKeySet = new Set();
        sensors.filter((s) => s.logId === 'measure_temperature.outside').forEach((s) => weekKeySet.add(s.key));
        const primaryByZone = new Map();
        for (const s of sensors) {
          if (s.logId !== 'measure_temperature' || !s.zone) continue;
          if (!primaryByZone.has(s.zone)) primaryByZone.set(s.zone, s.key);
        }
        for (const hr of HEATING_ROOMS) {
          const t = sensors.find((s) => s.deviceId === hr.thermostatId);
          if (t) primaryByZone.set(t.zone, t.key);
        }
        primaryByZone.forEach((key) => weekKeySet.add(key));
        sensors
          .filter((s) => HEATING_ROOMS.some((hr) => hr.zone === roomNameFromPath(s.zone)))
          .forEach((s) => weekKeySet.add(s.key));
        const weekKeys = [...weekKeySet].slice(0, 40);
        if (weekKeys.length) {
          const r3 = await fetch(`/api/homey/temperatures?period=last7Days&ids=${encodeURIComponent(weekKeys.join(','))}`);
          const data3 = await r3.json();
          if (!cancelled && r3.ok) setWeekSeries(data3.series || []);
        }
        // Week of heating output (tado heating power / plug watts) for fitting the
        // radiator authority of each heating room.
        const heatLogs = data.heating || [];
        const heatKeys = heatLogs.map((h) => h.key).slice(0, 40);
        if (heatKeys.length) {
          const meta = new Map(heatLogs.map((h) => [h.key, h]));
          const r4 = await fetch(`/api/homey/temperatures?period=last7Days&ids=${encodeURIComponent(heatKeys.join(','))}`);
          const data4 = await r4.json();
          if (!cancelled && r4.ok) setHeatSeries((data4.series || []).map((s) => ({ ...s, ...(meta.get(s.key) || {}) })));
        }
      } catch (e) {
        if (!cancelled) setErr((prev) => prev || `Temperature history unavailable: ${String(e.message || e)}`);
      }
    }
    load();
    iv = setInterval(load, HIST_POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Outdoor hourly forecast for the HOME location (fixed — not the browser's location).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/weather?lat=${HOME_LAT}&lon=${HOME_LON}`);
        const j = await r.json();
        if (cancelled || !r.ok || !j.hourly) return;
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const pts = [];
        (j.hourly.time || []).forEach((t, i) => {
          const v = j.hourly.temperature_2m ? j.hourly.temperature_2m[i] : null;
          if (typeof v !== 'number' || String(t).slice(0, 10) !== todayStr) return;
          const hh = Number(String(t).slice(11, 13));
          const mm = Number(String(t).slice(14, 16) || 0);
          pts.push({ m: hh * 60 + mm, v });
        });
        setOutForecast(pts);
      } catch { /* forecast is optional */ }
    }
    load();
    const iv = setInterval(load, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const deviceById = useMemo(() => new Map((devices || []).map((d) => [d.id, d])), [devices]);
  const flowById = useMemo(() => new Map((flows || []).map((f) => [f.id, f])), [flows]);

  // AL lights grouped by the zonePath their device actually lives in.
  const alByZonePath = useMemo(() => {
    const m = new Map();
    for (const r of AL_ROOMS) {
      const dev = deviceById.get(r.id);
      if (!dev) continue;
      if (!m.has(dev.zonePath)) m.set(dev.zonePath, []);
      m.get(dev.zonePath).push(r);
    }
    return m;
  }, [deviceById]);

  const midnight = todayMidnightMs();
  const seriesByKey = useMemo(() => new Map(histSeries.map((s) => [s.key, s.entries || []])), [histSeries]);

  // Outdoor context: week history (for fitting) and the latest outdoor reading.
  const outdoorWeek = useMemo(() => {
    const s = histSensors.find((x) => x.logId === 'measure_temperature.outside');
    if (!s) return [];
    return (weekSeries.find((w) => w.key === s.key) || {}).entries || [];
  }, [histSensors, weekSeries]);
  const outsideLatest = useMemo(() => {
    const s = histSensors.find((x) => x.logId === 'measure_temperature.outside');
    return s && typeof s.latest === 'number' ? s.latest : null;
  }, [histSensors]);

  // Room model per zone path (k, c, g), fit from the primary sensor's week together
  // with the outdoor series and — for heating rooms — the heating output.
  const modelByZone = useMemo(() => {
    const bySensor = new Map(weekSeries.map((s) => [s.key, s.entries || []]));
    const primaries = new Map();
    for (const s of histSensors) {
      if (s.logId !== 'measure_temperature' || !s.zone) continue;
      if (!primaries.has(s.zone)) primaries.set(s.zone, s);
    }
    for (const hr of HEATING_ROOMS) {
      const t = histSensors.find((s) => s.deviceId === hr.thermostatId);
      if (t) primaries.set(t.zone, t);
    }
    const m = new Map();
    primaries.forEach((sensor, zone) => {
      const entries = bySensor.get(sensor.key);
      const hr = HEATING_ROOMS.find((r) => r.zone === roomNameFromPath(zone));
      m.set(zone, entries && entries.length
        ? estimateRoomModel(entries, outdoorWeek, hr ? heatingOutput(hr, heatSeries) : null)
        : ROOM_MODEL_DEFAULTS);
    });
    return m;
  }, [histSensors, weekSeries, outdoorWeek, heatSeries]);

  // Build one row per zone that has lights or temperature sensors.
  const rooms = useMemo(() => {
    const groups = new Map();
    (devices || []).forEach((d) => {
      if (!groups.has(d.zonePath)) groups.set(d.zonePath, { path: d.zonePath, order: d.zoneOrder, devices: [] });
      groups.get(d.zonePath).devices.push(d);
    });
    return [...groups.values()]
      .map((g) => {
        const name = roomNameFromPath(g.path);
        // Plugs re-classed as "Light" in Homey (virtualClass) count as lights too.
        const lights = g.devices.filter((d) => d.class === 'light' || d.virtualClass === 'light');
        // Match history sensors primarily by device id (robust), then by zone path/name.
        const idsInZone = new Set(g.devices.map((d) => d.id));
        const sensors = histSensors.filter((s) => (
          (s.deviceId && idsInZone.has(s.deviceId)) || s.zone === g.path || roomNameFromPath(s.zone) === name
        ));
        const heating = HEATING_ROOMS.find((r) => r.zone === name) || null;
        const alMembers = alByZonePath.get(g.path) || [];
        return { ...g, name, lights, sensors, heating, alMembers };
      })
      .filter((g) => g.lights.length || g.sensors.length || g.heating)
      .sort((a, b) => cmpZoneOrder(a.order, b.order));
  }, [devices, histSensors, alByZonePath]);

  // Representative lighting schedule for a room (template used by most lights, today-resolved).
  function roomProfiles(alMembers) {
    if (!alMembers.length) return null;
    const counts = new Map();
    for (const m of alMembers) {
      const p = lightWeekend && m.weekend ? m.weekend : m.weekday;
      const k = JSON.stringify(p);
      counts.set(k, { n: (counts.get(k) || { n: 0 }).n + 1, p });
    }
    let best = null;
    for (const v of counts.values()) if (!best || v.n > best.n) best = v;
    return best ? best.p : null;
  }

  // AdaptiveLighting's published mode for the light, or the schedule guess
  // ({ mode, guess, st } — see resolveLightMode)
  function lightMode(alMember) {
    const dev = deviceById.get(alMember.id);
    if (!dev) return null;
    const profiles = lightWeekend && alMember.weekend ? alMember.weekend : alMember.weekday;
    return resolveLightMode(dev.capabilities, alStatus, alMember.id, activePhase(profiles, sun, nowMin));
  }

  async function applyPhase(room, phaseName) {
    setErr('');
    setApplying(room.path);
    try {
      const items = room.alMembers
        .map((m) => {
          const profiles = lightWeekend && m.weekend ? m.weekend : m.weekday;
          const phase = phaseList(profiles, sun).find((p) => p.name === phaseName);
          const dev = deviceById.get(m.id);
          if (!phase || !dev) return null;
          const caps = dev.capabilities || {};
          const values = {};
          if ('onoff' in caps) values.onoff = true;
          if ('light_mode' in caps && 'light_temperature' in caps) values.light_mode = 'temperature';
          if ('dim' in caps) values.dim = phase.brightness;
          if ('light_temperature' in caps) values.light_temperature = phase.temperature;
          return { deviceId: m.id, values };
        })
        .filter((it) => it && Object.keys(it.values).length);
      if (!items.length) throw new Error('No controllable lights in this room.');
      const r = await fetch('/api/homey/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'failed to apply');
      setTimeout(() => onReload && onReload(), 1200);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setApplying(null);
    }
  }

  // Turn every switchable light in a room on or off with one batched request.
  // Always-on devices are skipped — they cannot be switched.
  async function setAllLights(room, on) {
    const items = room.lights
      .filter((d) => 'onoff' in (d.capabilities || {}) && !d.alwaysOn && d.available !== false)
      .map((d) => ({ deviceId: d.id, values: { onoff: on } }));
    if (!items.length) return;
    setErr('');
    setApplying(room.path);
    try {
      const r = await fetch('/api/homey/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'failed to switch lights');
      setTimeout(() => onReload && onReload(), 1000);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setApplying(null);
    }
  }

  async function runHeatAction(room, action) {
    const hr = room.heating;
    if (!hr) return;
    const mapped = heatMapping[`${hr.key}:${action.key}`];
    const flow = (mapped && flowById.get(mapped)) || guessHeatFlow(hr, action, flows || []);
    if (!flow) { setErr(`No flow mapped for ${hr.label} · ${action.key} — map it on the Heating tab.`); return; }
    const bk = `${hr.key}:${action.key}`;
    setErr('');
    setBusy((prev) => new Set(prev).add(bk));
    try {
      const r = await fetch('/api/homey/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'flow trigger failed');
      setTimeout(() => onReload && onReload(), 2500);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(bk); return n; });
    }
  }

  function adjustTarget(room, delta) {
    const hr = room.heating;
    if (!hr || !hr.thermostatId || !onControl) return;
    const dev = deviceById.get(hr.thermostatId);
    const cur = dev && dev.capabilities ? dev.capabilities.target_temperature : null;
    if (cur == null) return;
    const next = Math.max(5, Math.min(25, Math.round((cur + delta) * 2) / 2));
    if (next !== cur) onControl(hr.thermostatId, { target_temperature: next });
  }

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 12.5, marginTop: -4 }}>
        Experimental room view: live lights with today&apos;s adaptive-lighting curve, and today&apos;s
        temperature with the heating schedule and a <span style={{ borderBottom: '2px dashed #94a3b8' }}>forecast</span> for
        the rest of the day. The forecast is an estimate (assumes current boost/pause/manual mode runs out
        as scheduled and ignores future motion/windows). Today follows the <b>{weekend ? 'weekend' : 'weekday'}</b> schedules.
      </p>

      <style>{`
        .r2-row { display: grid; gap: 14px; grid-template-columns: minmax(240px, 4fr) minmax(380px, 8fr); }
        .r2-room { margin-bottom: 20px; }
        .r2-room-title { margin: 0; font-size: 15px; }
        /* Mobile: stack the cards (Status first) and make the room boundary obvious —
           bigger title with an accent bar and more air between rooms. */
        @media (max-width: 760px) {
          .r2-row { grid-template-columns: 1fr; }
          .r2-room { margin-bottom: 34px; }
          .r2-room-title {
            font-size: 20px;
            padding-left: 9px;
            border-left: 4px solid #2563eb;
            line-height: 1.2;
          }
        }
      `}</style>

      {err && (
        <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, margin: '10px 0' }}>{err}</div>
      )}

      {rooms.map((room) => {
        const profiles = roomProfiles(room.alMembers);
        const sc = room.heating ? (heatStatus[room.heating.zone] || null) : null;
        const slots = room.heating ? heatingDaySlots(room.heating.key, weekend) : [];
        const thermo = room.heating && room.heating.thermostatId ? deviceById.get(room.heating.thermostatId) : null;
        const thermoCaps = thermo ? thermo.capabilities || {} : {};

        // Today's measured series for this room; thermostat's own sensor first.
        const series = room.sensors
          .map((s) => ({
            key: s.key, name: s.name,
            primary: room.heating && s.deviceId === room.heating.thermostatId,
            points: smoothPoints((seriesByKey.get(s.key) || [])
              .map((e) => ({ ms: new Date(e.t).getTime(), v: e.v }))
              .filter((e) => e.ms >= midnight)
              .map((e) => ({ m: (e.ms - midnight) / 60000, v: e.v }))),
          }))
          .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

        const primary = series[0];
        const lastPoint = primary && primary.points.length ? primary.points[primary.points.length - 1] : null;
        const startTemp = lastPoint ? lastPoint.v
          : thermoCaps.measure_temperature != null ? thermoCaps.measure_temperature : null;
        const model = modelByZone.get(room.path) || ROOM_MODEL_DEFAULTS;
        const windowOpen = sc ? !!sc.windowOpen : !!thermoCaps.alarm_open_window_detected;
        // An open window pauses the heating, so the room behaves passively — and the
        // open state is assumed to persist (it may stay open for days).
        const heatingActive = !!room.heating && heatingEnabled !== false && !windowOpen;
        let prediction = [];
        if (startTemp != null && (room.sensors.length || room.heating)) {
          const startMin = lastPoint ? lastPoint.m : nowMin;
          prediction = predictRoom({
            startMin,
            startTemp,
            params: model,
            targetAt: heatingActive ? makeTargetAt({
              startMin,
              slots,
              status: sc,
              deviceTarget: thermoCaps.target_temperature != null ? thermoCaps.target_temperature : null,
              weekend,
              roomKey: room.heating.key,
            }) : null,
            outdoorAt: makeOutdoorAt(outForecast, outsideLatest),
            stepMin: PRED_STEP_MIN,
          });
        }

        const slot = room.heating ? heatingSlot(room.heating.key, weekend, nowMin) : null;
        const mode = sc && sc.mode && sc.mode !== 'auto' ? sc.mode : null;
        const power = thermoCaps.tado_heating_power;
        const sensorLatest = room.sensors.find((s) => typeof s.latest === 'number');
        const curTemp = thermoCaps.measure_temperature != null ? thermoCaps.measure_temperature
          : lastPoint ? lastPoint.v
            : sensorLatest ? sensorLatest.latest : null;
        const target = thermoCaps.target_temperature != null ? thermoCaps.target_temperature
          : sc && sc.effectiveTarget != null ? sc.effectiveTarget
            : slot ? slot.target : null;

        const hasLights = room.lights.length > 0;
        // Show the climate panel for any room with history sensors OR heating config —
        // the schedule/forecast/controls must not depend on Insights being reachable.
        const hasClimate = room.sensors.length > 0 || !!room.heating;
        const uid = room.path.replace(/[^a-z0-9]/gi, '');

        return (
          <div key={room.path} className="r2-room">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 8px', flexWrap: 'wrap' }}>
              <h3 className="r2-room-title">{room.name}</h3>
              {mode && HEAT_MODE[mode] && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: HEAT_MODE[mode].bg, color: HEAT_MODE[mode].color, fontWeight: 600 }}>
                  {HEAT_MODE[mode].label}
                </span>
              )}
            </div>

            <div className="r2-row">
              <StatusPanel
                room={room}
                zone={zones && room.devices[0] ? zones[room.devices[0].zoneId] : null}
                onControl={onControl}
                heatingWindowOpen={!!(room.heating && windowOpen)}
              />

              {(hasClimate || hasLights) && (
                <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '12px 14px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    {/* One identical title on every room card; the legend tells the rest. */}
                    <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      📈 Today
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 10.5, color: '#6b7280', flexWrap: 'wrap' }}>
                      {hasClimate && <span><i style={{ display: 'inline-block', width: 14, borderTop: '2.5px solid #2563eb', verticalAlign: 'middle', marginRight: 4 }} />measured</span>}
                      {room.heating && <span><i style={{ display: 'inline-block', width: 14, borderTop: `2px solid ${TARGET_COLOR}`, verticalAlign: 'middle', marginRight: 4 }} />scheduled target</span>}
                      {prediction.length > 1 && <span><i style={{ display: 'inline-block', width: 14, borderTop: '2px dashed #2563eb', verticalAlign: 'middle', marginRight: 4 }} />forecast</span>}
                      {profiles && <span><i style={{ display: 'inline-block', width: 14, borderTop: '2px solid #f59e0b', opacity: 0.6, verticalAlign: 'middle', marginRight: 4 }} />💡 light level</span>}
                    </div>
                  </div>

                  <ClimateChart
                    series={hasClimate ? series : []} slots={hasClimate ? slots : []}
                    prediction={hasClimate ? prediction : []} nowMin={nowMin}
                    lighting={profiles ? { profiles, sun } : null} uid={uid}
                  />

                  {series.length > 1 && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10.5, color: '#6b7280', marginTop: 4 }}>
                      {series.map((s, i) => (
                        <span key={s.key}><i style={{ display: 'inline-block', width: 12, borderTop: `2px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}`, verticalAlign: 'middle', marginRight: 4, opacity: i === 0 ? 1 : 0.55 }} />{s.name}</span>
                      ))}
                    </div>
                  )}

                  {prediction.length > 1 && (
                    <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 4 }}
                      title="Forecast model: the room drifts toward the outdoor temperature plus its internal gains; the radiator lifts it toward the thermostat target but never above it. Parameters fit from the last 7 days of Insights (room, outdoor, heating output).">
                      🧠 {model.learned
                        ? `fit from ${model.samples} h this week: heat loss τ≈${(1 / (model.k * 60)).toFixed(1)} h · gains ${model.c >= 0 ? '+' : ''}${(model.c * 60).toFixed(2)} °C/h`
                        : 'model defaults (not enough history yet)'}
                      {room.heating && ` · radiator ≈${(model.g * 60).toFixed(1)} °C/h${model.gLearned ? '' : ' (default)'}`}
                      {' · outdoor: '}
                      {outForecast.length ? 'Open-Meteo forecast (home location)' : outsideLatest != null ? `current reading ${outsideLatest.toFixed(1)}°` : 'unknown'}
                      {room.heating && !heatingActive && (heatingEnabled === false ? ' · heating off' : ' · window open — heating paused')}
                    </div>
                  )}

                  {/* explain empty states instead of drawing nothing silently */}
                  {hasClimate && (() => {
                    const notes = [];
                    if (!room.sensors.length) {
                      notes.push('no Insights temperature log matched this room — measured line unavailable');
                    } else if (!series.some((s) => s.points.length)) {
                      notes.push('temperature history matched but has no samples for today yet');
                    }
                    if ((room.heating || room.sensors.length) && !prediction.length) {
                      notes.push('no current temperature reading — forecast unavailable');
                    }
                    return notes.length ? (
                      <div style={{ fontSize: 10.5, color: '#b45309', marginTop: 4 }}>
                        ⚠ {notes.join(' · ')}
                      </div>
                    ) : null;
                  })()}

                  {/* Temperature footers render last (flex order) — at the very bottom. */}
                  {hasClimate && !room.heating && curTemp != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto', order: 3, paddingTop: 10, borderTop: '1px solid #eef0f2', flexWrap: 'wrap', minHeight: 28, boxSizing: 'content-box' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{curTemp.toFixed(1)}°</div>
                      {sensorLatest && <span style={{ fontSize: 11.5, color: '#9ca3af' }}>🌡️ {sensorLatest.name}</span>}
                    </div>
                  )}

                  {room.heating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto', order: 3, paddingTop: 10, borderTop: '1px solid #eef0f2', flexWrap: 'wrap', minHeight: 28, boxSizing: 'content-box' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                        {curTemp != null ? `${curTemp.toFixed(1)}°` : '—'}
                      </div>
                      {room.heating.thermostatId && target != null ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#6b7280' }}>
                          target
                          <button onClick={() => adjustTarget(room, -0.5)} disabled={heatingEnabled === false}
                            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid #e3e6ea', background: '#fff', cursor: 'pointer', lineHeight: 1 }}>−</button>
                          <b style={{ minWidth: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{target}°</b>
                          <button onClick={() => adjustTarget(room, 0.5)} disabled={heatingEnabled === false}
                            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid #e3e6ea', background: '#fff', cursor: 'pointer', lineHeight: 1 }}>＋</button>
                        </div>
                      ) : target != null && (
                        <span style={{ fontSize: 12.5, color: '#6b7280' }}>target <b>{target}°</b></span>
                      )}
                      {power != null && (
                        <span style={{ fontSize: 11.5, color: '#6b7280' }}>🔥 {Math.round(power)}%</span>
                      )}
                      {slot && (
                        <span style={{ fontSize: 11.5, color: '#9ca3af' }}>📅 {slot.name} · {slot.target}°</span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {HEATING_ACTIONS.map((a) => {
                          const bk = `${room.heating.key}:${a.key}`;
                          const disabled = busy.has(bk) || heatingEnabled === false;
                          return (
                            <button key={a.key} onClick={() => runHeatAction(room, a)} disabled={disabled}
                              style={heatBtn(a.key, disabled)}
                              title={heatingEnabled === false ? 'Heating system is off' : `Run the ${a.key} flow for ${room.heating.label}`}>
                              {busy.has(bk) ? '…' : a.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Lights: chips + tiles + footer, under the temperature footer. */}
                  {hasLights && (
                    <>
                      <div style={{ order: 1, marginTop: 10, paddingTop: 10, borderTop: hasClimate ? '1px solid #eef0f2' : 'none' }}>
                        {profiles && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                            {phaseList(profiles, sun).map((p) => {
                              const active = isActive(p, nowMin);
                              return (
                                <button
                                  key={p.name}
                                  onClick={() => applyPhase(room, p.name)}
                                  disabled={applying === room.path}
                                  title={`Set these lights to ${p.name} now (${Math.round(p.brightness * 100)}%)`}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '3px 8px',
                                    borderRadius: 6, border: `1px solid ${active ? '#2563eb' : '#e3e6ea'}`,
                                    background: active ? '#eff4ff' : '#fff', color: '#374151',
                                    cursor: applying === room.path ? 'default' : 'pointer', opacity: applying === room.path ? 0.6 : 1,
                                  }}
                                >
                                  <span style={{ width: 8, height: 8, borderRadius: 2, background: tempColor(p.temperature), border: '1px solid rgba(0,0,0,0.15)' }} />
                                  {p.name} {fmtMinutes(p.start)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
                          {room.lights.map((d) => {
                            const al = room.alMembers.find((m) => m.id === d.id);
                            return (
                              <LightTile
                                key={d.id} device={d} al={al ? lightMode(al) : null}
                                onToggle={onControl ? (v) => onControl(d.id, { onoff: v }) : null}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: hasClimate ? 10 : 'auto', order: 2, paddingTop: 10, borderTop: '1px solid #eef0f2', flexWrap: 'wrap', minHeight: 28, boxSizing: 'content-box' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                          {room.lights.filter((d) => d.capabilities && d.capabilities.onoff).length}
                          <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280' }}> / {room.lights.length} on</span>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {[['💡 All on', true, '#16a34a'], ['⏻ All off', false, '#6b7280']].map(([label, on, color]) => {
                            const busyAll = applying === room.path;
                            return (
                              <button
                                key={label} onClick={() => setAllLights(room, on)} disabled={busyAll}
                                title={`Turn all lights in ${room.name} ${on ? 'on' : 'off'}`}
                                style={{
                                  padding: '4px 11px', borderRadius: 999, border: `1px solid ${color}`,
                                  background: '#fff', color, fontSize: 11.5, whiteSpace: 'nowrap',
                                  cursor: busyAll ? 'default' : 'pointer', opacity: busyAll ? 0.45 : 1,
                                }}
                              >
                                {busyAll ? '…' : label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {rooms.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>
          No rooms with lights or temperature sensors found yet.
        </div>
      )}
    </div>
  );
}
