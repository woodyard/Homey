'use client';

// Rooms — one card per room, closed until tapped. A closed card shows the essentials
// (temperature, lights on, activity). An open card has:
//  • Lights: every bulb as a live tile (tap a tile for brightness and warmth), all on/off,
//    and the room's adaptive-lighting phases.
//  • Today: the measured temperature since midnight with the room_heating schedule (slot
//    bands + target line), the light level, and a dashed forecast for the rest of the day
//    (physical room model: drift toward outdoors + gains, radiator lifts toward the effective
//    target — honouring boost/pause/manual — but never above it; see lib/thermal.js).
//  • Status: why the heating is (not) on, activity, windows and doors, other devices, batteries.
//  • All devices: every device in the room with its state and controls.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AL_ROOMS, getSunTimes, phaseList, isActive, activePhase, resolveLightMode, describeLightStatus, tempColor,
  fmtMinutes, copenhagenMinutesNow, isWeekendNow, isWeekendScheduleNow, isIdle,
} from '../lib/adaptiveLighting';
import {
  HEATING_ROOMS, HEATING_ACTIONS, heatingDaySlots, heatingSlot, heatFlowFor,
} from '../lib/heating';
import { estimateRoomModel, ROOM_MODEL_DEFAULTS, predictRoom } from '../lib/thermal';
import { explainHeating, heatingRoomSensor, liveWindowClosedAt, liveWindowOpen, optimisticMode } from '../lib/heatingState';
import {
  AppWindow, BatteryFull, BatteryLow, BatteryMedium, Blinds, Bot, CalendarClock, ChartSpline, ChevronDown,
  CircleDot, ClipboardList, Coffee, DoorClosed, DoorOpen, Fan, Flame, Footprints, Heater, House, LayoutList,
  Lightbulb, LoaderCircle, Minus, Moon, Pause, Plug, Plus, Power, Radar, Refrigerator, RotateCcw, Snowflake,
  Speaker, SunMedium, Thermometer, TriangleAlert, Tv, WashingMachine,
} from 'lucide-react';
import HeatingReason, { HeatingTag, useNow } from './HeatingReason';
import { cx, SliderRow, Toggle } from './ui';
import styles from './RoomsTab.module.css';

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
function StatusPanel({ room, zone, onControl, heatingWhy, now, className }) {
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
    <div className={cx('hd-inset', styles.panel, className)}>
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

// Compact on/off switch. `disabled` greys it out — used for "Always on" devices that cannot
// be switched off.
function MiniToggle({ on, onChange, title, disabled }) {
  return <Toggle size="sm" on={on} onChange={onChange} disabled={disabled} title={disabled ? (title || 'Always on — cannot be switched off') : title} />;
}

// A single bulb as a glowing tile with live state. `al` is resolveLightMode's
// { mode, guess, st } for lights AdaptiveLighting manages, else null.
const LIGHT_MODE_LABEL = { auto: 'Auto', manual: 'Manual', drift: 'Manual?', forced: 'Forced', off: 'Off', unknown: '—' };
const LIGHT_MODE_TAG = { auto: 'hd-tag-good', manual: 'hd-tag-warn', drift: 'hd-tag-warn', forced: 'hd-tag-accent' };
function LightTile({ device, al, onToggle, onSet }) {
  const [open, setOpen] = useState(false);
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
  const canDim = !!onSet && !unavailable && 'dim' in c;
  const canWarm = !!onSet && !unavailable && 'light_temperature' in c;
  const canAdjust = canDim || canWarm;
  return (
    <div
      title={unavailable
        ? `${device.name}: unavailable (unpowered or unreachable)`
        : `${device.name}: ${on ? (dim != null ? `${Math.round(dim * 100)}%` : 'on') : 'off'}${modeText ? ` · ${modeText}` : ''}${alText ? `\nScript: ${alText}` : ''}`}
      className={cx(styles.tile, unavailable && styles.tileUnavailable)}
      style={tileStyle}
    >
      <div className={styles.tileRow}>
        <button
          type="button" className={styles.tileMain} disabled={!canAdjust}
          onClick={() => setOpen((o) => !o)} aria-expanded={canAdjust ? open : undefined}
          aria-label={canAdjust ? `${device.name}: brightness and warmth` : undefined}
        >
          <span className={styles.tileIcon} style={iconStyle}>
            <Lightbulb size={18} strokeWidth={2} />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileName}>{device.name}</span>
            <span className={styles.tileMeta}>
              {unavailable && <span className={styles.warnIcon} title="Unavailable"><TriangleAlert size={12} /></span>}
              <span>{on ? (dim != null ? `${Math.round(dim * 100)}%` : 'On') : 'Off'}</span>
              {mode && mode !== 'off' && (
                <span className={`hd-tag ${LIGHT_MODE_TAG[mode] || ''}`} style={al.guess ? { opacity: 0.6 } : undefined}>
                  {mode === 'forced' ? 'Forced' : LIGHT_MODE_LABEL[mode] || mode}
                </span>
              )}
            </span>
          </span>
        </button>
        {onToggle && 'onoff' in c && (
          <MiniToggle
            on={on} onChange={onToggle} disabled={!!device.alwaysOn || unavailable}
            title={unavailable ? `${device.name}: unavailable`
              : device.alwaysOn ? `${device.name}: always on` : `${device.name}: turn ${on ? 'off' : 'on'}`}
          />
        )}
      </div>
      {open && canAdjust && (
        <div className={styles.tileSliders}>
          {canDim && (
            <SliderRow
              icon={SunMedium} label={`${device.name} brightness`} value={dim ?? 0} accent="#f59e0b"
              onCommit={(v) => onSet({ dim: v, ...('onoff' in c && v > 0 ? { onoff: true } : {}) })}
            />
          )}
          {canWarm && (
            <SliderRow
              icon={Thermometer} label={`${device.name} warmth`} value={c.light_temperature ?? 0} accent="#fb923c"
              fmt={(v) => (v >= 0.5 ? 'warm' : 'cool')}
              onCommit={(v) => onSet({ light_temperature: v, ...('light_mode' in c ? { light_mode: 'temperature' } : {}) })}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------- all devices ----

const TYPE_ICON = {
  light: Lightbulb, thermostat: Thermometer, sensor: Radar, socket: Plug, tv: Tv,
  mediaplayer: Speaker, coffeemachine: Coffee, fridge: Refrigerator, freezer: Snowflake,
  washer: WashingMachine, vacuumcleaner: Bot, heater: Flame, curtain: Blinds,
  fan: Fan, button: CircleDot, other: House,
};

function deviceStateLine(state) {
  const st = state || {};
  const parts = [];
  if ('onoff' in st) parts.push(st.onoff ? 'On' : 'Off');
  if (st.dim != null) parts.push(`${Math.round(st.dim * 100)}%`);
  if (st.measure_temperature != null) parts.push(`${st.measure_temperature}°`);
  if (st.measure_humidity != null) parts.push(`${st.measure_humidity}% humidity`);
  if (st.target_temperature != null) parts.push(`target ${st.target_temperature}°`);
  if ('alarm_motion' in st) parts.push(st.alarm_motion ? 'motion' : 'no motion');
  if ('alarm_contact' in st) parts.push(st.alarm_contact ? 'open' : 'closed');
  if (st.alarm_water) parts.push('leak!');
  if (st.display_status) parts.push(st.display_status);
  if (st.operational_state != null) parts.push(`state ${st.operational_state}`);
  if (st.measure_battery != null) parts.push(`battery ${Math.round(st.measure_battery)}%`);
  return parts.join(' · ');
}

// Every device in the room, closed until asked for: state, switch, and sliders for what
// the cards above do not cover (blinds, a thermostat that is not a heating room).
function DeviceList({ devices, heatingIds, onControl, className }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name, 'da')), [devices]);
  return (
    <div className={cx('hd-inset', styles.panel, className)}>
      <button type="button" className={styles.devToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Eyebrow icon={LayoutList}>All devices</Eyebrow>
        <span className={styles.devCount}>{devices.length}</span>
        <ChevronDown size={16} className={cx(styles.chev, open && styles.chevOpen)} />
      </button>
      {open && (
        <div className={styles.devList}>
          {sorted.map((d) => {
            const c = d.capabilities || {};
            const line = deviceStateLine(c);
            const Icon = TYPE_ICON[d.virtualClass || d.class] || House;
            const unavailable = d.available === false;
            const set = (values) => onControl(d.id, values);
            const ownTarget = 'target_temperature' in c && !heatingIds.has(d.id);
            return (
              <div key={d.id} className={styles.devRow} style={unavailable ? { opacity: 0.55 } : undefined}>
                <div className={styles.row}>
                  <span className={styles.rowIcon}><Icon size={16} /></span>
                  <span className={styles.devText}>
                    <span className={styles.devName}>{d.name}</span>
                    {(line || unavailable) && <span className={styles.devState}>{unavailable ? 'Unavailable' : line}</span>}
                  </span>
                  {'onoff' in c && onControl && (
                    <span className={styles.rowEnd}>
                      <MiniToggle
                        on={!!c.onoff} onChange={(v) => set({ onoff: v })} disabled={!!d.alwaysOn || unavailable}
                        title={d.alwaysOn ? `${d.name}: always on` : `${d.name}: turn ${c.onoff ? 'off' : 'on'}`}
                      />
                    </span>
                  )}
                </div>
                {onControl && !unavailable && ('windowcoverings_set' in c || ownTarget) && (
                  <div className={styles.devControls}>
                    {'windowcoverings_set' in c && (
                      <SliderRow icon={Blinds} label={`${d.name} position`} value={c.windowcoverings_set ?? 0} onCommit={(v) => set({ windowcoverings_set: v })} />
                    )}
                    {ownTarget && (
                      <div className={styles.stepper}>
                        <span className={styles.stepLabel}>Target</span>
                        <button type="button" className="hd-step" aria-label={`Lower ${d.name} target`}
                          onClick={() => set({ target_temperature: Math.round(((c.target_temperature ?? 20) - 0.5) * 2) / 2 })}>
                          <Minus size={15} strokeWidth={2.4} />
                        </button>
                        <b className={styles.stepValue}>{c.target_temperature ?? '—'}°</b>
                        <button type="button" className="hd-step" aria-label={`Raise ${d.name} target`}
                          onClick={() => set({ target_temperature: Math.round(((c.target_temperature ?? 20) + 0.5) * 2) / 2 })}>
                          <Plus size={15} strokeWidth={2.4} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

// Today's temperature on one quiet chart: measured since midnight (solid), the forecast for
// the rest of the day (dotted, same line continued), and the heating target as a stepped line.
function ClimateChart({ points, slots, prediction, nowMin, uid }) {
  const wrapRef = useRef(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState(null);

  const allVals = [...points.map((p) => p.v), ...prediction.map((p) => p.v), ...slots.map((s) => s.target)];
  const empty = !allVals.length;

  // Draw at the container's real pixel width so the labels stay legible on a phone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setW(Math.max(240, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  if (empty) return <div ref={wrapRef} className={`hd-empty ${styles.chartEmpty}`}>No temperature data yet today.</div>;

  const H = W < 480 ? 150 : 190;
  const M = { l: 30, r: 8, t: 10, b: 22 };
  const yMin = Math.floor(Math.min(...allVals) - 0.5);
  const yMax = Math.ceil(Math.max(...allVals) + 0.5);
  const ySpan = Math.max(1, yMax - yMin);
  const x = (m) => M.l + (Math.max(0, Math.min(1440, m)) / 1440) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - (v - yMin) / ySpan) * (H - M.t - M.b);
  const bottom = H - M.b;

  const step = ySpan > 8 ? 4 : ySpan > 4 ? 2 : 1;
  const yTicks = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);

  const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.m).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const targetPath = slots.map((s, i) => (
    `${i ? 'L' : 'M'} ${x(s.start).toFixed(1)} ${y(s.target).toFixed(1)} L ${x(s.end).toFixed(1)} ${y(s.target).toFixed(1)}`
  )).join(' ');
  const measured = points.length > 1 ? points : null;
  const last = points.length ? points[points.length - 1] : null;

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
    const point = (last && m > last.m ? closest(prediction) : closest(points)) || closest(prediction);
    setHover({ m, point, forecast: !!(last && point && point.m > last.m), slot: slots.find((s) => m >= s.start && m < s.end) || null });
  }

  return (
    <div ref={wrapRef} className={styles.chart}>
      <svg
        viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Temperature today"
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--text)', stopOpacity: 0.1 }} />
            <stop offset="100%" style={{ stopColor: 'var(--text)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--chart-grid)' }} />
            <text x={M.l - 7} y={y(v) + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--chart-axis)' }}>{v}°</text>
          </g>
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <text
            key={h} x={x(h * 60)} y={H - 5} fontSize="11" style={{ fill: 'var(--chart-axis)' }}
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
          >
            {String(h).padStart(2, '0')}
          </text>
        ))}
        {slots.length > 0 && (
          <path d={targetPath} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--heat)' }} />
        )}
        {measured && (
          <path d={`${linePath(measured)} L ${x(last.m).toFixed(1)} ${bottom} L ${x(measured[0].m).toFixed(1)} ${bottom} Z`} fill={`url(#area-${uid})`} />
        )}
        {measured && (
          <path d={linePath(measured)} fill="none" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--text)' }} />
        )}
        {prediction.length > 1 && (
          <path d={linePath(prediction)} fill="none" strokeWidth="2.25" strokeDasharray="0.5 6" strokeLinecap="round" style={{ stroke: 'var(--text)', opacity: 0.5 }} />
        )}
        {last ? (
          <circle cx={x(last.m)} cy={y(last.v)} r="4.5" strokeWidth="2.5" style={{ fill: 'var(--text)', stroke: 'var(--surface-2)' }} />
        ) : (
          <line x1={x(nowMin)} x2={x(nowMin)} y1={M.t} y2={bottom} strokeWidth="1.5" style={{ stroke: 'var(--border-strong)' }} />
        )}
        {hover && hover.point && (
          <g>
            <line x1={x(hover.point.m)} x2={x(hover.point.m)} y1={M.t} y2={bottom} strokeWidth="1" style={{ stroke: 'var(--border-strong)' }} />
            <circle cx={x(hover.point.m)} cy={y(hover.point.v)} r="4" strokeWidth="2" style={{ fill: 'var(--surface-2)', stroke: 'var(--text)' }} />
          </g>
        )}
      </svg>
      {hover && hover.point && (
        <div className={styles.tooltip} style={{ left: `${Math.max(14, Math.min(86, (x(hover.point.m) / W) * 100))}%` }}>
          <span className={styles.tipTime}>{fmtMinutes(hover.point.m)}</span>
          <b>{hover.point.v.toFixed(1)}°</b>
          {hover.forecast && <span className={styles.tipItem}>forecast</span>}
          {hover.slot && <span className={styles.tipItem} style={{ color: 'var(--heat-ink)' }}>target {hover.slot.target}°</span>}
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

export default function RoomsTab({ devices, zones, flows, alStatus, onControl, onReload }) {
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

  // Which rooms are open (remembered in this browser). A closed room draws no chart.
  const [openRooms, setOpenRooms] = useState(() => new Set());
  useEffect(() => {
    try { setOpenRooms(new Set(JSON.parse(localStorage.getItem('rooms_open') || '[]'))); } catch { /* ignore */ }
  }, []);
  const toggleRoom = (path) => setOpenRooms((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    try { localStorage.setItem('rooms_open', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

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

  // One card per zone that has devices.
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
    const flow = heatFlowFor(hr, action, flows || [], heatMapping);
    if (!flow) { setErr(`No flow named "${hr.code} - Heating ${action.flow}" in Homey.`); return; }
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
      {err && (
        <div className="hd-error" style={{ marginTop: 0 }}>
          <TriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
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
          const open = openRooms.has(room.path);
          const series = !open ? [] : room.sensors
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
          if (open && startTemp != null && (room.sensors.length || room.heating)) {
            const startMin = lastPoint ? lastPoint.m : nowMin;
            const scheduleAt = heatingActive ? makeTargetAt({
              startMin,
              slots,
              status: sc,
              deviceTarget: thermoCaps.target_temperature != null ? thermoCaps.target_temperature
                : sc && sc.mode === 'manual' ? sc.effectiveTarget : null,
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

          const motionDevs = room.devices.filter((d) => 'alarm_motion' in (d.capabilities || {}));
          const motionTs = motionDevs.map((d) => (d.capTimes || {}).alarm_motion).filter(Boolean).sort().pop() || null;
          const openContacts = room.devices.filter((d) => (d.capabilities || {}).alarm_contact === true).length;
          const anyTemp = room.devices.map((d) => (d.capabilities || {}).measure_temperature).find((v) => typeof v === 'number');
          const headTemp = curTemp != null ? curTemp : anyTemp != null ? anyTemp : null;
          const heatingIds = new Set(room.heating ? [room.heating.thermostatId, ...(room.heating.plugIds || [])].filter(Boolean) : []);

          return (
            <section key={room.path} className={cx('hd-card', styles.room)} data-open={open || undefined}>
              <button
                type="button" className={styles.roomHead} onClick={() => toggleRoom(room.path)}
                aria-expanded={open}
              >
                <div className={styles.roomTitle}>
                  <h3 className={styles.roomName}>{room.name}</h3>
                  <div className={styles.roomSub}>
                    {motionDevs.length > 0 && (motionNow
                      ? <span className={styles.subActive}><span className="hd-live-dot" />Active now</span>
                      : <span>{fmtAgo(motionTs) ? `Quiet for ${fmtAgo(motionTs)}` : 'Quiet'}</span>)}
                    <HeatingTag info={why} />
                    {openContacts > 0 && !(why && why.tag && why.tag.icon === 'window') && (
                      <span className="hd-tag hd-tag-warn"><AppWindow size={12} strokeWidth={2.2} />Open</span>
                    )}
                  </div>
                </div>
                <div className={styles.headStats}>
                  {headTemp != null && <span className={styles.headTemp}>{headTemp.toFixed(1)}°</span>}
                  {hasLights && (
                    <span className={cx(styles.headLights, lightsOn > 0 && styles.headLightsOn)} title="Lights on">
                      <Lightbulb size={14} strokeWidth={2.2} />{lightsOn}/{room.lights.length}
                    </span>
                  )}
                </div>
                <ChevronDown size={18} className={cx(styles.chev, open && styles.chevOpen)} />
              </button>

              {open && (
              <div className={styles.body}>
                    {/* Lights: count + all on/off, phase chips, live tiles. */}
                    {hasLights && (
                      <div className={cx('hd-inset', styles.panel, styles.stack)}>
                        <div className={styles.panelHead}>
                          <Eyebrow icon={Lightbulb}>Lights</Eyebrow>
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
                                onSet={onControl ? (values) => onControl(d.id, values) : null}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Today: temperature, forecast and the heating target on one chart. */}
                    {hasClimate && (
                    <div className={cx('hd-inset', styles.panel, styles.stack)}>
                      <div className={styles.panelHead}>
                        <Eyebrow icon={ChartSpline}>Today</Eyebrow>
                        <div className={styles.legend}>
                          <span className={styles.legendItem}><i className={styles.keyLine} />Temperature</span>
                          {room.heating && <span className={styles.legendItem}><i className={cx(styles.keyLine, styles.keyTarget)} />Target</span>}
                        </div>
                      </div>

                      <ClimateChart
                        points={primary ? primary.points : []} slots={slots} prediction={prediction} nowMin={nowMin} uid={uid}
                      />

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
                          <div className={styles.heatActions}>
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
                    )}

                    <StatusPanel
                      room={room}
                      zone={zones && room.devices[0] ? zones[room.devices[0].zoneId] : null}
                      onControl={onControl}
                      heatingWhy={why}
                      now={now}
                    />

                    <DeviceList devices={room.devices} heatingIds={heatingIds} onControl={onControl} />
              </div>
              )}
            </section>
          );
        })}

        {rooms.length === 0 && (
          <div className="hd-empty">No rooms found yet.</div>
        )}
      </div>
    </div>
  );
}
