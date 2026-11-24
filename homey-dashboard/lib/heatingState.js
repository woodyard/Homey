// Why is a room heating (or not) right now? The explanation the Heating tab shows, built
// from the room's HeatingStatus entry (published by room_heating.js on every run) plus the
// live device state.
//
// Pure and deterministic: the caller passes `now`. Mirrors the order in which the
// script decides (main run → controlHeating):
//   master switch off → override mode (pause/boost/manual) → silent sensor (plug rooms)
//   → TADO away without a minimum → window open past the timeout → window open inside
//   the grace period → settle delay after a long window opening → away minimum
//   → heating (plug rooms in steps: one radiator with a countdown to the next, or all until
//   the target) / warm enough / idle.
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

/** "4 min", "1 t 05 min", "2 t". Rounded up so a countdown never shows 0 while running. */
export function fmtMins(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}${NB}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}${NB}t ${String(r).padStart(2, '0')}${NB}min` : `${h}${NB}t`;
}

const deg = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 10) / 10}°`);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function minsBetween(from, to) {
  return (to - from) / MIN;
}

/** Time left to `to` as a ticking countdown, "6:42" (as on Lys), or "1 t 05 min" from an hour. */
function fmtLeft(now, to) {
  const s = Math.max(0, Math.ceil((to - now) / 1000));
  if (s >= 3600) return fmtMins(Math.ceil(s / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The script's slot and mode names, as the dashboard shows them.
const SLOT_NAMES = { Night: 'Nat', Morning: 'Morgen', Day: 'Dag', Daytime: 'Dag', Evening: 'Aften' };
const MODE_NAMES = { pause: 'pause', boost: 'boost', manual: 'manuelt' };

/** A schedule slot's name in Danish ("Evening" → "Aften"); other names pass through. */
export function slotName(name) {
  return SLOT_NAMES[name] || name;
}

// "20:00 → 19°C (Evening)" → "20:00 → 19° (Aften)"; anything else passes through.
function shortNextChange(s) {
  if (!s || typeof s !== 'string') return null;
  return s.replace(/°C/g, '°').replace(/\(([^)]+)\)/g, (m, name) => `(${slotName(name)})`).trim() || null;
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
 * @param {number|null} p.plugsOn       how many radiator plugs are on (live), null if unknown
 * @param {number|null} p.plugCount     how many radiator plugs the room has
 * @param {number|null} p.escalateAfter staging: minutes the primary runs alone below the range
 *   before all radiators join (room config), for the countdown bar
 * @param {number|null} p.temp          room temperature (live), falls back to sc.currentTemp
 * @param {number|null} p.deviceTarget  manual mode target: live tado setpoint, or a plug room's chosen target
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
  sc, heatingEnabled, kind = 'tado', power = null, plugOn = null, plugsOn = null, plugCount = null, escalateAfter = null,
  temp = null, deviceTarget = null,
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
      headline: 'Slukket — anlægget er slukket',
      tag: { tone: 'muted', icon: 'power', text: 'Anlæg slukket' },
      heatingOff: true,
    });
  }

  if (!sc) {
    if (loading) {
      return out({ state: 'loading', tone: 'muted', icon: 'help', headline: 'Henter varmestatus…' });
    }
    return out({
      state: 'unknown', tone: 'muted', icon: 'help',
      headline: 'Ukendt tilstand',
      detail: 'Ingen status for rummet lige nu',
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
  if (stale) staleTag = { tone: 'bad', icon: 'alert', text: 'Ingen opdatering' };
  const inOverride = mode && mode !== 'auto';
  const offset = num(settings.inactivityOffset) || 0;

  const addFactor = (f) => factors.push(f);
  const addCommonFactors = (skip = {}) => {
    if (!skip.awayPaused && tadoAway && !away && !inOverride) {
      addFactor({ key: 'away_paused', tone: 'accent', icon: 'footprints', text: 'Ude sat på pause — rummet er i brug' });
    }
    if (!skip.away && away && !inOverride) {
      // While the window logic keeps the heating off, nothing holds the away temperature yet.
      const word = skip.awayThen ? 'derefter' : 'holder';
      addFactor({ key: 'away', tone: 'accent', icon: 'away', text: `Ude${effTarget != null ? ` · ${word} ${deg(effTarget)}` : ''}` });
    }
    if (!skip.eco && sc.inactive && offset > 0 && !away && !inOverride) {
      addFactor({ key: 'eco', tone: 'muted', icon: 'moon', text: `Ingen aktivitet · −${deg(offset)}` });
    }
    if (!skip.window && (inOverride ? (liveWindow ?? sc.windowOpen) : (sc.windowOpen && liveWindow !== false))) {
      // A plug room's manual target keeps the radiators off with the window open; the rest ignore it.
      const windowText = !inOverride ? 'Vindue åbent'
        : kind === 'plug' && mode === 'manual' ? 'Vindue åbent · radiatorer slukket'
          : `Vindue åbent (ignoreres under ${MODE_NAMES[mode] || mode})`;
      addFactor({ key: 'window', tone: 'warn', icon: 'window', text: windowText });
    }
    if (!skip.justOpened && !inOverride && !stale && !sc.windowOpen && liveWindow === true) {
      addFactor({ key: 'window_new', tone: 'warn', icon: 'window', text: 'Vindue lige åbnet · varmen reagerer om lidt' });
    }
    const nc = shortNextChange(sc.nextChange);
    if (!skip.next && nc && !inOverride) {
      addFactor({ key: 'next', tone: 'muted', icon: 'clock', text: `Næste ${nc}` });
    }
    if (stale && !skip.stale) {
      addFactor({ key: 'stale', tone: 'bad', icon: 'alert', text: `Ingen opdatering fra varmestyringen i ${fmtMins(ageMin)}` });
    }
  };

  // The script has stopped: do not promise what only its next run can do.
  const scriptSilent = (lastKnown) => {
    addCommonFactors({ window: true, stale: true, awayThen: true });
    return out({
      state: 'stale', tone: 'bad', icon: 'alert',
      headline: `Ukendt status — ingen opdatering i ${fmtMins(ageMin)}`,
      detail: `Sidst kendt: ${lastKnown} · ingen ændring, før varmestyringen melder sig igen`,
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
    const until = running ? ` til ${hhmm(exp)}` : '';
    // The headline carries the end time and the bar the time left: the detail says what follows.
    const after = running ? 'Derefter følges tidsplanen igen' : 'Slutter ved næste tjek';
    if (stale && !running) return scriptSilent(MODE_NAMES[mode] || mode);
    addCommonFactors();
    const failed = action === `${mode}_error`; // the valve refused the command; the next run tries again
    const failedTxt = 'Ventilen svarede ikke — prøver igen';
    if (mode === 'pause') {
      return out({
        state: 'pause', tone: failed ? 'bad' : 'muted', icon: failed ? 'alert' : 'pause',
        headline: `Pause${until}`,
        detail: failed ? failedTxt : `${heatingNow ? 'Varmer stadig, stopper om lidt · ' : ''}${heatingNow ? after.toLowerCase() : after}`,
        progress, heatingOff: !heatingNow,
        tag: { tone: failed ? 'bad' : 'muted', icon: 'pause', text: running ? `Pause ${fmtMins(Math.ceil(left))}` : 'Pause' },
      });
    }
    if (mode === 'boost') {
      return out({
        state: 'boost', tone: failed ? 'bad' : 'heat', icon: failed ? 'alert' : 'flame',
        headline: `Boost${until}`,
        detail: failed ? failedTxt
          : kind === 'plug' && !heatingNow ? `Radiatorer slukket — boost-temperaturen er nået · ${after.toLowerCase()}` : after,
        progress,
        tag: { tone: failed ? 'bad' : 'heat', icon: 'flame', text: running ? `Boost ${fmtMins(Math.ceil(left))}` : 'Boost' },
      });
    }
    const mt = num(deviceTarget) != null ? num(deviceTarget) : effTarget;
    return out({
      state: 'manual', tone: 'warn', icon: 'hand',
      headline: `Manuelt ${mt != null ? deg(mt) : ''}${until}`.replace(/\s+/g, ' ').trim(),
      detail: running ? 'Derefter tager tidsplanen over' : 'Tidsplanen tager over ved næste tjek',
      progress,
      tag: { tone: 'warn', icon: 'hand', text: running ? `Manuelt ${fmtMins(Math.ceil(left))}` : 'Manuelt' },
    });
  }

  // 3. Silent temperature sensor (plug rooms): radiators are kept off before any other logic.
  if (action === 'sensor_stale_off') {
    addCommonFactors({ justOpened: true });
    return out({
      state: 'sensor_stale', tone: 'bad', icon: 'alert',
      headline: 'Slukket — temperaturføleren er tavs',
      detail: 'Radiatorerne er slukket, til føleren melder igen',
      heatingOff: true,
      tag: { tone: 'bad', icon: 'alert', text: 'Føler tavs' },
    });
  }

  // 4. TADO away with no minimum temperature: heating off, before any window logic.
  if (AWAY_OFF_ACTIONS.has(action) && away) {
    addCommonFactors({ away: true, justOpened: true });
    return out({
      state: 'away_off', tone: 'accent', icon: 'away',
      headline: 'Ude — varmen er slukket',
      detail: 'Ingen hjemme (TADO) · starter igen, når nogen er hjemme, eller rummet bruges',
      heatingOff: true,
      tag: { tone: 'accent', icon: 'away', text: 'Ude · slukket' },
    });
  }

  // 5. The window is closed, but the room's status entry still says open: the closing run has
  // only just started, or its entry has not landed. That run starts the settle delay after an
  // opening past the timeout, so count from the moment the sensor closed.
  const closedUnseen = !!sc.windowOpen && liveWindow === false;
  const closedKnown = closedUnseen && num(liveClosedAt) != null; // else no countdown: it would sit still
  const closedAt = closedUnseen ? (closedKnown ? Math.min(num(liveClosedAt), now) : now) : null;
  const settleExpected = closedUnseen && !(openSince != null && openTimeoutS != null
    && (closedAt - openSince) / 1000 < openTimeoutS);
  if (settleExpected) {
    if (stale) return scriptSilent('vindue åbent');
    const off = !heatingNow;
    const settledAt = delayS != null ? closedAt + delayS * 1000 : null;
    const left = settledAt != null ? minsBetween(now, settledAt) : null;
    const leftTxt = closedKnown && left != null && left > 0 ? fmtLeft(now, settledAt) : null;
    addCommonFactors({ window: true, awayThen: off });
    let headline = 'Vindue lukket — varmer stadig';
    if (off) {
      if (leftTxt) headline = `Slukket — starter om ${leftTxt} (≈${NB}${hhmm(settledAt)})`;
      else headline = closedKnown && settledAt != null ? 'Slukket — starter ved næste tjek' : 'Slukket — vinduet er lige lukket';
    }
    const closedTxt = closedKnown ? `Vindue lukket kl.${NB}${hhmm(closedAt)}` : 'Vindue lukket';
    let detail = `${closedTxt} · venter, så luften kan falde til ro`;
    if (delayMin != null) {
      detail = off
        ? `${closedTxt} · venter ${fmtMins(delayMin)}, så luften kan falde til ro`
        : `Ventetid på ${fmtMins(delayMin)}${leftTxt ? ` · tidsplanen følges igen om ${leftTxt}` : ''}`;
    }
    return out({
      state: 'settle_pending', tone: 'warn', icon: 'hourglass',
      headline,
      detail,
      progress: leftTxt ? { from: closedAt, to: settledAt } : null,
      heatingOff: off, resumeAt: off && settledAt != null ? Math.max(settledAt, now) : null,
      tag: { tone: 'warn', icon: 'hourglass', text: leftTxt ? `Venter ${leftTxt}` : 'Vindue lukket' },
    });
  }

  // 6. Window open.
  if (sc.windowOpen && !closedUnseen) {
    if (stale) return scriptSilent('vindue åbent');
    const openMin = openSince != null ? minsBetween(openSince, now) : null;
    // What the last run did, not what the clock says now: nothing is switched off before a
    // run has seen the window open past the timeout. Without the timestamps window_open_skip
    // can mean "first seen, no command yet" too, so only the device state separates them.
    const ranPastTimeout = openSince != null && openTimeoutS != null && updatedAt != null
      ? (updatedAt - openSince) / 1000 >= openTimeoutS
      : action === 'window_timeout_off' || (action === 'window_open_skip' && !heatingNow);
    const resumeTxt = delayMin != null && delayMin > 0
      ? `starter igen ${fmtMins(delayMin)} efter, at det er lukket`
      : 'starter igen, når det lukkes';
    const windowTag = { tone: 'warn', icon: 'window', text: 'Vindue åbent' };
    if (ranPastTimeout && !heatingNow) {
      addCommonFactors({ window: true, awayThen: true });
      return out({
        state: 'window_off', tone: 'warn', icon: 'window',
        headline: 'Slukket — vindue åbent',
        detail: openMin != null ? `Åbent i ${fmtMins(Math.floor(openMin))} · varmen ${resumeTxt}` : `Varmen ${resumeTxt}`,
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
      ? `det er åbent længere end ${openTimeoutS >= 60 ? fmtMins(openTimeoutS / 60) : `${openTimeoutS}${NB}s`}`
      : null;
    addCommonFactors({ window: true });
    if (heatingNow) {
      let headline = 'Vindue åbent — varmer stadig';
      if (pastStop) headline = 'Vindue åbent — varmen stopper ved næste tjek';
      else if (stopAt != null) headline = `Vindue åbent — varmen stopper ≈${NB}${hhmm(stopAt)}`;
      return out({
        state: 'window_grace', tone: 'warn', icon: 'window',
        headline,
        detail: pastStop
          ? `Varmen ${resumeTxt}`
          : `Slukker, hvis ${limit || 'det bliver stående åbent'}`,
        progress: !pastStop && stopAt != null ? { from: openSince, to: stopAt } : null,
        tag: windowTag,
      });
    }
    let then = 'Forbliver slukket, hvis det står åbent';
    if (pastStop) then = 'Forbliver slukket, så længe det er åbent';
    else if (stopAt != null) then = `Slukket fra ≈${NB}${hhmm(stopAt)}, hvis det stadig er åbent`;
    return out({
      state: 'window_grace', tone: 'warn', icon: 'window',
      headline: 'Vindue åbent — varmer ikke',
      detail: then,
      tag: windowTag,
    });
  }

  // 7. Settle delay after a long window opening. The script sends no command while it runs,
  // so the heating is off only if a run reached the timeout first.
  if (closedSince != null || SETTLE_ACTIONS.has(action)) {
    if (stale) return scriptSilent('venter efter vindue lukket');
    const off = !heatingNow;
    addCommonFactors({ window: true, awayThen: off });
    const retry = action === 'window_settle_retry';
    const retryHead = off ? 'Slukket — genstart mislykkedes, prøver igen' : 'Genstart mislykkedes, prøver igen';
    const retryDetail = `Ventetiden er slut, men radiatorerne svarede ikke · prøver igen med ${fmtMins(SCRIPT_INTERVAL_MIN)} mellemrum`;
    if (closedSince != null && delayS != null) {
      const resumeAt = closedSince + delayS * 1000;
      const left = minsBetween(now, resumeAt);
      if (left > 0) {
        const leftTxt = fmtLeft(now, resumeAt);
        return out({
          state: 'settle', tone: 'warn', icon: 'hourglass',
          headline: off ? `Slukket — starter om ${leftTxt} (≈${NB}${hhmm(resumeAt)})` : 'Vindue lukket — varmer stadig',
          detail: off
            ? `Vindue lukket kl.${NB}${hhmm(closedSince)} · venter ${fmtMins(delayMin)}, så luften kan falde til ro`
            : `Ventetid · tidsplanen følges igen om ${leftTxt} (≈${NB}${hhmm(resumeAt)})`,
          progress: { from: closedSince, to: resumeAt },
          heatingOff: off, resumeAt: off ? resumeAt : null,
          tag: { tone: 'warn', icon: 'hourglass', text: `Venter ${leftTxt}` },
        });
      }
      let headline = off ? 'Slukket — starter ved næste tjek' : 'Vindue lukket — tidsplanen følges igen ved næste tjek';
      if (retry) headline = retryHead;
      return out({
        state: 'settle_due', tone: retry ? 'bad' : 'warn', icon: 'hourglass',
        headline,
        detail: retry ? retryDetail : `Luften faldt til ro kl.${NB}${hhmm(resumeAt)} · varmen starter inden for ${fmtMins(SCRIPT_INTERVAL_MIN)}`,
        progress: { from: closedSince, to: resumeAt },
        heatingOff: off, resumeAt: off ? now : null,
        tag: { tone: retry ? 'bad' : 'warn', icon: 'hourglass', text: retry ? 'Prøver igen' : 'Starter' },
      });
    }
    const upTo = `op til ${delayMin != null ? fmtMins(delayMin) : 'et stykke tid'} efter, at vinduet blev lukket`;
    let headline = off ? 'Slukket — venter efter vindue lukket' : 'Vindue lukket — varmer stadig';
    if (retry) headline = retryHead;
    return out({
      state: 'settle', tone: retry ? 'bad' : 'warn', icon: 'hourglass',
      headline,
      detail: retry ? retryDetail : `${off ? 'Luften falder til ro, før varmen starter ·' : 'Ventetid · tidsplanen følges igen'} ${upTo}`,
      heatingOff: off,
      tag: { tone: retry ? 'bad' : 'warn', icon: 'hourglass', text: retry ? 'Prøver igen' : 'Venter' },
    });
  }

  // 8. Away with a minimum temperature: the target is lowered, heating holds it.
  if (away) {
    addCommonFactors({ away: true });
    return out({
      state: 'away', tone: 'accent', icon: 'away',
      headline: heatingNow ? `Ude — varmer til ${deg(effTarget)}` : `Ude — holder ${deg(effTarget)}`,
      detail: 'Ingen hjemme (TADO)',
      tag: { tone: 'accent', icon: 'away', text: effTarget != null ? `Ude ${deg(effTarget)}` : 'Ude' },
    });
  }

  addCommonFactors();

  // 9. Heating right now.
  if (heatingNow) {
    // Plug rooms in steps (staging): one radiator near the target, the other joins when the
    // first alone stays below the range (radiators.escalateAt) and then runs to the target.
    const rad = kind === 'plug' ? (sc.radiators || null) : null;
    const total = num(plugCount) != null ? plugCount : num(rad?.total);
    const on = num(plugsOn) != null ? plugsOn : num(rad?.on);
    const partial = total > 1 && on != null && on > 0 && on < total;
    const allTxt = total === 2 ? 'begge radiatorer' : `alle ${total} radiatorer`;
    if (rad?.primary && total > 1) {
      const escAt = num(rad.escalateAt);
      // The script's lower hysteresis edge (±0.25°), shown with both decimals: 21.75°, not 21.8°
      const lowEdge = effTarget != null ? Math.round((effTarget - 0.25) * 100) / 100 : null;
      if (partial && escAt != null && escAt > now) {
        const from = num(escalateAfter) != null ? escAt - escalateAfter * MIN : null;
        const leftTxt = fmtLeft(now, escAt);
        return out({
          state: 'heating_stage_wait', tone: 'heat', icon: 'flame',
          headline: `Varmer til ${deg(effTarget)} — ${on} af ${total} radiatorer`,
          detail: `Den anden tænder om ${leftTxt} (≈${NB}${hhmm(escAt)})${lowEdge != null ? `, hvis rummet stadig er under ${lowEdge}°` : ''}`,
          progress: from != null && from < escAt ? { from, to: escAt } : null,
        });
      }
      if (partial && escAt != null && t != null && lowEdge != null && t < lowEdge) {
        return out({
          state: 'heating_stage_wait', tone: 'heat', icon: 'flame',
          headline: `Varmer til ${deg(effTarget)} — ${on} af ${total} radiatorer`,
          detail: `Den anden tænder ved næste tjek · rummet ${deg(t)} er under ${lowEdge}°`,
        });
      }
      if (rad.boosted && on === total) {
        return out({
          state: 'heating_stage_boost', tone: 'heat', icon: 'flame',
          headline: `Varmer til ${deg(effTarget)} — ${allTxt}`,
          detail: `Én radiator alene nåede ikke op · den anden slukker ved ${deg(effTarget)}`,
        });
      }
    }
    let how;
    if (kind === 'tado') how = num(power) != null ? `Ventil på ${Math.round(power)}%` : 'Ventil åben';
    else if (partial) how = `${on} af ${total} radiatorer tændt`;
    else if (total > 1 && on === total) how = `${allTxt[0].toUpperCase()}${allTxt.slice(1)} tændt`;
    else how = 'Radiatorer tændt';
    return out({
      state: 'heating', tone: 'heat', icon: 'flame',
      headline: `Varmer til ${deg(effTarget)}`,
      detail: `${how}${t != null ? ` · rummet ${deg(t)}` : ''}`,
    });
  }

  // 10. Not heating because the room is warm enough (plug hysteresis is ±0.25°).
  if (t != null && effTarget != null && t >= effTarget - 0.3) {
    return out({
      state: 'warm', tone: 'good', icon: 'check',
      headline: `Varmt nok — ${deg(t)}`,
      detail: `Mål ${deg(effTarget)}${schedTarget != null && Math.abs(schedTarget - effTarget) > 0.05 ? ` (tidsplan ${deg(schedTarget)})` : ''} · varmer igen, når det falder under`,
    });
  }

  // 11. Below target but not heating: the valve/thermostat decides (or the next run will).
  return out({
    state: 'idle', tone: 'muted', icon: 'idle',
    headline: 'Varmer ikke',
    detail: kind === 'tado' ? 'Ventilen kalder ikke på varme lige nu' : 'Radiatorerne tænder ved næste tjek',
  });
}
