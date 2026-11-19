'use client';

// The dashboard shell: sign-in state, the shared Homey data (devices, zones, flows,
// notifications, live stream) and the tab that is open. Each tab lives in its own file.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, CloudSun, Flame, Lightbulb, LoaderCircle, Plug, Sofa, Thermometer,
} from 'lucide-react';
import AppChrome from './AppChrome';
import HeatingTab from './HeatingTab';
import RoomsTab from './RoomsTab';
import LightingTab from './LightingTab';
import WeatherTab from './WeatherTab';
import TemperatureTab from './TemperatureTab';
import ActivityTab from './ActivityTab';
import { cx, ErrorBox, roomNameFromPath, SPIN } from './ui';
import styles from './page.module.css';

const LOUD_CAPS = new Set([
  'onoff', 'alarm_motion', 'alarm_contact', 'alarm_tamper', 'alarm_water', 'alarm_battery',
  'alarm_generic', 'alarm_restarted', 'alarm_information', 'alarm_failure', 'alarm_lost',
  'alarm_stuck', 'alarm_tank_empty', 'alarm_tank_missing', 'alarm_tank_open',
  'alarm_cleaning_pad_missing', 'alarm_bin_missing', 'alarm_bin_full', 'alarm_motor',
  'alarm_open_window_detected', 'target_temperature', 'thermostat_mode',
  'windowcoverings_set', 'curtain_motor_state', 'operational_state', 'display_status',
  'command_start', 'command_stop', 'tado_presence_mode', 'vacuumcleaner_job_mode',
]);

const APP_VERSION = '2.0.2';
const REFRESH_SECONDS = 20;
// When the live stream is connected, the fast poll is redundant — fall back to a
// slow background re-sync (keeps the flows list fresh and recovers a stalled stream).
const LIVE_REFRESH_SECONDS = 120;

// Live server-push updates (SSE) are only enabled on the local/NAS build, which sets
// NEXT_PUBLIC_LIVE=1. On Vercel (serverless) it stays off and the app polls as before.
const LIVE_ENABLED = process.env.NEXT_PUBLIC_LIVE === '1';

const TZ = 'Europe/Copenhagen';

// [key, label, Icon, short label for the bottom bar]
const TABS = [
  ['heating', 'Heating', Flame],
  ['rooms', 'Rooms', Sofa],
  ['lighting', 'Lighting', Lightbulb, 'Lights'],
  ['weather', 'Weather', CloudSun],
  ['temperatures', 'Temperatures', Thermometer, 'Temps'],
  ['activity', 'Live activity', Activity, 'Activity'],
];
const NAV_TABS = ['heating', 'rooms', 'lighting', 'weather']; // in the bar; the rest live in the menu
const TAB_KEYS = TABS.map((t) => t[0]);
const TAB_ALIASES = { rooms2: 'rooms' }; // links from before 2.0.0

function mergeDevices(prev, changed) {
  const byId = new Map(prev.map((d) => [d.id, d]));
  for (const d of changed) byId.set(d.id, d);
  return [...byId.values()];
}

export default function Page() {
  const [authState, setAuthState] = useState('checking'); // checking | signedOut | signedIn
  const [homeyName, setHomeyName] = useState('');
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState({});
  const [flows, setFlows] = useState([]);
  const [activity, setActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [tab, setTab] = useState(null); // set from the address after mount, so a reload never flashes another tab
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [alStatus, setAlStatus] = useState(null); // AdaptiveLightingStatus (script-published)
  const [clock, setClock] = useState(null); // header date/time — set after mount (no hydration mismatch)
  const [themePref, setThemePref] = useState('system'); // system | light | dark
  const snapshotRef = useRef({});
  const sseSeeded = useRef(false);
  const nextRefreshAt = useRef(0);
  const refreshingRef = useRef(false);
  const refreshRef = useRef(() => {});
  const liveRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(err);
    const t = TAB_ALIASES[params.get('tab')] || params.get('tab');
    setTab(TAB_KEYS.includes(t) ? t : 'heating');
  }, []);

  // Keep the open tab in the address, so a reload or a home-screen bookmark returns to it.
  function selectTab(next) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      if (next === 'heating') url.searchParams.delete('tab'); else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    } catch { /* the tab still changes */ }
  }

  // Header clock (ticks every 30 s) + the theme picked earlier in the menu.
  useEffect(() => {
    setClock(new Date());
    const iv = setInterval(() => setClock(new Date()), 30000);
    try {
      const t = localStorage.getItem('hd-theme');
      if (t === 'light' || t === 'dark') setThemePref(t);
    } catch { /* storage blocked: follow the system */ }
    return () => clearInterval(iv);
  }, []);

  function setTheme(next) {
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
    if (authState !== 'signedIn' || (tab !== 'lighting' && tab !== 'rooms')) return undefined;
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

  // Merge device-state changes and Homey Timeline notifications into one feed.
  const feed = useMemo(() => {
    const devItems = activity.map((a, i) => ({ type: 'device', key: `d${i}-${+a.ts}`, ts: a.ts, ...a }));
    const notifItems = notifications.map((n) => ({ type: 'notif', key: `n-${n.id}`, ts: n.ts, excerpt: n.excerpt, ownerName: n.ownerName }));
    return [...devItems, ...notifItems].sort((a, b) => b.ts - a.ts).slice(0, 250);
  }, [activity, notifications]);

  const errBox = error ? <ErrorBox>{error}</ErrorBox> : null;

  const homeyTab = !!tab && tab !== 'weather';
  const signedIn = authState === 'signedIn';
  const dateLabel = clock ? clock.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const timeLabel = clock ? clock.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
  const reload = () => refreshRef.current();

  return (
    <div className="hd-shell">
      <AppChrome
        tabs={TABS} primary={NAV_TABS} tab={tab} onSelect={selectTab}
        dateLabel={dateLabel} timeLabel={timeLabel} signedIn={signedIn} homeyName={homeyName} version={APP_VERSION}
        liveEnabled={LIVE_ENABLED} live={live} refreshing={refreshing} countdown={countdown} onRefresh={reload}
        themePref={themePref} onTheme={setTheme}
      />

      <main key={tab || 'none'} className="hd-fade-in">
        {tab === 'weather' && <WeatherTab />}

        {homeyTab && authState === 'checking' && (
          <div className={styles.checking}>
            <LoaderCircle size={18} style={SPIN} /> Checking your Homey connection…
          </div>
        )}

        {homeyTab && authState === 'signedOut' && (
          <div className={cx('hd-card', styles.connectCard)}>
            <div className={styles.connectIcon} aria-hidden="true"><Plug size={26} strokeWidth={2} /></div>
            <h2 className={styles.connectTitle}>Connect to Homey</h2>
            {errBox}
            <a href="/api/auth/login" className={cx('hd-btn hd-btn-primary', styles.btnLg)}>
              <Plug size={17} /> Connect to Homey
            </a>
          </div>
        )}

        {homeyTab && signedIn && (
          <>
            {errBox}
            {tab === 'heating' && <HeatingTab devices={devices} zones={zones} flows={flows} onControl={controlDevice} onReload={reload} />}
            {tab === 'rooms' && <RoomsTab devices={devices} zones={zones} flows={flows} alStatus={alStatus} onControl={controlDevice} onReload={reload} />}
            {tab === 'lighting' && <LightingTab devices={devices} flows={flows} alStatus={alStatus} onReload={reload} />}
            {tab === 'temperatures' && <TemperatureTab />}
            {tab === 'activity' && <ActivityTab feed={feed} />}
          </>
        )}
      </main>
    </div>
  );
}
