'use client';

// Heating: the page the dashboard opens on. One card per heating room with the temperature,
// the target (− / +), and the one reason the room is or is not heating right now. A card opens
// to today's schedule and Boost / Pause / Reset; on wide screens the cards are always open.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, CalendarClock, ChevronDown, CircleHelp, Droplets, Flame, LoaderCircle, Moon, Pause, RotateCcw,
  Settings2, Snowflake,
} from 'lucide-react';
import { copenhagenMinutesNow, fmtMinutes, isWeekendNow } from '../lib/adaptiveLighting';
import {
  HEATING_ROOMS, HEATING_ACTIONS, TARGET_MIN, TARGET_MAX, heatingDaySlots, heatingSlot, heatFlowFor,
} from '../lib/heating';
import {
  explainHeating, heatingRoomSensor, liveWindowClosedAt, liveWindowOpen, optimisticMode, SCRIPT_INTERVAL_MIN, SETTLE_ACTIONS,
} from '../lib/heatingState';
import { HEAT_ICONS, useNow } from './HeatingReason';
import {
  BigTemp, clamp, cx, DayStrip, ErrorBox, fmtDuration, fmtLongDuration, INACTIVE_COUNTER_LIMIT, roomNameFromPath, SPIN, Toggle,
} from './ui';
import styles from './HeatingTab.module.css';

// Live inactivity timer for a heating room, tied to the config's inactivityTimeout: when it is
// reached, the inactivityOffset applies.
function HeatingInactivity({ motionActive, seedTs, timeoutMin, offset }) {
  const sinceRef = useRef(null);
  const prevRef = useRef(undefined);
  useEffect(() => {
    const prev = prevRef.current;
    if (motionActive) sinceRef.current = null;
    else if (prev === true) sinceRef.current = Date.now();
    else if (sinceRef.current == null) sinceRef.current = seedTs ? new Date(seedTs).getTime() : Date.now();
    prevRef.current = motionActive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionActive, seedTs]);

  if (motionActive) {
    return <span className={styles.infoItem} style={{ color: 'var(--good-ink)' }}><Activity size={14} /> Someone is in the room</span>;
  }

  const since = sinceRef.current ?? Date.now();
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const label = secs < INACTIVE_COUNTER_LIMIT ? fmtDuration(secs) : fmtLongDuration(secs);
  const timeoutSecs = (timeoutMin || 30) * 60;
  const reached = secs >= timeoutSecs;
  return (
    <span className={styles.infoItem} title={`No motion since ${new Date(since).toLocaleTimeString()}`}>
      <Moon size={14} />
      <span>No motion for <span className="hd-num">{label}</span></span>
      {offset > 0 && (reached
        ? <span style={{ color: 'var(--warn-ink)' }}>· −{offset}° applied</span>
        : <span className="hd-faint">· −{offset}° in <span className="hd-num">{fmtDuration(timeoutSecs - secs)}</span></span>)}
    </span>
  );
}

// Boost / Pause / Reset buttons: icon + tint (labels come from HEATING_ACTIONS, minus their emoji).
const HEAT_ACTION_UI = {
  boost: { Icon: Flame, cls: styles.btnBoost },
  pause: { Icon: Pause, cls: '' },
  reset: { Icon: RotateCcw, cls: '' },
};
const actionLabel = (a) => String(a.label || '').replace(/^[^A-Za-z0-9]+/, '').trim() || a.key;

// Real script mode wins; otherwise show the optimistic "manual" (from a +/-) until it expires,
// unless the script is not taking the press as manual: it skips detection during a settle delay
// and under away, and a run a full interval after the press (so the valve had time to report)
// that still says auto settles it. The real reason then stays visible.
function resolveMode(sc, opt) {
  if (sc && sc.mode && sc.mode !== 'auto') return { mode: sc.mode, modeExpires: sc.modeExpires };
  const ignored = sc && (sc.windowClosedSince != null || SETTLE_ACTIONS.has(sc.lastAction) || sc.away);
  const seen = opt && sc && sc.updatedAt - opt.at > SCRIPT_INTERVAL_MIN * 60000;
  if (opt && opt.expires > Date.now() && !ignored && !seen) return { mode: 'manual', modeExpires: opt.expires };
  return { mode: sc ? sc.mode : null, modeExpires: sc ? sc.modeExpires : null };
}

const OVERRIDE_STATES = new Set(['boost', 'pause', 'manual']);

// Today's schedule as a strip: a segment per slot, warmer targets drawn warmer.
function DayTimeline({ slots, nowMin }) {
  const targets = slots.map((s) => s.target);
  const lo = Math.min(...targets);
  const span = Math.max(...targets) - lo;
  const segments = slots.map((s) => {
    const warmth = span > 0 ? (s.target - lo) / span : 0.5;
    return {
      start: s.start, end: s.end, label: `${s.target}°`,
      color: `color-mix(in srgb, var(--heat) ${Math.round(14 + warmth * 66)}%, var(--surface-3))`,
      title: `${s.name}: ${fmtMinutes(s.start)}–${fmtMinutes(s.end === 1440 ? 0 : s.end)} · ${s.target}°`,
    };
  });
  return <div className={styles.timeline}><DayStrip segments={segments} nowMin={nowMin} /></div>;
}

// One heating room. `d` is roomData(room) (null when the thermostat is missing), `why` the
// explanation from lib/heatingState.js.
function RoomCard({ room, d, why, now, nowMin, slots, open, onToggle, systemOff, onAdjust, actions }) {
  const bodyId = `heat-${room.key}`;
  if (!d) {
    return (
      <article className={styles.card}>
        <div className={styles.head}><h3 className={styles.name}>{room.label}</h3></div>
        <div className={styles.missing}>Thermostat not found.</div>
      </article>
    );
  }
  const heatingNow = !systemOff && (d.kind === 'tado' ? d.power > 0 : !!d.plugOn);
  const power = d.kind === 'tado' ? clamp(d.power || 0, 0, 100) / 100 : (d.plugOn ? 1 : 0);
  const WhyIcon = HEAT_ICONS[why.icon] || CircleHelp;
  const p = why.progress;
  const pct = p && p.to > p.from ? clamp(((now - p.from) / (p.to - p.from)) * 100, 0, 100) : null;
  const reset = actions.find((a) => a.key === 'reset');
  const inOverride = OVERRIDE_STATES.has(why.state);
  // Master off greys out the controls, but the reason stays readable.
  const dim = systemOff ? styles.dimmed : undefined;
  return (
    <article
      className={styles.card} data-tone={why.tone} data-open={open || undefined} data-heating={heatingNow || undefined}
      style={heatingNow ? { '--wash': `${Math.round(9 + power * 13)}%` } : undefined}
    >
      <button type="button" className={styles.head} onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
        <h3 className={styles.name}>{room.label}</h3>
        {heatingNow && (
          <span className={styles.heatChip}>
            <Flame size={13} strokeWidth={2.4} />
            {d.kind === 'tado' ? `${Math.round(d.power)}%` : 'On'}
          </span>
        )}
        <ChevronDown size={18} className={styles.chev} />
      </button>

      <div className={cx(styles.main, dim)}>
        <div className={styles.now}>
          <BigTemp value={d.temp} className={styles.temp} />
          {d.humidity != null && (
            <span className={styles.humidity} title="Humidity"><Droplets size={13} /> {Math.round(d.humidity)}%</span>
          )}
        </div>
        {d.setTarget != null ? (
          <div className={styles.stepper} role="group" aria-label={`${room.label} target`}>
            <button
              type="button" className="hd-step" onClick={() => onAdjust(-0.5)}
              disabled={systemOff || d.setTarget <= TARGET_MIN} aria-label={`Lower ${room.label} target`}
            >
              −
            </button>
            <div className={styles.target}>
              <span className={styles.targetLabel}>Target</span>
              <span className={styles.targetVal}>{d.setTarget}°</span>
            </div>
            <button
              type="button" className="hd-step" onClick={() => onAdjust(0.5)}
              disabled={systemOff || d.setTarget >= TARGET_MAX} aria-label={`Raise ${room.label} target`}
            >
              +
            </button>
          </div>
        ) : (
          <span className={styles.noTarget}>Follows the schedule</span>
        )}
      </div>

      <div className={styles.reason}>
        <span className={styles.reasonIcon} aria-hidden="true"><WhyIcon size={16} strokeWidth={2.3} /></span>
        <div className={styles.reasonBody}>
          <div className={styles.reasonHead}>{why.headline}</div>
          {why.detail && <div className={styles.reasonDetail}>{why.detail}</div>}
          {pct != null && (
            <div
              className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(pct)} aria-label="Time elapsed"
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        {inOverride && reset && (
          <button
            type="button" className={cx('hd-btn hd-btn-sm', styles.quickReset)} onClick={reset.onClick}
            disabled={reset.disabled} title="Cancel the override and follow the schedule again"
          >
            {reset.busy ? <LoaderCircle size={14} style={SPIN} /> : <RotateCcw size={14} />}
            Reset
          </button>
        )}
      </div>

      <div className={styles.more} id={bodyId}>
        <div className={styles.moreInner}>
          {why.factors.length > 0 && (
            <div className={styles.factors}>
              {why.factors.map((f) => {
                const FIcon = HEAT_ICONS[f.icon] || CircleHelp;
                return (
                  <span key={f.key} className={cx('hd-tag', f.tone !== 'muted' && `hd-tag-${f.tone}`, styles.factor)}>
                    <FIcon size={12} strokeWidth={2.2} />{f.text}
                  </span>
                );
              })}
            </div>
          )}

          {d.scheduled && (
            <div className={cx(styles.schedule, dim)}>
              <div className={styles.schedHead}>
                <CalendarClock size={14} />
                <span>
                  <b>{d.scheduled.name}</b> · {d.scheduled.target}° until {fmtMinutes(d.scheduled.end === 1440 ? 0 : d.scheduled.end)}
                  {d.setTarget != null && d.setTarget < d.scheduled.target - 0.05 && (
                    <span style={{ color: 'var(--warn-ink)' }}> · now set to {d.setTarget}°</span>
                  )}
                </span>
              </div>
              <DayTimeline slots={slots} nowMin={nowMin} />
            </div>
          )}

          {(d.hasMotion || d.kind === 'plug') && (
            <div className={cx(styles.info, dim)}>
              {d.kind === 'plug' && (
                <span className={styles.infoItem} style={d.plugOn ? { color: 'var(--heat-ink)' } : undefined}>
                  <Flame size={14} /> Radiator{d.plugCount === 1 ? '' : 's'} {d.plugOn ? 'on' : 'off'}
                </span>
              )}
              {d.hasMotion && d.scheduled && (
                <HeatingInactivity
                  motionActive={d.motionActive} seedTs={d.seedTs}
                  timeoutMin={d.scheduled.timeout} offset={d.scheduled.offset}
                />
              )}
            </div>
          )}

          <div className={cx(styles.actions, dim)}>
            {actions.map((a) => (
              <button
                key={a.key} type="button" onClick={a.onClick} disabled={a.disabled} title={a.title}
                aria-pressed={a.key === 'reset' ? undefined : a.active} className={cx('hd-btn', a.cls)}
              >
                {a.busy ? <LoaderCircle size={15} style={SPIN} /> : <a.Icon size={15} />}
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function HeatingTab({ devices, zones, flows, onControl, onReload }) {
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(() => new Set());
  const [err, setErr] = useState('');
  const [heatingEnabled, setHeatingEnabled] = useState(null);
  const [status, setStatus] = useState({});
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [optManual, setOptManual] = useState({}); // zone -> { at, expires } ms (optimistic manual after +/-)
  const [optTarget, setOptTarget] = useState({}); // room key -> { value, ts } (hold new setpoint until the device or script shows it)
  const plugTargetTimers = useRef({}); // room key -> timer of a plug room's target not sent yet
  const [masterBusy, setMasterBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const now = useNow(30000); // countdowns move between status polls

  function loadStatus() {
    return fetch('/api/homey/heating').then((r) => r.json())
      .then((j) => {
        setStatusLoaded(true);
        if (j.error) return; // a failed Homey read answers with an empty status: keep the last one
        setHeatingEnabled(j.heatingEnabled);
        if (j.status) setStatus(j.status);
      }).catch(() => setStatusLoaded(true));
  }

  useEffect(() => {
    try { setMapping(JSON.parse(localStorage.getItem('heating_flows') || '{}')); } catch { /* ignore */ }
    loadStatus();
    const iv = setInterval(loadStatus, 15000); // refresh heating status every 15s
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => new Map((devices || []).map((d) => [d.id, d.capabilities || {}])), [devices]);
  const flowOptions = useMemo(() => (flows || []).slice().sort((a, b) => a.name.localeCompare(b.name)), [flows]);

  const flowFor = (room, action) => {
    return heatFlowFor(room, action, flows || [], mapping);
  };
  const setFlowFor = (roomKey, actionKey, flowId) => {
    setMapping((prev) => {
      const next = { ...prev, [`${roomKey}:${actionKey}`]: flowId };
      try { localStorage.setItem('heating_flows', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const weekend = isWeekendNow();
  const nowMin = copenhagenMinutesNow();

  function roomData(room) {
    const zoneDevs = (devices || []).filter((d) => roomNameFromPath(d.zonePath) === room.zone);
    const motionDevs = zoneDevs.filter((d) => 'alarm_motion' in d.capabilities);
    const hasMotion = motionDevs.length > 0;
    const motionNow = motionDevs.some((d) => !!d.capabilities.alarm_motion);
    const zoneId = zoneDevs[0] ? zoneDevs[0].zoneId : null;
    const seedTs = zoneId && zones && zones[zoneId] ? zones[zoneId].activeLastUpdated : null;
    const scheduled = heatingSlot(room.key, weekend, nowMin);
    const sc = status[room.zone] || null; // live status published by room_heating.js

    let base;
    if (room.thermostatId) {
      const c = byId.get(room.thermostatId);
      if (!c) return null;
      base = {
        kind: 'tado',
        temp: c.measure_temperature ?? null,
        power: c.tado_heating_power ?? null,
        humidity: c.measure_humidity ?? null,
        deviceTarget: c.target_temperature ?? null,
        deviceWindow: !!c.alarm_open_window_detected,
      };
    } else {
      const plugs = (room.plugIds || []).map((id) => byId.get(id)).filter(Boolean);
      const sensor = heatingRoomSensor(devices, room.zone);
      const contact = zoneDevs.find((d) => 'alarm_contact' in d.capabilities);
      base = {
        kind: 'plug',
        temp: sensor ? sensor.capabilities.measure_temperature : null,
        power: null,
        humidity: sensor ? (sensor.capabilities.measure_humidity ?? null) : null,
        deviceTarget: null,
        deviceWindow: contact ? !!contact.capabilities.alarm_contact : false,
        plugOn: plugs.some((p) => p.onoff),
        plugCount: plugs.length,
      };
    }

    return {
      ...base,
      sc,
      liveWindow: liveWindowOpen(devices, room.zone),
      liveClosedAt: liveWindowClosedAt(devices, room.zone),
      scheduled,
      hasMotion,
      motionActive: motionNow,
      seedTs,
      // Target: the live device setpoint is the truth for tado (updates on +/-); fall back to the
      // script's effectiveTarget for plug rooms (0 during a pause, so the schedule's target then).
      // A recent +/- holds its value for 45s (propagation).
      setTarget: (() => {
        const planned = sc ? (sc.mode === 'pause' ? sc.scheduledTarget : sc.effectiveTarget) : null;
        const baseTarget = base.deviceTarget ?? planned ?? null;
        const ot = optTarget[room.key];
        return (ot && ot.value != null && baseTarget !== ot.value && Date.now() - ot.ts < 45000) ? ot.value : baseTarget;
      })(),
      windowOpen: sc && sc.windowOpen != null ? sc.windowOpen : base.deviceWindow,
      away: sc ? !!sc.away : false,
      ...resolveMode(sc, optManual[room.zone]),
    };
  }

  // Master switch: set the HeatingEnabled Logic variable. On OFF, also trigger the
  // "Heating switched off" flow for an immediate turn-off of all devices.
  async function toggleMaster(next) {
    const prev = heatingEnabled;
    setErr('');
    setMasterBusy(true);
    setHeatingEnabled(next);
    try {
      const r = await fetch('/api/homey/heating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'failed to set heating');
      if (!next) {
        const offFlow = (flows || []).find((f) => /switched\s*off/i.test(f.name) && /heat|varme/i.test(f.name));
        if (offFlow) {
          await fetch('/api/homey/reset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flowId: offFlow.id, advanced: offFlow.type === 'advanced' }),
          });
        }
      }
      [1500, 3500].forEach((ms) => setTimeout(loadStatus, ms));
      setTimeout(() => onReload && onReload(), 2000);
    } catch (e) {
      setErr(String(e.message || e));
      setHeatingEnabled(prev);
    } finally {
      setMasterBusy(false);
    }
  }

  // A plug room has no device target: ask room_heating.js through the API, then start the room's
  // target flow so the script acts now. Without that flow its next run (≤ 5 min) picks it up.
  async function sendPlugTarget(room, target) {
    try {
      const r = await fetch('/api/homey/heating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: room.key, target }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'failed to set target');
      const flow = (flows || []).find((f) => f.name === room.targetFlow);
      if (flow) {
        await fetch('/api/homey/reset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
        });
      }
      [2000, 5000, 10000, 20000].forEach((ms) => setTimeout(loadStatus, ms));
      setTimeout(() => onReload && onReload(), 5000);
    } catch (e) {
      setErr(String(e.message || e));
      setOptTarget((prev) => { const n = { ...prev }; delete n[room.key]; return n; });
      setOptManual((prev) => { const n = { ...prev }; delete n[room.zone]; return n; });
      loadStatus();
    }
  }

  // Manual target change. Tado: setting the device target trips the script's manual-intervention
  // detection. Plug room: the script is asked directly. Either way it holds "manual" for
  // manualOverrideDuration minutes.
  function adjustTarget(room, d, delta) {
    if (d.setTarget == null || (room.thermostatId && !onControl)) return;
    const next = Math.max(TARGET_MIN, Math.min(TARGET_MAX, Math.round((d.setTarget + delta) * 2) / 2));
    if (next === d.setTarget) return;
    setErr('');
    if (room.thermostatId) {
      // Set ONLY the setpoint (like changing it in the Tado app) — sending onoff can make Tado
      // resume its schedule and discard the overlay we're setting in the same request.
      onControl(room.thermostatId, { target_temperature: next });
      // Reconcile: re-pull device state (Tado catches up) and heating status (script flags manual).
      [5000, 12000, 20000].forEach((ms) => setTimeout(() => onReload && onReload(), ms));
      [4000, 8000, 15000].forEach((ms) => setTimeout(loadStatus, ms));
    } else {
      // Several presses in a row end in one request and one script run.
      clearTimeout(plugTargetTimers.current[room.key]);
      plugTargetTimers.current[room.key] = setTimeout(() => sendPlugTarget(room, next), 800);
    }
    // Hold the new setpoint on screen until the device or script shows it, so a refresh that
    // reads the not-yet-updated value doesn't flicker it back.
    setOptTarget((prev) => ({ ...prev, [room.key]: { value: next, ts: Date.now() } }));
    // We just triggered manual override — show the Manual badge immediately (sticky).
    setOptManual((prev) => ({ ...prev, [room.zone]: { at: Date.now(), expires: Date.now() + (room.manualDuration || 90) * 60000 } }));
  }

  async function runAction(room, action) {
    const flow = flowFor(room, action);
    if (!flow) { setErr(`No flow named "${room.code} - Heating ${action.flow}" in Homey.`); return; }
    const bk = `${room.key}:${action.key}`;
    setErr('');
    setBusy((prev) => new Set(prev).add(bk));
    // Optimistically reflect the new mode so the badge appears instantly (boost/pause = 60 min).
    setStatus((prev) => ({ ...prev, [room.zone]: optimisticMode(prev[room.zone], action.key, Date.now()) }));
    setOptManual((prev) => { const n = { ...prev }; delete n[room.zone]; return n; }); // boost/pause/reset override manual
    clearTimeout(plugTargetTimers.current[room.key]); // a target not sent yet is replaced as well
    setOptTarget((prev) => { const n = { ...prev }; delete n[room.key]; return n; });
    try {
      const r = await fetch('/api/homey/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'flow trigger failed');
      // The flow runs the script, which publishes HeatingStatus after a few seconds —
      // re-poll a few times to replace the optimistic value with the real one.
      [1500, 3500, 6000].forEach((ms) => setTimeout(loadStatus, ms));
      setTimeout(() => onReload && onReload(), 2500);
    } catch (e) {
      setErr(String(e.message || e));
      loadStatus(); // revert optimistic state to reality
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(bk); return n; });
    }
  }

  const masterOff = heatingEnabled === false;

  // Which cards are open on a phone (wide screens show them all open).
  const [openRooms, setOpenRooms] = useState({});
  useEffect(() => {
    try { setOpenRooms(JSON.parse(localStorage.getItem('heating_open') || '{}')); } catch { /* ignore */ }
  }, []);
  const toggleOpen = (key) => setOpenRooms((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    try { localStorage.setItem('heating_open', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // The flows are found by name. Only a flow that is missing needs picking by hand.
  const flowMissing = (flows || []).length > 0
    && HEATING_ROOMS.some((room) => HEATING_ACTIONS.some((a) => !flowFor(room, a)));

  const rooms = HEATING_ROOMS.map((room) => ({ room, d: roomData(room) }));
  const found = rooms.filter(({ d }) => d);
  const heatingCount = masterOff ? 0 : found.filter(({ d }) => (d.kind === 'tado' ? d.power > 0 : d.plugOn)).length;
  const outside = (devices || [])
    .map((dev) => (dev.capabilities || {})['measure_temperature.outside'])
    .find((v) => typeof v === 'number');

  let title = 'Heating';
  let sub = 'Checking status…';
  if (masterOff) {
    title = 'Heating is off';
    sub = outside != null ? `${outside.toFixed(1)}° outside` : '';
  } else if (heatingEnabled != null) {
    title = heatingCount > 0 ? `${heatingCount} of ${found.length} rooms heating` : 'No rooms heating';
    sub = outside != null ? `${outside.toFixed(1)}° outside` : 'Rooms follow their schedule';
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.summary} data-off={masterOff || undefined} data-heating={heatingCount > 0 || undefined}>
        <span className={styles.summaryIcon} aria-hidden="true">
          {masterOff ? <Snowflake size={22} /> : <Flame size={22} />}
        </span>
        <div className={styles.summaryText}>
          <h2 className={styles.summaryTitle}>{title}</h2>
          {(masterBusy || sub) && <div className={styles.summarySub}>{masterBusy ? 'Updating…' : sub}</div>}
        </div>
        <Toggle
          size="lg" on={!!heatingEnabled} label="Heating system"
          title={heatingEnabled ? 'Switch all heating off' : 'Switch the heating on'}
          onChange={(v) => !masterBusy && toggleMaster(v)}
        />
      </section>

      {err && <ErrorBox style={{ margin: 0 }}>{err}</ErrorBox>}

      <div className={styles.rooms}>
        {rooms.map(({ room, d }) => {
          // Why the room is (not) heating — the one main reason plus the other factors.
          const why = d ? explainHeating({
            sc: d.sc, heatingEnabled, kind: d.kind, power: d.power, plugOn: d.plugOn, temp: d.temp,
            deviceTarget: d.kind === 'plug' ? d.setTarget : d.deviceTarget, liveWindow: d.liveWindow, liveClosedAt: d.liveClosedAt, mode: d.mode, modeExpires: d.modeExpires,
            manualMinutes: room.manualDuration, loading: !statusLoaded, now,
          }) : null;
          const actions = HEATING_ACTIONS.map((a) => {
            const flow = flowFor(room, a);
            const isBusy = busy.has(`${room.key}:${a.key}`);
            const ui = HEAT_ACTION_UI[a.key] || { Icon: Activity, cls: '' };
            return {
              key: a.key, label: actionLabel(a), Icon: ui.Icon, cls: ui.cls, busy: isBusy,
              active: !!d && !masterOff && d.mode === a.key, // Boost or Pause is running
              disabled: isBusy || !flow || masterOff,
              title: masterOff ? 'Heating system is off' : flow ? `Runs flow: ${flow.name}` : `No flow named "${room.code} - Heating ${a.flow}"`,
              onClick: () => runAction(room, a),
            };
          });
          return (
            <RoomCard
              key={room.key} room={room} d={d} why={why} now={now} nowMin={nowMin}
              slots={heatingDaySlots(room.key, weekend)}
              open={!!openRooms[room.key]} onToggle={() => toggleOpen(room.key)}
              systemOff={masterOff} onAdjust={(delta) => adjustTarget(room, d, delta)} actions={actions}
            />
          );
        })}
      </div>

      {(flowMissing || showConfig) && (
      <div className={styles.setup}>
        <button type="button" className="hd-btn hd-btn-ghost hd-btn-sm" onClick={() => setShowConfig((s) => !s)} aria-expanded={showConfig}>
          <Settings2 size={15} /> Flow mapping
          <ChevronDown size={15} className={cx(styles.setupChev, showConfig && styles.setupChevOpen)} />
        </button>
        {showConfig && (
          <div className={cx('hd-card hd-card-pad', styles.cfgCard)}>
            {HEATING_ROOMS.map((room) => (
              <div key={room.key} className={styles.cfgRow}>
                <span className={styles.cfgRoom}>{room.label}</span>
                {HEATING_ACTIONS.map((a) => {
                  const flow = flowFor(room, a);
                  return (
                    <label key={a.key} className={styles.cfgField}>
                      <span>{actionLabel(a)}</span>
                      <select
                        className="hd-select hd-select-sm" value={flow ? flow.id : ''}
                        onChange={(e) => setFlowFor(room.key, a.key, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {flowOptions.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
