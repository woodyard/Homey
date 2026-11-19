'use client';

// Andet: devices that have no tab of their own. For now the washing machine: how far the
// wash has come, when it is done, and what else the machine reports (program, phase, spin
// speed, energy and water used). Read-only: the machine is started at the machine.

import {
  CircleCheck, Droplets, Info, RotateCw, Timer, TriangleAlert, WashingMachine, Zap,
} from 'lucide-react';
import { clamp, cx, Empty, roomNameFromPath } from './ui';
import styles from './OtherTab.module.css';

const TZ = 'Europe/Copenhagen';

// The machine reports its state, program and phase as English text (Miele). Known ones are
// shown in Danish; anything else passes through as the machine wrote it.
const STATUS_DA = {
  off: 'Slukket', on: 'Tændt', idle: 'Klar', programmed: 'Program valgt', 'waiting to start': 'Venter på start',
  'in use': 'I gang', running: 'I gang', pause: 'På pause', paused: 'På pause', 'rinse hold': 'Skyllestop',
  finished: 'Færdig', 'end programmed': 'Færdig', 'programme interrupted': 'Afbrudt', 'program interrupted': 'Afbrudt',
  failure: 'Fejl', service: 'Service', 'not connected': 'Ikke forbundet',
};
const PROGRAM_DA = {
  cottons: 'Bomuld', 'minimum iron': 'Strygelet', delicates: 'Finvask', woollens: 'Uld', silks: 'Silke',
  shirts: 'Skjorter', denim: 'Denim', 'dark garments': 'Mørkt tøj', sportswear: 'Sportstøj', outerwear: 'Overtøj',
  'express 20': 'Ekspres 20', 'automatic plus': 'Automatic plus', proofing: 'Imprægnering',
  'drain/spin': 'Udpumpning og centrifugering', rinse: 'Skyl', 'separate rinse': 'Ekstra skyl', starch: 'Stivelse',
  'clean machine': 'Rens maskinen', 'down duvets': 'Dundyner', pillows: 'Hovedpuder', curtains: 'Gardiner',
};
const PHASE_DA = {
  'pre-wash': 'Forvask', prewash: 'Forvask', soak: 'Iblødsætning', 'main wash': 'Hovedvask', rinse: 'Skyl', rinsing: 'Skyl',
  'rinse hold': 'Skyllestop', drain: 'Udpumpning', spin: 'Centrifugering', spinning: 'Centrifugering',
  'anti-crease': 'Antikrøl', finished: 'Færdig', 'not running': 'Ikke i gang', venting: 'Udluftning',
};
const translate = (map, text) => {
  const s = text == null ? '' : String(text).trim();
  return map[s.toLowerCase()] || s;
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Minutes as "48 min" or "1 t 48 min".
function fmtMin(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} t ${m % 60} min` : `${Math.floor(m / 60)} t`;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// What the washer is doing, from its capabilities.
function washerState(c) {
  const status = String(c.display_status || '').trim().toLowerCase();
  const remaining = num(c.numeric_time_remaining);
  const elapsed = num(c.numeric_time_elapsed);
  const startIn = num(c.numeric_time_start);
  let state = 'idle';
  if (c.alarm_failure || status === 'failure') state = 'failure';
  else if (status === 'finished' || status === 'end programmed') state = 'finished';
  else if (status === 'in use' || status === 'running' || status === 'rinse hold') state = 'running';
  else if (status === 'pause' || status === 'paused') state = 'paused';
  else if (status === 'waiting to start') state = 'waiting';
  else if (status === 'off' || status === 'not connected' || (!status && c.onoff === false)) state = 'off';
  const total = remaining != null && elapsed != null ? remaining + elapsed : null;
  return {
    state, remaining, elapsed, startIn,
    statusText: translate(STATUS_DA, c.display_status) || (c.onoff === false ? 'Slukket' : '—'),
    progress: total ? clamp(elapsed / total, 0, 1) : null,
  };
}

// Ring that fills as the wash progresses, with the time left in the middle.
function ProgressRing({ progress, children }) {
  const size = 132;
  const sw = 10;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className={styles.ring}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} style={{ stroke: 'var(--surface-3)' }} />
        {progress != null && progress > 0 && (
          <circle
            className={styles.ringArc} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)}
          />
        )}
      </svg>
      <div className={styles.ringCenter}>{children}</div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }) {
  return (
    <div className={styles.fact}>
      <dt><Icon size={14} strokeWidth={2.2} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function WasherCard({ device }) {
  const c = device.capabilities || {};
  const w = washerState(c);
  const active = w.state === 'running' || w.state === 'paused';
  const program = translate(PROGRAM_DA, c.display_program);
  const phase = translate(PHASE_DA, c.display_program_phase);
  const spin = num(c.display_spin_speed);
  const energy = num(c.meter_energy_consumption);
  const water = num(c.meter_water_consumption);
  const showFacts = w.state !== 'off' && w.state !== 'idle';
  const doneAt = active && w.remaining != null ? clockFmt.format(new Date(Date.now() + w.remaining * 60000)) : null;
  const unavailable = device.available === false;
  return (
    <article className={styles.card} data-state={w.state}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true"><WashingMachine size={22} strokeWidth={2} /></span>
        <div className={styles.titles}>
          <h2 className={styles.title}>Vaskemaskine</h2>
          <div className={styles.room}>{roomNameFromPath(device.zonePath)}</div>
        </div>
        <span className={styles.status}>{unavailable ? 'Ikke forbundet' : w.statusText}</span>
      </header>

      {active && (
        <div className={styles.hero}>
          <ProgressRing progress={w.progress}>
            <span className={styles.left}>{w.remaining != null ? fmtMin(w.remaining) : '—'}</span>
            <span className={styles.leftLabel}>tilbage</span>
          </ProgressRing>
          <div className={styles.heroText}>
            {program && <div className={styles.program}>{program}</div>}
            {phase && <div className={styles.phase}>{phase}</div>}
            {doneAt && <div className={styles.done}>Færdig ca. <b>{doneAt}</b></div>}
          </div>
        </div>
      )}

      {w.state === 'finished' && (
        <div className={styles.note} data-tone="good"><CircleCheck size={18} strokeWidth={2.2} />Vasken er færdig{program ? ` · ${program}` : ''}</div>
      )}
      {w.state === 'waiting' && (
        <div className={styles.note}>
          <Timer size={18} strokeWidth={2.2} />
          {w.startIn ? `Starter om ${fmtMin(w.startIn)}` : 'Venter på start'}{program ? ` · ${program}` : ''}
        </div>
      )}
      {(c.alarm_failure || w.state === 'failure') && (
        <div className={styles.note} data-tone="bad"><TriangleAlert size={18} strokeWidth={2.2} />Maskinen melder fejl</div>
      )}
      {c.alarm_information && !c.alarm_failure && (
        <div className={styles.note} data-tone="warn"><Info size={18} strokeWidth={2.2} />Maskinen har en besked</div>
      )}

      {showFacts && (
        <dl className={styles.facts}>
          {w.elapsed != null && w.elapsed > 0 && <Fact icon={Timer} label="Tid gået" value={fmtMin(w.elapsed)} />}
          {spin != null && spin > 0 && <Fact icon={RotateCw} label="Centrifugering" value={`${spin} o/min`} />}
          {energy != null && energy > 0 && <Fact icon={Zap} label="Energi" value={`${energy} kWh`} />}
          {water != null && water > 0 && <Fact icon={Droplets} label="Vand" value={`${water} l`} />}
          {c.display_energy_prediction != null && <Fact icon={Zap} label="Forventet energi" value={String(c.display_energy_prediction)} />}
          {c.display_water_prediction != null && <Fact icon={Droplets} label="Forventet vand" value={String(c.display_water_prediction)} />}
        </dl>
      )}
    </article>
  );
}

export default function OtherTab({ devices }) {
  const washers = (devices || []).filter((d) => d.class === 'washer');
  if (!washers.length) return <Empty icon={WashingMachine}>Ingen vaskemaskine fundet.</Empty>;
  return (
    <div className={styles.wrap}>
      {washers.map((d) => <WasherCard key={d.id} device={d} />)}
    </div>
  );
}
