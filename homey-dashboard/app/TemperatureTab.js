'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
// Temperatures: every temperature sensor's history on one chart. The sensor cards under the
// chart are the legend and the picker in one: tap a card to show or hide its line.

import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import styles from './TemperatureTab.module.css';

const PERIODS = [
  ['last6Hours', '6 h'],
  ['last24Hours', '24 h'],
  ['last7Days', '7 d'],
  ['last14Days', '14 d'],
  ['last31Days', '31 d'],
];
const PERIOD_KEY = 'homey-temperature-period-v1';
const SELECTED_KEY = 'homey-temperature-sensors-v1';
// Series palette: vivid but not neon, readable on both the light and the dark card.
const COLORS = [
  '#5b7cff', '#f97316', '#22c55e', '#a855f7', '#06b6d4', '#ec4899',
  '#6366f1', '#eab308', '#14b8a6', '#ef4444', '#8b5cf6', '#0ea5e9',
];
const DASHES = ['', '8 4', '3 4'];

function sensorColor(index) {
  return COLORS[index % COLORS.length];
}

function sensorDash(index) {
  return DASHES[Math.floor(index / COLORS.length) % DASHES.length];
}

function shortZone(zone) {
  const parts = String(zone || '').split(' > ');
  return parts[parts.length - 1] || 'No room';
}

function fmtTemp(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}°` : '—';
}

function closestEntry(entries, targetMs) {
  if (!entries.length) return null;
  let low = 0;
  let high = entries.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (new Date(entries[mid].t).getTime() < targetMs) low = mid + 1;
    else high = mid;
  }
  const current = entries[low];
  const previous = low > 0 ? entries[low - 1] : null;
  if (!previous) return current;
  return Math.abs(new Date(previous.t).getTime() - targetMs) < Math.abs(new Date(current.t).getTime() - targetMs)
    ? previous : current;
}

// Colour key for a sensor: a dot, or a short dashed stroke for the sensors whose
// colour repeats (index ≥ 12) and are told apart in the chart by their dash.
function SensorSwatch({ color, dash, off }) {
  const c = off ? 'var(--toggle-off)' : color;
  if (!dash) return <i className={styles.dot} style={{ background: c }} />;
  const scaled = dash.split(' ').map((n) => Number(n) / 2).join(' ');
  return (
    <svg className={styles.dashSwatch} width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
      <line x1="1" x2="15" y1="4" y2="4" style={{ stroke: c }} strokeWidth="2.5" strokeDasharray={scaled} />
    </svg>
  );
}

function TemperatureChart({ sensors, series, period, loading }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  // Draw in real pixels (viewBox = rendered width) so labels stay 11px on a phone too.
  const [width, setWidth] = useState(1100);
  const gradientId = `temp-area-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      const w = Math.round(node.clientWidth);
      if (w > 0) setWidth(w);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const W = width;
  const H = Math.round(Math.max(240, Math.min(420, width * 0.42)));
  const compact = width < 560;
  const margin = { left: compact ? 34 : 44, right: compact ? 10 : 18, top: 14, bottom: 32 };

  const chart = useMemo(() => {
    const byKey = new Map(series.map((item) => [item.key, [...item.entries].sort((a, b) => new Date(a.t) - new Date(b.t))]));
    const usable = sensors.map((sensor) => ({ sensor, entries: byKey.get(sensor.key) || [] })).filter((item) => item.entries.length);
    const all = usable.flatMap((item) => item.entries.map((entry) => ({ ...entry, ms: new Date(entry.t).getTime() })));
    if (!all.length) return { usable, empty: true };
    const rawMin = Math.min(...all.map((entry) => entry.v));
    const rawMax = Math.max(...all.map((entry) => entry.v));
    const valuePad = Math.max(1, (rawMax - rawMin) * 0.1);
    const yMin = Math.floor(rawMin - valuePad);
    const yMax = Math.ceil(rawMax + valuePad);
    const xMin = Math.min(...all.map((entry) => entry.ms));
    const xMax = Math.max(...all.map((entry) => entry.ms));
    const xSpan = Math.max(1, xMax - xMin);
    const ySpan = Math.max(1, yMax - yMin);
    const x = (ms) => margin.left + ((ms - xMin) / xSpan) * (W - margin.left - margin.right);
    const y = (value) => H - margin.bottom - ((value - yMin) / ySpan) * (H - margin.top - margin.bottom);
    const baseY = (H - margin.bottom).toFixed(1);
    const paths = usable.map((item) => {
      const d = item.entries.map((entry, index) => `${index ? 'L' : 'M'} ${x(new Date(entry.t).getTime()).toFixed(1)} ${y(entry.v).toFixed(1)}`).join(' ');
      const firstX = x(new Date(item.entries[0].t).getTime()).toFixed(1);
      const lastX = x(new Date(item.entries[item.entries.length - 1].t).getTime()).toFixed(1);
      return { ...item, d, area: `${d} L ${lastX} ${baseY} L ${firstX} ${baseY} Z` };
    });
    // Whole-degree ticks at a "nice" step (1/2/5/10°) — dividing the span into equal
    // fifths produced fractional ticks that rounded to an odd-looking 18,20,21,23,24,26.
    const step = ySpan <= 6 ? 1 : ySpan <= 12 ? 2 : ySpan <= 30 ? 5 : 10;
    const yTicks = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);
    const xCount = Math.max(3, Math.min(7, Math.floor((W - margin.left - margin.right) / 90) + 1));
    const xTicks = Array.from({ length: xCount }, (_, i) => xMin + (i * xSpan) / (xCount - 1));
    return { usable, paths, rawMin, rawMax, yMin, yMax, xMin, xMax, x, y, yTicks, xTicks, empty: false };
  }, [sensors, series, W, H, margin.left, margin.right, margin.top, margin.bottom]);

  function xLabel(ms) {
    const date = new Date(ms);
    if (period === 'last6Hours') return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (period === 'last24Hours') return date.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit' });
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function onMove(event) {
    if (chart.empty) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = Math.max(margin.left, Math.min(W - margin.right, ((event.clientX - rect.left) / rect.width) * W));
    const ms = chart.xMin + ((relativeX - margin.left) / (W - margin.left - margin.right)) * (chart.xMax - chart.xMin);
    const values = chart.usable.map((item) => ({ sensor: item.sensor, entry: closestEntry(item.entries, ms) })).filter((item) => item.entry);
    setHover({ x: relativeX, ms, values });
  }

  // Tooltip sits on the side of the crosshair with the most room.
  const hoverPct = hover ? (hover.x / W) * 100 : 0;
  const tooltipStyle = hover && hoverPct > 50
    ? { right: `calc(${100 - hoverPct}% + 12px)` }
    : { left: `calc(${hoverPct}% + 12px)` };

  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      {chart.empty && loading && (
        <div className={`hd-skeleton ${styles.chartSkeleton}`}>
          <span className={styles.chartSkeletonLabel}>
            <LoaderCircle size={14} className={styles.spin} />
            Loading history…
          </span>
        </div>
      )}
      {chart.empty && !loading && (
        <div className={`hd-empty ${styles.chartEmpty}`}>No sensor selected.</div>
      )}
      {!chart.empty && (
        <svg
          viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Temperature history for ${sensors.length} sensors`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        >
          {chart.paths.length === 1 && (
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={chart.paths[0].sensor.color} stopOpacity="0.24" />
                <stop offset="100%" stopColor={chart.paths[0].sensor.color} stopOpacity="0" />
              </linearGradient>
            </defs>
          )}
          {chart.yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left} x2={W - margin.right} y1={chart.y(tick)} y2={chart.y(tick)}
                style={{ stroke: 'var(--chart-grid)' }}
              />
              <text
                x={margin.left - 10} y={chart.y(tick) + 4} textAnchor="end"
                className={styles.axisText} style={{ fill: 'var(--chart-axis)' }}
              >
                {tick}°
              </text>
            </g>
          ))}
          {chart.xTicks.map((tick) => (
            <text
              key={tick} x={chart.x(tick)} y={H - 10} textAnchor="middle"
              className={styles.axisText} style={{ fill: 'var(--chart-axis)' }}
            >
              {xLabel(tick)}
            </text>
          ))}
          <line
            x1={margin.left} x2={W - margin.right} y1={H - margin.bottom} y2={H - margin.bottom}
            style={{ stroke: 'var(--border-strong)' }}
          />
          {chart.paths.length === 1 && (
            <path d={chart.paths[0].area} style={{ fill: `url(#${gradientId})`, stroke: 'none' }} />
          )}
          {chart.paths.map((item) => (
            <path
              key={item.sensor.key} d={item.d} className={styles.line}
              style={{ fill: 'none', stroke: item.sensor.color }}
              strokeWidth="2" strokeDasharray={item.sensor.dash || undefined}
              strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          {hover && (
            <line
              x1={hover.x} x2={hover.x} y1={margin.top} y2={H - margin.bottom}
              style={{ stroke: 'var(--border-strong)' }} strokeWidth="1" strokeDasharray="4 4"
            />
          )}
          {hover && hover.values.map(({ sensor, entry }) => (
            <circle
              key={sensor.key} r="4"
              cx={chart.x(new Date(entry.t).getTime())} cy={chart.y(entry.v)}
              style={{ fill: sensor.color, stroke: 'var(--surface-solid)' }} strokeWidth="2"
            />
          ))}
        </svg>
      )}
      {!chart.empty && loading && (
        <div className={styles.busy}>
          <span className={styles.chartSkeletonLabel}>
            <LoaderCircle size={14} className={styles.spin} />
            Updating…
          </span>
        </div>
      )}
      {!chart.empty && hover && (
        <div className={styles.tooltip} style={tooltipStyle}>
          <span className={styles.tooltipTime}>
            {new Date(hover.ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          {hover.values.map(({ sensor, entry }) => (
            <span key={sensor.key} className={styles.tooltipRow}>
              <SensorSwatch color={sensor.color} dash={sensor.dash} />
              <span className={styles.tooltipName}>{sensor.name}</span>
              <span className={styles.tooltipValue}>{fmtTemp(entry.v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TemperatureTab() {
  const [sensors, setSensors] = useState([]);
  const [selected, setSelected] = useState([]);
  const [series, setSeries] = useState([]);
  const [period, setPeriod] = useState('last7Days');
  const [loadingSensors, setLoadingSensors] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const hydrated = useRef(false);

  useEffect(() => {
    const savedPeriod = window.localStorage.getItem(PERIOD_KEY);
    if (PERIODS.some(([value]) => value === savedPeriod)) setPeriod(savedPeriod);
    let cancelled = false;
    fetch('/api/homey/temperatures')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the temperature sensors');
        if (cancelled) return;
        setSensors(data.sensors || []);
        const savedRaw = window.localStorage.getItem(SELECTED_KEY);
        let saved = [];
        try { saved = JSON.parse(savedRaw || '[]'); } catch { saved = []; }
        const available = new Set((data.sensors || []).map((sensor) => sensor.key));
        const restored = saved.filter((key) => available.has(key));
        setSelected(savedRaw !== null ? restored : (data.sensors || []).map((sensor) => sensor.key));
        hydrated.current = true;
      })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); })
      .finally(() => { if (!cancelled) setLoadingSensors(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated.current || loadingSensors) return undefined;
    window.localStorage.setItem(PERIOD_KEY, period);
    window.localStorage.setItem(SELECTED_KEY, JSON.stringify(selected));
    if (!selected.length) {
      setSeries([]);
      setLoadingData(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingData(true);
      setError('');
      try {
        const params = new URLSearchParams({ period, ids: selected.join(',') });
        const response = await fetch(`/api/homey/temperatures?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the temperature history');
        setSeries(data.series || []);
      } catch (e) {
        if (e.name !== 'AbortError') setError(String(e.message || e));
      } finally {
        if (!controller.signal.aborted) setLoadingData(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selected, period, loadingSensors, reloadKey]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // Stable colour per sensor (index in the FULL list) — used identically by the
  // chips, the chart lines, the tooltip and the stat cards, regardless of selection.
  const coloredSensors = useMemo(
    () => sensors.map((sensor, i) => ({ ...sensor, color: sensorColor(i), dash: sensorDash(i) })),
    [sensors],
  );
  const activeSensors = useMemo(() => coloredSensors.filter((sensor) => selectedSet.has(sensor.key)), [coloredSensors, selectedSet]);
  // Per-sensor min / max / newest sample over the loaded period, for the stat cards.
  const statsByKey = useMemo(() => {
    const map = new Map();
    series.forEach((item) => {
      const entries = item.entries || [];
      if (!entries.length) return;
      let lo = Infinity;
      let hi = -Infinity;
      let last = null;
      let lastMs = -Infinity;
      entries.forEach((entry) => {
        if (entry.v < lo) lo = entry.v;
        if (entry.v > hi) hi = entry.v;
        const ms = new Date(entry.t).getTime();
        if (ms >= lastMs) { lastMs = ms; last = entry.v; }
      });
      map.set(item.key, { min: lo, max: hi, last });
    });
    return map;
  }, [series]);

  function toggle(key) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  const allSelected = sensors.length > 0 && selected.length === sensors.length;

  return (
    <section className={styles.tab}>
      <div className={styles.bar}>
        <div className={`hd-seg ${styles.periods}`} role="group" aria-label="Period">
          {PERIODS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {label}
            </button>
          ))}
        </div>
        <button
          type="button" className="hd-icon-btn" onClick={() => setReloadKey((value) => value + 1)}
          disabled={loadingData} aria-label="Refresh" title="Refresh"
        >
          <RefreshCw size={17} strokeWidth={2} className={loadingData ? styles.spin : undefined} />
        </button>
      </div>

      {error && (
        <div className="hd-error" role="alert" style={{ margin: 0 }}>
          <TriangleAlert size={16} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      <div className={`hd-card ${styles.chartCard}`}>
        <TemperatureChart sensors={activeSensors} series={series} period={period} loading={loadingData || loadingSensors} />
      </div>

      {sensors.length > 0 && (
        <div className={styles.pickHead}>
          <span className="hd-num">{selected.length} of {sensors.length} shown</span>
          <button
            type="button" className="hd-btn hd-btn-ghost hd-btn-sm"
            onClick={() => setSelected(allSelected ? [] : sensors.map((sensor) => sensor.key))}
          >
            {allSelected ? 'Hide all' : 'Show all'}
          </button>
        </div>
      )}

      <div className={styles.sensors}>
        {coloredSensors.map((sensor) => {
          const checked = selectedSet.has(sensor.key);
          const stat = statsByKey.get(sensor.key);
          const latest = typeof sensor.latest === 'number' ? sensor.latest : (stat ? stat.last : null);
          return (
            <button
              key={sensor.key} type="button" aria-pressed={checked} title={`${sensor.name} · ${shortZone(sensor.zone)}`}
              className={`${styles.sensor} ${checked ? styles.sensorOn : ''}`}
              style={{ '--chip': sensor.color }} onClick={() => toggle(sensor.key)}
            >
              <span className={styles.sensorName}>
                <SensorSwatch color={sensor.color} dash={sensor.dash} off={!checked} />
                <span className={styles.sensorNameText}>{sensor.name}</span>
              </span>
              <span className={styles.sensorValue}>{fmtTemp(latest)}</span>
              <span className={styles.sensorRange}>
                {checked && stat ? `${fmtTemp(stat.min)} – ${fmtTemp(stat.max)}` : shortZone(sensor.zone)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
