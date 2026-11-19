'use client';

// Adaptive lighting: each room's circadian schedule (from the Homey adaptivelighting.js
// script) with the mode the script reports per light. A phase can be applied directly,
// and a room reset to Auto through its light-reset flow.

import { useEffect, useMemo, useState } from 'react';
import {
  CircleCheck, Hand, Lightbulb, LoaderCircle, Pin, RotateCcw, Settings2, Sunrise, Sunset,
} from 'lucide-react';
import {
  AL_ROOMS, getSunTimes, phaseList, isActive, activePhase, tempColor, fmtMinutes,
  copenhagenMinutesNow, isWeekendScheduleNow, resolveLightMode, describeLightStatus, isIdle,
} from '../lib/adaptiveLighting';
import { cx, cmpZonePath, ErrorBox, Pill, SPIN } from './ui';
import styles from './LightingTab.module.css';

function warmthLabel(t) {
  if (t >= 0.75) return 'very warm';
  if (t >= 0.6) return 'warm';
  if (t >= 0.45) return 'neutral';
  return 'cool';
}

// Best-guess a room's reset flow by token overlap with the flow name.
// Short tokens (room codes like "E9", "ST") must match as whole words to avoid noise.
function guessResetFlow(tokens, resetFlows) {
  let best = null;
  let bestScore = 0;
  for (const f of resetFlows) {
    const n = f.name.toLowerCase();
    let score = 0;
    for (const raw of tokens) {
      const t = raw.toLowerCase();
      if (!t) continue;
      const hit = t.length <= 2 ? new RegExp(`\\b${t}\\b`).test(n) : n.includes(t);
      if (hit) score += t.length + 1;
    }
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore > 0 ? best : null;
}

export default function LightingTab({ devices, flows, alStatus, onReload }) {
  const sun = useMemo(() => getSunTimes(new Date()), []);
  const [weekend, setWeekend] = useState(isWeekendScheduleNow());
  const [busy, setBusy] = useState(() => new Set());
  const [err, setErr] = useState('');
  const [mapping, setMapping] = useState({});
  const [applying, setApplying] = useState(null); // key of the group being applied
  const [picking, setPicking] = useState(null); // area whose reset flow is being chosen
  const nowMin = copenhagenMinutesNow();
  const todayWeekend = isWeekendScheduleNow();

  useEffect(() => {
    try { setMapping(JSON.parse(localStorage.getItem('al_reset_flows') || '{}')); } catch { /* ignore */ }
  }, []);

  const deviceMap = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => m.set(d.id, d.capabilities || {}));
    return m;
  }, [devices]);

  // Light-reset flows: prefer names with both "reset" and a light word; exclude heating.
  const resetFlows = useMemo(() => {
    const all = flows || [];
    const resets = all.filter((f) => /reset|nulstil/i.test(f.name));
    const lightish = resets.filter((f) => /light|lys|lamp/i.test(f.name));
    const base = lightish.length
      ? lightish
      : resets.filter((f) => !/heat|heating|varme|temp|therm/i.test(f.name));
    return (base.length ? base : resets).slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [flows]);
  const flowById = useMemo(() => {
    const m = new Map();
    (flows || []).forEach((f) => m.set(f.id, f));
    return m;
  }, [flows]);

  // One entry per room (area). Each member keeps its own schedule; the room's chart
  // uses a single representative schedule (the template used by the most lights).
  const areas = useMemo(() => {
    const byArea = new Map();
    for (const r of AL_ROOMS) {
      if (!byArea.has(r.area)) byArea.set(r.area, []);
      byArea.get(r.area).push({ name: r.name, id: r.id, weekday: r.weekday, weekend: r.weekend || null });
    }
    return [...byArea.entries()].map(([area, members]) => {
      const counts = new Map();
      for (const m of members) {
        const k = JSON.stringify(m.weekday);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      let repKey = null;
      let repN = -1;
      for (const [k, n] of counts) if (n > repN) { repN = n; repKey = k; }
      const rep = members.find((m) => JSON.stringify(m.weekday) === repKey) || members[0];
      const mixed = counts.size > 1;
      return { area, members, repWeekday: rep.weekday, repWeekend: rep.weekend, repName: rep.name, mixed };
    });
  }, []);

  // Order the rooms by their real zone path (from live devices).
  const zonePathById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => m.set(d.id, d.zonePath));
    return m;
  }, [devices]);
  const orderedAreas = useMemo(() => {
    return areas
      .map((a) => {
        const withZone = a.members.find((m) => zonePathById.get(m.id));
        return { ...a, zonePath: withZone ? zonePathById.get(withZone.id) : a.area };
      })
      .sort((x, y) => cmpZonePath(x.zonePath, y.zonePath));
  }, [areas, zonePathById]);

  // The reset flow chosen for a room: explicit mapping (keyed by area), else best guess.
  const flowForRoom = (area, members) => {
    if (mapping[area]) return flowById.get(mapping[area]) || null;
    const tokens = [
      ...area.split(/\s+/),
      ...members.map((m) => m.name.split(/\s+/)[0]), // room codes like "E9", "ST"
    ];
    return guessResetFlow(tokens, resetFlows);
  };
  const setFlowForRoom = (area, flowId) => {
    setMapping((prev) => {
      const next = { ...prev, [area]: flowId };
      try { localStorage.setItem('al_reset_flows', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // A light's mode: AdaptiveLighting's published state, or — when the script hasn't
  // published for this light — the guess against its own schedule in effect today.
  const memberActual = (m) => (todayWeekend && m.weekend ? m.weekend : m.weekday);
  const modeForMember = (m) => resolveLightMode(deviceMap.get(m.id), alStatus, m.id, activePhase(memberActual(m), sun, nowMin));
  const isManualish = (r) => r.mode === 'manual' || r.mode === 'drift';

  // Not memoised: drift depends on how long a difference has lasted, so the count
  // must follow the page's 1 s re-render, not just data changes (~18 lights, cheap)
  let manualCount = 0;
  for (const { members } of areas) for (const m of members) if (isManualish(modeForMember(m))) manualCount += 1;

  // Apply a phase's brightness/temperature to a group's lights right now (direct
  // capability control — no script needed). Puts the lights into "manual" until reset.
  async function applyPhase(key, members, phaseName) {
    setErr('');
    setApplying(key);
    try {
      const items = members
        .map((m) => {
          // Each light uses its own template's phase of this name (viewed weekday/weekend).
          const profiles = weekend && m.weekend ? m.weekend : m.weekday;
          const phase = phaseList(profiles, sun).find((p) => p.name === phaseName);
          if (!phase) return null;
          const caps = deviceMap.get(m.id) || {};
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

  async function resetRoom(area, flow) {
    if (!flow) { setErr(`No reset flow selected for ${area}.`); return; }
    setErr('');
    setBusy((prev) => new Set(prev).add(area));
    try {
      const r = await fetch('/api/homey/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'flow trigger failed');
      setTimeout(() => onReload && onReload(), 1600); // let the flow run, then refresh live state
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(area); return n; });
    }
  }

  const tonePill = (tone) => ({ background: `var(--${tone}-soft)`, color: `var(--${tone})`, borderColor: 'transparent', fontWeight: 600 });

  return (
    <div>
      {err && <ErrorBox>{err}</ErrorBox>}

      <div className={styles.alBar}>
        <Pill><Sunrise size={14} className={styles.amber} /> Sunrise <b className="hd-num">{fmtMinutes(sun.sunriseMinutes)}</b></Pill>
        <Pill><Sunset size={14} className={styles.amber} /> Sunset <b className="hd-num">{fmtMinutes(sun.sunsetMinutes)}</b></Pill>
        {manualCount === 0 ? (
          <span className="hd-pill" style={tonePill('good')}><CircleCheck size={14} /> all Auto</span>
        ) : (
          <span className="hd-pill" style={tonePill('warn')}><Hand size={14} /> {manualCount} manual</span>
        )}
        <div className={cx('hd-seg', styles.segRight)} role="group" aria-label="Schedule shown">
          {[['Weekday', false], ['Weekend', true]].map(([label, val]) => (
            <button key={label} type="button" aria-pressed={weekend === val} onClick={() => setWeekend(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.areaList}>
        {orderedAreas.map(({ area, members, repWeekday, repWeekend, repName, mixed }) => {
          const roomFlow = flowForRoom(area, members);
          const roomBusy = busy.has(area);
          const memberModes = members.map((m) => modeForMember(m));
          const roomMode = memberModes.some(isManualish) ? 'manual'
            : memberModes.some((r) => r.mode === 'forced') ? 'forced' : 'auto';
          const useWeekend = weekend && repWeekend;
          const chartProfiles = useWeekend ? repWeekend : repWeekday;
          return (
            <div key={area} className="hd-card hd-card-pad">
              <div className={styles.areaHead}>
                <h3 className="hd-title">{area}</h3>
                <ModeBadge mode={roomMode} />
                <div className={styles.areaControls}>
                  <button
                    type="button" className="hd-btn hd-btn-soft hd-btn-sm"
                    onClick={() => resetRoom(area, roomFlow)} disabled={roomBusy || !roomFlow}
                  >
                    {roomBusy ? <LoaderCircle size={14} style={SPIN} /> : <RotateCcw size={14} />}
                    Reset to Auto
                  </button>
                  <button
                    type="button" className={cx('hd-icon-btn', styles.cfgBtn)} aria-label={`Reset flow for ${area}`}
                    aria-expanded={picking === area || !roomFlow} onClick={() => setPicking((p) => (p === area ? null : area))}
                  >
                    <Settings2 size={15} />
                  </button>
                </div>
              </div>
              {(picking === area || !roomFlow) && (
                <label className={styles.flowPick}>
                  <span>Reset flow</span>
                  <select
                    className="hd-select hd-select-sm"
                    value={roomFlow ? roomFlow.id : ''}
                    onChange={(e) => setFlowForRoom(area, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {resetFlows.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                </label>
              )}
              <ScheduleChart
                profiles={chartProfiles}
                sun={sun}
                nowMin={nowMin}
                onApplyPhase={(phase) => applyPhase(area, members, phase.name)}
                applying={applying === area}
              />
              <div className={styles.members}>
                {members.map((m, i) => (
                  <div key={m.id} className={styles.memberRow}>
                    <BulbTile caps={deviceMap.get(m.id)} />
                    <span className={styles.memberName} title={m.name}>{m.name}</span>
                    <ModeBadge {...memberModes[i]} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lightbulb tile tinted with the light's current colour (when on and known).
function BulbTile({ caps }) {
  const s = lightSwatch(caps);
  if (s && s.on) {
    return (
      <span
        className={styles.bulb}
        title={s.dim != null ? `on · ${Math.round(s.dim * 100)}%` : 'on'}
        style={{
          background: s.color, color: '#1f2937',
          boxShadow: `0 0 14px -3px ${s.color}`,
          opacity: s.dim != null ? 0.55 + 0.45 * s.dim : 1,
        }}
      >
        <Lightbulb size={14} strokeWidth={2.2} />
      </span>
    );
  }
  return (
    <span className={styles.bulb} title={s ? 'off' : undefined} style={s ? { color: 'var(--faint)' } : undefined}>
      <Lightbulb size={14} />
    </span>
  );
}

// mode/guess/st as returned by resolveLightMode (room badges pass just a mode).
function ModeBadge({ mode, guess = false, st = null }) {
  const map = {
    auto: { label: 'Auto', cls: 'hd-tag-good' },
    manual: { label: 'Manual', cls: 'hd-tag-warn' },
    drift: { label: 'Manual?', cls: 'hd-tag-warn', dashed: true },
    forced: { label: st?.profile || 'Forced', cls: 'hd-tag-accent', Icon: Pin },
    off: { label: 'Off', cls: '' },
    unknown: { label: '—', cls: '', faint: true },
  };
  const s = map[mode] || map.unknown;
  const BadgeIcon = s.Icon;
  // AL dimmed it for an empty room: "Auto · idle" (the mode underneath stays)
  const idle = !guess && mode !== 'off' && isIdle(st);
  const title = guess
    ? 'Guessed from the schedule — the script has not reported this light'
    : mode === 'drift'
      ? `Differs from what the script set (${describeLightStatus(st)}); it will switch to Manual on its next check`
      : describeLightStatus(st) || undefined;
  return (
    <span
      title={title}
      className={cx('hd-tag', s.cls, s.dashed && styles.driftDashed)}
      style={{
        opacity: guess ? 0.7 : 1, flexShrink: 0,
        cursor: title ? 'help' : undefined,
        color: s.faint ? 'var(--faint)' : undefined,
      }}
    >
      {guess ? '~' : ''}
      {BadgeIcon && <BadgeIcon size={11} />}
      {s.label}{idle ? ' · idle' : ''}
    </span>
  );
}

function ScheduleChart({ profiles, sun, nowMin, onApplyPhase, applying }) {
  const phases = phaseList(profiles, sun);
  const pct = (m) => `${(m / 1440) * 100}%`;

  // Split any phase that wraps past midnight into two drawable bars.
  const bars = [];
  phases.forEach((p) => {
    if (p.end <= 1440) bars.push({ ...p, s: p.start, e: p.end });
    else {
      bars.push({ ...p, s: p.start, e: 1440 });
      bars.push({ ...p, s: 0, e: p.end - 1440 });
    }
  });

  return (
    <div>
      <div className={styles.chart}>
        {[3, 6, 9, 12, 15, 18, 21].map((h) => (
          <div key={h} className={cx(styles.grid, h % 6 === 0 && styles.gridMajor)} style={{ left: pct(h * 60) }} />
        ))}
        {bars.map((b, k) => {
          const c = tempColor(b.temperature);
          return (
            <div
              key={k}
              className={styles.bar}
              title={`${b.name}: ${fmtMinutes(b.start)}–${fmtMinutes(b.end)} · ${Math.round(b.brightness * 100)}% · ${warmthLabel(b.temperature)}`}
              style={{
                left: `calc(${pct(b.s)} + 1px)`, width: `calc(${pct(b.e - b.s)} - 2px)`,
                height: `${Math.max(3, b.brightness * 100)}%`,
                background: `linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0, rgba(255, 255, 255, 0) 5px), ${c}`,
                boxShadow: `0 0 16px -3px ${c}`,
              }}
            />
          );
        })}
        {[[Sunrise, sun.sunriseMinutes, 'Sunrise'], [Sunset, sun.sunsetMinutes, 'Sunset']].map(([SunIcon, m, label]) => (
          <div key={label} className={styles.sunMark} style={{ left: pct(m) }} title={`${label} ${fmtMinutes(m)}`}>
            <span className={styles.sunIcon}><SunIcon size={12} strokeWidth={2.2} /></span>
          </div>
        ))}
        <div className={styles.nowLine} style={{ left: pct(nowMin) }} title={`Now ${fmtMinutes(nowMin)}`}>
          <span className={styles.nowDot} />
        </div>
      </div>

      <div className={styles.axis}>
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: pct(h * 60), transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      <div className={styles.phases}>
        {phases.map((p, i) => {
          const active = isActive(p, nowMin);
          const c = tempColor(p.temperature);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onApplyPhase && onApplyPhase(p)}
              disabled={applying || !onApplyPhase}
              title={`Set these lights to ${p.name} (${Math.round(p.brightness * 100)}%) now`}
              className={cx(styles.phaseChip, active && styles.phaseChipActive)}
            >
              <span className={styles.swatch} style={{ background: c, boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.12), 0 0 8px ${c}` }} />
              <b style={{ fontWeight: active ? 700 : 600 }}>{p.name}</b>
              <span className={styles.phaseMeta}>{fmtMinutes(p.start)} · {Math.round(p.brightness * 100)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Current on-tile colour for a light: hue when in colour mode, else warm/cool from
// light_temperature, else a neutral warm white. Returns null for non-lights.
function lightSwatch(caps) {
  if (!caps || !('onoff' in caps)) return null;
  const on = !!caps.onoff;
  let color;
  if (caps.light_mode === 'color' && caps.light_hue != null) {
    const h = Math.round((caps.light_hue || 0) * 360);
    const s = Math.round((caps.light_saturation != null ? caps.light_saturation : 1) * 100);
    color = `hsl(${h} ${s}% 55%)`;
  } else if (caps.light_temperature != null) {
    color = tempColor(caps.light_temperature);
  } else {
    color = tempColor(0.6);
  }
  const dim = caps.dim;
  return { on, color, dim: dim != null ? dim : null };
}
