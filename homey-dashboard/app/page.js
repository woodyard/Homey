'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AL_ROOMS, getSunTimes, phaseList, isActive, activePhase, tempColor, fmtMinutes,
  copenhagenMinutesNow, isWeekendNow, isWeekendScheduleNow, resolveLightMode, describeLightStatus,
} from '../lib/adaptiveLighting';
import TemperatureTab from './TemperatureTab';
import RoomsV2Tab from './RoomsV2Tab';
import { HEATING_ROOMS, HEATING_ACTIONS, heatingSlot, guessHeatFlow } from '../lib/heating';

const TYPE_ICON = {
  light: '💡', thermostat: '🌡️', sensor: '📡', socket: '🔌', tv: '📺',
  mediaplayer: '🔊', coffeemachine: '☕', fridge: '🧊', freezer: '❄️',
  washer: '🧺', vacuumcleaner: '🤖', heater: '🔥', curtain: '🪟',
  fan: '🌀', button: '🔘', other: '🏠',
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

const APP_VERSION = '1.17.1';
const REFRESH_SECONDS = 20;
// When the live stream is connected, the fast poll is redundant — fall back to a
// slow background re-sync (keeps the flows list fresh and recovers a stalled stream).
const LIVE_REFRESH_SECONDS = 120;

// Live server-push updates (SSE) are only enabled on the local/NAS build, which sets
// NEXT_PUBLIC_LIVE=1. On Vercel (serverless) it stays off and the app polls as before.
const LIVE_ENABLED = process.env.NEXT_PUBLIC_LIVE === '1';

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
  if (s.target_temperature != null) parts.push('🎯' + s.target_temperature + '°C');
  if (s.thermostat_mode) parts.push('mode:' + s.thermostat_mode);
  if ('alarm_motion' in s) parts.push(s.alarm_motion ? '🏃 motion' : 'no motion');
  if ('alarm_contact' in s) parts.push(s.alarm_contact ? '🚪 open' : '🚪 closed');
  if (s.alarm_water) parts.push('💧 leak!');
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
  const snapshotRef = useRef({});
  const sseSeeded = useRef(false);
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

  const errBox = error ? (
    <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, margin: '14px 0' }}>
      {error}
    </div>
  ) : null;

  const homeyTab = tab !== 'weather';

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>
          Skovgaard Dashboard <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 400 }}>v{APP_VERSION}</span>
        </h1>
        {authState === 'signedIn' && (
          <a href="/api/auth/logout" style={{ fontSize: 12.5, color: '#6b7280' }}>
            Disconnect{homeyName ? ` (${homeyName})` : ''}
          </a>
        )}
      </div>

      <div style={{ ...TAB_BAR, flexWrap: 'wrap' }}>
        {[['weather', 'Weather'], ['rooms', 'Rooms'], ['rooms2', 'Rooms 2.0'], ['activity', 'Live activity'], ['temperatures', 'Temperatures'], ['heating', 'Heating'], ['lighting', 'Adaptive lighting']].map(([t, label]) => (
          <div key={t} onClick={() => setTab(t)} style={tabItem(tab === t)}>{label}</div>
        ))}
      </div>

      {tab === 'weather' && <WeatherTab />}

      {homeyTab && authState === 'checking' && (
        <p style={{ color: '#6b7280' }}>Checking your Homey connection…</p>
      )}

      {homeyTab && authState === 'signedOut' && (
        <div style={{ maxWidth: 480, margin: '48px auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>Connect to Homey</h2>
          <p style={{ color: '#6b7280', marginBottom: 20 }}>
            Log in to see live room status, activity, heating, and adaptive lighting.
          </p>
          {errBox}
          <a
            href="/api/auth/login"
            style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 8, background: '#2563eb', color: '#fff', textDecoration: 'none', fontSize: 14 }}
          >
            Connect to Homey
          </a>
        </div>
      )}

      {homeyTab && authState === 'signedIn' && (
        <div>
          {errBox}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, margin: '2px 0 12px' }}>
            <style>{'@keyframes hd-spin { to { transform: rotate(360deg); } }'}</style>
            {LIVE_ENABLED && (
              <span style={{ fontSize: 11.5, color: live ? '#16a34a' : '#b45309' }}>
                {live ? '🟢 Live' : '🟠 Connecting…'}
              </span>
            )}
            <button
              onClick={() => refreshRef.current()} disabled={refreshing} title="Refresh"
              style={{
                width: 28, height: 28, borderRadius: 999, border: '1px solid #e3e6ea', background: '#fff',
                color: '#2563eb', cursor: refreshing ? 'default' : 'pointer', fontSize: 14, lineHeight: 1,
              }}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'hd-spin 0.8s linear infinite' : 'none' }}>↻</span>
            </button>
          </div>

          {tab === 'rooms' && (
            <div>
              <input
                type="text" placeholder="Filter rooms or devices…" value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {filteredRoomKeys.map((key) => (
                  <RoomCard key={key} group={roomGroups[key]} zone={zones[key]} openRooms={openRooms} onControl={controlDevice} />
                ))}
                {filteredRoomKeys.length === 0 && <Empty>No rooms or devices match your filter.</Empty>}
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div>
              <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4 }}>
                Live feed of Homey <b>Timeline notifications</b> (🔔) plus real <b>device-state changes</b> —
                since Homey has no "flow currently running" signal, state changes are the closest proxy for
                flows and scripts acting on your home.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {feed.length === 0 && (
                  <Empty>Nothing yet. Notifications and device changes will appear here as they happen.</Empty>
                )}
                {feed.map((item) => (
                  <div key={item.key} style={{
                    background: item.type === 'notif' ? '#f8fafc' : '#fff',
                    border: `1px solid ${item.type === 'notif' ? '#dbe4f0' : '#e3e6ea'}`,
                    borderLeft: item.type === 'notif' ? '3px solid #2563eb' : '1px solid #e3e6ea',
                    borderRadius: 8, padding: '8px 12px', fontSize: 12.5,
                    display: 'flex', justifyContent: 'space-between', gap: 10,
                  }}>
                    {item.type === 'notif' ? (
                      <span>🔔 {item.ownerName && <b>{item.ownerName}: </b>}{renderExcerpt(item.excerpt)}</span>
                    ) : (
                      <span>{item.room} — <b>{item.name}</b>: {item.cap} {fmtVal(item.from)} → {fmtVal(item.to)}</span>
                    )}
                    <span style={{ color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {item.ts.toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
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
    </Shell>
  );
}

const TAB_BAR = { display: 'flex', gap: 4, borderBottom: '1px solid #e3e6ea', marginBottom: 18 };
function tabItem(active) {
  return {
    padding: '9px 16px', cursor: 'pointer', fontSize: 13.5,
    color: active ? '#2563eb' : '#6b7280',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    fontWeight: active ? 600 : 400,
  };
}

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

const LOC_BTN = (disabled) => ({
  fontSize: 11.5, padding: '4px 10px', borderRadius: 999, border: '1px solid #e3e6ea',
  background: '#fff', color: '#2563eb', cursor: disabled ? 'default' : 'pointer',
});

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

  if (motionActive) return <span style={{ color: '#16a34a' }}>🏃 Active</span>;

  const since = sinceRef.current ?? Date.now();
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const label = secs < INACTIVE_COUNTER_LIMIT ? fmtDuration(secs) : fmtLongDuration(secs);
  const timeoutSecs = (timeoutMin || 30) * 60;
  const reached = secs >= timeoutSecs;
  return (
    <span style={{ color: '#6b7280' }} title={`No motion since ${new Date(since).toLocaleTimeString()}`}>
      💤 {label}
      {offset > 0 && (reached
        ? <span style={{ color: '#b45309' }}> · −{offset}° applied</span>
        : <span style={{ color: '#9ca3af' }}> · −{offset}° in {fmtDuration(timeoutSecs - secs)}</span>)}
    </span>
  );
}

function stepStyle(disabled) {
  return {
    width: 24, height: 24, borderRadius: 6, border: '1px solid #e3e6ea', background: '#fff',
    fontSize: 14, lineHeight: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
  };
}

function heatBtnStyle(actionKey, disabled) {
  const c = actionKey === 'boost' ? '#ea580c' : actionKey === 'pause' ? '#6b7280' : '#2563eb';
  return {
    padding: '5px 12px', borderRadius: 999, border: `1px solid ${c}`, background: '#fff', color: c,
    fontSize: 12, whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
  };
}

const HEAT_MODE = {
  boost: { label: '🔥 Boost', bg: '#fff1e6', color: '#ea580c' },
  pause: { label: '⏸ Paused', bg: '#f1f2f4', color: '#6b7280' },
  manual: { label: '✋ Manual', bg: '#fff7ed', color: '#b45309' },
};
// Real script mode wins; otherwise show the sticky optimistic "manual" (from a +/-) until it expires.
function resolveMode(sc, optExpiry) {
  if (sc && sc.mode && sc.mode !== 'auto') return { mode: sc.mode, modeExpires: sc.modeExpires };
  if (optExpiry && optExpiry > Date.now()) return { mode: 'manual', modeExpires: optExpiry };
  return { mode: sc ? sc.mode : null, modeExpires: sc ? sc.modeExpires : null };
}

function heatModeRemaining(modeExpires) {
  if (!modeExpires) return null;
  const secs = Math.round((modeExpires - Date.now()) / 1000);
  if (secs <= 0) return null;
  if (secs < 3600) return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
}

function HeatingTab({ devices, zones, flows, onControl, onReload }) {
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(() => new Set());
  const [err, setErr] = useState('');
  const [heatingEnabled, setHeatingEnabled] = useState(null);
  const [status, setStatus] = useState({});
  const [optManual, setOptManual] = useState({}); // zone -> expiry ms (optimistic manual after +/-)
  const [optTarget, setOptTarget] = useState({}); // thermostatId -> { value, ts } (hold new setpoint through Tado propagation)
  const [masterBusy, setMasterBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  function loadStatus() {
    return fetch('/api/homey/heating').then((r) => r.json())
      .then((j) => { setHeatingEnabled(j.heatingEnabled); if (j.status) setStatus(j.status); }).catch(() => {});
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
      const sensor = zoneDevs.find((d) => d.capabilities.measure_temperature != null && d.capabilities.target_temperature == null);
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
      scheduled,
      hasMotion,
      motionActive: motionNow,
      seedTs,
      // Target: the live device setpoint is the truth for tado (updates on +/-); fall back to the
      // script's effectiveTarget for plug rooms. A recent +/- holds its value for 45s (propagation).
      setTarget: (() => {
        const baseTarget = base.deviceTarget != null ? base.deviceTarget : (sc && sc.effectiveTarget != null ? sc.effectiveTarget : null);
        const ot = optTarget[room.thermostatId];
        return (ot && ot.value != null && base.deviceTarget !== ot.value && Date.now() - ot.ts < 45000) ? ot.value : baseTarget;
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

  // Manual target change on a tado room. Setting the device target trips the script's
  // manual-intervention detection → it holds "manual" for manualOverrideDuration minutes.
  function adjustTarget(room, d, delta) {
    if (d.setTarget == null || !room.thermostatId || !onControl) return;
    const next = Math.max(5, Math.min(25, Math.round((d.setTarget + delta) * 2) / 2)); // Tado range 5–25°C
    if (next === d.setTarget) return;
    setErr('');
    // Set ONLY the setpoint (like changing it in the Tado app) — sending onoff can make Tado
    // resume its schedule and discard the overlay we're setting in the same request.
    onControl(room.thermostatId, { target_temperature: next });
    // Hold the new setpoint on screen through Tado's propagation window so a refresh that
    // reads the not-yet-updated value doesn't flicker it back.
    setOptTarget((prev) => ({ ...prev, [room.thermostatId]: { value: next, ts: Date.now() } }));
    // We just triggered manual override — show the ✋ badge immediately (sticky).
    setOptManual((prev) => ({ ...prev, [room.zone]: Date.now() + (room.manualDuration || 90) * 60000 }));
    // Reconcile: re-pull device state (Tado catches up) and heating status (script flags manual).
    [5000, 12000, 20000].forEach((ms) => setTimeout(() => onReload && onReload(), ms));
    [4000, 8000, 15000].forEach((ms) => setTimeout(loadStatus, ms));
  }

  async function runAction(room, action) {
    const flow = flowFor(room, action);
    if (!flow) { setErr(`No flow mapped for ${room.label} · ${action.key}. Use “Configure flows”.`); return; }
    const bk = `${room.key}:${action.key}`;
    setErr('');
    setBusy((prev) => new Set(prev).add(bk));
    // Optimistically reflect the new mode so the badge appears instantly (boost/pause = 60 min).
    const optMode = action.key === 'boost' ? 'boost' : action.key === 'pause' ? 'pause' : 'auto';
    const optExpires = optMode === 'auto' ? null : Date.now() + 60 * 60000;
    setStatus((prev) => ({ ...prev, [room.zone]: { ...(prev[room.zone] || {}), mode: optMode, modeExpires: optExpires } }));
    setOptManual((prev) => { const n = { ...prev }; delete n[room.zone]; return n; }); // boost/pause/reset override manual
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

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap',
        background: heatingEnabled === false ? '#f8fafc' : '#fff',
        border: `1px solid ${heatingEnabled === false ? '#dbe4f0' : '#e3e6ea'}`,
        borderLeft: `3px solid ${heatingEnabled === false ? '#94a3b8' : '#ea580c'}`,
        borderRadius: 12, padding: '12px 16px',
      }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>{heatingEnabled === false ? '❄️' : '🔥'}</span>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Heating system</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {heatingEnabled == null ? 'state unknown'
              : heatingEnabled ? 'On — rooms follow their schedule'
                : 'Off — all heating disabled'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {masterBusy && <span style={{ fontSize: 11.5, color: '#9ca3af' }}>updating…</span>}
          <Toggle on={!!heatingEnabled} onChange={(v) => !masterBusy && toggleMaster(v)} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ color: '#6b7280', fontSize: 12.5, margin: 0 }}>
          Thermostat status per room. <b>Boost</b> (max heat ~1h), <b>Pause</b> (off ~1h) and
          <b> Reset</b> (cancel override) run your <code>room_heating</code> flows.
        </p>
        <button onClick={() => setShowConfig((s) => !s)} style={{ marginLeft: 'auto', ...LOC_BTN(false) }}>
          ⚙ Configure flows
        </button>
      </div>

      {err && (
        <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {HEATING_ROOMS.map((room) => {
          const d = roomData(room);
          const systemOff = heatingEnabled === false;
          return (
            <div key={room.key} style={{
              background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '14px 16px',
              filter: systemOff ? 'grayscale(1)' : 'none',
              opacity: systemOff ? 0.55 : 1,
              transition: 'opacity .2s, filter .2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 14.5 }}>{room.label}</h3>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  {d && d.away && <Tag bg="#eff6ff" color="#2563eb">🚪 away</Tag>}
                  {d && d.mode && HEAT_MODE[d.mode] && (
                    <Tag bg={HEAT_MODE[d.mode].bg} color={HEAT_MODE[d.mode].color}>
                      {HEAT_MODE[d.mode].label}{heatModeRemaining(d.modeExpires) ? ` ${heatModeRemaining(d.modeExpires)}` : ''}
                    </Tag>
                  )}
                  {d && d.windowOpen && <Tag bg="#fff7ed" color="#b45309">🪟 window open</Tag>}
                </span>
              </div>

              {!d ? (
                <div style={{ color: '#9ca3af', fontSize: 12.5, marginTop: 8 }}>Thermostat not found.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 4px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{d.temp != null ? d.temp.toFixed(1) : '—'}°</div>
                    <div style={{ color: '#6b7280', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {d.kind === 'tado' && d.setTarget != null ? (
                        <>
                          target
                          <button onClick={() => adjustTarget(room, d, -0.5)} disabled={systemOff || d.setTarget <= 5} style={stepStyle(systemOff || d.setTarget <= 5)} title="−0.5° (manual override)">−</button>
                          <b style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{d.setTarget}°</b>
                          <button onClick={() => adjustTarget(room, d, 0.5)} disabled={systemOff || d.setTarget >= 25} style={stepStyle(systemOff || d.setTarget >= 25)} title="+0.5° (manual override)">＋</button>
                        </>
                      ) : d.setTarget != null ? <>target <b>{d.setTarget}°</b></> : 'schedule-controlled'}
                      {d.humidity != null && <span style={{ color: '#9ca3af' }}> · 💧 {d.humidity}%</span>}
                    </div>
                  </div>
                  {d.kind === 'tado' && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
                      ± adjusts target · manual override holds {room.manualDuration} min
                    </div>
                  )}

                  {d.kind === 'tado' ? (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#6b7280', marginBottom: 3 }}>
                        <span>🔥 Heating</span><span>{d.power != null ? `${Math.round(d.power)}%` : '—'}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: '#f1f2f4', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, d.power || 0))}%`, background: '#f97316', transition: 'width .3s' }} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: d.plugOn ? '#ea580c' : '#6b7280' }}>
                      Radiator {d.plugOn ? '🔥 on' : 'off'}{d.plugCount ? ` · ${d.plugCount} plug${d.plugCount === 1 ? '' : 's'}` : ''}
                    </div>
                  )}

                  {d.scheduled && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <div style={{ color: '#6b7280' }}>
                        📅 <b>{d.scheduled.name}</b> · scheduled {d.scheduled.target}°
                        {d.setTarget != null && d.setTarget < d.scheduled.target - 0.05 && (
                          <span style={{ color: '#b45309' }}> → set {d.setTarget}°</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <span style={{ color: d.windowOpen ? '#b45309' : '#9ca3af' }}>
                          🪟 {d.windowOpen ? 'Open — heating paused' : 'Closed'}
                        </span>
                        {d.hasMotion && (
                          <HeatingInactivity
                            motionActive={d.motionActive}
                            seedTs={d.seedTs}
                            timeoutMin={d.scheduled.timeout}
                            offset={d.scheduled.offset}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {HEATING_ACTIONS.map((a) => {
                  const flow = flowFor(room, a);
                  const bk = `${room.key}:${a.key}`;
                  const isBusy = busy.has(bk);
                  const disabled = isBusy || !flow || systemOff;
                  return (
                    <button
                      key={a.key} onClick={() => runAction(room, a)} disabled={disabled}
                      title={systemOff ? 'Heating system is off' : flow ? `Runs flow: ${flow.name}` : 'No flow mapped — use Configure flows'}
                      style={heatBtnStyle(a.key, disabled)}
                    >
                      {isBusy ? '…' : a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showConfig && (
        <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 8 }}>
            Map each room&apos;s Boost / Pause / Reset to the Homey flow that runs it (auto-guessed by name, saved in this browser).
          </div>
          {HEATING_ROOMS.map((room) => (
            <div key={room.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ width: 120, fontSize: 12.5, fontWeight: 600 }}>{room.label}</span>
              {HEATING_ACTIONS.map((a) => {
                const flow = flowFor(room, a);
                return (
                  <select
                    key={a.key} value={flow ? flow.id : ''} onChange={(e) => setFlowFor(room.key, a.key, e.target.value)} title={a.label}
                    style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #e3e6ea', maxWidth: 160 }}
                  >
                    <option value="">{a.label} —</option>
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

  if (err) {
    return <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5 }}>{err}</div>;
  }
  if (!data) return <Empty>Loading weather…</Empty>;

  const cur = data.current;
  const [curIcon, curDesc] = wmo(cur.weather_code);
  const daily = data.daily;
  const times = data.hourly.time;
  let start = times.findIndex((t) => t.slice(0, 13) === cur.time.slice(0, 13));
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 24, times.length); i++) {
    hours.push({ time: times[i], temp: data.hourly.temperature_2m[i], pop: data.hourly.precipitation_probability?.[i], code: data.hourly.weather_code[i] });
  }
  const sectionH = { fontSize: 14, margin: '0 0 10px', color: '#374151' };
  const yr = data.yr;
  const omT = cur.temperature_2m;
  const yrT = yr && yr.current ? yr.current.temp : null;
  const bothT = yrT != null;
  const avgT = bothT ? (omT + yrT) / 2 : omT;
  const diffT = bothT ? Math.abs(omT - yrT) : null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: '#374151' }}>
            📍 <b>{data.place}</b>
            {data.lat != null && <span style={{ color: '#9ca3af', fontSize: 11.5 }}> ({data.lat}, {data.lon})</span>}
          </span>
          <button onClick={detect} disabled={locating} style={LOC_BTN(locating)}>
            {locating ? 'Locating…' : '📍 Use my location'}
          </button>
          <form onSubmit={search} style={{ display: 'inline-flex', gap: 6 }}>
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search city…"
              style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 8, border: '1px solid #e3e6ea', width: 150 }}
            />
            <button type="submit" style={LOC_BTN(false)}>Search</button>
          </form>
        </div>
        {results.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 380 }}>
            {results.map((r, i) => (
              <button
                key={i} onClick={() => pickLoc(r)}
                style={{ textAlign: 'left', fontSize: 12.5, padding: '6px 10px', borderRadius: 8, border: '1px solid #e3e6ea', background: '#fff', cursor: 'pointer' }}
              >
                {r.name}{r.admin1 ? `, ${r.admin1}` : ''}{r.country ? ` · ${r.country}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '16px 18px', marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>{curIcon}</div>
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{Math.round(avgT)}°C</div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>{curDesc} · feels {Math.round(cur.apparent_temperature)}°C</div>
          {bothT && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, flexWrap: 'wrap' }}>
              <span style={{
                padding: '1px 7px', borderRadius: 6, fontWeight: 600,
                background: diffT <= 1 ? '#ecfdf3' : '#fff7ed', color: diffT <= 1 ? '#16a34a' : '#b45309',
              }}>
                {diffT <= 1 ? '✓ Sources agree' : `⚠ Differ ${diffT.toFixed(1)}°`}
              </span>
              <span style={{ color: '#9ca3af' }}>
                Open-Meteo {Math.round(omT)}° {curIcon} · YR {Math.round(yrT)}° {yrIcon(yr.current.symbol)}
              </span>
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill>💧 {cur.relative_humidity_2m}%</Pill>
          <Pill>🌬️ {Math.round(cur.wind_speed_10m)} m/s {windDir(cur.wind_direction_10m)}</Pill>
          <Pill>🌧️ {cur.precipitation} mm</Pill>
          <Pill>🌅 {timeOnly(daily.sunrise[0])}</Pill>
          <Pill>🌇 {timeOnly(daily.sunset[0])}</Pill>
        </div>
      </div>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 16 }}>
        updated {timeOnly(cur.time)} · data by Open-Meteo &amp; MET Norway (YR)
      </div>

      <h3 style={sectionH}>Next 24 hours</h3>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 18 }}>
        {hours.map((h, i) => (
          <div key={i} style={{ flex: '0 0 auto', width: 58, textAlign: 'center', background: '#fff', border: '1px solid #e3e6ea', borderRadius: 10, padding: '8px 4px' }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{hourLabel(h.time)}</div>
            <div style={{ fontSize: 20 }}>{wmo(h.code)[0]}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{Math.round(h.temp)}°</div>
            {h.pop != null && <div style={{ fontSize: 10.5, color: '#2563eb' }}>💧{h.pop}%</div>}
          </div>
        ))}
      </div>

      <h3 style={sectionH}>7-day forecast</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {daily.time.map((d, i) => {
          const [icon, desc] = wmo(daily.weather_code[i]);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #e3e6ea', borderRadius: 10, padding: '8px 14px', fontSize: 13 }}>
              <span style={{ width: 44, fontWeight: 600 }}>{i === 0 ? 'Today' : dayLabel(d)}</span>
              <span style={{ fontSize: 20, width: 28, textAlign: 'center' }} title={desc}>{icon}</span>
              <span style={{ color: '#6b7280', flex: 1 }}>{desc}</span>
              {daily.precipitation_probability_max?.[i] != null && (
                <span style={{ color: '#2563eb', fontSize: 12 }}>💧{daily.precipitation_probability_max[i]}%</span>
              )}
              <span style={{ width: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <b>{Math.round(daily.temperature_2m_max[i])}°</b> <span style={{ color: '#9ca3af' }}>{Math.round(daily.temperature_2m_min[i])}°</span>
              </span>
              {yr && yr.daily && yr.daily[d] && (
                <span title={`YR: ${yrIcon(yr.daily[d].symbol)}`} style={{ width: 68, textAlign: 'right', color: '#9ca3af', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  yr {Math.round(yr.daily[d].tMax)}°/{Math.round(yr.daily[d].tMin)}°
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px 60px' }}>{children}</div>;
}

function RefreshControl({ countdown, refreshing, onRefresh, live }) {
  // While live, there's no countdown to show — the stream pushes updates. The fill
  // (progress toward the next poll) only makes sense when actively polling.
  const frac = refreshing ? 1 : (live ? 0 : Math.min(1, Math.max(0, (REFRESH_SECONDS - countdown) / REFRESH_SECONDS)));
  const label = refreshing ? 'Refreshing…' : (live ? 'Refresh now' : `Refresh now · ${countdown}s`);
  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      title={live ? 'Refresh now (updates stream in live)' : 'Refresh now — resets the countdown'}
      style={{
        position: 'relative', overflow: 'hidden', marginLeft: 'auto',
        display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 152,
        justifyContent: 'center', padding: '6px 16px', borderRadius: 999,
        border: '1px solid #2563eb', background: '#fff', color: '#2563eb',
        fontSize: 12.5, cursor: refreshing ? 'default' : 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <style>{'@keyframes hd-spin { to { transform: rotate(360deg); } }'}</style>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`,
          background: '#e0ebff', zIndex: 0,
          transition: refreshing ? 'none' : 'width 0.9s linear',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          display: 'inline-block', fontSize: 14, lineHeight: 1,
          animation: refreshing ? 'hd-spin 0.8s linear infinite' : 'none',
        }}>↻</span>
        {label}
      </span>
    </button>
  );
}

function batteryColor(pct) {
  if (pct <= 20) return '#dc2626'; // red
  if (pct <= 50) return '#eab308'; // yellow
  return '#16a34a';                // green
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
          x="0.6" y="0.6" width={bodyW - 1.2} height={bodyH - 1.2} rx="3.2" ry="3.2"
          fill="#fff" stroke="#9ca3af" strokeWidth="1"
        />
        <rect x={bodyW} y={(bodyH - capH) / 2} width={capW} height={capH} rx="1" fill="#9ca3af" />
        <rect x={pad} y={pad} width={fillW} height={bodyH - pad * 2} rx="1.8" fill={color} />
        <text
          x={bodyW / 2} y={bodyH / 2 + 0.5} textAnchor="middle" dominantBaseline="central"
          fontSize="10.5" fontWeight="700" fill="#111827" stroke="#fff" strokeWidth="2.2"
          paintOrder="stroke" style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {pct}
        </text>
      </svg>
    </span>
  );
}

function Pill({ children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff',
      border: '1px solid #e3e6ea', borderRadius: 999, padding: '5px 12px',
      fontSize: 12.5, color: '#374151',
    }}>
      {children}
    </span>
  );
}

function Tag({ children, color, bg, title }) {
  return (
    <span title={title} style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 6, background: bg, color,
      marginRight: 4, display: 'inline-block', cursor: title ? 'help' : 'default',
    }}>
      {children}
    </span>
  );
}

function Empty({ children }) {
  return <div style={{ color: '#6b7280', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>{children}</div>;
}

const inputStyle = {
  width: '100%', maxWidth: 320, padding: '7px 10px', borderRadius: 8,
  border: '1px solid #e3e6ea', fontSize: 13, marginBottom: 14, background: '#fff',
};

const thStyle = { textAlign: 'left', padding: '8px 12px', fontSize: 12.5, color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e3e6ea' };
const tdStyle = { textAlign: 'left', padding: '8px 12px', fontSize: 12.5, borderBottom: '1px solid #e3e6ea' };

function warmthLabel(t) {
  if (t >= 0.75) return 'very warm';
  if (t >= 0.6) return 'warm';
  if (t >= 0.45) return 'neutral';
  return 'cool';
}

// Best-guess a light's reset flow by token overlap with the flow name.
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

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4 }}>
        The configured circadian schedule from the Homey <code>adaptivelighting.js</code> script.
        Bar <b>height</b> = brightness, bar <b>color</b> = white balance (cool → warm), resolved for
        today&apos;s sunrise/sunset in København. Each light shows the mode the script reports:{' '}
        <b>Auto</b> (following the schedule, incl. daylight and sun adjustments), <b>Manual</b> (the
        script saw it adjusted) or <b>📌</b> a forced profile. <b>Manual?</b> means the light has
        differed from what the script last set for over 30 s and the script hasn&apos;t noticed yet; a
        leading <b>~</b> means the script hasn&apos;t reported this light, so the mode is guessed from
        the schedule. Hover a badge for what the script applied. <b>Reset room to Auto</b> triggers that
        room&apos;s light-reset flow. <b>Tap a phase</b> (Morning / Daytime / …) to set that room&apos;s
        lights to those settings now.
      </p>

      {err && (
        <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, margin: '10px 0' }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '8px 0 18px' }}>
        <Pill>🌅 Sunrise {fmtMinutes(sun.sunriseMinutes)}</Pill>
        <Pill>🌇 Sunset {fmtMinutes(sun.sunsetMinutes)}</Pill>
        <Pill>🕐 Now {fmtMinutes(nowMin)}</Pill>
        <Pill>{manualCount === 0 ? '✅ all Auto' : `✋ ${manualCount} manual`}</Pill>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid #e3e6ea', borderRadius: 999, overflow: 'hidden' }}>
          {[['Weekday', false], ['Weekend', true]].map(([label, val]) => (
            <button
              key={label}
              onClick={() => setWeekend(val)}
              style={{
                padding: '5px 14px', fontSize: 12.5, border: 'none', cursor: 'pointer',
                background: weekend === val ? '#2563eb' : '#fff',
                color: weekend === val ? '#fff' : '#6b7280',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {orderedAreas.map(({ area, members, repWeekday, repWeekend, repName, mixed }) => {
        const roomFlow = flowForRoom(area, members);
        const roomBusy = busy.has(area);
        const memberModes = members.map((m) => modeForMember(m));
        const roomMode = memberModes.some(isManualish) ? 'manual'
          : memberModes.some((r) => r.mode === 'forced') ? 'forced' : 'auto';
        const useWeekend = weekend && repWeekend;
        const chartProfiles = useWeekend ? repWeekend : repWeekday;
        return (
          <div key={area} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 14, margin: 0, color: '#374151' }}>{area}</h3>
              <ModeBadge mode={roomMode} />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={roomFlow ? roomFlow.id : ''}
                  onChange={(e) => setFlowForRoom(area, e.target.value)}
                  title="Which flow resets this room"
                  style={{ fontSize: 11.5, padding: '4px 8px', borderRadius: 6, border: '1px solid #e3e6ea', background: '#fff', maxWidth: 220 }}
                >
                  <option value="">— reset flow —</option>
                  {resetFlows.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
                <button onClick={() => resetRoom(area, roomFlow)} disabled={roomBusy || !roomFlow} style={resetBtnStyle(roomBusy || !roomFlow)}>
                  {roomBusy ? 'Running…' : '↺ Reset room to Auto'}
                </button>
              </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
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
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ flex: 1 }}>💡 {m.name}</span>
                    <ModeBadge {...memberModes[i]} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// mode/guess/st as returned by resolveLightMode (room badges pass just a mode).
function ModeBadge({ mode, guess = false, st = null }) {
  const map = {
    auto: { label: 'Auto', bg: '#ecfdf3', color: '#16a34a' },
    manual: { label: 'Manual', bg: '#fff7ed', color: '#b45309' },
    drift: { label: 'Manual?', bg: '#fffbeb', color: '#b45309' },
    forced: { label: `📌 ${st?.profile || 'Forced'}`, bg: '#eff6ff', color: '#2563eb' },
    off: { label: 'Off', bg: '#f1f2f4', color: '#6b7280' },
    unknown: { label: '—', bg: '#f1f2f4', color: '#9ca3af' },
  };
  const s = map[mode] || map.unknown;
  const title = guess
    ? 'Guessed from the schedule — the script has not reported this light'
    : mode === 'drift'
      ? `Differs from what the script set (${describeLightStatus(st)}); it will switch to Manual on its next check`
      : describeLightStatus(st) || undefined;
  return (
    <span title={title} style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 6, background: s.bg, color: s.color, fontWeight: 600,
      opacity: guess ? 0.7 : 1,
    }}>
      {guess ? '~' : ''}{s.label}
    </span>
  );
}

function resetBtnStyle(disabled) {
  return {
    padding: '4px 10px', borderRadius: 999, border: '1px solid #2563eb',
    background: '#fff', color: '#2563eb', fontSize: 11.5, whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
  };
}

function ScheduleChart({ profiles, sun, nowMin, onApplyPhase, applying }) {
  const phases = phaseList(profiles, sun);
  const H = 76;
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
      <div style={{
        position: 'relative', height: H, borderRadius: 8, overflow: 'hidden',
        border: '1px solid #d7dbe0', background: 'linear-gradient(#0b1220, #131c2e)',
      }}>
        {[6, 12, 18].map((h) => (
          <div key={h} style={{ position: 'absolute', left: pct(h * 60), top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.07)' }} />
        ))}
        {bars.map((b, k) => (
          <div
            key={k}
            title={`${b.name}: ${fmtMinutes(b.start)}–${fmtMinutes(b.end)} · ${Math.round(b.brightness * 100)}% · ${warmthLabel(b.temperature)}`}
            style={{
              position: 'absolute', left: pct(b.s), width: pct(b.e - b.s), bottom: 0,
              height: `${Math.max(3, b.brightness * 100)}%`, background: tempColor(b.temperature),
              borderRight: '1px solid rgba(0,0,0,0.18)', opacity: 0.95,
            }}
          />
        ))}
        {[['🌅', sun.sunriseMinutes], ['🌇', sun.sunsetMinutes]].map(([icon, m]) => (
          <div key={icon} style={{ position: 'absolute', left: pct(m), top: 0, bottom: 0, width: 1, background: 'rgba(255,214,102,0.5)' }}>
            <span style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', fontSize: 9 }}>{icon}</span>
          </div>
        ))}
        <div style={{ position: 'absolute', left: pct(nowMin), top: 0, bottom: 0, width: 2, background: '#ef4444', boxShadow: '0 0 5px rgba(239,68,68,0.9)' }} />
      </div>

      <div style={{ position: 'relative', height: 14, marginTop: 3, fontSize: 10, color: '#9ca3af' }}>
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ position: 'absolute', left: pct(h * 60), transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {phases.map((p, i) => {
          const active = isActive(p, nowMin);
          return (
            <button
              key={i}
              onClick={() => onApplyPhase && onApplyPhase(p)}
              disabled={applying || !onApplyPhase}
              title={`Set these lights to ${p.name} (${Math.round(p.brightness * 100)}%) now`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 8px',
                borderRadius: 6, border: `1px solid ${active ? '#2563eb' : '#e3e6ea'}`,
                background: active ? '#eff4ff' : '#fff', color: '#374151',
                cursor: applying ? 'default' : 'pointer', opacity: applying ? 0.6 : 1,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 2, background: tempColor(p.temperature), border: '1px solid rgba(0,0,0,0.15)' }} />
              <b style={{ fontWeight: active ? 700 : 600 }}>{p.name}</b>
              <span style={{ color: '#6b7280' }}>{fmtMinutes(p.start)} · {Math.round(p.brightness * 100)}%</span>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
      {lights.map((d) => {
        const s = lightSwatch(d.capabilities);
        if (!s) return null;
        const opacity = s.on ? (s.dim != null ? 0.4 + 0.6 * s.dim : 1) : 1;
        const label = s.on ? (s.dim != null ? `${Math.round(s.dim * 100)}%` : 'on') : 'off';
        return (
          <span
            key={d.id}
            title={`${d.name}: ${label}`}
            style={{
              width: 16, height: 16, borderRadius: 4,
              background: s.on ? s.color : '#eceef1', opacity,
              border: s.on ? '1px solid rgba(0,0,0,0.12)' : '1px solid #d1d5db',
              boxShadow: s.on ? `0 0 5px ${s.color}` : 'none',
            }}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 5, paddingLeft: 20 }}>
      {'dim' in c && (
        <SliderRow
          icon="🔆" value={c.dim ?? 0} accent="#f59e0b"
          onCommit={(v) => set({ dim: v, ...('onoff' in c && v > 0 ? { onoff: true } : {}) })}
        />
      )}
      {'light_temperature' in c && (
        <SliderRow
          icon="🌡️" value={c.light_temperature ?? 0} accent="#fb923c"
          fmt={(v) => (v >= 0.5 ? 'warm' : 'cool')}
          onCommit={(v) => set({ light_temperature: v, ...('light_mode' in c ? { light_mode: 'temperature' } : {}) })}
        />
      )}
      {'windowcoverings_set' in c && (
        <SliderRow icon="🪟" value={c.windowcoverings_set ?? 0} accent="#2563eb" onCommit={(v) => set({ windowcoverings_set: v })} />
      )}
      {'target_temperature' in c && (
        <TempStepper value={c.target_temperature ?? 20} current={c.measure_temperature} onCommit={(v) => set({ target_temperature: v })} />
      )}
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title={on ? 'Turn off' : 'Turn on'}
      style={{
        width: 38, height: 22, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer',
        background: on ? '#16a34a' : '#cbd5e1', position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

function SliderRow({ icon, value, onCommit, accent, fmt }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const pct = Math.round((v ?? 0) * 100);
  const commit = (e) => onCommit(e.target.valueAsNumber / 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, textAlign: 'center' }}>{icon}</span>
      <input
        type="range" min={0} max={100} value={pct}
        onChange={(e) => setV(e.target.valueAsNumber / 100)}
        onPointerUp={commit}
        onKeyUp={commit}
        style={{ flex: 1, accentColor: accent || '#2563eb', cursor: 'pointer' }}
      />
      <span style={{ width: 40, textAlign: 'right', color: '#6b7280', fontSize: 11 }}>{fmt ? fmt(v) : `${pct}%`}</span>
    </div>
  );
}

function TempStepper({ value, current, onCommit }) {
  const round = (x) => Math.round(x * 2) / 2;
  const btn = {
    width: 24, height: 24, borderRadius: 6, border: '1px solid #e3e6ea', background: '#fff',
    cursor: 'pointer', fontSize: 14, lineHeight: 1,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, textAlign: 'center' }}>🎯</span>
      <button type="button" style={btn} onClick={() => onCommit(round(value - 0.5))}>−</button>
      <span style={{ minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value}°C</span>
      <button type="button" style={btn} onClick={() => onCommit(round(value + 0.5))}>＋</button>
      {current != null && <span style={{ color: '#9ca3af', fontSize: 11 }}>now {current}°C</span>}
    </div>
  );
}

// Pulsing "live" indicator shown while a room has active motion.
function MotionBadge() {
  return (
    <span title="Motion detected now" style={{ display: 'inline-flex', alignItems: 'center', padding: 3, cursor: 'help' }}>
      <style>{'@keyframes hd-pulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}70%{box-shadow:0 0 0 7px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}'}</style>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#16a34a', animation: 'hd-pulse 1.4s ease-out infinite' }} />
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
      motionTag = <Tag bg="#f1f2f4" color="#6b7280" title={title}>💤 {label}</Tag>;
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
    <div style={{ position: 'relative', background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '14px 16px' }}>
      {motionTag && <div style={{ position: 'absolute', top: 12, right: 12 }}>{motionTag}</div>}
      <h3 style={{ margin: '0 0 2px', fontSize: 14.5, paddingRight: 74 }}>{roomName}</h3>
      <div style={{ color: '#6b7280', fontSize: 11.5, marginBottom: 8 }}>{group.path}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        {lightsTotal > 0 && <Tag bg={lightsOn ? '#ecfdf3' : '#f1f2f4'} color={lightsOn ? '#16a34a' : '#6b7280'}>💡 {lightsOn}/{lightsTotal}</Tag>}
        {avgTemp != null && <Tag bg="#f1f2f4" color="#6b7280">🌡️ {avgTemp}°C</Tag>}
        {openContact && <Tag bg="#fff7ed" color="#b45309">🚪 open</Tag>}
        {leak && <Tag bg="#fef2f2" color="#dc2626">💧 leak</Tag>}
        {minBattery != null && <BatteryIndicator level={minBattery} />}
        {!lightsTotal && avgTemp == null && !hasMotion && !openContact && !leak && minBattery == null && (
          <Tag bg="#f1f2f4" color="#6b7280">no live signals</Tag>
        )}
      </div>
      {lightsTotal > 0 && <LightStrip lights={group.devices.filter((d) => d.class === 'light')} />}
      <span onClick={toggle} style={{ fontSize: 11.5, color: '#2563eb', cursor: 'pointer' }}>
        {group.devices.length} device{group.devices.length === 1 ? '' : 's'} {open ? '▸' : '▾'}
      </span>
      {open && (
        <div style={{ marginTop: 8, borderTop: '1px solid #e3e6ea', paddingTop: 8 }}>
          {[...group.devices].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
            const c = d.capabilities;
            const line = deviceStateLine(c);
            const battery = c.measure_battery;
            const canToggle = 'onoff' in c;
            const hasSliders = 'dim' in c || 'light_temperature' in c || 'windowcoverings_set' in c || 'target_temperature' in c;
            const controllable = onControl && (canToggle || hasSliders);
            return (
              <div key={d.id} style={{ padding: '5px 0', fontSize: 12, borderTop: '1px dashed #eef0f2' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span>{TYPE_ICON[d.class] || '🏠'} {d.name}</span>
                  <span style={{
                    color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 8,
                    justifyContent: 'flex-end', flexWrap: 'wrap',
                  }}>
                    {!controllable && line !== '—' && <span>{line}</span>}
                    {battery != null && <BatteryIndicator level={battery} />}
                    {canToggle && onControl && <Toggle on={!!c.onoff} onChange={(v) => onControl(d.id, { onoff: v })} />}
                    {!controllable && battery == null && line === '—' && <span>—</span>}
                  </span>
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
