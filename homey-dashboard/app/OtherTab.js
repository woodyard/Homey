'use client';

// Andet: devices that have no tab of their own.
//  • The washing machine: how far the wash has come, when it is done, and what else the
//    machine reports (program, phase, spin speed, energy and water used).
//  • The robot vacuum: what it is doing, how it cleans, and anything it needs help with.
// Read-only: the devices are started where they always are.

import {
  Bot, CircleCheck, Droplets, Info, RotateCw, Sparkles, Timer, TriangleAlert, WashingMachine, Zap,
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

// ------------------------------------------------------------- robot vacuum ----

// Homey gives each state and mode a title (passed along as device.capLabels). Known English
// titles are shown in Danish; anything else passes through as Homey wrote it.
const VACUUM_DA = {
  stopped: 'Stoppet', running: 'Kører', paused: 'På pause', error: 'Fejl', 'seeking charger': 'På vej hjem',
  'returning to dock': 'På vej hjem', charging: 'Lader', docked: 'I dock',
  idle: 'Ledig', cleaning: 'Gør rent', mapping: 'Kortlægger',
  vacuum: 'Støvsugning', mop: 'Gulvvask', 'vacuum and mop': 'Støvsugning og gulvvask', 'vacuum & mop': 'Støvsugning og gulvvask',
  'vacuum then mop': 'Støvsugning, så gulvvask', 'deep clean': 'Grundig rengøring', quiet: 'Stille', auto: 'Auto',
};
// Without a title from Homey: the numbers this robot reports (as its flow cards list them).
const VACUUM_STATE_BY_ID = { 0: 'Stopped', 1: 'Running', 2: 'Paused', 3: 'Error', 64: 'Seeking charger', 65: 'Charging', 66: 'Docked' };
const VACUUM_JOB_BY_ID = { 0: 'Idle', 1: 'Cleaning', 2: 'Mapping' };
// Homey leaves some titles as a raw key ("Cluster.rvc_run_mode.tag.mapping"): keep its last word.
const vacuumLabel = (label) => {
  const s = label == null ? '' : String(label).trim();
  const tag = /\.tag\.([a-z_]+)$/i.exec(s);
  return tag ? tag[1].replace(/_/g, ' ') : s;
};
// What the robot may need help with, most urgent first.
const VACUUM_ALARMS = [
  ['alarm_stuck', 'Sidder fast'],
  ['alarm_lost', 'Kan ikke finde vej'],
  ['alarm_bin_full', 'Støvbeholderen er fuld'],
  ['alarm_bin_missing', 'Støvbeholderen mangler'],
  ['alarm_tank_empty', 'Vandtanken er tom'],
  ['alarm_tank_missing', 'Vandtanken mangler'],
  ['alarm_tank_open', 'Vandtanken er åben'],
  ['alarm_cleaning_pad_missing', 'Moppen mangler'],
];

function VacuumCard({ device }) {
  const c = device.capabilities || {};
  const labels = device.capLabels || {};
  const raw = vacuumLabel(labels.operational_state) || VACUUM_STATE_BY_ID[c.operational_state] || '';
  const key = raw.trim().toLowerCase();
  const alarms = VACUUM_ALARMS.filter(([cap]) => c[cap] === true);
  let state = 'idle';
  if (key === 'error' || alarms.length) state = 'failure';
  else if (key === 'running' || key === 'seeking charger' || key === 'returning to dock') state = 'running';
  else if (key === 'paused') state = 'paused';
  const job = translate(VACUUM_DA, vacuumLabel(labels.vacuumcleaner_job_mode) || VACUUM_JOB_BY_ID[c.vacuumcleaner_job_mode]);
  // The clean mode has no known list: shown only when Homey gives it a title.
  const mode = translate(VACUUM_DA, vacuumLabel(labels['vacuumcleaner_job_mode.clean_mode']));
  const statusText = device.available === false ? 'Ikke forbundet' : (translate(VACUUM_DA, raw) || '—');
  return (
    <article className={styles.card} data-state={state}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true"><Bot size={22} strokeWidth={2} /></span>
        <div className={styles.titles}>
          <h2 className={styles.title}>Robotstøvsuger</h2>
          <div className={styles.room}>{roomNameFromPath(device.zonePath)}</div>
        </div>
        <span className={styles.status}>{statusText}</span>
      </header>

      {alarms.map(([cap, text]) => (
        <div key={cap} className={styles.note} data-tone="bad"><TriangleAlert size={18} strokeWidth={2.2} />{text}</div>
      ))}

      {(job || mode) && (
        <dl className={styles.facts}>
          {job && <Fact icon={Bot} label="Opgave" value={job} />}
          {mode && <Fact icon={Sparkles} label="Rengøring" value={mode} />}
        </dl>
      )}
    </article>
  );
}

export default function OtherTab({ devices }) {
  const washers = (devices || []).filter((d) => d.class === 'washer');
  const vacuums = (devices || []).filter((d) => d.class === 'vacuumcleaner');
  if (!washers.length && !vacuums.length) return <Empty icon={WashingMachine}>Ingen enheder fundet.</Empty>;
  return (
    <div className={styles.wrap}>
      {washers.map((d) => <WasherCard key={d.id} device={d} />)}
      {vacuums.map((d) => <VacuumCard key={d.id} device={d} />)}
    </div>
  );
}
