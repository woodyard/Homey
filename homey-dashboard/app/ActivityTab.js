'use client';

// Live activity: Homey Timeline notifications merged with the device-state changes this
// page has seen since it was opened (Homey has no "flow is running" signal, so state changes
// are the closest view of flows and scripts acting on the home).

import {
  Activity, AppWindow, Bell, Blinds, Bot, DoorOpen, Droplets, Flame, Footprints, Power, Thermometer,
  TriangleAlert,
} from 'lucide-react';
import { cx, Empty } from './ui';
import styles from './ActivityTab.module.css';

// Render Homey notification excerpts, honouring their **bold** markers.
function renderExcerpt(text) {
  return String(text || '').split(/\*\*(.+?)\*\*/g).map((part, i) => (
    i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>
  ));
}

function fmtVal(v) {
  if (v === true) return 'on';
  if (v === false) return 'off';
  if (v === null || v === undefined) return '—';
  return String(v);
}

const TONE = {
  accent: ['var(--accent-soft)', 'var(--accent)'],
  good: ['var(--good-soft)', 'var(--good)'],
  warn: ['var(--warn-soft)', 'var(--warn)'],
  bad: ['var(--bad-soft)', 'var(--bad)'],
  heat: ['var(--heat-soft)', 'var(--heat)'],
  neutral: ['var(--neutral-soft)', 'var(--muted)'],
};

function feedVisual(item) {
  if (item.type === 'notif') return { Icon: Bell, tone: 'accent' };
  const cap = item.cap || '';
  let Icon = Activity;
  if (cap === 'onoff') Icon = Power;
  else if (cap === 'target_temperature') Icon = Thermometer;
  else if (cap === 'thermostat_mode' || cap === 'tado_presence_mode') Icon = Flame;
  else if (cap === 'alarm_motion') Icon = Footprints;
  else if (cap === 'alarm_contact') Icon = DoorOpen;
  else if (cap === 'alarm_water') Icon = Droplets;
  else if (cap === 'alarm_open_window_detected') Icon = AppWindow;
  else if (cap.startsWith('windowcoverings') || cap.startsWith('curtain')) Icon = Blinds;
  else if (cap.startsWith('vacuumcleaner') || cap.startsWith('alarm_bin') || cap.startsWith('alarm_cleaning')) Icon = Bot;
  else if (cap.startsWith('alarm_')) Icon = TriangleAlert;

  let tone = 'accent';
  if (item.to === true) {
    if (cap === 'alarm_water') tone = 'bad';
    else if (cap.startsWith('alarm_') && cap !== 'alarm_motion') tone = 'warn';
    else tone = 'good';
  } else if (item.to === false) tone = 'neutral';
  else if (cap === 'target_temperature' || cap === 'thermostat_mode') tone = 'heat';
  return { Icon, tone };
}

function FeedItem({ item }) {
  const { Icon, tone } = feedVisual(item);
  const [bg, color] = TONE[tone];
  return (
    <div className={styles.tlItem}>
      <span className={styles.tlIconWrap}>
        <span className={styles.tlIcon} style={{ background: bg, color }}><Icon size={14} strokeWidth={2.2} /></span>
      </span>
      <div className={styles.tlBody}>
        {item.type === 'notif' ? (
          <>
            {item.ownerName && <b>{item.ownerName}</b>}
            <div className={styles.tlExcerpt}>{renderExcerpt(item.excerpt)}</div>
          </>
        ) : (
          <>
            <b>{item.name}</b> <span className={styles.tlRoom}>· {item.room}</span>
            <div className={styles.tlSub}>
              <span className={styles.tlCap}>{item.cap}</span>
              <span className="hd-tag">{fmtVal(item.from)}</span>
              <span aria-hidden="true">→</span>
              <span className={cx('hd-tag', item.to === true ? 'hd-tag-good' : item.to === false ? '' : 'hd-tag-accent')}>
                {fmtVal(item.to)}
              </span>
            </div>
          </>
        )}
      </div>
      <span className={styles.tlTime}>{item.ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

// Day heading for a feed item: Today, Yesterday, or the date.
function dayKey(ts) {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function ActivityTab({ feed }) {
  if (!feed.length) {
    return <Empty icon={Activity}>Nothing yet. Notifications and device changes appear here as they happen.</Empty>;
  }
  const groups = [];
  feed.forEach((item) => {
    const key = dayKey(item.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item); else groups.push({ key, items: [item] });
  });
  return (
    <div className={styles.wrap}>
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className={styles.day}>{g.key}</h2>
          <div className={cx('hd-card', styles.timeline)}>
            {g.items.map((item) => <FeedItem key={item.key} item={item} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
