'use client';

// One light as a tile with its live state: tinted by the bulb's own colour while on, with
// its brightness and the mode AdaptiveLighting reports. The bulb switches the light on and
// off; the rest of the tile opens brightness, warmth and (for colour bulbs) colour.

import { useState } from 'react';
import { ChevronDown, Hand, Lightbulb, Palette, SunMedium, Thermometer, TriangleAlert } from 'lucide-react';
import { describeLightStatus, isIdle, tempColor } from '../lib/adaptiveLighting';
import { slotName } from '../lib/heatingState';
import { cx, SliderRow } from './ui';
import styles from './LightTile.module.css';

const HUE_TRACK = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 90% 55%)`).join(', ')})`;
const WARMTH_TRACK = `linear-gradient(90deg, ${tempColor(0)}, ${tempColor(1)})`;

// A single bulb as a glowing tile with live state. `al` is resolveLightMode's
// { mode, guess, st } for lights AdaptiveLighting manages, else null.
const LIGHT_MODE_LABEL = { auto: 'Auto', manual: 'Manuelt', drift: 'Manuelt?', forced: 'Låst', off: 'Slukket', unknown: '—' };
export default function LightTile({ device, al, onToggle, onSet }) {
  const [open, setOpen] = useState(false);
  const mode = al ? al.mode : null;
  const c = device.capabilities || {};
  const on = !!c.onoff;
  const unavailable = device.available === false;
  let color;
  if (c.light_mode === 'color' && c.light_hue != null) {
    color = `hsl(${Math.round((c.light_hue || 0) * 360)} ${Math.round((c.light_saturation != null ? c.light_saturation : 1) * 100)}% 55%)`;
  } else if (c.light_temperature != null) {
    color = tempColor(c.light_temperature);
  } else {
    color = tempColor(0.6);
  }
  const dim = c.dim;
  const modeText = mode
    ? `${mode === 'forced' && al.st?.profile ? `Låst ${slotName(al.st.profile)}` : LIGHT_MODE_LABEL[mode] || mode}${al.guess ? ' (gættet)' : ''}${!al.guess && mode !== 'off' && isIdle(al.st) ? ' · dæmpet' : ''}`
    : '';
  const alText = al && al.st ? describeLightStatus(al.st) : '';
  // A lit tile is tinted by the bulb's own colour with a glow that grows with brightness.
  const level = dim != null ? dim : 0.75;
  const tileStyle = on ? {
    background: `color-mix(in srgb, ${color} 20%, var(--surface-solid))`,
    borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
    boxShadow: `0 8px 24px -10px color-mix(in srgb, ${color} ${Math.round(45 + level * 40)}%, transparent)`,
  } : undefined;
  const iconStyle = on ? {
    background: `color-mix(in srgb, ${color} 38%, transparent)`,
    color: `color-mix(in srgb, ${color} 72%, var(--text))`,
    boxShadow: `0 0 ${Math.round(6 + level * 12)}px color-mix(in srgb, ${color} 65%, transparent)`,
  } : undefined;
  const idle = !!al && !al.guess && mode !== 'off' && isIdle(al.st); // dimmed while the room is empty
  const canSwitch = !!onToggle && 'onoff' in c && !device.alwaysOn && !unavailable;
  const canDim = !!onSet && !unavailable && 'dim' in c;
  const canWarm = !!onSet && !unavailable && 'light_temperature' in c;
  const canColour = !!onSet && !unavailable && 'light_hue' in c;
  const canAdjust = canDim || canWarm || canColour;
  const turnOn = 'onoff' in c && !on ? { onoff: true } : {}; // a light that is on is not told to turn on again
  return (
    <div
      title={unavailable
        ? `${device.name}: utilgængelig (uden strøm eller uden forbindelse)`
        : `${device.name}: ${on ? (dim != null ? `${Math.round(dim * 100)}%` : 'tændt') : 'slukket'}${modeText ? ` · ${modeText}` : ''}${alText ? `\nAutomatik: ${alText}` : ''}`}
      className={cx(styles.tile, unavailable && styles.tileUnavailable)}
      style={tileStyle}
    >
      <div className={styles.tileRow}>
        <button
          type="button" className={styles.bulb} style={iconStyle} disabled={!canSwitch}
          onClick={() => onToggle(!on)} aria-pressed={on}
          aria-label={device.alwaysOn ? `${device.name}: altid tændt` : `${on ? 'Sluk' : 'Tænd'} ${device.name}`}
        >
          <Lightbulb size={20} strokeWidth={2} />
        </button>
        <button
          type="button" className={styles.tileMain} disabled={!canAdjust}
          onClick={() => setOpen((o) => !o)} aria-expanded={canAdjust ? open : undefined}
          aria-label={canAdjust ? `Justér ${device.name}` : undefined}
        >
          <span className={styles.tileBody}>
            <span className={styles.tileName}>{device.name}</span>
            <span className={styles.tileMeta}>
              {unavailable && <span className={styles.warnIcon} title="Utilgængelig"><TriangleAlert size={12} /></span>}
              <span>{on ? (dim != null ? `${Math.round(dim * 100)}%` : 'Tændt') : 'Slukket'}</span>
              {/* Auto is the normal state and gets no tag: only what differs from it is shown.
                  Manual is the hand Heating uses for a manual target, without the word. */}
              {(mode === 'manual' || mode === 'drift') && (
                <span
                  className={cx('hd-tag', 'hd-tag-warn', styles.hand, mode === 'drift' && styles.drift)} role="img"
                  aria-label={LIGHT_MODE_LABEL[mode]} style={al.guess ? { opacity: 0.6 } : undefined}
                >
                  <Hand size={13} strokeWidth={2.4} />
                </span>
              )}
              {mode === 'forced' && <span className="hd-tag hd-tag-accent">{al.st?.profile ? slotName(al.st.profile) : 'Låst'}</span>}
              {idle && <span className="hd-tag">Dæmpet</span>}
            </span>
          </span>
          {canAdjust && <ChevronDown size={17} className={cx(styles.chev, open && styles.chevOpen)} />}
        </button>
      </div>
      {open && canAdjust && (
        <div className={styles.tileSliders}>
          {canDim && (
            <SliderRow
              icon={SunMedium} label={`${device.name} lysstyrke`} value={dim ?? 0}
              track={`linear-gradient(90deg, var(--surface-3), ${color})`}
              onCommit={(v) => onSet({ dim: v, ...(v > 0 ? turnOn : {}) })}
            />
          )}
          {canWarm && (
            <SliderRow
              icon={Thermometer} label={`${device.name} farvetemperatur`} value={c.light_temperature ?? 0}
              track={WARMTH_TRACK} fmt={() => null}
              onCommit={(v) => onSet({ light_temperature: v, ...('light_mode' in c ? { light_mode: 'temperature' } : {}), ...turnOn })}
            />
          )}
          {canColour && (
            <SliderRow
              icon={Palette} label={`${device.name} farve`} value={c.light_hue ?? 0}
              track={HUE_TRACK} fmt={() => null}
              onCommit={(v) => onSet({
                light_hue: v,
                ...('light_saturation' in c ? { light_saturation: c.light_saturation > 0.3 ? c.light_saturation : 1 } : {}),
                ...('light_mode' in c ? { light_mode: 'color' } : {}),
                ...turnOn,
              })}
            />
          )}
        </div>
      )}
    </div>
  );
}
