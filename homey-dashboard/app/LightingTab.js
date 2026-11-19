'use client';

// Adaptive lighting: each room's day as a strip (colour = white balance, label = brightness),
// from the Homey adaptivelighting.js script, with the mode the script reports per light.
// Rooms whose Daytime colour follows the sun show that curve on the strip. Each light can be
// switched and adjusted; on a room with a light in Manual, the Manual badge is a button that
// runs the room's light-reset flow and so returns it to Auto.

import { useEffect, useMemo, useState } from 'react';
import {
  Hand, LoaderCircle, Pin, RotateCcw, Sun, Sunrise, Sunset,
} from 'lucide-react';
import {
  AL_ROOMS, getSunTimes, phaseList, activePhase, tempColor, fmtMinutes, copenhagenMinutesNow,
  isWeekendScheduleNow, resolveLightMode, describeLightStatus, isIdle, sunColourSamples, SUN_PROFILE,
} from '../lib/adaptiveLighting';
import { cx, cmpZonePath, DayStrip, ErrorBox, Pill, SPIN } from './ui';
import { slotName } from '../lib/heatingState';
import LightTile from './LightTile';
import styles from './LightingTab.module.css';

function warmthLabel(t) {
  if (t >= 0.75) return 'meget varm';
  if (t >= 0.6) return 'varm';
  if (t >= 0.45) return 'neutral';
  return 'kold';
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

export default function LightingTab({ devices, flows, alStatus, onControl, onReload }) {
  const sun = useMemo(() => getSunTimes(new Date()), []);
  const [busy, setBusy] = useState(() => new Set());
  const [err, setErr] = useState('');
  const [mapping, setMapping] = useState({});
  const nowMin = copenhagenMinutesNow();
  const todayWeekend = isWeekendScheduleNow(); // the strips show the schedule in effect today

  useEffect(() => {
    try { setMapping(JSON.parse(localStorage.getItem('al_reset_flows') || '{}')); } catch { /* ignore */ }
  }, []);

  const deviceById = useMemo(() => new Map((devices || []).map((d) => [d.id, d])), [devices]);
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
      byArea.get(r.area).push({ name: r.name, id: r.id, weekday: r.weekday, weekend: r.weekend || null, sun: !!r.sun });
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
      return { area, members, repWeekday: rep.weekday, repWeekend: rep.weekend, repSun: rep.sun };
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

  // A room's reset flow. The flows are named "<room code> - Light reset" ("ST - Light reset"),
  // the code being the first word of the lights' names, so the name decides. Only when no flow
  // has that name does a flow picked by hand (keyed by area) or a guess step in.
  const flowForRoom = (area, members) => {
    const name = `${members[0].name.split(/\s+/)[0]} - Light reset`.toLowerCase();
    const exact = (flows || []).find((f) => f.name.trim().toLowerCase() === name);
    if (exact) return exact;
    if (mapping[area] && flowById.get(mapping[area])) return flowById.get(mapping[area]);
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

  async function resetRoom(area, flow) {
    if (!flow) { setErr(`Intet nulstil-flow valgt for ${area}.`); return; }
    setErr('');
    setBusy((prev) => new Set(prev).add(area));
    try {
      const r = await fetch('/api/homey/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flow.id, advanced: flow.type === 'advanced' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Kunne ikke starte flowet');
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
        <Pill><Sunrise size={14} className={styles.amber} /> Solopgang <b className="hd-num">{fmtMinutes(sun.sunriseMinutes)}</b></Pill>
        <Pill><Sunset size={14} className={styles.amber} /> Solnedgang <b className="hd-num">{fmtMinutes(sun.sunsetMinutes)}</b></Pill>
        {manualCount > 0 && (
          <span className="hd-pill" style={tonePill('warn')}><Hand size={14} /> {manualCount} manuelt</span>
        )}
      </div>

      <div className={styles.areaList}>
        {orderedAreas.map(({ area, members, repWeekday, repWeekend, repSun }) => {
          const roomFlow = flowForRoom(area, members);
          const roomBusy = busy.has(area);
          const memberModes = members.map((m) => modeForMember(m));
          const manual = memberModes.some(isManualish);
          const roomMode = manual ? 'manual' : memberModes.some((r) => r.mode === 'forced') ? 'forced' : 'auto';
          const useWeekend = todayWeekend && repWeekend;
          const chartProfiles = useWeekend ? repWeekend : repWeekday;
          return (
            <div key={area} className="hd-card hd-card-pad">
              <div className={styles.areaHead}>
                <h3 className="hd-title">{area}</h3>
                {/* Only what differs from Auto is shown, at the right edge. The Manual badge is
                    the way back: it runs the room's light-reset flow. */}
                {manual && roomFlow && (
                  <button
                    type="button" className={styles.modeBtn} onClick={() => resetRoom(area, roomFlow)} disabled={roomBusy}
                    aria-label={`${area} er i manuelt. Tilbage til auto`} title="Tilbage til auto"
                  >
                    {roomBusy ? <LoaderCircle size={13} style={SPIN} /> : <RotateCcw size={13} strokeWidth={2.4} />}
                    Manuelt
                  </button>
                )}
                {roomMode !== 'auto' && !(manual && roomFlow) && <ModeBadge mode={roomMode} />}
              </div>
              {manual && !roomFlow && (
                <label className={styles.flowPick}>
                  <span>Nulstil-flow</span>
                  <select className="hd-select hd-select-sm" value="" onChange={(e) => setFlowForRoom(area, e.target.value)}>
                    <option value="">— intet —</option>
                    {resetFlows.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                </label>
              )}
              <ScheduleStrip profiles={chartProfiles} sun={sun} nowMin={nowMin} followsSun={repSun} />
              <div className={styles.members}>
                {members.map((m, i) => {
                  const device = deviceById.get(m.id);
                  return device ? (
                    <LightTile
                      key={m.id} device={device} al={memberModes[i]}
                      onToggle={onControl ? (v) => onControl(m.id, { onoff: v }) : null}
                      onSet={onControl ? (values) => onControl(m.id, values) : null}
                    />
                  ) : (
                    <div key={m.id} className={styles.missing}>{m.name}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// mode/guess/st as returned by resolveLightMode (room badges pass just a mode).
function ModeBadge({ mode, guess = false, st = null }) {
  const map = {
    auto: { label: 'Auto', cls: 'hd-tag-good' },
    manual: { label: 'Manuelt', cls: 'hd-tag-warn' },
    drift: { label: 'Manuelt?', cls: 'hd-tag-warn', dashed: true },
    forced: { label: st?.profile ? slotName(st.profile) : 'Låst', cls: 'hd-tag-accent', Icon: Pin },
    off: { label: 'Slukket', cls: '' },
    unknown: { label: '—', cls: '', faint: true },
  };
  const s = map[mode] || map.unknown;
  const BadgeIcon = s.Icon;
  // AL dimmed it for an empty room: "Auto · idle" (the mode underneath stays)
  const idle = !guess && mode !== 'off' && isIdle(st);
  const title = guess
    ? 'Gættet ud fra tidsplanen — scriptet har ikke meldt denne lampe'
    : mode === 'drift'
      ? `Afviger fra det, scriptet satte (${describeLightStatus(st)}); skifter til manuelt ved næste tjek`
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
      {s.label}{idle ? ' · dæmpet' : ''}
    </span>
  );
}

// A room's day as a strip: one segment per phase, its white balance as the colour (fainter
// when dimmer) and its brightness as the label. Where the room follows the sun, Daytime is
// drawn as today's sun colour curve and its label carries a sun. A phase that wraps past midnight becomes two segments.
function ScheduleStrip({ profiles, sun, nowMin, followsSun }) {
  const tint = (temperature, brightness) => (
    `color-mix(in srgb, ${tempColor(temperature)} ${Math.round(35 + brightness * 65)}%, var(--surface-3))`
  );
  const segments = [];
  phaseList(profiles, sun).forEach((p) => {
    const pct = `${Math.round(p.brightness * 100)}%`;
    const parts = p.end <= 1440 ? [[p.start, p.end]] : [[p.start, 1440], [0, p.end - 1440]];
    parts.forEach(([start, end]) => {
      const samples = followsSun && p.name === SUN_PROFILE ? sunColourSamples(profiles, start, end) : [];
      const color = samples.length > 1
        ? `linear-gradient(90deg, ${samples.map((x) => `${tint(x.temperature, p.brightness)} ${(((x.m - start) / (end - start)) * 100).toFixed(1)}%`).join(', ')})`
        : tint(p.temperature, p.brightness);
      segments.push({
        start, end, label: pct, color, icon: samples.length > 1 ? <Sun size={12} strokeWidth={2.6} aria-label="Farven følger solen" /> : null,
        title: `${slotName(p.name)}: ${fmtMinutes(p.start)}–${fmtMinutes(p.end)} · ${pct} · ${samples.length > 1 ? 'farven følger solen' : warmthLabel(p.temperature)}`,
      });
    });
  });
  segments.sort((a, b) => a.start - b.start);
  return <DayStrip segments={segments} nowMin={nowMin} />;
}
