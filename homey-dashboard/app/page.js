'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity, AppWindow, ArrowUp, Bell, Blinds, Bot, Calendar, Check, ChevronDown, CircleCheck, CircleDot,
  Clock, CloudSun, Coffee, DoorOpen, Droplets, Fan, Flame, Footprints, Hand, House, LayoutGrid, Lightbulb,
  LoaderCircle, LocateFixed, LogOut, MapPin, Monitor, Moon, Pause, Pin, Plug, Power, Radar, Refrigerator,
  RefreshCw, RotateCcw, Search, Settings2, Snowflake, Sparkles, Speaker, Sun, SunMedium, Sunrise, Sunset,
  Target, Thermometer, TriangleAlert, Tv, Umbrella, WashingMachine, Wind,
} from 'lucide-react';
import {
  AL_ROOMS, getSunTimes, phaseList, isActive, activePhase, tempColor, fmtMinutes,
  copenhagenMinutesNow, isWeekendNow, isWeekendScheduleNow, resolveLightMode, describeLightStatus, isIdle,
} from '../lib/adaptiveLighting';
import TemperatureTab from './TemperatureTab';
import RoomsV2Tab from './RoomsV2Tab';
import HeatingReason, { useNow } from './HeatingReason';
import { HEATING_ROOMS, HEATING_ACTIONS, TARGET_MIN, TARGET_MAX, heatingSlot, guessHeatFlow } from '../lib/heating';
import {
  explainHeating, heatingRoomSensor, liveWindowClosedAt, liveWindowOpen, optimisticMode, SCRIPT_INTERVAL_MIN, SETTLE_ACTIONS,
} from '../lib/heatingState';
import styles from './page.module.css';

// Device class → lucide icon (device rows in the Rooms tab).
const TYPE_ICON = {
  light: Lightbulb, thermostat: Thermometer, sensor: Radar, socket: Plug, tv: Tv,
  mediaplayer: Speaker, coffeemachine: Coffee, fridge: Refrigerator, freezer: Snowflake,
  washer: WashingMachine, vacuumcleaner: Bot, heater: Flame, curtain: Blinds,
  fan: Fan, button: CircleDot, other: House,
};

const LOUD_CAPS = new Set([
  'onoff', 'alarm_motion', 'alarm_contact', 'alarm_tamper', 'alarm_water', 'alarm_battery',
  'alarm_generic', 'alarm_restarted', 'alarm_information', 'alarm_failure', 'alarm_lost',
  'alarm_stuck', 'alarm_tank_empty', 'alarm_tank_missing', 'alarm_tank_open',
  'alarm_cleaning_pad_missing', 'alarm_bin_missing', 'alarm_bin_full', 'alarm_motor',
  'alarm_open_window_detected', 'target_temperature', 'thermostat_mode',
  'windowcoverings_set', 'curtain_motor_state', 'operational_state', 'display_status',
  'command_start', 'command_stop', 'tado_presence_mode', 'vacuumcleaner_job_mode',
]);

const APP_VERSION = '1.21.1';
const REFRESH_SECONDS = 20;
// When the live stream is connected, the fast poll is redundant — fall back to a
// slow background re-sync (keeps the flows list fresh and recovers a stalled stream).
const LIVE_REFRESH_SECONDS = 120;

// Live server-push updates (SSE) are only enabled on the local/NAS build, which sets
// NEXT_PUBLIC_LIVE=1. On Vercel (serverless) it stays off and the app polls as before.
const LIVE_ENABLED = process.env.NEXT_PUBLIC_LIVE === '1';

const TZ = 'Europe/Copenhagen';

const TABS = [
  ['weather', 'Weather', CloudSun],
  ['rooms', 'Rooms', LayoutGrid],
  ['rooms2', 'Rooms 2.0', Sparkles],
  ['activity', 'Live activity', Activity],
  ['temperatures', 'Temperatures', Thermometer],
  ['heating', 'Heating', Flame],
  ['lighting', 'Adaptive lighting', Lightbulb],
];

// Header theme toggle: system → light → dark (stored as 'hd-theme', applied as data-theme).
const THEME_META = {
  system: { Icon: Monitor, label: 'System', next: 'light' },
  light: { Icon: Sun, label: 'Light', next: 'dark' },
  dark: { Icon: Moon, label: 'Dark', next: 'system' },
};

// Spinning icon (keyframes live in globals.css).
const SPIN = { animation: 'hd-spin 0.8s linear infinite' };

const cx = (...a) => a.filter(Boolean).join(' ');

function mergeDevices(prev, changed) {
  const byId = new Map(prev.map((d) => [d.id, d]));
  for (const d of changed) byId.set(d.id, d);
  return [...byId.values()];
}

// Order rooms by their full zone path ("Hjem > Kertemindegade 9 > Stue"), since this
// Homey's cloud API exposes no zone-order field. Compares level-by-level with Danish
// collation (æ/ø/å last), and a parent path sorts before its children.
function cmpZonePath(a, b) {
  const A = (a || '').split(' > ');
  const B = (b || '').split(' > ');
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const c = A[i].localeCompare(B[i], 'da');
    if (c !== 0) return c;
  }
  return A.length - B.length;
}

function roomNameFromPath(path) {
  const parts = (path || '').split(' > ');
  return parts[parts.length - 1] || path;
}

function deviceStateLine(state) {
  const s = state || {};
  const parts = [];
  if ('onoff' in s) parts.push(s.onoff ? 'On' : 'Off');
  if (s.dim != null) parts.push(Math.round(s.dim * 100) + '%');
  if (s.measure_temperature != null) parts.push(s.measure_temperature + '°C');
  if (s.measure_humidity != null) parts.push(s.measure_humidity + '% RH');
  if (s.target_temperature != null) parts.push('target ' + s.target_temperature + '°C');
  if (s.thermostat_mode) parts.push('mode:' + s.thermostat_mode);
  if ('alarm_motion' in s) parts.push(s.alarm_motion ? 'motion' : 'no motion');
  if ('alarm_contact' in s) parts.push(s.alarm_contact ? 'open' : 'closed');
  if (s.alarm_water) parts.push('leak!');
  if (s.display_status) parts.push(s.display_status);
  if (s.operational_state != null) parts.push('state:' + s.operational_state);
  return parts.length ? parts.join(' · ') : '—';
}

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

export default function Page() {
  const [authState, setAuthState] = useState('checking'); // checking | signedOut | signedIn
  const [homeyName, setHomeyName] = useState('');
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState({});
  const [flows, setFlows] = useState([]);
  const [activity, setActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [roomFilter, setRoomFilter] = useState('');
  const [tab, setTab] = useState('weather'); // weather (public landing) | rooms | activity | temperatures | heating | lighting
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [alStatus, setAlStatus] = useState(null); // AdaptiveLightingStatus (script-published)
  const [clock, setClock] = useState(null); // header date/time — set after mount (no hydration mismatch)
  const [themePref, setThemePref] = useState('system'); // system | light | dark
  const snapshotRef = useRef({});
  const sseSeeded = useRef(false);
  const navRef = useRef(null);
  const openRooms = useRef(new Set());
  const nextRefreshAt = useRef(0);
  const refreshingRef = useRef(false);
  const refreshRef = useRef(() => {});
  const liveRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(err);
    const t = params.get('tab');
    if (t && ['weather', 'rooms', 'rooms2', 'activity', 'temperatures', 'heating', 'lighting'].includes(t)) setTab(t);
  }, []);

  // Header clock (ticks every 30 s) + the theme picked earlier with the header toggle.
  useEffect(() => {
    setClock(new Date());
    const iv = setInterval(() => setClock(new Date()), 30000);
    try {
      const t = localStorage.getItem('hd-theme');
      if (t === 'light' || t === 'dark') setThemePref(t);
    } catch { /* storage blocked: follow the system */ }
    return () => clearInterval(iv);
  }, []);

  function cycleTheme() {
    const next = THEME_META[themePref].next;
    setThemePref(next);
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
    try {
      if (next === 'system') localStorage.removeItem('hd-theme');
      else localStorage.setItem('hd-theme', next);
    } catch { /* storage blocked: the attribute still applies for this visit */ }
  }

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const r = await fetch('/api/auth/status');
        const data = await r.json();
        if (cancelled) return;
        if (data.authenticated) {
          setAuthState('signedIn');
          setHomeyName(data.homeyName || '');
        } else {
          setAuthState('signedOut');
        }
      } catch {
        if (!cancelled) setAuthState('signedOut');
      }
    }
    checkAuth();
    return () => { cancelled = true; };
  }, []);

  async function loadDevices(keepError = false) {
    try {
      const r = await fetch('/api/homey/devices');
      if (r.status === 401) { setAuthState('signedOut'); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed to load devices');
      diffAndLog(data.devices);
      setDevices(data.devices);
      if (data.zones) setZones(data.zones);
      setUpdatedAt(new Date());
      if (!keepError) setError('');
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  // Control a device: optimistically apply capability values, POST them, revert on error.
  async function controlDevice(deviceId, values) {
    setDevices((prev) => prev.map((d) => (
      d.id === deviceId ? { ...d, capabilities: { ...d.capabilities, ...values } } : d
    )));
    try {
      const r = await fetch('/api/homey/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ deviceId, values }] }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'control failed');
      if (data.errors && data.errors.length) { setError(data.errors.join(' · ')); refreshRef.current(); }
    } catch (e) {
      setError(String(e.message || e));
      refreshRef.current(); // re-pull real state
    }
  }

  async function loadNotifications() {
    try {
      const r = await fetch('/api/homey/notifications');
      if (r.status === 401) { setAuthState('signedOut'); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed to load notifications');
      setNotifications(data.notifications.map((n) => ({ ...n, ts: new Date(n.dateCreated) })));
    } catch { /* notifications are best-effort */ }
  }

  async function loadFlows() {
    try {
      const r = await fetch('/api/homey/flows');
      if (r.status === 401) { setAuthState('signedOut'); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed to load flows');
      setFlows(data.flows);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  function diffAndLog(newDevices) {
    const now = new Date();
    const added = [];
    newDevices.forEach((d) => {
      const prev = snapshotRef.current[d.id];
      if (prev) {
        Object.entries(d.capabilities).forEach(([cap, val]) => {
          if (!LOUD_CAPS.has(cap)) return;
          if (prev[cap] !== undefined && prev[cap] !== val) {
            added.push({
              ts: now, room: roomNameFromPath(d.zonePath), name: d.name, cap,
              from: prev[cap], to: val,
            });
          }
        });
      }
      snapshotRef.current[d.id] = d.capabilities;
    });
    if (added.length) {
      setActivity((prev) => [...added, ...prev].slice(0, 150));
    }
  }

  async function refreshNow() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([loadDevices(), loadFlows(), loadNotifications()]);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      const total = liveRef.current ? LIVE_REFRESH_SECONDS : REFRESH_SECONDS;
      nextRefreshAt.current = Date.now() + total * 1000;
      setCountdown(total);
    }
  }
  refreshRef.current = refreshNow;

  useEffect(() => {
    if (authState !== 'signedIn') return;
    nextRefreshAt.current = Date.now() + REFRESH_SECONDS * 1000;
    refreshRef.current();
    const interval = setInterval(() => {
      const secs = Math.max(0, Math.round((nextRefreshAt.current - Date.now()) / 1000));
      setCountdown(secs);
      if (secs <= 0 && !refreshingRef.current) refreshRef.current();
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // AdaptiveLighting's published per-light status — one shared 15s poll, only while
  // a tab that shows light modes is open (each poll is a Homey API call)
  useEffect(() => {
    if (authState !== 'signedIn' || (tab !== 'lighting' && tab !== 'rooms2')) return undefined;
    let cancelled = false;
    async function loadAlStatus() {
      try {
        const r = await fetch('/api/homey/lighting');
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setAlStatus(data.status || null);
      } catch { /* keep the last status; badges fall back to the guess once it ages out */ }
    }
    loadAlStatus();
    const iv = setInterval(loadAlStatus, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [authState, tab]);

  // Live server-push updates via SSE (local/NAS build only). Merges changed devices
  // as they arrive; the 20s poll above stays as a safety net.
  useEffect(() => {
    if (!LIVE_ENABLED || authState !== 'signedIn') return undefined;
    let es;
    try {
      es = new EventSource('/api/homey/stream');
    } catch {
      return undefined;
    }
    const onDevices = (ev) => {
      let changed;
      try { changed = JSON.parse(ev.data).devices; } catch { return; }
      if (!changed || !changed.length) return;
      if (!sseSeeded.current) {
        // First burst is a full snapshot — seed without logging spurious activity.
        sseSeeded.current = true;
        changed.forEach((d) => { snapshotRef.current[d.id] = d.capabilities; });
      } else {
        diffAndLog(changed);
      }
      setDevices((prev) => mergeDevices(prev, changed));
      setUpdatedAt(new Date());
    };
    const onNotifications = (ev) => {
      let items;
      try { items = JSON.parse(ev.data).notifications; } catch { return; }
      if (!items || !items.length) return;
      setNotifications((prev) => {
        const byId = new Map(prev.map((n) => [n.id, n]));
        for (const n of items) byId.set(n.id, { ...n, ts: new Date(n.dateCreated) });
        return [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, 150);
      });
    };
    es.addEventListener('ready', () => setLive(true));
    es.addEventListener('devices', onDevices);
    es.addEventListener('notifications', onNotifications);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => {
      setLive(false);
      sseSeeded.current = false;
      try { es.close(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // When live toggles, re-scale the background poll: slow while streaming, fast otherwise.
  useEffect(() => {
    liveRef.current = live;
    if (authState !== 'signedIn') return;
    const total = live ? LIVE_REFRESH_SECONDS : REFRESH_SECONDS;
    nextRefreshAt.current = Date.now() + total * 1000;
    setCountdown(total);
  }, [live, authState]);

  const roomGroups = useMemo(() => {
    const groups = {};
    devices.forEach((d) => {
      const key = d.zoneId || 'unknown';
      if (!groups[key]) groups[key] = { path: d.zonePath, order: d.zoneOrder, devices: [] };
      groups[key].devices.push(d);
    });
    return groups;
  }, [devices]);

  // Merge device-state changes and Homey Timeline notifications into one feed.
  // (Must stay above the early returns below — hooks can't be called conditionally.)
  const feed = useMemo(() => {
    const devItems = activity.map((a, i) => ({ type: 'device', key: `d${i}-${+a.ts}`, ts: a.ts, ...a }));
    const notifItems = notifications.map((n) => ({ type: 'notif', key: `n-${n.id}`, ts: n.ts, excerpt: n.excerpt, ownerName: n.ownerName }));
    return [...devItems, ...notifItems].sort((a, b) => b.ts - a.ts).slice(0, 250);
  }, [activity, notifications]);

  const filteredRoomKeys = Object.keys(roomGroups)
    .filter((key) => {
      const g = roomGroups[key];
      const name = roomNameFromPath(g.path).toLowerCase();
      const f = roomFilter.toLowerCase();
      if (!f) return true;
      return name.includes(f) || g.devices.some((d) => d.name.toLowerCase().includes(f));
    })
    .sort((a, b) => cmpZonePath(roomGroups[a].path, roomGroups[b].path));

  const errBox = error ? <ErrorBox>{error}</ErrorBox> : null;

  // Keep the active tab in view in the sideways-scrolling tab row (phones).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav && nav.querySelector('[aria-current="page"]');
    if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
  }, [tab]);

  const homeyTab = tab !== 'weather';
  const signedIn = authState === 'signedIn';
  const theme = THEME_META[themePref] || THEME_META.system;
  const ThemeIcon = theme.Icon;
  const dateLabel = clock ? clock.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const dateShort = clock ? clock.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const timeLabel = clock ? clock.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Shell>
      <header className={styles.topbar}>
        <div className={styles.topRow}>
          <div className={styles.brand}>
            <div className={styles.brandMark} aria-hidden="true"><House size={18} strokeWidth={2.2} /></div>
            <div className={styles.brandText}>
              <h1 className={styles.brandTitle} style={{ margin: 0 }}>
                Skovgaard<span className={styles.version}>v{APP_VERSION}</span>
              </h1>
              <div className={styles.brandSub}>
                {clock ? (
                  <>
                    <span className={styles.hideSm}>{dateLabel}</span>
                    <span className={styles.showSm}>{dateShort}</span>
                    {' · '}<b>{timeLabel}</b>
                  </>
                ) : ' '}
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            {LIVE_ENABLED && signedIn && (
              <span
                className={cx('hd-pill', styles.livePill)}
                style={{ color: live ? 'var(--good)' : 'var(--warn)' }}
                title={live ? 'Live — updates stream in from Homey' : 'Connecting to the live stream…'}
              >
                {live ? <span className="hd-live-dot" /> : <LoaderCircle size={13} style={SPIN} />}
                {live ? <span>Live</span> : <span className={styles.hideSm}>Connecting…</span>}
              </span>
            )}
            {homeyTab && signedIn && (
              <button
                type="button" className="hd-icon-btn" aria-label="Refresh"
                onClick={() => refreshRef.current()} disabled={refreshing}
                title={refreshing ? 'Refreshing…' : live ? 'Refresh now (updates stream in live)' : `Refresh now · next refresh in ${countdown}s`}
              >
                <RefreshCw size={16} style={refreshing ? SPIN : undefined} />
              </button>
            )}
            <button
              type="button" className="hd-icon-btn" onClick={cycleTheme}
              aria-label={`Theme: ${theme.label}`}
              title={`Theme: ${theme.label} — click for ${THEME_META[theme.next].label}`}
            >
              <ThemeIcon size={16} />
            </button>
            {signedIn && (
              <a
                href="/api/auth/logout" className={cx('hd-btn hd-btn-ghost', styles.disconnect)}
                title={`Disconnect${homeyName ? ` (${homeyName})` : ''}`}
              >
                <LogOut size={15} />
                <span className={styles.hideSm}>Disconnect{homeyName ? ` (${homeyName})` : ''}</span>
              </a>
            )}
          </div>
        </div>

        <nav ref={navRef} className={styles.nav} aria-label="Sections">
          {TABS.map(([t, label, Icon]) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              className={cx(styles.navBtn, tab === t && styles.navBtnActive)}
              aria-current={tab === t ? 'page' : undefined}
            >
              <Icon size={15} strokeWidth={2} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main key={tab} className="hd-fade-in">
        {tab === 'weather' && <WeatherTab />}

        {homeyTab && authState === 'checking' && (
          <div className={styles.checking}>
            <LoaderCircle size={16} style={SPIN} /> Checking your Homey connection…
          </div>
        )}

        {homeyTab && authState === 'signedOut' && (
          <div className={cx('hd-card', styles.connectCard)}>
            <div className={styles.connectIcon} aria-hidden="true"><Plug size={26} strokeWidth={2} /></div>
            <h2 className={styles.connectTitle}>Connect to Homey</h2>
            <p className={styles.connectText}>
              Log in to see live room status, activity, heating, and adaptive lighting.
            </p>
            {errBox}
            <a href="/api/auth/login" className={cx('hd-btn hd-btn-primary', styles.btnLg)}>
              <Plug size={16} /> Connect to Homey
            </a>
          </div>
        )}

        {homeyTab && signedIn && (
          <div>
            {errBox}

            {tab === 'rooms' && (
              <div>
                <div className={cx(styles.searchWrap, styles.filterWrap)}>
                  <Search size={15} className={styles.searchIcon} />
                  <input
                    type="text" className="hd-input" placeholder="Filter rooms or devices…" value={roomFilter}
                    onChange={(e) => setRoomFilter(e.target.value)} aria-label="Filter rooms or devices"
                  />
                </div>
                <div className="hd-grid">
                  {filteredRoomKeys.map((key) => (
                    <RoomCard key={key} group={roomGroups[key]} zone={zones[key]} openRooms={openRooms} onControl={controlDevice} />
                  ))}
                  {filteredRoomKeys.length === 0 && <Empty icon={Search}>No rooms or devices match your filter.</Empty>}
                </div>
              </div>
            )}

            {tab === 'activity' && (
              <div>
                <p className="hd-lede">
                  Live feed of Homey <b>Timeline notifications</b> (<Bell size={12} style={{ verticalAlign: '-1px' }} />) plus
                  real <b>device-state changes</b> — since Homey has no &quot;flow currently running&quot; signal, state
                  changes are the closest proxy for flows and scripts acting on your home.
                </p>
                {feed.length === 0 ? (
                  <Empty icon={Activity}>Nothing yet. Notifications and device changes will appear here as they happen.</Empty>
                ) : (
                  <div className={cx('hd-card', styles.timeline)}>
                    {feed.map((item) => <FeedItem key={item.key} item={item} />)}
                  </div>
                )}
              </div>
            )}

            {tab === 'rooms2' && (
              <RoomsV2Tab
                devices={devices} zones={zones} flows={flows} alStatus={alStatus}
                onControl={controlDevice} onReload={() => refreshRef.current()}
              />
            )}

            {tab === 'temperatures' && <TemperatureTab />}

            {tab === 'heating' && <HeatingTab devices={devices} zones={zones} flows={flows} onControl={controlDevice} onReload={() => refreshRef.current()} />}

            {tab === 'lighting' && <LightingTab devices={devices} flows={flows} alStatus={alStatus} onReload={() => refreshRef.current()} />}
          </div>
        )}
      </main>
    </Shell>
  );
}

function ErrorBox({ children, style }) {
  return (
    <div className="hd-error" role="alert" style={style}>
      <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

// ---------- live activity ----------

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
      <span className={styles.tlTime}>{item.ts.toLocaleTimeString()}</span>
    </div>
  );
}

// ---------- weather ----------

const WMO = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Dense drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Rain showers'], 81: ['🌧️', 'Rain showers'], 82: ['⛈️', 'Violent showers'],
  85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail'],
};
const wmo = (code) => WMO[code] || ['❓', '—'];
// Clear / mainly clear at night shows a moon, partly cloudy a plain cloud (no sun after dark).
const wmoGlyph = (code, isDay) => (isDay === 0 && (code === 0 || code === 1) ? '🌙' : isDay === 0 && code === 2 ? '☁️' : wmo(code)[0]);
const timeOnly = (iso) => { const m = String(iso).match(/T(\d{2}:\d{2})/); return m ? m[1] : iso; };
const hourLabel = (iso) => { const m = String(iso).match(/T(\d{2})/); return m ? m[1] : iso; };
function dayLabel(iso) {
  const [y, mo, da] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, da).toLocaleDateString('en-US', { weekday: 'short' });
}
function windDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg || 0) % 360) / 45) % 8];
}

// MET Norway / YR symbol_code -> emoji.
function yrIcon(code) {
  if (!code) return '❓';
  const c = code.toLowerCase();
  const night = c.includes('_night');
  if (c.includes('thunder')) return '⛈️';
  if (c.includes('snow')) return '❄️';
  if (c.includes('sleet')) return '🌨️';
  if (c.includes('rain') || c.includes('drizzle')) return '🌧️';
  if (c.includes('fog')) return '🌫️';
  if (c.includes('partlycloudy')) return night ? '☁️' : '⛅';
  if (c.includes('cloudy')) return '☁️';
  if (c.includes('fair')) return night ? '🌙' : '🌤️';
  if (c.includes('clearsky')) return night ? '🌙' : '☀️';
  return '🌡️';
}

// Hero background per condition (data colours — the hero carries its own white text).
function heroTheme(code, isDay) {
  if (isDay === 0) return 'night';
  if ([95, 96, 99].includes(code)) return 'thunder';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 3 || code === 45 || code === 48) return 'overcast';
  if (code === 2) return 'partly';
  return 'clear';
}
const HERO_BG = {
  clear: 'radial-gradient(circle at 86% 14%, rgba(255, 228, 140, 0.6) 0%, rgba(255, 228, 140, 0) 42%), linear-gradient(160deg, #3b82f6 0%, #60a5fa 55%, #93c5fd 100%)',
  partly: 'radial-gradient(circle at 86% 12%, rgba(255, 236, 170, 0.32) 0%, rgba(255, 236, 170, 0) 40%), linear-gradient(160deg, #46699f 0%, #6b8bbb 55%, #a3b8d6 100%)',
  overcast: 'linear-gradient(160deg, #64748b 0%, #7c8aa0 50%, #94a3b8 100%)',
  rain: 'radial-gradient(circle at 15% 0%, rgba(125, 211, 252, 0.18) 0%, rgba(125, 211, 252, 0) 45%), linear-gradient(160deg, #1e3a8a 0%, #1d4f91 50%, #0e7490 100%)',
  snow: 'radial-gradient(circle at 85% 10%, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 45%), linear-gradient(160deg, #7dd3fc 0%, #bae6fd 55%, #e0f2fe 100%)',
  thunder: 'radial-gradient(circle at 80% 0%, rgba(167, 139, 250, 0.38) 0%, rgba(167, 139, 250, 0) 45%), linear-gradient(160deg, #312e81 0%, #4c1d95 55%, #6d28d9 100%)',
  night: 'radial-gradient(circle at 84% 14%, rgba(199, 210, 254, 0.22) 0%, rgba(199, 210, 254, 0) 38%), linear-gradient(160deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)',
};

// Temperature → colour for the 7-day range bars (cool blue … warm orange/red).
const TEMP_STOPS = [
  [-10, [129, 140, 248]], [0, [56, 189, 248]], [8, [45, 212, 191]], [14, [163, 230, 53]],
  [19, [250, 204, 21]], [25, [251, 146, 60]], [32, [239, 68, 68]],
];
function tempTint(t) {
  const rgb = (c) => `rgb(${c.join(', ')})`;
  if (!(t > TEMP_STOPS[0][0])) return rgb(TEMP_STOPS[0][1]);
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return rgb(c0.map((v, k) => Math.round(v + (c1[k] - v) * f)));
    }
  }
  return rgb(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const HOUR_W = 60; // width of one hour column in the 24 h strip

// Smooth temperature curve over the hourly columns (Catmull-Rom → cubic Bézier).
function HourlyCurve({ temps }) {
  const n = temps.length;
  if (!n) return null;
  const W = n * HOUR_W;
  const H = 78;
  const top = 24;
  const bottom = 64;
  const vals = temps.map((t) => (Number.isFinite(t) ? t : 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((t, i) => [i * HOUR_W + HOUR_W / 2, bottom - ((t - min) / span) * (bottom - top)]);
  const f = (v) => v.toFixed(1);
  let line = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  const last = pts[pts.length - 1];
  const area = `${line} L${f(last[0])},${H} L${f(pts[0][0])},${H} Z`;
  return (
    <svg className={styles.hourlySvg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id="hdHourlyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.26 }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#hdHourlyFill)" />
      <path d={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }} />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={x} cy={y} r={i === 0 ? 4 : 2.75} strokeWidth="2"
            style={{ fill: i === 0 ? 'var(--accent)' : 'var(--surface-solid)', stroke: 'var(--accent)' }}
          />
          <text
            x={x} y={y - 9} textAnchor="middle"
            style={{ fill: i === 0 ? 'var(--text)' : 'var(--text-2)', fontSize: 12, fontWeight: i === 0 ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(temps[i])}°
          </text>
        </g>
      ))}
    </svg>
  );
}

function PopCell({ pop }) {
  if (pop == null) return <span className={styles.pop} />;
  if (pop <= 0) return <span className={cx(styles.pop, styles.popZero)}>{pop}%</span>;
  return (
    <span className={styles.pop} title={`${pop}% chance of precipitation`}>
      {pop}%
      <span className={styles.popBar}><span style={{ width: `${clamp(pop, 0, 100)}%` }} /></span>
    </span>
  );
}

// Heating rooms + schedules now live in lib/heating.js (shared with the Rooms 2.0 tab).

// Live inactivity timer for a heating room, mirroring the Rooms-page counter and tying
// it to the config's inactivityTimeout → when reached, the inactivityOffset applies.
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
    return <span className={styles.schedItem} style={{ color: 'var(--good)' }}><Activity size={13} /> Active</span>;
  }

  const since = sinceRef.current ?? Date.now();
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const label = secs < INACTIVE_COUNTER_LIMIT ? fmtDuration(secs) : fmtLongDuration(secs);
  const timeoutSecs = (timeoutMin || 30) * 60;
  const reached = secs >= timeoutSecs;
  return (
    <span className={styles.schedItem} style={{ color: 'var(--muted)' }} title={`No motion since ${new Date(since).toLocaleTimeString()}`}>
      <Moon size={13} />
      <span className="hd-num">{label}</span>
      {offset > 0 && (reached
        ? <span style={{ color: 'var(--warn)' }}>· −{offset}° applied</span>
        : <span style={{ color: 'var(--faint)' }}>· −{offset}° in {fmtDuration(timeoutSecs - secs)}</span>)}
    </span>
  );
}

// Boost / Pause / Reset buttons: icon + tint (labels come from HEATING_ACTIONS, minus their emoji).
const HEAT_ACTION_UI = {
  boost: { Icon: Flame, cls: styles.btnHeat },
  pause: { Icon: Pause, cls: '' },
  reset: { Icon: RotateCcw, cls: 'hd-btn-soft' },
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


// Ring gauge: heating power for tado rooms, full/empty for plug radiators; temperature in the centre.
function HeatRing({ kind, temp, power, plugOn }) {
  const gid = `hr${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const size = 84;
  const sw = 8;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const frac = kind === 'tado' ? clamp(power || 0, 0, 100) / 100 : (plugOn ? 1 : 0);
  const sub = kind === 'tado'
    ? (power != null ? `heat ${Math.round(power)}%` : 'heat —')
    : (plugOn ? 'heating' : 'off');
  const title = kind === 'tado'
    ? `Heating power ${power != null ? `${Math.round(power)}%` : '—'}`
    : `Radiator ${plugOn ? 'on' : 'off'}`;
  return (
    <div className={styles.ring} title={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="55%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} style={{ stroke: 'var(--surface-3)' }} />
        {frac > 0 && (
          <circle
            className={styles.ringArc} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={`url(#${gid})`} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
          />
        )}
      </svg>
      <div className={styles.ringCenter}>
        <span className={styles.ringTemp}>{temp != null ? temp.toFixed(1) : '—'}°</span>
        <span className={styles.ringSub}>{sub}</span>
      </div>
    </div>
  );
}

function HeatingTab({ devices, zones, flows, onControl, onReload }) {
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
  const flowById = useMemo(() => new Map((flows || []).map((f) => [f.id, f])), [flows]);
  const flowOptions = useMemo(() => (flows || []).slice().sort((a, b) => a.name.localeCompare(b.name)), [flows]);

  const flowFor = (room, action) => {
    const m = mapping[`${room.key}:${action.key}`];
    if (m) return flowById.get(m) || null;
    return guessHeatFlow(room, action, flows || []);
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
    if (!flow) { setErr(`No flow mapped for ${room.label} · ${action.key}. Use “Configure flows”.`); return; }
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

  return (
    <div>
      <div
        className={cx('hd-card', styles.master)}
        style={masterOff ? undefined : { background: 'linear-gradient(115deg, var(--heat-soft) 0%, transparent 70%), var(--surface)' }}
      >
        <div
          className={styles.masterTile}
          style={masterOff ? { background: 'var(--cool-soft)', color: 'var(--cool)' } : { background: 'var(--heat-soft)', color: 'var(--heat)' }}
        >
          {masterOff ? <Snowflake size={24} /> : <Flame size={24} />}
        </div>
        <div className={styles.masterText}>
          <div className={styles.masterTitle}>Heating system</div>
          <div className={styles.masterStatus}>
            {heatingEnabled == null ? 'state unknown'
              : heatingEnabled ? 'On — rooms follow their schedule'
                : 'Off — all heating disabled'}
          </div>
        </div>
        <div className={styles.masterRight}>
          {masterBusy && <span className="hd-faint" style={{ fontSize: 11.5 }}>updating…</span>}
          <Toggle size="lg" on={!!heatingEnabled} onChange={(v) => !masterBusy && toggleMaster(v)} />
        </div>
      </div>

      <div className={styles.introRow}>
        <p className={cx('hd-lede', styles.introText)}>
          Thermostat status per room. <b>Boost</b> (max heat ~1h), <b>Pause</b> (off ~1h) and
          <b> Reset</b> (cancel override) run your <code>room_heating</code> flows.
        </p>
        <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setShowConfig((s) => !s)} aria-expanded={showConfig}>
          <Settings2 size={15} /> Configure flows
        </button>
      </div>

      {err && <ErrorBox style={{ marginTop: 0 }}>{err}</ErrorBox>}

      <div className="hd-grid">
        {HEATING_ROOMS.map((room) => {
          const d = roomData(room);
          const systemOff = heatingEnabled === false;
          // Why the room is (not) heating — the one main reason plus the other factors.
          const why = d ? explainHeating({
            sc: d.sc, heatingEnabled, kind: d.kind, power: d.power, plugOn: d.plugOn, temp: d.temp,
            deviceTarget: d.kind === 'plug' ? d.setTarget : d.deviceTarget, liveWindow: d.liveWindow, liveClosedAt: d.liveClosedAt, mode: d.mode, modeExpires: d.modeExpires,
            manualMinutes: room.manualDuration, loading: !statusLoaded, now,
          }) : null;
          // Master off greys out the controls, but the status strip stays readable.
          const offStyle = systemOff ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined;
          return (
            <div key={room.key} className={cx('hd-card hd-card-pad', styles.heatCard)}>
              <div className={styles.heatHead}>
                <h3 className="hd-title">{room.label}</h3>
              </div>

              {!d ? (
                <div className="hd-faint" style={{ fontSize: 12.5, marginTop: 10 }}>Thermostat not found.</div>
              ) : (
                <>
                  <HeatingReason info={why} now={now} className={styles.heatWhy} />
                  <div style={offStyle}>
                    <div className={styles.heatMain}>
                      <HeatRing kind={d.kind} temp={d.temp} power={d.power} plugOn={d.plugOn} />
                      <div className={styles.heatSide}>
                        <span className="hd-eyebrow">Target</span>
                        {d.setTarget != null ? (
                          <div className={styles.stepper}>
                            <button
                              type="button" className="hd-step" onClick={() => adjustTarget(room, d, -0.5)}
                              disabled={systemOff || d.setTarget <= TARGET_MIN} title="−0.5° (manual override)"
                              aria-label={`Lower ${room.label} target`}
                            >
                              −
                            </button>
                            <span className={cx(styles.targetVal, styles.stepVal)}>{d.setTarget}°</span>
                            <button
                              type="button" className="hd-step" onClick={() => adjustTarget(room, d, 0.5)}
                              disabled={systemOff || d.setTarget >= TARGET_MAX} title="+0.5° (manual override)"
                              aria-label={`Raise ${room.label} target`}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className="hd-muted" style={{ fontSize: 13 }}>schedule-controlled</span>
                        )}
                        {(d.kind === 'plug' || d.humidity != null) && (
                          <div className={styles.heatInfo}>
                            {d.kind === 'plug' && (
                              <span className={styles.schedItem} style={d.plugOn ? { color: 'var(--heat)' } : undefined}>
                                <Flame size={13} /> Radiator {d.plugOn ? 'on' : 'off'}
                                {d.plugCount ? ` · ${d.plugCount} plug${d.plugCount === 1 ? '' : 's'}` : ''}
                              </span>
                            )}
                            {d.humidity != null && (
                              <span className={styles.schedItem}><Droplets size={13} /> {d.humidity}%</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {d.setTarget != null && (
                      <div className={styles.hint}>± adjusts target · manual override holds {room.manualDuration} min</div>
                    )}

                    {d.scheduled && (
                      <div className={cx('hd-inset', styles.schedule)}>
                        <div className={styles.schedRow}>
                          <Calendar size={13} />
                          <span>
                            <b style={{ color: 'var(--text-2)' }}>{d.scheduled.name}</b> · scheduled {d.scheduled.target}°
                            {d.setTarget != null && d.setTarget < d.scheduled.target - 0.05 && (
                              <span style={{ color: 'var(--warn)' }}> → set {d.setTarget}°</span>
                            )}
                          </span>
                        </div>
                        {d.hasMotion && (
                          <div className={styles.schedLine}>
                            <HeatingInactivity
                              motionActive={d.motionActive}
                              seedTs={d.seedTs}
                              timeoutMin={d.scheduled.timeout}
                              offset={d.scheduled.offset}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className={styles.heatActions} style={offStyle}>
                {HEATING_ACTIONS.map((a) => {
                  const flow = flowFor(room, a);
                  const bk = `${room.key}:${a.key}`;
                  const isBusy = busy.has(bk);
                  const disabled = isBusy || !flow || systemOff;
                  const ui = HEAT_ACTION_UI[a.key] || { Icon: Activity, cls: '' };
                  const AIcon = ui.Icon;
                  return (
                    <button
                      key={a.key} type="button" onClick={() => runAction(room, a)} disabled={disabled}
                      title={systemOff ? 'Heating system is off' : flow ? `Runs flow: ${flow.name}` : 'No flow mapped — use Configure flows'}
                      className={cx('hd-btn', ui.cls)}
                    >
                      {isBusy ? <LoaderCircle size={14} style={SPIN} /> : <AIcon size={14} />}
                      {actionLabel(a)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showConfig && (
        <div className={cx('hd-card hd-card-pad', styles.cfgCard)}>
          <div className={styles.cfgIntro}>
            Map each room&apos;s Boost / Pause / Reset to the Homey flow that runs it (auto-guessed by name, saved in this browser).
          </div>
          {HEATING_ROOMS.map((room) => (
            <div key={room.key} className={styles.cfgRow}>
              <span className={styles.cfgRoom}>{room.label}</span>
              {HEATING_ACTIONS.map((a) => {
                const flow = flowFor(room, a);
                return (
                  <select
                    key={a.key} className="hd-select hd-select-sm" value={flow ? flow.id : ''}
                    onChange={(e) => setFlowFor(room.key, a.key, e.target.value)} title={a.label}
                  >
                    <option value="">{actionLabel(a)} —</option>
                    {flowOptions.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeatherTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [locating, setLocating] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const coordsRef = useRef(null);

  async function load(coords) {
    try {
      const qs = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : '';
      const r = await fetch(`/api/weather${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed to load weather');
      setData(j); setErr('');
    } catch (e) { setErr(String(e.message || e)); }
  }

  function saveCoords(c) {
    coordsRef.current = c;
    try { localStorage.setItem('weather_loc', JSON.stringify(c)); } catch { /* ignore */ }
  }

  function detect() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { load(coordsRef.current); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        saveCoords({ lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) });
        load(coordsRef.current);
      },
      () => { setLocating(false); load(coordsRef.current); }, // denied/unavailable → cached or default
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, // fresh, most accurate reading
    );
  }

  async function search(e) {
    if (e) e.preventDefault();
    if (!q.trim()) return;
    try {
      const r = await fetch(`/api/weather/search?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      setResults(j.results || []);
    } catch { setResults([]); }
  }

  function pickLoc(r) {
    setResults([]); setQ('');
    saveCoords({ lat: +Number(r.lat).toFixed(4), lon: +Number(r.lon).toFixed(4) });
    load(coordsRef.current);
  }

  useEffect(() => {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('weather_loc') || 'null'); } catch { /* ignore */ }
    if (cached && cached.lat != null) {
      coordsRef.current = cached;
      load(cached);   // respect a saved choice; don't auto-override it
    } else {
      detect();       // first visit: try geolocation, fall back to default
    }
    const iv = setInterval(() => load(coordsRef.current), 600000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <ErrorBox style={{ marginTop: 0 }}>{err}</ErrorBox>;
  if (!data) {
    return (
      <div>
        <div className="hd-skeleton" style={{ height: 300, borderRadius: 24 }} />
        <div className={styles.updated}>Loading weather…</div>
      </div>
    );
  }

  const cur = data.current;
  const [curIcon, curDesc] = wmo(cur.weather_code);
  const daily = data.daily;
  const times = data.hourly.time;
  let start = times.findIndex((t) => t.slice(0, 13) === cur.time.slice(0, 13));
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 24, times.length); i++) {
    hours.push({ time: times[i], temp: data.hourly.temperature_2m[i], pop: data.hourly.precipitation_probability?.[i], code: data.hourly.weather_code[i], isDay: data.hourly.is_day?.[i] });
  }
  const yr = data.yr;
  const omT = cur.temperature_2m;
  const yrT = yr && yr.current ? yr.current.temp : null;
  const bothT = yrT != null;
  const avgT = bothT ? (omT + yrT) / 2 : omT;
  const diffT = bothT ? Math.abs(omT - yrT) : null;

  const heroKind = heroTheme(cur.weather_code, cur.is_day);
  const heroIcon = wmoGlyph(cur.weather_code, cur.is_day);
  const todayMax = daily.temperature_2m_max[0];
  const todayMin = daily.temperature_2m_min[0];
  const windDeg = cur.wind_direction_10m || 0;

  const stats = [
    { Icon: Droplets, label: 'Humidity', value: `${cur.relative_humidity_2m}%` },
    {
      Icon: Wind, label: 'Wind', title: `Wind from ${windDir(cur.wind_direction_10m)} (${Math.round(windDeg)}°)`,
      value: (
        <>
          <ArrowUp size={15} strokeWidth={2.6} style={{ transform: `rotate(${windDeg + 180}deg)`, flexShrink: 0 }} />
          {Math.round(cur.wind_speed_10m)}
          <span className={styles.statUnit}>m/s {windDir(cur.wind_direction_10m)}</span>
        </>
      ),
    },
    { Icon: Umbrella, label: 'Precipitation', value: <>{cur.precipitation}<span className={styles.statUnit}>mm</span></> },
    { Icon: Sunrise, label: 'Sunrise', value: timeOnly(daily.sunrise[0]) },
    { Icon: Sunset, label: 'Sunset', value: timeOnly(daily.sunset[0]) },
  ];

  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const weekSpan = weekMax - weekMin || 1;

  return (
    <div>
      <div className={styles.locBar}>
        <span className={styles.locPlace}>
          <MapPin size={15} />
          <b>{data.place}</b>
          {data.lat != null && <span className={styles.locCoords}>{data.lat}, {data.lon}</span>}
        </span>
        <div className={styles.locActions}>
          <button type="button" className="hd-btn hd-btn-soft" onClick={detect} disabled={locating}>
            {locating ? <LoaderCircle size={14} style={SPIN} /> : <LocateFixed size={14} />}
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          <div className={styles.searchBox}>
            <form onSubmit={search} className={styles.searchForm}>
              <div className={styles.searchWrap}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  className="hd-input" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search city…" aria-label="Search city"
                />
              </div>
              <button type="submit" className="hd-btn">Search</button>
            </form>
            {results.length > 0 && (
              <div className={cx('hd-card', styles.results)} style={{ background: 'var(--surface-solid)' }}>
                {results.map((r, i) => (
                  <button key={i} type="button" className={styles.resultBtn} onClick={() => pickLoc(r)}>
                    <MapPin size={14} />
                    <span>{r.name}{r.admin1 ? `, ${r.admin1}` : ''}{r.country ? ` · ${r.country}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className={cx(styles.hero, heroKind === 'snow' && styles.heroSnow)} style={{ background: HERO_BG[heroKind] }}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <div className={styles.heroPlace}><MapPin size={14} /> {data.place}</div>
            <div className={styles.heroCond}>{curDesc}</div>
            <div className={styles.heroTemp}>{Math.round(avgT)}°</div>
            <div className={styles.heroMeta}>
              Feels like {Math.round(cur.apparent_temperature)}° · H: {Math.round(todayMax)}° L: {Math.round(todayMin)}°
            </div>
            {bothT && (
              <div className={styles.heroSources}>
                <span className={styles.glassChip}>
                  {diffT <= 1
                    ? <><Check size={12} strokeWidth={3} /> Sources agree</>
                    : <><TriangleAlert size={12} /> Differ {diffT.toFixed(1)}°</>}
                </span>
                <span className={styles.heroSourcesText}>
                  Open-Meteo {Math.round(omT)}° {heroIcon} · YR {Math.round(yrT)}° {yrIcon(yr.current.symbol)}
                </span>
              </div>
            )}
          </div>
          <div className={styles.heroEmoji} aria-hidden="true">{heroIcon}</div>
        </div>
        <div className={styles.statGrid}>
          {stats.map(({ Icon, label, value, title }) => (
            <div key={label} className={styles.statTile} title={title}>
              <div className={styles.statLabel}><Icon size={12} strokeWidth={2.2} /> {label}</div>
              <div className={styles.statValue}>{value}</div>
            </div>
          ))}
        </div>
      </section>
      <div className={styles.updated}>
        updated {timeOnly(cur.time)} · data by Open-Meteo &amp; MET Norway (YR)
      </div>

      <h3 className="hd-section-title"><Clock size={14} /> Next 24 hours</h3>
      <div className={cx('hd-card', styles.hourlyCard)}>
        <div className={styles.hourlyScroll}>
          <div className={styles.hourlyInner} style={{ width: hours.length * HOUR_W }}>
            <HourlyCurve temps={hours.map((h) => h.temp)} />
            <div className={styles.hourRow}>
              {hours.map((h, i) => (
                <div key={i} className={styles.hourCol}>
                  <span className={cx(styles.hourLabel, i === 0 && styles.hourNow)} title={`${hourLabel(h.time)}:00`}>
                    {i === 0 ? 'Now' : hourLabel(h.time)}
                  </span>
                  <span className={styles.hourEmoji} title={wmo(h.code)[1]}>{wmoGlyph(h.code, h.isDay)}</span>
                  <PopCell pop={h.pop} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <h3 className="hd-section-title"><Calendar size={14} /> 7-day forecast</h3>
      <div className={cx('hd-card', styles.dayList)}>
        {daily.time.map((d, i) => {
          const [icon, desc] = wmo(daily.weather_code[i]);
          const lo = daily.temperature_2m_min[i];
          const hi = daily.temperature_2m_max[i];
          const pop = daily.precipitation_probability_max?.[i];
          const width = clamp(((hi - lo) / weekSpan) * 100, 4, 100);
          const left = clamp(((lo - weekMin) / weekSpan) * 100, 0, 100 - width);
          const nowPos = clamp(((avgT - weekMin) / weekSpan) * 100, 0, 100);
          return (
            <div key={i} className={styles.dayRow}>
              <span className={styles.dayNameWrap}>
                <span className={cx(styles.dayName, i === 0 && styles.dayToday)}>{i === 0 ? 'Today' : dayLabel(d)}</span>
                <span className={styles.daySub}>
                  {desc}{yr && yr.daily && yr.daily[d] ? ` · yr ${Math.round(yr.daily[d].tMax)}°/${Math.round(yr.daily[d].tMin)}°` : ''}
                </span>
              </span>
              <span className={styles.dayEmoji} title={desc}>{icon}</span>
              <span className={styles.dayDesc}>{desc}</span>
              <span className={cx(styles.dayRain, !(pop > 0) && styles.dayRainZero)} title={pop != null ? `${pop}% chance of precipitation` : undefined}>
                {pop != null && (pop > 0 ? <><Droplets size={12} />{pop}%</> : `${pop}%`)}
              </span>
              <span className={styles.dayMin}>{Math.round(lo)}°</span>
              <div className={styles.rangeWrap}>
                <div className={styles.rangeTrack}>
                  <div
                    className={styles.rangeFill}
                    style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${tempTint(lo)}, ${tempTint(hi)})` }}
                  />
                  {i === 0 && <div className={styles.rangeNow} style={{ left: `${nowPos}%` }} title={`Now ${Math.round(avgT)}°`} />}
                </div>
              </div>
              <span className={styles.dayMax}>{Math.round(hi)}°</span>
              {yr && yr.daily && yr.daily[d] ? (
                <span className={styles.dayYr} title={`YR: ${yrIcon(yr.daily[d].symbol)}`}>
                  yr {Math.round(yr.daily[d].tMax)}°/{Math.round(yr.daily[d].tMin)}°
                </span>
              ) : <span className={styles.dayYr} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return <div className="hd-shell">{children}</div>;
}

function RefreshControl({ countdown, refreshing, onRefresh, live }) {
  // While live, there's no countdown to show — the stream pushes updates. The fill
  // (progress toward the next poll) only makes sense when actively polling.
  const frac = refreshing ? 1 : (live ? 0 : Math.min(1, Math.max(0, (REFRESH_SECONDS - countdown) / REFRESH_SECONDS)));
  const label = refreshing ? 'Refreshing…' : (live ? 'Refresh now' : `Refresh now · ${countdown}s`);
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      title={live ? 'Refresh now (updates stream in live)' : 'Refresh now — resets the countdown'}
      className="hd-btn"
      style={{ position: 'relative', overflow: 'hidden', marginLeft: 'auto', minWidth: 152 }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`,
          background: 'var(--accent-soft)', zIndex: 0,
          transition: refreshing ? 'none' : 'width 0.9s linear',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <RefreshCw size={14} style={refreshing ? SPIN : undefined} />
        {label}
      </span>
    </button>
  );
}

function batteryColor(pct) {
  if (pct <= 20) return '#ef4444'; // red
  if (pct <= 50) return '#eab308'; // yellow
  return '#22c55e';                // green
}

function BatteryIndicator({ level }) {
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  const color = batteryColor(pct);
  const bodyW = 38, bodyH = 16, pad = 1.8, capW = 2.2, capH = 6;
  const innerMax = bodyW - pad * 2;
  const fillW = Math.max(2, (pct / 100) * innerMax);
  const totalW = bodyW + capW + 1;
  return (
    <span title={`Battery ${pct}%`} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <svg width={totalW} height={bodyH} viewBox={`0 0 ${totalW} ${bodyH}`} aria-hidden="true">
        <rect
          x="0.6" y="0.6" width={bodyW - 1.2} height={bodyH - 1.2} rx="3.2" ry="3.2" strokeWidth="1"
          style={{ fill: 'var(--surface-solid)', stroke: 'var(--faint)' }}
        />
        <rect x={bodyW} y={(bodyH - capH) / 2} width={capW} height={capH} rx="1" style={{ fill: 'var(--faint)' }} />
        <rect x={pad} y={pad} width={fillW} height={bodyH - pad * 2} rx="1.8" fill={color} />
        <text
          x={bodyW / 2} y={bodyH / 2 + 0.5} textAnchor="middle" dominantBaseline="central"
          fontSize="10.5" fontWeight="700" strokeWidth="2.2" paintOrder="stroke"
          style={{ fill: 'var(--text)', stroke: 'var(--surface-solid)', fontVariantNumeric: 'tabular-nums' }}
        >
          {pct}
        </text>
      </svg>
    </span>
  );
}

function Pill({ children }) {
  return <span className="hd-pill">{children}</span>;
}

// Small status chip. `tone` picks a hd-tag variant (good, warn, bad, heat, accent, cool, violet).
function Tag({ children, tone, icon: Icon, title }) {
  return (
    <span title={title} className={cx('hd-tag', tone && `hd-tag-${tone}`)} style={title ? { cursor: 'help' } : undefined}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

function Empty({ children, icon: Icon }) {
  return (
    <div className="hd-empty">
      {Icon && <Icon size={22} className={styles.emptyIcon} />}
      {children}
    </div>
  );
}

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

function LightingTab({ devices, flows, alStatus, onReload }) {
  const sun = useMemo(() => getSunTimes(new Date()), []);
  const [weekend, setWeekend] = useState(isWeekendScheduleNow());
  const [busy, setBusy] = useState(() => new Set());
  const [err, setErr] = useState('');
  const [mapping, setMapping] = useState({});
  const [applying, setApplying] = useState(null); // key of the group being applied
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

  // Order the rooms by their real zone path (from live devices), matching the Rooms tab.
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
      <p className="hd-lede">
        The configured circadian schedule from the Homey <code>adaptivelighting.js</code> script.
        Bar <b>height</b> = brightness, bar <b>color</b> = white balance (cool → warm), resolved for
        today&apos;s sunrise/sunset in København. Each light shows the mode the script reports:{' '}
        <b>Auto</b> (following the schedule, incl. daylight and sun adjustments), <b>Manual</b> (the
        script saw it adjusted) or <b><Pin size={11} style={{ verticalAlign: '-1px' }} /></b> a forced profile. <b>Manual?</b> means the light has
        differed from what the script last set for over 30 s and the script hasn&apos;t noticed yet; a
        leading <b>~</b> means the script hasn&apos;t reported this light, so the mode is guessed from
        the schedule. Hover a badge for what the script applied. <b>Reset room to Auto</b> triggers that
        room&apos;s light-reset flow. <b>Tap a phase</b> (Morning / Daytime / …) to set that room&apos;s
        lights to those settings now.
      </p>

      {err && <ErrorBox>{err}</ErrorBox>}

      <div className={styles.alBar}>
        <Pill><Sunrise size={14} className={styles.amber} /> Sunrise <b className="hd-num">{fmtMinutes(sun.sunriseMinutes)}</b></Pill>
        <Pill><Sunset size={14} className={styles.amber} /> Sunset <b className="hd-num">{fmtMinutes(sun.sunsetMinutes)}</b></Pill>
        <Pill><Clock size={14} /> Now <b className="hd-num">{fmtMinutes(nowMin)}</b></Pill>
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
                  <select
                    className="hd-select hd-select-sm"
                    value={roomFlow ? roomFlow.id : ''}
                    onChange={(e) => setFlowForRoom(area, e.target.value)}
                    title="Which flow resets this room"
                  >
                    <option value="">— reset flow —</option>
                    {resetFlows.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                  <button
                    type="button" className={cx('hd-btn hd-btn-soft hd-btn-sm', styles.tapSm)}
                    onClick={() => resetRoom(area, roomFlow)} disabled={roomBusy || !roomFlow}
                  >
                    {roomBusy ? <LoaderCircle size={13} style={SPIN} /> : <RotateCcw size={13} />}
                    {roomBusy ? 'Running…' : 'Reset room to Auto'}
                  </button>
                </div>
              </div>
              <div className={styles.caption}>
                {(repWeekend ? (useWeekend ? 'weekend schedule' : 'weekday schedule') : 'same every day')}
                {mixed && ` · timeline shown for ${repName}; other lights differ slightly`}
              </div>
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

function LightStrip({ lights }) {
  return (
    <div className={styles.lightStrip}>
      {lights.map((d) => {
        const s = lightSwatch(d.capabilities);
        if (!s) return null;
        const opacity = s.on ? (s.dim != null ? 0.4 + 0.6 * s.dim : 1) : 1;
        const label = s.on ? (s.dim != null ? `${Math.round(s.dim * 100)}%` : 'on') : 'off';
        return (
          <span
            key={d.id}
            title={`${d.name}: ${label}`}
            className={cx(styles.lightDot, !s.on && styles.lightDotOff)}
            style={s.on ? {
              background: s.color, opacity,
              boxShadow: `0 0 10px ${s.color}, inset 0 0 0 1px rgba(0, 0, 0, 0.1)`,
            } : undefined}
          />
        );
      })}
    </div>
  );
}

function DeviceControls({ device, onControl }) {
  const c = device.capabilities;
  const set = (values) => onControl(device.id, values);
  return (
    <div className={styles.controls}>
      {'dim' in c && (
        <SliderRow
          icon={SunMedium} value={c.dim ?? 0} accent="#f59e0b"
          onCommit={(v) => set({ dim: v, ...('onoff' in c && v > 0 ? { onoff: true } : {}) })}
        />
      )}
      {'light_temperature' in c && (
        <SliderRow
          icon={Thermometer} value={c.light_temperature ?? 0} accent="#fb923c"
          fmt={(v) => (v >= 0.5 ? 'warm' : 'cool')}
          onCommit={(v) => set({ light_temperature: v, ...('light_mode' in c ? { light_mode: 'temperature' } : {}) })}
        />
      )}
      {'windowcoverings_set' in c && (
        <SliderRow icon={Blinds} value={c.windowcoverings_set ?? 0} accent="var(--accent)" onCommit={(v) => set({ windowcoverings_set: v })} />
      )}
      {'target_temperature' in c && (
        <TempStepper value={c.target_temperature ?? 20} current={c.measure_temperature} onCommit={(v) => set({ target_temperature: v })} />
      )}
    </div>
  );
}

function Toggle({ on, onChange, size }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title={on ? 'Turn off' : 'Turn on'}
      className={cx(styles.toggle, size === 'lg' && styles.toggleLg, on && styles.toggleOn)}
    >
      <span className={styles.knob} />
    </button>
  );
}

function SliderRow({ icon, value, onCommit, accent, fmt }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const pct = Math.round((v ?? 0) * 100);
  const commit = (e) => onCommit(e.target.valueAsNumber / 100);
  const Icon = typeof icon === 'string' ? null : icon;
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon}>{Icon ? <Icon size={15} /> : icon}</span>
      <input
        type="range" min={0} max={100} value={pct}
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

function TempStepper({ value, current, onCommit }) {
  const round = (x) => Math.round(x * 2) / 2;
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon}><Target size={15} /></span>
      <button type="button" className="hd-step" onClick={() => onCommit(round(value - 0.5))} aria-label="Lower target">−</button>
      <span className={styles.stepVal}>{value}°C</span>
      <button type="button" className="hd-step" onClick={() => onCommit(round(value + 0.5))} aria-label="Raise target">+</button>
      {current != null && <span className="hd-faint hd-num" style={{ fontSize: 11.5 }}>now {current}°C</span>}
    </div>
  );
}

// Pulsing "live" indicator shown while a room has active motion.
function MotionBadge() {
  return (
    <span className="hd-tag hd-tag-good" title="Motion detected now" style={{ cursor: 'help', flexShrink: 0 }}>
      <span className={cx('hd-live-dot', styles.activeDot)} />
      Active
    </span>
  );
}

const INACTIVE_COUNTER_LIMIT = 30 * 60; // per-second counter for 30 min, then per-minute

function fmtDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtLongDuration(secs) {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function RoomCard({ group, zone, openRooms, onControl }) {
  const [open, setOpen] = useState(openRooms.current.has(group.path));
  const roomName = roomNameFromPath(group.path);
  const lightsOn = group.devices.filter((d) => d.class === 'light' && d.capabilities.onoff).length;
  const lightsTotal = group.devices.filter((d) => d.class === 'light').length;
  const motionDevices = group.devices.filter((d) => 'alarm_motion' in d.capabilities);
  const hasMotion = motionDevices.length > 0;
  const motionActive = motionDevices.some((d) => !!d.capabilities.alarm_motion);
  const openContact = group.devices.some((d) => d.capabilities.alarm_contact);
  const leak = group.devices.some((d) => d.capabilities.alarm_water);
  const batteryLevels = group.devices
    .map((d) => d.capabilities.measure_battery)
    .filter((v) => v != null);
  const minBattery = batteryLevels.length ? Math.min(...batteryLevels) : null;
  const temps = group.devices.map((d) => d.capabilities.measure_temperature).filter((v) => v != null);
  const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null;

  // Track when motion last cleared. If we *observe* it clear (active → inactive), that
  // moment is "now". Only fall back to the zone's activeLastUpdated when the room is
  // already idle on load (we never saw it active), since that stored value can be stale.
  const inactiveSinceRef = useRef(null);
  const prevActiveRef = useRef(undefined);
  useEffect(() => {
    const prev = prevActiveRef.current;
    if (motionActive) {
      inactiveSinceRef.current = null;
    } else if (prev === true) {
      inactiveSinceRef.current = Date.now(); // observed the clear just now
    } else if (inactiveSinceRef.current == null) {
      inactiveSinceRef.current = zone && zone.activeLastUpdated ? new Date(zone.activeLastUpdated).getTime() : Date.now();
    }
    prevActiveRef.current = motionActive;
  }, [motionActive, zone && zone.activeLastUpdated]);

  let motionTag = null;
  if (hasMotion) {
    if (motionActive) {
      motionTag = <MotionBadge />;
    } else {
      const since = inactiveSinceRef.current ?? Date.now();
      const title = `No motion since ${new Date(since).toLocaleTimeString()}`;
      const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
      const label = secs < INACTIVE_COUNTER_LIMIT ? fmtDuration(secs) : fmtLongDuration(secs);
      motionTag = <Tag icon={Moon} title={title}><span className="hd-num">{label}</span></Tag>;
    }
  }

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) openRooms.current.add(group.path); else openRooms.current.delete(group.path);
      return next;
    });
  }

  return (
    <div className="hd-card hd-card-pad hd-card-hover">
      <div className={styles.roomHead}>
        <div style={{ minWidth: 0 }}>
          <h3 className="hd-title">{roomName}</h3>
          <div className={styles.roomPath}>{group.path}</div>
        </div>
        {motionTag}
      </div>
      <div className={styles.chips}>
        {lightsTotal > 0 && (
          <Tag tone={lightsOn ? 'good' : null} icon={Lightbulb}>{lightsOn}/{lightsTotal}</Tag>
        )}
        {avgTemp != null && <Tag icon={Thermometer}>{avgTemp}°C</Tag>}
        {openContact && <Tag tone="warn" icon={DoorOpen}>open</Tag>}
        {leak && <Tag tone="bad" icon={Droplets}>leak</Tag>}
        {minBattery != null && <BatteryIndicator level={minBattery} />}
        {!lightsTotal && avgTemp == null && !hasMotion && !openContact && !leak && minBattery == null && (
          <Tag>no live signals</Tag>
        )}
      </div>
      {lightsTotal > 0 && <LightStrip lights={group.devices.filter((d) => d.class === 'light')} />}
      <button
        type="button" onClick={toggle} aria-expanded={open}
        className={cx('hd-btn hd-btn-ghost hd-btn-sm', styles.devToggle)}
      >
        {group.devices.length} device{group.devices.length === 1 ? '' : 's'}
        <ChevronDown size={14} className={cx(styles.chev, open && styles.chevOpen)} />
      </button>
      {open && (
        <div className={styles.devList}>
          {[...group.devices].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
            const c = d.capabilities;
            const line = deviceStateLine(c);
            const battery = c.measure_battery;
            const canToggle = 'onoff' in c;
            const hasSliders = 'dim' in c || 'light_temperature' in c || 'windowcoverings_set' in c || 'target_temperature' in c;
            const controllable = onControl && (canToggle || hasSliders);
            const DIcon = TYPE_ICON[d.class] || House;
            return (
              <div key={d.id} className={styles.devRow}>
                <div className={styles.devMain}>
                  <span className={cx(styles.devIcon, canToggle && c.onoff && styles.devIconOn)}><DIcon size={15} /></span>
                  <div className={styles.devText}>
                    <div className={styles.devName}>{d.name}</div>
                    {line !== '—' && <div className={styles.devState}>{line}</div>}
                  </div>
                  <div className={styles.devRight}>
                    {battery != null && <BatteryIndicator level={battery} />}
                    {canToggle && onControl && <Toggle on={!!c.onoff} onChange={(v) => onControl(d.id, { onoff: v })} />}
                    {!controllable && battery == null && line === '—' && <span className="hd-faint">—</span>}
                  </div>
                </div>
                {onControl && hasSliders && <DeviceControls device={d} onControl={onControl} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
