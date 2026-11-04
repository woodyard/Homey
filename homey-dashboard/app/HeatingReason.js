'use client';

// Heating "why" strip shared by the Heating tab and the Rooms 2.0 tab: the one main
// reason a room is (or is not) heating right now, a countdown bar when it ends at a known
// time, and the other factors as chips. The text comes from lib/heatingState.js.

import { useEffect, useState } from 'react';
import {
  AppWindow, CalendarClock, CircleCheck, CircleHelp, DoorOpen, Flame, Footprints, Hand, Hourglass, Moon,
  Pause, Power, Thermometer, TriangleAlert,
} from 'lucide-react';
import styles from './HeatingReason.module.css';

export const HEAT_ICONS = {
  power: Power, help: CircleHelp, pause: Pause, flame: Flame, hand: Hand, alert: TriangleAlert,
  away: DoorOpen, window: AppWindow, hourglass: Hourglass, footprints: Footprints, moon: Moon,
  clock: CalendarClock, check: CircleCheck, idle: Thermometer,
};

const TAG_CLASS = {
  heat: 'hd-tag-heat', good: 'hd-tag-good', warn: 'hd-tag-warn', bad: 'hd-tag-bad', accent: 'hd-tag-accent', muted: '',
};

/** Current time, re-rendered every `ms` so countdowns move without new data. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}

/** Compact header tag for the state (e.g. "Waiting 18 min"), or nothing in normal states. */
export function HeatingTag({ info }) {
  if (!info || !info.tag) return null;
  const Icon = HEAT_ICONS[info.tag.icon] || CircleHelp;
  return (
    <span className={`hd-tag hd-num ${TAG_CLASS[info.tag.tone] || ''}`}>
      <Icon size={12} strokeWidth={2.2} />{info.tag.text}
    </span>
  );
}

export default function HeatingReason({ info, now, className }) {
  if (!info) return null;
  const Icon = HEAT_ICONS[info.icon] || CircleHelp;
  const p = info.progress;
  const pct = p && p.to > p.from
    ? Math.max(0, Math.min(100, ((now - p.from) / (p.to - p.from)) * 100)) : null;
  return (
    <div className={`${styles.wrap}${className ? ` ${className}` : ''}`}>
      <div className={styles.strip} data-tone={info.tone}>
        <span className={styles.icon} aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
        <div className={styles.body}>
          <div className={styles.headline}>{info.headline}</div>
          {info.detail && <div className={styles.detail}>{info.detail}</div>}
          {pct != null && (
            <div
              className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(pct)} aria-label="Time elapsed"
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
      {info.factors && info.factors.length > 0 && (
        <div className={styles.factors}>
          {info.factors.map((f) => {
            const FIcon = HEAT_ICONS[f.icon] || CircleHelp;
            return (
              <span key={f.key} className={`hd-tag ${TAG_CLASS[f.tone] || ''} ${styles.chip}`}>
                <FIcon size={12} strokeWidth={2.2} />{f.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
