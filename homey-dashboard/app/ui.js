'use client';

// Small shared pieces used by several tabs.

import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
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
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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
      title={title || (on ? 'Turn off' : 'Turn on')}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
      className={cx(styles.toggle, size === 'lg' && styles.toggleLg, size === 'sm' && styles.toggleSm, on && styles.toggleOn, disabled && styles.toggleDisabled)}
    >
      <span className={styles.track}><span className={styles.knob} /></span>
    </button>
  );
}

// A 0–1 slider with an icon and its value; commits on release, not while dragging.
export function SliderRow({ icon: Icon, value, onCommit, accent, fmt, label }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const pct = Math.round((v ?? 0) * 100);
  const commit = (e) => onCommit(e.target.valueAsNumber / 100);
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon}>{Icon && <Icon size={16} />}</span>
      <input
        type="range" min={0} max={100} value={pct} aria-label={label}
        onChange={(e) => setV(e.target.valueAsNumber / 100)}
        onPointerUp={commit}
        onKeyUp={commit}
        className={styles.slider}
        style={{ accentColor: accent || 'var(--accent)' }}
      />
      <span className={styles.sliderVal}>{fmt ? fmt(v) : `${pct}%`}</span>
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
