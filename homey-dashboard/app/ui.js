'use client';

// Small shared pieces used by several tabs.

import { useEffect, useRef, useState } from 'react';
import { Activity, Moon, TriangleAlert } from 'lucide-react';
import styles from './ui.module.css';

export const cx = (...a) => a.filter(Boolean).join(' ');

// Spinning icon (keyframes live in globals.css).
export const SPIN = { animation: 'hd-spin 0.8s linear infinite' };

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function roomNameFromPath(path) {
  const parts = (path || '').split(' > ');
  return parts[parts.length - 1] || path;
}

// Order rooms by their full zone path ("Hjem > Kertemindegade 9 > Stue"), since this
// Homey's cloud API exposes no zone-order field. Compares level-by-level with Danish
// collation (æ/ø/å last), and a parent path sorts before its children.
export function cmpZonePath(a, b) {
  const A = (a || '').split(' > ');
  const B = (b || '').split(' > ');
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const c = A[i].localeCompare(B[i], 'da');
    if (c !== 0) return c;
  }
  return A.length - B.length;
}

export const INACTIVE_COUNTER_LIMIT = 30 * 60; // per-second counter for 30 min, then per-minute

export function fmtDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtLongDuration(secs) {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} t ${m % 60} min`;
}

export function ErrorBox({ children, style }) {
  return (
    <div className="hd-error" role="alert" style={style}>
      <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

export function Empty({ children, icon: Icon }) {
  return (
    <div className="hd-empty">
      {Icon && <Icon size={22} className={styles.emptyIcon} />}
      {children}
    </div>
  );
}

// Someone is in the room now (a motion sensor in its zone sees movement). Varme and Lys.
export function Presence({ className }) {
  return <span className={cx(styles.presence, className)}><Activity size={14} /> Der er nogen i rummet</span>;
}

// Nobody seen for `secs` (Varme and Lys); `children` adds to the line ("· slukker om 0:40").
export function NoMotion({ secs, className, title, children }) {
  const label = secs < INACTIVE_COUNTER_LIMIT ? fmtDuration(secs) : fmtLongDuration(secs);
  return (
    <span className={cx(styles.noMotion, className)} title={title}>
      <Moon size={14} />
      <span>Ingen bevægelse i <span className="hd-num">{label}</span></span>
      {children}
    </span>
  );
}

// Thin bar for time gone of a countdown (Boost, Pause, a window, an empty room). Colour from
// `tone` or the surrounding --tone.
export function ProgressBar({ pct, tone, label = 'Tid gået', className }) {
  return (
    <div
      className={cx(styles.progress, className)} role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(pct)} aria-label={label} style={tone ? { '--tone': tone } : undefined}
    >
      <span style={{ width: `${clamp(pct, 0, 100)}%` }} />
    </div>
  );
}

export function Pill({ children }) {
  return <span className="hd-pill">{children}</span>;
}

// Small status chip. `tone` picks a hd-tag variant (good, warn, bad, heat, accent, cool, violet).
export function Tag({ children, tone, icon: Icon, title }) {
  return (
    <span title={title} className={cx('hd-tag', tone && `hd-tag-${tone}`)}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

// On/off switch. size: 'sm' (lists) | undefined | 'lg' (the heating master switch).
// `disabled` greys it out — used for "Always on" devices that cannot be switched off.
export function Toggle({ on, onChange, size, title, disabled, label }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} aria-disabled={disabled || undefined}
      title={title || (on ? 'Sluk' : 'Tænd')}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
      className={cx(styles.toggle, size === 'lg' && styles.toggleLg, size === 'sm' && styles.toggleSm, on && styles.toggleOn, disabled && styles.toggleDisabled)}
    >
      <span className={styles.track}><span className={styles.knob} /></span>
    </button>
  );
}

// A 0–1 slider with an icon; commits on release, not while dragging. `track` is the CSS
// background of the track (a gradient that shows what the slider changes). The value is shown
// as a percentage, or as fmt(v); a fmt that returns null shows no value.
//
// The commit listens for the browser's own `change` event, which fires once when the thumb is
// let go, however it was moved (mouse, finger, keyboard). A pointerup handler misses most
// finger drags: the browser takes the gesture over and sends pointercancel instead.
export function SliderRow({ icon: Icon, value, onCommit, track, fmt, label }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const inputRef = useRef(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    const onChange = () => commitRef.current(el.valueAsNumber / 100);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  const pct = Math.round((v ?? 0) * 100);
  const text = fmt ? fmt(v) : `${pct}%`;
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon}>{Icon && <Icon size={17} />}</span>
      <input
        ref={inputRef} type="range" min={0} max={100} value={pct} aria-label={label}
        onChange={(e) => setV(e.target.valueAsNumber / 100)}
        className={styles.slider}
        style={track ? { '--track': track } : undefined}
      />
      {text != null && <span className={styles.sliderVal}>{text}</span>}
    </div>
  );
}

// "21.3°" with the decimal set smaller, as on a thermostat.
export function BigTemp({ value, className }) {
  if (value == null || !Number.isFinite(Number(value))) return <span className={cx(styles.bigTemp, className)}>—</span>;
  const [int, dec] = Number(value).toFixed(1).split('.');
  return (
    <span className={cx(styles.bigTemp, className)}>
      {int}<span className={styles.bigTempDec}>.{dec}°</span>
    </span>
  );
}

// A day as one strip: a segment per period with its label above, and a marker for now.
// segments: [{ start, end, label, icon?, color, title }], minutes from midnight, in order.
// `icon` (a small element) sits before the label, e.g. a sun on a period that follows the sun.
export function DayStrip({ segments, nowMin }) {
  if (!segments.length) return null;
  return (
    <div>
      <div className={styles.stripLabels} aria-hidden="true">
        {segments.map((s) => (
          <span key={s.start} style={{ flexGrow: s.end - s.start }} className={nowMin >= s.start && nowMin < s.end ? styles.stripLabelNow : undefined}>
            {s.end - s.start >= 150 && <>{s.icon}{s.label}</>}
          </span>
        ))}
      </div>
      <div className={styles.stripBar}>
        {segments.map((s) => (
          <div key={s.start} className={styles.stripSeg} style={{ flexGrow: s.end - s.start, background: s.color }} title={s.title} />
        ))}
        <span className={styles.stripNow} style={{ left: `${clamp((nowMin / 1440) * 100, 0, 100)}%` }} />
      </div>
      <div className={styles.stripAxis} aria-hidden="true">
        {['00', '06', '12', '18', '24'].map((h) => <span key={h}>{h}</span>)}
      </div>
    </div>
  );
}
