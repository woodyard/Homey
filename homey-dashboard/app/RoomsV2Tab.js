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
  fmtMinutes, copenhagenMinutesNow, isWeekendNow, isWeekendScheduleNow, isIdle,
} from '../lib/adaptiveLighting';
import {
  HEATING_ROOMS, HEATING_ACTIONS, heatingDaySlots, heatingSlot, guessHeatFlow,
} from '../lib/heating';
import { estimateRoomModel, ROOM_MODEL_DEFAULTS, predictRoom } from '../lib/thermal';
import { explainHeating, heatingRoomSensor, hhmm, liveWindowClosedAt, liveWindowOpen, optimisticMode } from '../lib/heatingState';
import {
  AppWindow, BatteryFull, BatteryLow, BatteryMedium, Blinds, Bot, Brain, CalendarClock, ChartSpline,
  ClipboardList, Coffee, DoorClosed, DoorOpen, Fan, Flame, Footprints, Heater, House, Lightbulb,
  LoaderCircle, Minus, Moon, Pause, Plug, Plus, Power, Refrigerator, RotateCcw, Snowflake, Sparkles,
  Speaker, Thermometer, TriangleAlert, Tv, WashingMachine,
} from 'lucide-react';
import HeatingReason, { HeatingTag, useNow } from './HeatingReason';
import styles from './RoomsV2Tab.module.css';

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
  socket: Plug, tv: Tv, mediaplayer: Speaker, coffeemachine: Coffee, fridge: Refrigerator, freezer: Snowflake,
  washer: WashingMachine, vacuumcleaner: Bot, heater: Heater, curtain: Blinds, fan: Fan, other: House,
};

function batteryColor(pct) {
  return pct <= 20 ? 'var(--bad)' : pct <= 50 ? 'var(--warn)' : 'var(--good)';
}

function BatteryIcon({ pct }) {
  const Icon = pct <= 20 ? BatteryLow : pct <= 50 ? BatteryMedium : BatteryFull;
  return <Icon size={13} strokeWidth={2.2} />;
}

function otherStateText(caps) {
  if (caps.display_status) return String(caps.display_status);
  if (caps.operational_state != null) return `state ${caps.operational_state}`;
  if (caps.windowcoverings_set != null) return `${Math.round(caps.windowcoverings_set * 100)}%`;
  return null;
}

// Small uppercase panel heading with an icon.
function Eyebrow({ icon: Icon, children }) {
  return (
    <div className={`hd-eyebrow ${styles.eyebrow}`}>
      {Icon && <Icon size={13} strokeWidth={2.2} />}
      {children}
    </div>
  );
}

// Left card: room status — why the heating is (not) on, motion inactivity, open
// windows/doors with duration, batteries, and any devices not covered by the
// lights/heating sections.
function StatusPanel({ room, zone, onControl, heatingWhy, now }) {
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
    <div className={`hd-inset ${styles.panel}`}>
      <Eyebrow icon={ClipboardList}>Status</Eyebrow>

      {heatingWhy && (
        <div>
          <div className={styles.subLabel}>Heating</div>
          <HeatingReason info={heatingWhy} now={now} />
        </div>
      )}

      {(motionDevs.length > 0 || contacts.length > 0) && (
        <div>
          <div className={styles.subLabel}>Activity</div>
          {motionDevs.length > 0 && (
            motionActive
              ? (
                <div className={styles.row}>
                  <span className={styles.rowIcon} style={{ color: 'var(--good)' }}><Footprints size={15} /></span>
                  <span className={styles.rowName} style={{ color: 'var(--good)', fontWeight: 600 }}>Active now</span>
                  <span className={styles.rowEnd}><span className={`hd-live-dot ${styles.liveDot}`} /></span>
                </div>
              )
              : (
                <div className={styles.row} title={motionTs ? `No motion since ${new Date(motionTs).toLocaleString()}` : undefined}>
                  <span className={styles.rowIcon}><Moon size={15} /></span>
                  <span className={styles.rowName}>Inactive{fmtAgo(motionTs) ? ` for ${fmtAgo(motionTs)}` : ''}</span>
                </div>
              )
          )}
          {contacts.map((d) => {
            const open = !!d.capabilities.alarm_contact;
            const since = (d.capTimes || {}).alarm_contact;
            const Icon = /vindue|window/i.test(d.name) ? AppWindow : open ? DoorOpen : DoorClosed;
            return (
              <div key={d.id} className={styles.row} title={since ? `Last change ${new Date(since).toLocaleString()}` : undefined}>
                <span className={styles.rowIcon} style={open ? { color: 'var(--warn)' } : undefined}><Icon size={15} /></span>
                <span className={styles.rowName}>{d.name}</span>
                <span className={styles.rowEnd}>
                  {open
                    ? <span className="hd-tag hd-tag-warn">open{fmtAgo(since) ? ` · ${fmtAgo(since)}` : ''}</span>
                    : <span className={styles.stateText}>closed</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div className={styles.subLabel}>Devices</div>
          {others.map((d) => {
            const caps = d.capabilities || {};
            const stateText = otherStateText(caps);
            const unavailable = d.available === false;
            const Icon = STATUS_ICON[d.virtualClass || d.class] || House;
            return (
              <div key={d.id} className={styles.row} style={unavailable ? { opacity: 0.55 } : undefined}
                title={unavailable ? `${d.name}: unavailable (unpowered or unreachable)` : undefined}>
                <span className={styles.rowIcon}><Icon size={15} /></span>
                <span className={styles.rowName}>{d.name}</span>
                <span className={styles.rowEnd}>
                  {unavailable && <span className={styles.warnIcon} title="Unavailable"><TriangleAlert size={13} /></span>}
                  {stateText && <span className={styles.stateText}>{stateText}</span>}
                  {'onoff' in caps && onControl
                    ? (
                      <MiniToggle
                        on={!!caps.onoff} onChange={(v) => onControl(d.id, { onoff: v })} disabled={!!d.alwaysOn || unavailable}
                        title={unavailable ? `${d.name}: unavailable`
                          : d.alwaysOn ? `${d.name}: always on` : `${d.name}: turn ${caps.onoff ? 'off' : 'on'}`}
                      />
                    )
                    : !stateText && <span className={styles.stateText}>—</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {batteries.length > 0 && (
        <div>
          <div className={styles.subLabel}>Batteries</div>
          <div className={styles.batteries}>
            {batteries.map((d) => {
              const pct = d.capabilities.measure_battery;
              return (
                <span key={d.id} title={d.name} className={styles.battery}>
                  <span className={styles.batteryPct} style={{ color: batteryColor(pct) }}>
                    <BatteryIcon pct={pct} />
                    {Math.round(pct)}%
                  </span>
                  <span className={styles.batteryName}>{d.name}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {motionDevs.length === 0 && contacts.length === 0 && !heatingWhy
        && others.length === 0 && batteries.length === 0 && (
        <div className={styles.nothing}>Nothing to report.</div>
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
      className={`${styles.toggle}${on ? ` ${styles.toggleOn}` : ''}${disabled ? ` ${styles.toggleDisabled}` : ''}`}
    >
      <span className={styles.track}><span className={styles.knob} /></span>
    </button>
  );
}

// A single bulb as a glowing tile with live state. `al` is resolveLightMode's
// { mode, guess, st } for lights AdaptiveLighting manages, else null.
const LIGHT_MODE_LABEL = { auto: 'Auto', manual: 'Manual', drift: 'Manual?', forced: 'Forced', off: 'Off', unknown: '—' };
const LIGHT_MODE_TAG = { auto: 'hd-tag-good', manual: 'hd-tag-warn', drift: 'hd-tag-warn', forced: 'hd-tag-accent' };
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
  const modeText = mode
    ? `${mode === 'forced' && al.st?.profile ? `Forced ${al.st.profile}` : LIGHT_MODE_LABEL[mode] || mode}${al.guess ? ' (guessed)' : ''}${!al.guess && mode !== 'off' && isIdle(al.st) ? ' · idle' : ''}`
    : '';
  const alText = al && al.st ? describeLightStatus(al.st) : '';
  // A lit tile is tinted by the bulb's own colour with a glow that grows with brightness.
  const level = dim != null ? dim : 0.75;
  const tileStyle = on ? {
    background: `color-mix(in srgb, ${color} 20%, var(--surface-solid))`,
    borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
    boxShadow: `0 8px 24px -10px color-mix(in srgb, ${color} ${Math.round(45 + level * 40)}%, transparent)`,
  } : undefined;
  const iconStyle = on ? {
    background: `color-mix(in srgb, ${color} 38%, transparent)`,
    color: `color-mix(in srgb, ${color} 72%, var(--text))`,
    boxShadow: `0 0 ${Math.round(6 + level * 12)}px color-mix(in srgb, ${color} 65%, transparent)`,
  } : undefined;
  return (
    <div
      title={unavailable
        ? `${device.name}: unavailable (unpowered or unreachable)`
        : `${device.name}: ${on ? (dim != null ? `${Math.round(dim * 100)}%` : 'on') : 'off'}${modeText ? ` · ${modeText}` : ''}${alText ? `\nScript: ${alText}` : ''}`}
      className={`${styles.tile}${unavailable ? ` ${styles.tileUnavailable}` : ''}`}
      style={tileStyle}
    >
      <span className={styles.tileIcon} style={iconStyle}>
        <Lightbulb size={17} strokeWidth={2} />
      </span>
      <div className={styles.tileBody}>
        <span className={styles.tileName}>{device.name}</span>
        <span className={styles.tileMeta}>
          {unavailable && <span className={styles.warnIcon} title="Unavailable"><TriangleAlert size={12} /></span>}
          <span>{on ? (dim != null ? `${Math.round(dim * 100)}%` : 'On') : 'Off'}</span>
          {mode && (
            <span className={`hd-tag ${LIGHT_MODE_TAG[mode] || ''}`} style={al.guess ? { opacity: 0.6 } : undefined} title={modeText}>
              {mode === 'forced' ? 'Forced' : LIGHT_MODE_LABEL[mode] || mode}
            </span>
          )}
        </span>
      </div>
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

// Data colours — picked to read on both the light and the dark theme.
const SERIES_COLORS = ['#5b7cff', '#22b8cf', '#14b8a6', '#ec4899'];
const TARGET_COLOR = '#a855f7'; // scheduled heating target — distinct from the orange light curve
const FORECAST_COLOR = '#5b7cff';
const LIGHT_LEVEL_COLOR = '#f59e0b';
const SUN_MARK_COLOR = '#f3c96b';

function LegendItem({ color, dashed, width = 2, opacity = 1, children }) {
  return (
    <span className={styles.legendItem}>
      <svg width="18" height="4" aria-hidden="true" style={{ opacity, flex: 'none' }}>
        <line x1="1" x2="17" y1="2" y2="2" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? '3.5 3' : undefined} />
      </svg>
      {children}
    </span>
  );
}

function ClimateChart({ series, slots, prediction, nowMin, lighting, uid }) {
  const wrapRef = useRef(null);
  const [W, setW] = useState(920);
  const [hover, setHover] = useState(null);

  // Optional adaptive-lighting overlay: brightness on a 0–100% right-hand axis.
  const light = lighting ? brightnessModel(lighting.profiles, lighting.sun) : null;

  const allVals = [
    ...series.flatMap((s) => s.points.map((p) => p.v)),
    ...prediction.map((p) => p.v),
    ...slots.map((s) => s.target),
  ];
  const hasTemp = allVals.length > 0;
  const empty = !hasTemp && !light;

  // Draw at the container's real pixel width so the labels stay legible on a phone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setW(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  const narrow = W < 560;
  const H = narrow ? 220 : 260;
  const M = { l: narrow ? 34 : 40, r: lighting ? (narrow ? 32 : 34) : 14, t: 26, b: 22 };

  const x = (m) => M.l + (m / 1440) * (W - M.l - M.r);
  const yb = (b) => H - M.b - b * (H - M.t - M.b);

  if (empty) return <div ref={wrapRef} className={`hd-empty ${styles.chartEmpty}`}>No temperature data yet today.</div>;
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

  const mainPts = series[0] && series[0].points.length > 1 ? series[0].points : null;
  const top = M.t - 16;
  const bottom = H - M.b;

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
    <div ref={wrapRef} className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {mainPts && (
          <defs>
            <linearGradient id={`area-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[0]} stopOpacity="0.24" />
              <stop offset="100%" stopColor={SERIES_COLORS[0]} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {/* schedule slot bands + labels */}
        {slots.map((s, i) => {
          // Clamp to the drawn day, and keep the label inside the plot at the edges.
          const x0 = x(Math.max(0, s.start));
          const x1 = x(Math.min(1440, s.end));
          if (x1 <= x0) return null;
          const label = `${s.name} ${s.target}°${s.offset > 0 ? ` (−${s.offset}° idle)` : ''}`;
          const half = label.length * 2.9;
          const mid = (x0 + x1) / 2;
          const lx = mid + half > W - M.r ? W - M.r - 2 : mid - half < M.l ? M.l + 2 : mid;
          const anchor = lx === mid ? 'middle' : lx > mid ? 'end' : 'start';
          return (
            <g key={`${s.name}-${s.start}`}>
              <rect x={x0} y={top} width={x1 - x0} height={bottom - top}
                style={{ fill: 'var(--heat)', fillOpacity: i % 2 ? 0.075 : 0.035 }} />
              {(x1 - x0) > 52 && (
                <text x={lx} y={M.t - 5} textAnchor={anchor} fontSize="10"
                  style={{ fill: 'var(--muted)', fontWeight: 500 }}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--chart-grid)' }} />
            <text x={M.l - 7} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" style={{ fill: 'var(--chart-axis)' }}>{v}°</text>
          </g>
        ))}
        {/* adaptive-lighting overlay: brightness area (right axis) behind the temp curves */}
        {light && (() => {
          const curve = light.samples
            .map((b, i) => `${i ? 'L' : 'M'} ${x(i * light.STEP).toFixed(1)} ${yb(b).toFixed(1)}`).join(' ');
          const area = `${curve} L ${x(1440).toFixed(1)} ${bottom} L ${M.l} ${bottom} Z`;
          const sunrise = lighting.sun.sunriseMinutes;
          const sunset = lighting.sun.sunsetMinutes;
          return (
            <g>
              <defs>
                <linearGradient id={`cmb-${uid}`} x1="0" x2="1" y1="0" y2="0">
                  {light.stops.map((s, i) => <stop key={i} offset={`${(s.at * 100).toFixed(1)}%`} stopColor={s.color} />)}
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#cmb-${uid})`} opacity="0.22" />
              <path d={curve} fill="none" stroke={`url(#cmb-${uid})`} strokeWidth="1.8" opacity="0.85" />
              {/* dim the night hours */}
              <rect x={M.l} y={top} width={x(sunrise) - M.l} height={bottom - top} style={{ fill: 'var(--neutral-soft)' }} />
              <rect x={x(sunset)} y={top} width={W - M.r - x(sunset)} height={bottom - top} style={{ fill: 'var(--neutral-soft)' }} />
              {/* sun / moon markers */}
              {[[sunrise, '☀️'], [sunset, '🌙']].map(([m, icon]) => (
                <g key={icon}>
                  <line x1={x(m)} x2={x(m)} y1={M.t - 6} y2={bottom} stroke={SUN_MARK_COLOR} strokeDasharray="2 3" opacity="0.9" />
                  <text x={x(m)} y={bottom - 5} textAnchor="middle" fontSize="10">{icon}</text>
                </g>
              ))}
              {/* right-hand brightness axis */}
              {[0, 0.5, 1].map((b) => (
                <text key={b} x={W - M.r + 4} y={yb(b) + 3.5} fontSize="9.5" style={{ fill: 'var(--faint)' }}>{Math.round(b * 100)}%</text>
              ))}
            </g>
          );
        })()}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 6} fontSize="10.5" style={{ fill: 'var(--chart-axis)' }}
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {String(h).padStart(2, '0')}
          </text>
        ))}
        {/* scheduled target step line */}
        {slots.length > 0 && (
          <path d={targetPath} fill="none" stroke={TARGET_COLOR} strokeWidth="2" opacity="0.9"
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* soft area under the primary measured line */}
        {mainPts && (
          <path
            d={`${linePath(mainPts)} L ${x(mainPts[mainPts.length - 1].m).toFixed(1)} ${bottom} L ${x(mainPts[0].m).toFixed(1)} ${bottom} Z`}
            fill={`url(#area-${uid})`}
          />
        )}
        {/* measured lines since midnight */}
        {series.map((s, i) => s.points.length > 1 && (
          <path key={s.key} d={linePath(s.points)} fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={i === 0 ? 2.6 : 1.5} opacity={i === 0 ? 1 : 0.6}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* prediction */}
        {prediction.length > 1 && (
          <path d={linePath(prediction)} fill="none" stroke={FORECAST_COLOR} strokeWidth="2"
            strokeDasharray="5 5" opacity="0.7" strokeLinecap="round" />
        )}
        {/* now marker */}
        <line x1={x(nowMin)} x2={x(nowMin)} y1={top} y2={bottom} strokeWidth="1.6"
          style={{ stroke: 'var(--bad)', filter: 'drop-shadow(0 0 3px var(--bad))' }} />
        <circle cx={x(nowMin)} cy={top} r="6" style={{ fill: 'var(--bad)', fillOpacity: 0.18 }} />
        <circle cx={x(nowMin)} cy={top} r="3" style={{ fill: 'var(--bad)' }} />
        {hover && (
          <g>
            <line x1={hover.px} x2={hover.px} y1={top} y2={bottom} strokeWidth="1" strokeDasharray="4 4"
              style={{ stroke: 'var(--muted)' }} />
            {hover.actual && (
              <circle cx={x(hover.actual.m)} cy={y(hover.actual.v)} r="4" fill={SERIES_COLORS[0]} strokeWidth="2"
                style={{ stroke: 'var(--surface-solid)' }} />
            )}
            {hover.pred && (
              <circle cx={x(hover.pred.m)} cy={y(hover.pred.v)} r="3.5" fill={FORECAST_COLOR} strokeWidth="2"
                style={{ stroke: 'var(--surface-solid)' }} />
            )}
          </g>
        )}
      </svg>
      {hover && (
        <div
          className={`${styles.tooltip}${narrow ? ` ${styles.tooltipNarrow}` : ''}`}
          style={narrow ? undefined : { left: `${Math.max(8, Math.min(84, (hover.px / W) * 100))}%` }}
        >
          <b className="hd-num">{fmtMinutes(hover.m)}</b>
          {hover.slot && <span className={styles.tipItem} style={{ color: TARGET_COLOR }}>{hover.slot.name} → {hover.slot.target}°</span>}
          {hover.actual && (
            <span className={styles.tipItem}>
              <i className={styles.tipDot} style={{ background: SERIES_COLORS[0] }} />measured <b>{hover.actual.v.toFixed(1)}°</b>
            </span>
          )}
          {hover.pred && (
            <span className={styles.tipItem}>
              <i className={styles.tipDot} style={{ background: FORECAST_COLOR, opacity: 0.6 }} />forecast {hover.pred.v.toFixed(1)}°
            </span>
          )}
          {hover.light != null && (
            <span className={styles.tipItem} style={{ color: 'var(--warn)' }}>
              <Lightbulb size={12} strokeWidth={2.2} />{Math.round(hover.light * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Icons for the inline heating actions (the header state tag comes from HeatingTag).
const HEAT_ACTION_UI = {
  boost: { icon: Flame, className: styles.boost },
  pause: { icon: Pause, className: '' },
  reset: { icon: RotateCcw, className: 'hd-btn-soft' },
};

// HEATING_ACTIONS labels carry a leading emoji/symbol ('🔥 Boost') — the button
// draws its own icon, so only the word is shown.
function actionText(label) {
  return String(label).replace(/^[^\p{L}\p{N}]+/u, '').trim() || label;
}

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
  const [heatLoaded, setHeatLoaded] = useState(false);
  const loadHeatRef = useRef(() => {});
  const [heatingEnabled, setHeatingEnabled] = useState(null);
  const [heatMapping, setHeatMapping] = useState({});
  const [busy, setBusy] = useState(() => new Set());
  const [applying, setApplying] = useState(null);
  const [err, setErr] = useState('');
  const now = useNow(30000); // heating countdowns move between status polls

  // Heating status (mode / windowOpen / away / effectiveTarget per zone).
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/homey/heating').then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setHeatLoaded(true);
        if (j.error) return; // a failed Homey read answers with an empty status: keep the last one
        setHeatingEnabled(j.heatingEnabled);
        if (j.status) setHeatStatus(j.status);
      })
      .catch(() => { if (!cancelled) setHeatLoaded(true); });
    loadHeatRef.current = load;
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
    // Show the new mode at once; the re-polls replace it when the script has published.
    setHeatStatus((prev) => ({ ...prev, [hr.zone]: optimisticMode(prev[hr.zone], action.key, Date.now()) }));
    try {
      const r = await fetch('/api/homey/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'flow trigger failed');
      [1500, 3500, 6000].forEach((ms) => setTimeout(() => loadHeatRef.current(), ms));
      setTimeout(() => onReload && onReload(), 2500);
    } catch (e) {
      setErr(String(e.message || e));
      loadHeatRef.current(); // revert the optimistic state to reality
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
      <div className={styles.intro}>
        <span className="hd-tag hd-tag-violet"><Sparkles size={12} strokeWidth={2.2} />Experimental</span>
        <span className="hd-pill">
          <CalendarClock size={14} />
          <span>Today follows the <b>{weekend ? 'weekend' : 'weekday'}</b> schedules</span>
        </span>
      </div>
      <p className="hd-lede">
        Experimental room view: live lights with today&apos;s adaptive-lighting curve, and today&apos;s
        temperature with the heating schedule and a <span className={styles.dashSample}>forecast</span> for
        the rest of the day. The forecast is an estimate (assumes current boost/pause/manual mode runs out
        as scheduled and ignores future motion/windows).
      </p>

      {err && (
        <div className="hd-error">
          <TriangleAlert size={15} style={{ flex: 'none', marginTop: 1 }} />
          <span>{err}</span>
        </div>
      )}

      <div className={styles.rooms}>
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
          // Status lags up to 5 min behind the contact sensors: a closed window is no longer open.
          const liveWindow = room.heating ? liveWindowOpen(devices, room.heating.zone) : null;
          const windowOpen = sc ? !!sc.windowOpen && liveWindow !== false : !!thermoCaps.alarm_open_window_detected;
          const power = thermoCaps.tado_heating_power;
          const sensorLatest = room.sensors.find((s) => typeof s.latest === 'number');
          // The sensor the heating acts on, as on the Heating tab; history is for the chart.
          const roomSensor = room.heating && !room.heating.thermostatId ? heatingRoomSensor(devices, room.heating.zone) : null;
          const heatTemp = thermoCaps.measure_temperature != null ? thermoCaps.measure_temperature
            : roomSensor ? roomSensor.capabilities.measure_temperature : null;
          const curTemp = heatTemp != null ? heatTemp
            : sc && sc.currentTemp != null ? sc.currentTemp
              : lastPoint ? lastPoint.v
                : sensorLatest ? sensorLatest.latest : null;
          const plugs = room.heating ? (room.heating.plugIds || []).map((id) => deviceById.get(id)).filter(Boolean) : [];
          // Why the room is (not) heating — status strip + header tag.
          const why = room.heating ? explainHeating({
            sc,
            heatingEnabled,
            kind: room.heating.thermostatId ? 'tado' : 'plug',
            power: power != null ? power : null,
            plugOn: plugs.length ? plugs.some((p) => !!(p.capabilities || {}).onoff) : null,
            temp: heatTemp,
            deviceTarget: thermoCaps.target_temperature != null ? thermoCaps.target_temperature : null,
            liveWindow,
            liveClosedAt: liveWindowClosedAt(devices, room.heating.zone),
            manualMinutes: room.heating.manualDuration,
            loading: !heatLoaded,
            now,
          }) : null;
          // An open window pauses the heating, so the room behaves passively — and the
          // open state is assumed to persist (it may stay open for days). During a settle
          // delay that holds the heating off, the room stays passive until the resume time.
          const heatingActive = !!room.heating && heatingEnabled !== false && !windowOpen;
          const resumeAt = why && why.resumeAt && why.resumeAt > now ? why.resumeAt : null;
          let prediction = [];
          if (startTemp != null && (room.sensors.length || room.heating)) {
            const startMin = lastPoint ? lastPoint.m : nowMin;
            const scheduleAt = heatingActive ? makeTargetAt({
              startMin,
              slots,
              status: sc,
              deviceTarget: thermoCaps.target_temperature != null ? thermoCaps.target_temperature : null,
              weekend,
              roomKey: room.heating.key,
            }) : null;
            const resumeMin = resumeAt ? nowMin + (resumeAt - now) / 60000 : null;
            prediction = predictRoom({
              startMin,
              startTemp,
              params: model,
              targetAt: scheduleAt && resumeMin != null ? (m) => (m < resumeMin ? null : scheduleAt(m)) : scheduleAt,
              outdoorAt: makeOutdoorAt(outForecast, outsideLatest),
              stepMin: PRED_STEP_MIN,
            });
          }

          const slot = room.heating ? heatingSlot(room.heating.key, weekend, nowMin) : null;
          const target = thermoCaps.target_temperature != null ? thermoCaps.target_temperature
            : sc && sc.effectiveTarget != null ? sc.effectiveTarget
              : slot ? slot.target : null;

          const hasLights = room.lights.length > 0;
          // Show the climate panel for any room with history sensors OR heating config —
          // the schedule/forecast/controls must not depend on Insights being reachable.
          const hasClimate = room.sensors.length > 0 || !!room.heating;
          const uid = room.path.replace(/[^a-z0-9]/gi, '');

          const lightsOn = room.lights.filter((d) => d.capabilities && d.capabilities.onoff).length;
          const motionNow = room.devices.some((d) => !!(d.capabilities || {}).alarm_motion);
          const busyAll = applying === room.path;

          // explain empty states instead of drawing nothing silently
          const notes = [];
          if (hasClimate) {
            if (!room.sensors.length) {
              notes.push('no Insights temperature log matched this room — measured line unavailable');
            } else if (!series.some((s) => s.points.length)) {
              notes.push('temperature history matched but has no samples for today yet');
            }
            if ((room.heating || room.sensors.length) && !prediction.length) {
              notes.push('no current temperature reading — forecast unavailable');
            }
          }

          return (
            <section key={room.path} className={`hd-card hd-fade-in ${styles.room}`}>
              <header className={styles.roomHead}>
                <div className={styles.roomTitle}>
                  <h3 className={styles.roomName}>{room.name}</h3>
                  {motionNow && <span className={`hd-live-dot ${styles.liveDot}`} title="Motion right now" />}
                  {room.path !== room.name && <span className={styles.roomPath}>{room.path}</span>}
                </div>
                <div className={styles.headTags}>
                  <HeatingTag info={why} />
                  {curTemp != null && (
                    <span className="hd-tag hd-num" title="Current temperature">
                      <Thermometer size={12} strokeWidth={2.2} />{curTemp.toFixed(1)}°
                    </span>
                  )}
                  {hasLights && (
                    <span className={`hd-tag hd-num${lightsOn ? ' hd-tag-warn' : ''}`} title="Lights on">
                      <Lightbulb size={12} strokeWidth={2.2} />{lightsOn}/{room.lights.length}
                    </span>
                  )}
                </div>
              </header>

              <div className={styles.grid}>
                <StatusPanel
                  room={room}
                  zone={zones && room.devices[0] ? zones[room.devices[0].zoneId] : null}
                  onControl={onControl}
                  heatingWhy={why}
                  now={now}
                />

                {(hasClimate || hasLights) && (
                  <div className={styles.col}>
                    {/* Today: temperature + schedule + forecast + light level on one chart. */}
                    <div className={`hd-inset ${styles.panel} ${styles.stack}`}>
                      <div className={styles.panelHead}>
                        {/* One identical title on every room card; the legend tells the rest. */}
                        <Eyebrow icon={ChartSpline}>Today</Eyebrow>
                        <div className={styles.legend}>
                          {hasClimate && <LegendItem color={SERIES_COLORS[0]} width={2.5}>measured</LegendItem>}
                          {room.heating && <LegendItem color={TARGET_COLOR}>scheduled target</LegendItem>}
                          {prediction.length > 1 && <LegendItem color={FORECAST_COLOR} dashed>forecast</LegendItem>}
                          {profiles && <LegendItem color={LIGHT_LEVEL_COLOR} opacity={0.7}>light level</LegendItem>}
                        </div>
                      </div>

                      <ClimateChart
                        series={hasClimate ? series : []} slots={hasClimate ? slots : []}
                        prediction={hasClimate ? prediction : []} nowMin={nowMin}
                        lighting={profiles ? { profiles, sun } : null} uid={uid}
                      />

                      {series.length > 1 && (
                        <div className={`${styles.legend} ${styles.legendLeft}`}>
                          {series.map((s, i) => (
                            <LegendItem key={s.key} color={SERIES_COLORS[i % SERIES_COLORS.length]} opacity={i === 0 ? 1 : 0.6}>
                              {s.name}
                            </LegendItem>
                          ))}
                        </div>
                      )}

                      {prediction.length > 1 && (
                        <div className={styles.note}
                          title="Forecast model: the room drifts toward the outdoor temperature plus its internal gains; the radiator lifts it toward the thermostat target but never above it. Parameters fit from the last 7 days of Insights (room, outdoor, heating output).">
                          <Brain size={13} className={styles.noteIcon} />
                          <span>
                            {model.learned
                              ? `fit from ${model.samples} h this week: heat loss τ≈${(1 / (model.k * 60)).toFixed(1)} h · gains ${model.c >= 0 ? '+' : ''}${(model.c * 60).toFixed(2)} °C/h`
                              : 'model defaults (not enough history yet)'}
                            {room.heating && ` · radiator ≈${(model.g * 60).toFixed(1)} °C/h${model.gLearned ? '' : ' (default)'}`}
                            {' · outdoor: '}
                            {outForecast.length ? 'Open-Meteo forecast (home location)' : outsideLatest != null ? `current reading ${outsideLatest.toFixed(1)}°` : 'unknown'}
                            {room.heating && !heatingActive && (heatingEnabled === false ? ' · heating off' : ' · window open — heating off')}
                            {room.heating && heatingActive && resumeAt && ` · heating off until ≈ ${hhmm(resumeAt)} (settle delay)`}
                          </span>
                        </div>
                      )}

                      {notes.length > 0 && (
                        <div className={`${styles.note} ${styles.noteWarn}`}>
                          <TriangleAlert size={13} className={styles.noteIcon} />
                          <span>{notes.join(' · ')}</span>
                        </div>
                      )}

                      {/* Temperature footer — sensor-only rooms */}
                      {hasClimate && !room.heating && curTemp != null && (
                        <div className={styles.footer}>
                          <span className={`hd-big-num ${styles.bigTemp}`}>{curTemp.toFixed(1)}°</span>
                          {sensorLatest && (
                            <span className="hd-tag"><Thermometer size={12} strokeWidth={2.2} />{sensorLatest.name}</span>
                          )}
                        </div>
                      )}

                      {/* Temperature footer — heating rooms, with inline controls */}
                      {room.heating && (
                        <div className={styles.footer}>
                          <span className={`hd-big-num ${styles.bigTemp}`} title="Current temperature">
                            {curTemp != null ? `${curTemp.toFixed(1)}°` : '—'}
                          </span>
                          {room.heating.thermostatId && target != null ? (
                            <div className={styles.stepper}>
                              <span className={styles.stepLabel}>Target</span>
                              <button type="button" className="hd-step" onClick={() => adjustTarget(room, -0.5)}
                                disabled={heatingEnabled === false} aria-label="Lower target 0.5°" title="Lower target 0.5°">
                                <Minus size={14} strokeWidth={2.4} />
                              </button>
                              <b className={styles.stepValue}>{target}°</b>
                              <button type="button" className="hd-step" onClick={() => adjustTarget(room, 0.5)}
                                disabled={heatingEnabled === false} aria-label="Raise target 0.5°" title="Raise target 0.5°">
                                <Plus size={14} strokeWidth={2.4} />
                              </button>
                            </div>
                          ) : target != null && (
                            <span className={`${styles.stepper} ${styles.stepperStatic}`}>
                              <span className={styles.stepLabel}>Target</span>
                              <b className={styles.stepValue}>{target}°</b>
                            </span>
                          )}
                          {power != null && (
                            <span className="hd-tag hd-tag-heat hd-num" title="Heating power">
                              <Flame size={12} strokeWidth={2.2} />{Math.round(power)}%
                            </span>
                          )}
                          {slot && (
                            <span className="hd-tag" title="Current schedule slot">
                              <CalendarClock size={12} strokeWidth={2.2} />{slot.name} · {slot.target}°
                            </span>
                          )}
                          <div className={styles.actions}>
                            {HEATING_ACTIONS.map((a) => {
                              const bk = `${room.heating.key}:${a.key}`;
                              const disabled = busy.has(bk) || heatingEnabled === false;
                              const ui = HEAT_ACTION_UI[a.key] || { icon: null, className: '' };
                              const ActionIcon = busy.has(bk) ? LoaderCircle : ui.icon;
                              return (
                                <button key={a.key} type="button" onClick={() => runHeatAction(room, a)} disabled={disabled}
                                  className={`hd-btn ${ui.className} ${styles.actionBtn}`}
                                  title={heatingEnabled === false ? 'Heating system is off' : `Run the ${a.key} flow for ${room.heating.label}`}>
                                  {ActionIcon && <ActionIcon size={14} strokeWidth={2.2} className={busy.has(bk) ? styles.spin : undefined} />}
                                  {actionText(a.label)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Lights: count + all on/off, phase chips, live tiles. */}
                    {hasLights && (
                      <div className={`hd-inset ${styles.panel} ${styles.stack}`}>
                        <div className={styles.panelHead}>
                          <Eyebrow icon={Lightbulb}>Lights</Eyebrow>
                          <span className={styles.lightCount}>
                            <b className="hd-big-num">{lightsOn}</b>
                            <span className="hd-muted">/ {room.lights.length} on</span>
                          </span>
                          <div className={styles.actions}>
                            {[['All on', true], ['All off', false]].map(([label, on]) => (
                              <button
                                key={label} type="button" onClick={() => setAllLights(room, on)} disabled={busyAll}
                                title={`Turn all lights in ${room.name} ${on ? 'on' : 'off'}`}
                                className={`hd-btn ${on ? styles.allOn : ''} ${styles.actionBtn}`}
                              >
                                {busyAll
                                  ? <LoaderCircle size={14} strokeWidth={2.2} className={styles.spin} />
                                  : on ? <Lightbulb size={14} strokeWidth={2.2} /> : <Power size={14} strokeWidth={2.2} />}
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {profiles && (
                          <div className={styles.phases}>
                            {phaseList(profiles, sun).map((p) => {
                              const active = isActive(p, nowMin);
                              return (
                                <button
                                  key={p.name}
                                  type="button"
                                  onClick={() => applyPhase(room, p.name)}
                                  disabled={applying === room.path}
                                  aria-pressed={active}
                                  title={`Set these lights to ${p.name} now (${Math.round(p.brightness * 100)}%)`}
                                  className={`${styles.phase}${active ? ` ${styles.phaseActive}` : ''}`}
                                >
                                  <span className={styles.swatch} style={{ background: tempColor(p.temperature) }} />
                                  {p.name}
                                  <span className={styles.phaseTime}>{fmtMinutes(p.start)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className={styles.tiles}>
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
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}

        {rooms.length === 0 && (
          <div className="hd-empty">No rooms with lights or temperature sensors found yet.</div>
        )}
      </div>
    </div>
  );
}
