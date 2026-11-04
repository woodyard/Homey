// Why is a room heating (or not) right now? One shared explanation for the Heating tab
// and the Rooms 2.0 tab, built from the room's HeatingStatus entry (published by
// room_heating.js on every run) plus the live device state.
//
// Pure and deterministic: the caller passes `now`. Mirrors the order in which the
// script decides (main run → controlHeating):
//   master switch off → override mode (pause/boost/manual) → silent sensor (plug rooms)
//   → TADO away without a minimum → window open past the timeout → window open inside
//   the grace period → settle delay after a long window opening → away minimum
//   → heating / warm enough / idle.
//
// windowOpenSince / windowClosedSince (epoch ms) are newer fields; without them the
// explanation falls back to lastAction + settings and gives no countdown.
//
// When the script runs (the "<room> - Heating" flows): a 5-minute cron, and straight away when
// a window opens or closes. Two countdowns run it again just after the window timeouts: 70 s
// after opening (timeout 60 s) and 1810 s after closing (delay 1800 s). So the switch-off and
// the resume happen on those timers, not on the 5-minute grid; the cron only catches a missed run.
//
// The first run that sees an open window sends no command, and a settle delay sends none
// either, so a headline says "Off" only if the live device state agrees. A room's HeatingStatus
// entry can lag well behind (20 min seen on a healthy system), so the live contact sensors decide
// whether the window is open now, and when it closed.

export const TZ = 'Europe/Copenhagen';
export const SCRIPT_INTERVAL_MIN = 5;   // the room_heating cron
export const STALE_AFTER_MIN = 30;      // entries lagging 20 min are normal, see above
export const MODE_MINUTES = { boost: 60, pause: 60, manual: 90 };
const TIMEOUT_TIMER_MARGIN_S = 10;      // the flow countdowns fire 10 s after the script's timeouts

const MIN = 60000;
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 24h HH:MM in Copenhagen. */
export function hhmm(ms) {
  return clockFmt.format(new Date(ms));
}

const NB = ' '; // keeps "≈ 14:18" and "18 min" together when the text wraps

/** "4 min", "1 h 05 min", "2 h". Rounded up so a countdown never shows 0 while running. */
export function fmtMins(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}${NB}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}${NB}h ${String(r).padStart(2, '0')}${NB}min` : `${h}${NB}h`;
}

const deg = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 10) / 10}°`);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function minsBetween(from, to) {
  return (to - from) / MIN;
}

// "20:00 → 19°C (Evening)" → "20:00 → 19° (Evening)"; anything else passes through.
function shortNextChange(s) {
  if (!s || typeof s !== 'string') return null;
  return s.replace(/°C/g, '°').trim() || null;
}

export const SETTLE_ACTIONS = new Set(['window_closed_waiting', 'window_settle_retry']);
const AWAY_OFF_ACTIONS = new Set(['tado_away_off', 'tado_away_skip']);
const FACTOR_ORDER = { bad: 0, warn: 1, accent: 2 }; // the rest (muted) comes last

const zoneSegments = (d) => (d.zonePath || '').split(' > ');

/**
 * Live window state as the script reads it (isWindowOpen): any contact sensor in the zone or
 * its child zones. null when the room has no contact sensor with a known value.
 */
export function liveWindowOpen(devices, zone) {
  const contacts = (devices || []).filter((d) => (
    typeof (d.capabilities || {}).alarm_contact === 'boolean' && zoneSegments(d).includes(zone)
  ));
  return contacts.length ? contacts.some((d) => d.capabilities.alarm_contact) : null;
}

/**
 * When the last contact sensor in the zone closed (epoch ms). null while one is open, or when
 * the sensors report no time.
 */
export function liveWindowClosedAt(devices, zone) {
  const contacts = (devices || []).filter((d) => (
    typeof (d.capabilities || {}).alarm_contact === 'boolean' && zoneSegments(d).includes(zone)
  ));
  if (!contacts.length || contacts.some((d) => d.capabilities.alarm_contact)) return null;
  const times = contacts
    .map((d) => new Date((d.capTimes || {}).alarm_contact).getTime())
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/** The temperature sensor of a plug room: the first non-thermostat sensor in the zone itself. */
export function heatingRoomSensor(devices, zone) {
  return (devices || []).find((d) => {
    const seg = zoneSegments(d);
    const c = d.capabilities || {};
    return seg[seg.length - 1] === zone && c.measure_temperature != null && c.target_temperature == null;
  }) || null;
}

/** HeatingStatus entry patched for a Boost / Pause / Reset press, until the script publishes. */
export function optimisticMode(entry, actionKey, now) {
  const mode = actionKey === 'boost' || actionKey === 'pause' ? actionKey : 'auto';
  const next = { ...(entry || {}), mode, modeExpires: mode === 'auto' ? null : now + MODE_MINUTES[mode] * MIN };
  // effectiveTarget still holds the pause (0) or boost temperature: not a target to compare with.
  if (mode === 'auto' && num(next.scheduledTarget) != null) next.effectiveTarget = next.scheduledTarget;
  return next;
}

/**
 * @param {object} p
 * @param {object|null} p.sc            HeatingStatus entry for the room (or null)
 * @param {boolean|null} p.heatingEnabled  master switch (HeatingEnabled); null = unknown
 * @param {'tado'|'plug'} p.kind
 * @param {number|null} p.power         tado heating power % (live), null if unknown
 * @param {boolean|null} p.plugOn       any radiator plug on (live), null if unknown
 * @param {number|null} p.temp          room temperature (live), falls back to sc.currentTemp
 * @param {number|null} p.deviceTarget  live tado setpoint (manual mode target)
 * @param {string|null} p.mode          override for sc.mode (optimistic UI), optional
 * @param {number|null} p.modeExpires   override for sc.modeExpires, optional
 * @param {boolean|null} p.liveWindow  live contact sensors (liveWindowOpen), null if unknown
 * @param {number|null} p.liveClosedAt  when the window closed (liveWindowClosedAt), null if unknown
 * @param {number} p.manualMinutes      manual override duration (room config), default 90
 * @param {boolean} p.loading           the first status read has not answered yet
 * @param {number} p.now                epoch ms
 * @returns {{
 *   state: string, tone: string, icon: string, headline: string, detail: string|null,
 *   progress: {from:number,to:number}|null, factors: {key:string,tone:string,icon:string,text:string}[],
 *   tag: {tone:string,icon:string,text:string}|null, heatingOff: boolean, resumeAt: number|null
 * }}
 */
export function explainHeating({
  sc, heatingEnabled, kind = 'tado', power = null, plugOn = null, temp = null, deviceTarget = null,
  liveWindow = null, liveClosedAt = null, mode: modeIn, modeExpires: expiresIn, manualMinutes = MODE_MINUTES.manual,
  loading = false, now,
}) {
  const factors = [];
  let staleTag = null; // shown in the header when nothing else is
  const out = (o) => ({
    detail: null, progress: null, heatingOff: false, resumeAt: null, ...o, tag: staleTag || o.tag,
    factors: factors.slice().sort((a, b) => (FACTOR_ORDER[a.tone] ?? 3) - (FACTOR_ORDER[b.tone] ?? 3)),
  });

  // 1. Master switch: the script returns before doing anything, so the status entry is frozen.
  if (heatingEnabled === false) {
    return out({
      state: 'master_off', tone: 'muted', icon: 'power',
      headline: 'Off — system switched off',
      tag: { tone: 'muted', icon: 'power', text: 'System off' },
      heatingOff: true,
    });
  }

  if (!sc) {
    if (loading) {
      return out({ state: 'loading', tone: 'muted', icon: 'help', headline: 'Checking heating status…' });
    }
    return out({
      state: 'unknown', tone: 'muted', icon: 'help',
      headline: 'State unknown',
      detail: 'No status available for this room right now',
    });
  }

  const settings = sc.settings || {};
  const openTimeoutS = num(settings.windowOpenTimeout);
  const delayS = num(settings.windowClosedDelay);
  const delayMin = delayS != null ? Math.round(delayS / 60) : null;
  const effTarget = num(sc.effectiveTarget);
  const schedTarget = num(sc.scheduledTarget);
  const t = num(temp) != null ? num(temp) : num(sc.currentTemp);
  const action = sc.lastAction || null;
  const mode = modeIn !== undefined ? modeIn : sc.mode;
  const modeExpires = expiresIn !== undefined ? expiresIn : sc.modeExpires;
  const away = !!sc.away;
  const tadoAway = !!sc.tadoAway;
  const openSince = num(sc.windowOpenSince);
  const closedSince = num(sc.windowClosedSince);

  // Live device state wins over the last published "heating" flag.
  const heatingNow = kind === 'tado'
    ? (num(power) != null ? power > 0 : !!sc.heating)
    : (plugOn != null ? !!plugOn : !!sc.heating);

  // ---- secondary factors (computed up front, filtered per primary state) ----
  const updatedAt = num(sc.updatedAt);
  const ageMin = updatedAt != null ? minsBetween(updatedAt, now) : null;
  const stale = ageMin != null && ageMin > STALE_AFTER_MIN;
  if (stale) staleTag = { tone: 'bad', icon: 'alert', text: 'No update' };
  const inOverride = mode && mode !== 'auto';
  const offset = num(settings.inactivityOffset) || 0;

  const addFactor = (f) => factors.push(f);
  const addCommonFactors = (skip = {}) => {
    if (!skip.awayPaused && tadoAway && !away && !inOverride) {
      addFactor({ key: 'away_paused', tone: 'accent', icon: 'footprints', text: 'Away paused — room in use' });
    }
    if (!skip.away && away && !inOverride) {
      // While the window logic keeps the heating off, nothing holds the away temperature yet.
      const word = skip.awayThen ? 'then' : 'holds';
      addFactor({ key: 'away', tone: 'accent', icon: 'away', text: `Away${effTarget != null ? ` · ${word} ${deg(effTarget)}` : ''}` });
    }
    if (!skip.eco && sc.inactive && offset > 0 && !away && !inOverride) {
      addFactor({ key: 'eco', tone: 'muted', icon: 'moon', text: `No activity · −${deg(offset)}` });
    }
    if (!skip.window && (inOverride ? (liveWindow ?? sc.windowOpen) : (sc.windowOpen && liveWindow !== false))) {
      addFactor({ key: 'window', tone: 'warn', icon: 'window', text: inOverride ? `Window open (ignored in ${mode})` : 'Window open' });
    }
    if (!skip.justOpened && !inOverride && !stale && !sc.windowOpen && liveWindow === true) {
      addFactor({ key: 'window_new', tone: 'warn', icon: 'window', text: 'Window just opened · heating reacts shortly' });
    }
    const nc = shortNextChange(sc.nextChange);
    if (!skip.next && nc && !inOverride) {
      addFactor({ key: 'next', tone: 'muted', icon: 'clock', text: `Next ${nc}` });
    }
    if (stale && !skip.stale) {
      addFactor({ key: 'stale', tone: 'bad', icon: 'alert', text: `No update from the heating script for ${fmtMins(ageMin)}` });
    }
  };

  // The script has stopped: do not promise what only its next run can do.
  const scriptSilent = (lastKnown) => {
    addCommonFactors({ window: true, stale: true, awayThen: true });
    return out({
      state: 'stale', tone: 'bad', icon: 'alert',
      headline: `Status unknown — no update for ${fmtMins(ageMin)}`,
      detail: `Last known: ${lastKnown} · no change until the heating script runs again`,
      heatingOff: !heatingNow,
    });
  };

  // 2. Override modes: the script handles them before any window/away logic.
  if (inOverride && (mode === 'pause' || mode === 'boost' || mode === 'manual')) {
    const exp = num(modeExpires);
    const left = exp != null ? minsBetween(now, exp) : null;
    const running = left != null && left > 0;
    const dur = mode === 'manual' ? manualMinutes : MODE_MINUTES[mode];
    const progress = running ? { from: exp - dur * MIN, to: exp } : null;
    const until = running ? ` until ${hhmm(exp)}` : '';
    const leftTxt = running ? `${fmtMins(Math.ceil(left))} left` : 'ending at the next check';
    if (stale && !running) return scriptSilent(mode);
    addCommonFactors();
    const failed = action === `${mode}_error`; // the valve refused the command; the next run tries again
    const failedTxt = `Valve did not respond — retrying · ${leftTxt}`;
    if (mode === 'pause') {
      return out({
        state: 'pause', tone: failed ? 'bad' : 'muted', icon: failed ? 'alert' : 'pause',
        headline: `Paused${until}`,
        detail: failed ? failedTxt : `${heatingNow ? 'Still heating, stops shortly' : 'Heating off'} · ${leftTxt}, then the schedule resumes`,
        progress, heatingOff: !heatingNow,
        tag: { tone: failed ? 'bad' : 'muted', icon: 'pause', text: running ? `Paused ${fmtMins(Math.ceil(left))}` : 'Paused' },
      });
    }
    if (mode === 'boost') {
      return out({
        state: 'boost', tone: failed ? 'bad' : 'heat', icon: failed ? 'alert' : 'flame',
        headline: `Boost${until}`,
        detail: failed ? failedTxt : `${kind === 'plug' ? (heatingNow ? 'Radiators on' : 'Radiators off — at boost temperature') : 'Valve set to 25°'} · ${leftTxt}`,
        progress,
        tag: { tone: failed ? 'bad' : 'heat', icon: 'flame', text: running ? `Boost ${fmtMins(Math.ceil(left))}` : 'Boost' },
      });
    }
    const mt = num(deviceTarget) != null ? num(deviceTarget) : effTarget;
    return out({
      state: 'manual', tone: 'warn', icon: 'hand',
      headline: `Manual ${mt != null ? deg(mt) : ''}${until}`.replace(/\s+/g, ' ').trim(),
      detail: `Set by hand · ${running ? `${leftTxt}, then the schedule takes over` : 'schedule takes over at the next check'}`,
      progress,
      tag: { tone: 'warn', icon: 'hand', text: running ? `Manual ${fmtMins(Math.ceil(left))}` : 'Manual' },
    });
  }

  // 3. Silent temperature sensor (plug rooms): radiators are kept off before any other logic.
  if (action === 'sensor_stale_off') {
    addCommonFactors({ justOpened: true });
    return out({
      state: 'sensor_stale', tone: 'bad', icon: 'alert',
      headline: 'Off — temperature sensor silent',
      detail: 'Radiators stay off until the sensor reports again',
      heatingOff: true,
      tag: { tone: 'bad', icon: 'alert', text: 'Sensor silent' },
    });
  }

  // 4. TADO away with no minimum temperature: heating off, before any window logic.
  if (AWAY_OFF_ACTIONS.has(action) && away) {
    addCommonFactors({ away: true, justOpened: true });
    return out({
      state: 'away_off', tone: 'accent', icon: 'away',
      headline: 'Away — heating off',
      detail: 'Nobody home (TADO) · resumes when someone is home or the room is used',
      heatingOff: true,
      tag: { tone: 'accent', icon: 'away', text: 'Away · off' },
    });
  }

  // 5. The window is closed, but the room's status entry still says open: the closing run has
  // only just started, or its entry has not landed. That run starts the settle delay after an
  // opening past the timeout, so count from the moment the sensor closed.
  const closedUnseen = !!sc.windowOpen && liveWindow === false;
  const closedAt = closedUnseen ? (num(liveClosedAt) != null ? Math.min(num(liveClosedAt), now) : now) : null;
  const settleExpected = closedUnseen && !(openSince != null && openTimeoutS != null
    && (closedAt - openSince) / 1000 < openTimeoutS);
  if (settleExpected) {
    if (stale) return scriptSilent('window open');
    const off = !heatingNow;
    const settledAt = delayS != null ? closedAt + delayS * 1000 : null;
    const left = settledAt != null ? minsBetween(now, settledAt) : null;
    const leftTxt = left != null && left > 0 ? fmtMins(Math.ceil(left)) : null;
    addCommonFactors({ window: true, awayThen: off });
    let headline = 'Window closed — still heating';
    if (off) {
      if (leftTxt) headline = `Off — resumes in ${leftTxt} (≈${NB}${hhmm(settledAt)})`;
      else headline = settledAt != null ? 'Off — resuming at the next check' : 'Off — window just closed';
    }
    let detail = 'Window closed · waiting for the air to settle';
    if (delayMin != null) {
      detail = off
        ? `Window closed · air settles for ${fmtMins(delayMin)}`
        : `Settle delay of ${fmtMins(delayMin)}${leftTxt ? ` · schedule resumes in ${leftTxt}` : ''}`;
    }
    return out({
      state: 'settle_pending', tone: 'warn', icon: 'hourglass',
      headline,
      detail,
      progress: leftTxt ? { from: closedAt, to: settledAt } : null,
      heatingOff: off, resumeAt: off && settledAt != null ? Math.max(settledAt, now) : null,
      tag: { tone: 'warn', icon: 'hourglass', text: leftTxt ? `Waiting ${leftTxt}` : 'Window closed' },
    });
  }

  // 6. Window open.
  if (sc.windowOpen && !closedUnseen) {
    if (stale) return scriptSilent('window open');
    const openMin = openSince != null ? minsBetween(openSince, now) : null;
    // What the last run did, not what the clock says now: nothing is switched off before a
    // run has seen the window open past the timeout. Without the timestamps window_open_skip
    // can mean "first seen, no command yet" too, so only the device state separates them.
    const ranPastTimeout = openSince != null && openTimeoutS != null && updatedAt != null
      ? (updatedAt - openSince) / 1000 >= openTimeoutS
      : action === 'window_timeout_off' || (action === 'window_open_skip' && !heatingNow);
    const resumeTxt = delayMin != null && delayMin > 0
      ? `resumes ${fmtMins(delayMin)} after it closes`
      : 'resumes when it closes';
    const windowTag = { tone: 'warn', icon: 'window', text: 'Window open' };
    if (ranPastTimeout && !heatingNow) {
      addCommonFactors({ window: true, awayThen: true });
      return out({
        state: 'window_off', tone: 'warn', icon: 'window',
        headline: 'Off — window open',
        detail: openMin != null ? `Open ${fmtMins(Math.floor(openMin))} · heating ${resumeTxt}` : `Heating ${resumeTxt}`,
        heatingOff: true,
        tag: windowTag,
      });
    }
    // Inside the grace period the script regulates as usual; the flow's countdown runs it again
    // just after the timeout, and that run switches the heating off.
    const stopAt = openSince != null && openTimeoutS != null
      ? openSince + (openTimeoutS + TIMEOUT_TIMER_MARGIN_S) * 1000 : null;
    const pastStop = ranPastTimeout || (stopAt != null && now >= stopAt);
    const limit = openTimeoutS != null
      ? `open longer than ${openTimeoutS >= 60 ? fmtMins(openTimeoutS / 60) : `${openTimeoutS}${NB}s`}`
      : null;
    addCommonFactors({ window: true });
    if (heatingNow) {
      const how = kind === 'tado'
        ? (num(power) != null ? `Valve at ${Math.round(power)}%` : 'Valve open')
        : 'Radiators on';
      let headline = 'Window open — still heating';
      if (pastStop) headline = 'Window open — heating stops at the next check';
      else if (stopAt != null) headline = `Window open — heating stops ≈${NB}${hhmm(stopAt)}`;
      return out({
        state: 'window_grace', tone: 'warn', icon: 'window',
        headline,
        detail: pastStop
          ? `${how} · heating ${resumeTxt}`
          : `${how} · switches off if ${limit || 'it stays open'}`,
        progress: !pastStop && stopAt != null ? { from: openSince, to: stopAt } : null,
        tag: windowTag,
      });
    }
    const why = t != null && effTarget != null && t >= effTarget - 0.3
      ? `Warm enough, room ${deg(t)}`
      : `${effTarget != null ? `Target ${deg(effTarget)}` : 'Valve idle'}${t != null ? ` · room ${deg(t)}` : ''}`;
    let then = 'stays off if it stays open';
    if (pastStop) then = 'stays off while it is open';
    else if (stopAt != null) then = `off from ≈${NB}${hhmm(stopAt)} if still open`;
    return out({
      state: 'window_grace', tone: 'warn', icon: 'window',
      headline: 'Window open — not heating',
      detail: `${why} · ${then}`,
      tag: windowTag,
    });
  }

  // 7. Settle delay after a long window opening. The script sends no command while it runs,
  // so the heating is off only if a run reached the timeout first.
  if (closedSince != null || SETTLE_ACTIONS.has(action)) {
    if (stale) return scriptSilent('waiting after window closed');
    const off = !heatingNow;
    addCommonFactors({ window: true, awayThen: off });
    const retry = action === 'window_settle_retry';
    const retryHead = off ? 'Off — resume failed, retrying' : 'Resume failed, retrying';
    const retryDetail = `The settle delay is over but the radiators did not respond · retried every ${fmtMins(SCRIPT_INTERVAL_MIN)}`;
    if (closedSince != null && delayS != null) {
      const resumeAt = closedSince + delayS * 1000;
      const left = minsBetween(now, resumeAt);
      if (left > 0) {
        const leftTxt = fmtMins(Math.ceil(left));
        return out({
          state: 'settle', tone: 'warn', icon: 'hourglass',
          headline: off ? `Off — resumes in ${leftTxt} (≈${NB}${hhmm(resumeAt)})` : 'Window closed — still heating',
          detail: off
            ? `Window closed · air settles for ${fmtMins(delayMin)}`
            : `Settle delay · schedule resumes in ${leftTxt} (≈${NB}${hhmm(resumeAt)})`,
          progress: { from: closedSince, to: resumeAt },
          heatingOff: off, resumeAt: off ? resumeAt : null,
          tag: { tone: 'warn', icon: 'hourglass', text: `Waiting ${leftTxt}` },
        });
      }
      let headline = off ? 'Off — resuming at the next check' : 'Window closed — schedule resumes at the next check';
      if (retry) headline = retryHead;
      return out({
        state: 'settle_due', tone: retry ? 'bad' : 'warn', icon: 'hourglass',
        headline,
        detail: retry ? retryDetail : `Air settled at ${hhmm(resumeAt)} · the script checks every ${fmtMins(SCRIPT_INTERVAL_MIN)}`,
        progress: { from: closedSince, to: resumeAt },
        heatingOff: off, resumeAt: off ? now : null,
        tag: { tone: retry ? 'bad' : 'warn', icon: 'hourglass', text: retry ? 'Retrying' : 'Resuming' },
      });
    }
    const upTo = `up to ${delayMin != null ? fmtMins(delayMin) : 'a while'} after the window closed`;
    let headline = off ? 'Off — waiting after window closed' : 'Window closed — still heating';
    if (retry) headline = retryHead;
    return out({
      state: 'settle', tone: retry ? 'bad' : 'warn', icon: 'hourglass',
      headline,
      detail: retry ? retryDetail : `${off ? 'Air settles before heating resumes ·' : 'Settle delay · schedule resumes'} ${upTo}`,
      heatingOff: off,
      tag: { tone: retry ? 'bad' : 'warn', icon: 'hourglass', text: retry ? 'Retrying' : 'Waiting' },
    });
  }

  // 8. Away with a minimum temperature: the target is lowered, heating holds it.
  if (away) {
    addCommonFactors({ away: true });
    const lowered = effTarget != null && schedTarget != null && effTarget < schedTarget - 0.05;
    return out({
      state: 'away', tone: 'accent', icon: 'away',
      headline: heatingNow ? `Away — heating to ${deg(effTarget)}` : `Away — holding ${deg(effTarget)}`,
      detail: `Nobody home (TADO)${lowered ? ` · schedule ${deg(schedTarget)}` : ''}${t != null ? ` · room ${deg(t)}` : ''}`,
      tag: { tone: 'accent', icon: 'away', text: effTarget != null ? `Away ${deg(effTarget)}` : 'Away' },
    });
  }

  addCommonFactors();

  // 9. Heating right now.
  if (heatingNow) {
    const how = kind === 'tado'
      ? (num(power) != null ? `Valve at ${Math.round(power)}%` : 'Valve open')
      : 'Radiators on';
    return out({
      state: 'heating', tone: 'heat', icon: 'flame',
      headline: `Heating to ${deg(effTarget)}`,
      detail: `${how}${t != null ? ` · room ${deg(t)}` : ''}`,
    });
  }

  // 10. Not heating because the room is warm enough (plug hysteresis is ±0.25°).
  if (t != null && effTarget != null && t >= effTarget - 0.3) {
    return out({
      state: 'warm', tone: 'good', icon: 'check',
      headline: `Warm enough — ${deg(t)}`,
      detail: `Target ${deg(effTarget)}${schedTarget != null && Math.abs(schedTarget - effTarget) > 0.05 ? ` (schedule ${deg(schedTarget)})` : ''} · heats again when it drops below`,
    });
  }

  // 11. Below target but not heating: the valve/thermostat decides (or the next run will).
  return out({
    state: 'idle', tone: 'muted', icon: 'idle',
    headline: effTarget != null ? `Not heating — target ${deg(effTarget)}` : 'Not heating',
    detail: kind === 'tado'
      ? `The valve is not calling for heat right now${t != null ? ` · room ${deg(t)}` : ''}`
      : `Radiators switch on at the next check${t != null ? ` · room ${deg(t)}` : ''}`,
  });
}
