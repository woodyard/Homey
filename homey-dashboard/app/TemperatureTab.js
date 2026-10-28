'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const PERIODS = [
  ['last6Hours', '6 timer'],
  ['last24Hours', '24 timer'],
  ['last7Days', '7 dage'],
  ['last14Days', '14 dage'],
  ['last31Days', '31 dage'],
];
const PERIOD_KEY = 'homey-temperature-period-v1';
const SELECTED_KEY = 'homey-temperature-sensors-v1';
const COLORS = [
  '#2563eb', '#ea580c', '#16a34a', '#9333ea', '#0891b2', '#db2777',
  '#4f46e5', '#ca8a04', '#0f766e', '#c2410c', '#7c3aed', '#0369a1',
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
  return parts[parts.length - 1] || 'Uden rum';
}

function fmtTemp(value) {
  return typeof value === 'number' ? `${value.toLocaleString('da-DK', { maximumFractionDigits: 1 })} °C` : '—';
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

function TemperatureChart({ sensors, series, period, loading }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 1100;
  const H = 480;
  const margin = { left: 62, right: 24, top: 24, bottom: 54 };

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
    const paths = usable.map((item) => ({
      ...item,
      d: item.entries.map((entry, index) => `${index ? 'L' : 'M'} ${x(new Date(entry.t).getTime()).toFixed(1)} ${y(entry.v).toFixed(1)}`).join(' '),
    }));
    // Whole-degree ticks at a "nice" step (1/2/5/10°) — dividing the span into equal
    // fifths produced fractional ticks that rounded to an odd-looking 18,20,21,23,24,26.
    const step = ySpan <= 6 ? 1 : ySpan <= 12 ? 2 : ySpan <= 30 ? 5 : 10;
    const yTicks = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);
    const xTicks = Array.from({ length: 7 }, (_, i) => xMin + (i * xSpan) / 6);
    return { usable, paths, rawMin, rawMax, yMin, yMax, xMin, xMax, x, y, yTicks, xTicks, empty: false };
  }, [sensors, series]);

  function xLabel(ms) {
    const date = new Date(ms);
    if (period === 'last6Hours') return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    if (period === 'last24Hours') return date.toLocaleString('da-DK', { weekday: 'short', hour: '2-digit' });
    return date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  }

  function onMove(event) {
    if (chart.empty) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = Math.max(margin.left, Math.min(W - margin.right, ((event.clientX - rect.left) / rect.width) * W));
    const ms = chart.xMin + ((relativeX - margin.left) / (W - margin.left - margin.right)) * (chart.xMax - chart.xMin);
    const values = chart.usable.map((item) => ({ sensor: item.sensor, entry: closestEntry(item.entries, ms) })).filter((item) => item.entry);
    setHover({ x: relativeX, ms, values });
  }

  if (chart.empty) {
    return (
      <div className="temp-empty-chart">
        {loading ? 'Henter temperaturmålinger…' : 'Vælg mindst én måler med tilgængelige data.'}
      </div>
    );
  }

  const tooltipLeft = hover ? Math.max(10, Math.min(86, (hover.x / W) * 100)) : 0;
  return (
    <div className="temp-chart-wrap" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Temperaturmålinger for ${sensors.length} valgte målere`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={W - margin.right} y1={chart.y(tick)} y2={chart.y(tick)} stroke="#e5e7eb" />
            <text x={margin.left - 12} y={chart.y(tick) + 4} textAnchor="end" fontSize="12" fill="#6b7280">
              {tick}°
            </text>
          </g>
        ))}
        {chart.xTicks.map((tick) => (
          <text key={tick} x={chart.x(tick)} y={H - 18} textAnchor="middle" fontSize="12" fill="#6b7280">
            {xLabel(tick)}
          </text>
        ))}
        <line x1={margin.left} x2={W - margin.right} y1={H - margin.bottom} y2={H - margin.bottom} stroke="#cbd5e1" />
        {chart.paths.map((item) => (
          <path
            key={item.sensor.key} d={item.d} fill="none" stroke={item.sensor.color}
            strokeWidth="2.6" strokeDasharray={item.sensor.dash} strokeLinecap="round" strokeLinejoin="round"
          />
        ))}
        {hover && (
          <line x1={hover.x} x2={hover.x} y1={margin.top} y2={H - margin.bottom} stroke="#475569" strokeWidth="1" strokeDasharray="4 4" />
        )}
      </svg>
      {hover && (
        <div className="temp-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <b>{new Date(hover.ms).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>
          {hover.values.map(({ sensor, entry }) => (
            <span key={sensor.key}>
              <i style={{ background: sensor.color }} />
              {sensor.name}: <strong>{fmtTemp(entry.v)}</strong>
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
  const [search, setSearch] = useState('');
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
        if (!response.ok) throw new Error(data.error || 'Kunne ikke hente temperaturmålere');
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
        if (!response.ok) throw new Error(data.error || 'Kunne ikke hente temperaturdata');
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
  // checkbox swatches, the chart lines, and the tooltip, regardless of selection.
  const coloredSensors = useMemo(
    () => sensors.map((sensor, i) => ({ ...sensor, color: sensorColor(i), dash: sensorDash(i) })),
    [sensors],
  );
  const visibleSensors = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('da-DK');
    if (!term) return coloredSensors;
    return coloredSensors.filter((sensor) => `${sensor.name} ${sensor.zone}`.toLocaleLowerCase('da-DK').includes(term));
  }, [coloredSensors, search]);
  const activeSensors = useMemo(() => coloredSensors.filter((sensor) => selectedSet.has(sensor.key)), [coloredSensors, selectedSet]);
  const allEntries = useMemo(() => series.flatMap((item) => item.entries || []), [series]);
  const min = allEntries.length ? Math.min(...allEntries.map((entry) => entry.v)) : null;
  const max = allEntries.length ? Math.max(...allEntries.map((entry) => entry.v)) : null;

  function toggle(key) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  return (
    <section className="temperature-tab">
      <style>{`
        .temperature-tab { display:grid; grid-template-columns:minmax(230px,280px) minmax(0,1fr); gap:16px; }
        .temp-panel { background:#fff; border:1px solid #e3e6ea; border-radius:10px; }
        .temp-controls { padding:14px; align-self:start; position:sticky; top:12px; }
        .temp-control-row { display:flex; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .temp-control-row label { color:#6b7280; font-size:12px; }
        .temp-control-row select { border:1px solid #d1d5db; border-radius:7px; padding:6px 8px; background:#fff; font-size:12.5px; }
        .temp-search { width:100%; border:1px solid #d1d5db; border-radius:7px; padding:7px 9px; font-size:12.5px; margin-bottom:9px; }
        .temp-actions { display:flex; gap:6px; margin-bottom:10px; }
        .temp-actions button { border:1px solid #dbe3ef; border-radius:999px; background:#fff; color:#2563eb; padding:4px 9px; font-size:11.5px; cursor:pointer; }
        .temp-list { max-height:520px; overflow:auto; display:flex; flex-direction:column; gap:3px; }
        .temp-sensor { display:grid; grid-template-columns:18px 12px 1fr auto; gap:7px; align-items:center; padding:6px 5px; border-radius:7px; cursor:pointer; font-size:12px; }
        .temp-sensor:hover { background:#f8fafc; }
        .temp-swatch { width:11px; height:3px; border-radius:3px; }
        .temp-sensor-name { min-width:0; }
        .temp-sensor-name b, .temp-sensor-name small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .temp-sensor-name small { color:#8a919c; margin-top:1px; }
        .temp-latest { color:#4b5563; white-space:nowrap; font-variant-numeric:tabular-nums; }
        .temp-main { min-width:0; }
        .temp-kpis { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
        .temp-kpi { background:#fff; border:1px solid #e3e6ea; border-radius:10px; padding:12px 14px; }
        .temp-kpi small { color:#6b7280; display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
        .temp-kpi b { font-size:20px; display:block; margin-top:2px; }
        .temp-chart-panel { padding:14px; position:relative; }
        .temp-chart-head { display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:4px; }
        .temp-chart-head h2 { margin:0; font-size:15px; }
        .temp-chart-status { display:flex; align-items:center; gap:8px; font-size:11.5px; color:#6b7280; }
        .temp-chart-status button { border:1px solid #dbe3ef; border-radius:999px; background:#fff; color:#2563eb; padding:4px 9px; font-size:11.5px; cursor:pointer; }
        .temp-chart-wrap { position:relative; min-height:390px; }
        .temp-chart-wrap svg { width:100%; height:auto; display:block; overflow:visible; }
        .temp-empty-chart { min-height:390px; display:grid; place-items:center; color:#6b7280; font-size:13px; }
        .temp-tooltip { position:absolute; top:16px; transform:translateX(-50%); max-width:290px; max-height:260px; overflow:auto; background:rgba(255,255,255,.96); border:1px solid #dbe3ef; box-shadow:0 8px 24px rgba(15,23,42,.13); border-radius:9px; padding:9px 11px; pointer-events:none; font-size:11.5px; z-index:2; }
        .temp-tooltip b { display:block; margin-bottom:5px; }
        .temp-tooltip span { display:grid; grid-template-columns:8px 1fr auto; gap:5px; align-items:center; white-space:nowrap; }
        .temp-tooltip i { width:7px; height:7px; border-radius:50%; }
        .temp-error { grid-column:1/-1; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; border-radius:8px; padding:8px 12px; font-size:12px; }
        @media (max-width:800px) { .temperature-tab { grid-template-columns:1fr; } .temp-controls { position:static; } .temp-list { max-height:300px; } .temp-kpis { grid-template-columns:repeat(3,1fr); } }
      `}</style>
      {error && <div className="temp-error">{error}</div>}
      <aside className="temp-panel temp-controls">
        <div className="temp-control-row">
          <label htmlFor="temperature-period">Periode</label>
          <select id="temperature-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <input className="temp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Søg efter måler eller rum…" />
        <div className="temp-actions">
          <button type="button" onClick={() => setSelected(sensors.map((sensor) => sensor.key))}>Vælg alle</button>
          <button type="button" onClick={() => setSelected([])}>Fravælg alle</button>
        </div>
        <div className="temp-list" aria-label="Temperaturmålere">
          {loadingSensors && <span style={{ color: '#6b7280', fontSize: 12 }}>Finder temperaturmålere…</span>}
          {visibleSensors.map((sensor) => {
            const checked = selectedSet.has(sensor.key);
            return (
              <label className="temp-sensor" key={sensor.key}>
                <input type="checkbox" checked={checked} onChange={() => toggle(sensor.key)} />
                <i className="temp-swatch" style={{ background: checked ? sensor.color : '#cbd5e1' }} />
                <span className="temp-sensor-name"><b>{sensor.name}</b><small>{shortZone(sensor.zone)}</small></span>
                <span className="temp-latest">{fmtTemp(sensor.latest)}</span>
              </label>
            );
          })}
        </div>
      </aside>
      <div className="temp-main">
        <div className="temp-kpis">
          <div className="temp-kpi"><small>Valgte målere</small><b>{selected.length} / {sensors.length}</b></div>
          <div className="temp-kpi"><small>Laveste</small><b>{fmtTemp(min)}</b></div>
          <div className="temp-kpi"><small>Højeste</small><b>{fmtTemp(max)}</b></div>
        </div>
        <div className="temp-panel temp-chart-panel">
          <div className="temp-chart-head">
            <h2>Temperaturudvikling</h2>
            <div className="temp-chart-status">
              <span>{loadingData ? 'Opdaterer…' : `${allEntries.length.toLocaleString('da-DK')} målepunkter`}</span>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loadingData}>↻ Opdater</button>
            </div>
          </div>
          <TemperatureChart sensors={activeSensors} series={series} period={period} loading={loadingData} />
        </div>
      </div>
    </section>
  );
}
