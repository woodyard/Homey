'use client';

// Weather: current conditions from two sources (Open-Meteo and MET Norway / YR), the next
// 24 hours and a 7-day forecast. Follows the device's location, or a searched city.

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Check, Droplets, LoaderCircle, LocateFixed, MapPin, Search, Sunrise, TriangleAlert,
  Umbrella, Wind, X,
} from 'lucide-react';
import { cx, clamp, ErrorBox, SPIN } from './ui';
import styles from './WeatherTab.module.css';

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

export default function WeatherTab() {
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
    { Icon: Sunrise, label: 'Daylight', title: 'Sunrise and sunset', value: `${timeOnly(daily.sunrise[0])}–${timeOnly(daily.sunset[0])}` },
  ];

  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const weekSpan = weekMax - weekMin || 1;

  return (
    <div>
      <div className={styles.locBar}>
        <button
          type="button" className="hd-icon-btn" onClick={detect} disabled={locating}
          aria-label="Use my location" title="Use my location"
        >
          {locating ? <LoaderCircle size={17} style={SPIN} /> : <LocateFixed size={17} />}
        </button>
        <div className={styles.searchBox}>
          <form onSubmit={search} className={styles.searchWrap} role="search">
            <Search size={16} className={styles.searchIcon} />
            <input
              className="hd-input" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
              placeholder="Search city" aria-label="Search city"
            />
            {(q || results.length > 0) && (
              <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => { setQ(''); setResults([]); }}>
                <X size={16} />
              </button>
            )}
          </form>
          {results.length > 0 && (
            <div className={cx('hd-card', styles.results)}>
              {results.map((r, i) => (
                <button key={i} type="button" className={styles.resultBtn} onClick={() => pickLoc(r)}>
                  <MapPin size={15} />
                  <span>{r.name}{r.admin1 ? `, ${r.admin1}` : ''}{r.country ? ` · ${r.country}` : ''}</span>
                </button>
              ))}
            </div>
          )}
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
        Updated {timeOnly(cur.time)} · Open-Meteo &amp; MET Norway (YR)
      </div>

      <h3 className="hd-section-title">Next 24 hours</h3>
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

      <h3 className="hd-section-title">Next 7 days</h3>
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
                <span className={styles.daySub}>{desc}</span>
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
