'use client';

// The app's chrome: the top bar, the navigation and the menu.
// Phones and small tablets get a bottom bar in thumb reach with the main tabs and a Menu
// button; wider screens get the tabs in the top bar and a menu button on the right. The menu
// holds the tabs that are not in the bar, the theme, Refresh and Disconnect.
// tabs: [key, label, Icon, shortLabel?] · primary: the keys that get a place in the bar.

import { useEffect, useState } from 'react';
import {
  ChevronRight, House, LoaderCircle, LogOut, Menu, Monitor, Moon, RefreshCw, Sun, X,
} from 'lucide-react';
import { cx, SPIN } from './ui';
import styles from './AppChrome.module.css';

const THEMES = [
  ['system', 'Auto', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
];

export default function AppChrome({
  tabs, primary, tab, onSelect, dateLabel, timeLabel, signedIn, homeyName, version,
  liveEnabled, live, refreshing, countdown, onRefresh, themePref, onTheme,
}) {
  const [open, setOpen] = useState(false);

  const toItem = ([key, label, Icon, short]) => ({ key, label, Icon, short: short || label });
  const main = primary.map((key) => toItem(tabs.find((t) => t[0] === key)));
  const more = tabs.filter((t) => !primary.includes(t[0])).map(toItem);
  const active = tabs.find((t) => t[0] === tab);
  const activeMore = more.find((t) => t.key === tab);
  const MenuIcon = activeMore ? activeMore.Icon : Menu;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The tabs differ in length, so a new one starts from the top. So does the current one.
  function choose(key) {
    setOpen(false);
    onSelect(key);
    window.scrollTo(0, 0);
  }

  const liveDot = liveEnabled && signedIn && (
    <span
      className={styles.live} data-live={live || undefined}
      title={live ? 'Live — updates stream in from Homey' : 'Connecting to the live stream…'}
    >
      {live ? <span className="hd-live-dot" /> : <LoaderCircle size={13} style={SPIN} />}
      <span className={styles.liveText}>{live ? 'Live' : 'Connecting…'}</span>
    </span>
  );

  return (
    <>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <div className={styles.brand}>
            <span className={styles.mark} aria-hidden="true"><House size={17} strokeWidth={2.3} /></span>
            <div className={styles.titles}>
              <h1 className={styles.title}>
                <span className={styles.titlePage}>{active ? active[1] : '\u00a0'}</span>
                <span className={styles.titleBrand}>Skovgaard</span>
              </h1>
              <div className={styles.sub}>{dateLabel ? <>{dateLabel} · <b>{timeLabel}</b></> : ' '}</div>
            </div>
          </div>

          <nav className={styles.tabs} aria-label="Sections">
            {main.map(({ key, label, Icon }) => (
              <button
                key={key} type="button" onClick={() => choose(key)}
                className={cx(styles.tab, tab === key && styles.tabActive)}
                aria-current={tab === key ? 'page' : undefined}
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </button>
            ))}
          </nav>

          <div className={styles.right}>
            {liveDot}
            <button
              type="button" className={cx('hd-icon-btn', styles.menuBtn)} onClick={() => setOpen((v) => !v)}
              aria-expanded={open} aria-controls="app-menu" aria-label="Menu"
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <nav className={styles.bar} aria-label="Sections">
        {main.map(({ key, short, Icon }) => (
          <button
            key={key} type="button" onClick={() => choose(key)}
            className={cx(styles.barBtn, tab === key && !open && styles.barBtnActive)}
            aria-current={tab === key ? 'page' : undefined}
          >
            <span className={styles.barIcon}><Icon size={20} strokeWidth={2} /></span>
            <span className={styles.barLabel}>{short}</span>
          </button>
        ))}
        <button
          type="button" onClick={() => setOpen((v) => !v)}
          className={cx(styles.barBtn, (activeMore || open) && styles.barBtnActive)}
          aria-expanded={open} aria-controls="app-menu"
        >
          <span className={styles.barIcon}>{open ? <X size={20} strokeWidth={2} /> : <MenuIcon size={20} strokeWidth={2} />}</span>
          <span className={styles.barLabel}>{activeMore && !open ? activeMore.short : 'Menu'}</span>
        </button>
      </nav>

      {open && (
        <>
          <button type="button" className={styles.backdrop} aria-label="Close menu" onClick={() => setOpen(false)} />
          <div id="app-menu" className={styles.sheet} role="dialog" aria-label="Menu">
            <div className={styles.grab} aria-hidden="true" />
            <div className={styles.group}>
              {more.map(({ key, label, Icon }) => (
                <button
                  key={key} type="button" onClick={() => choose(key)}
                  className={cx(styles.row, tab === key && styles.rowActive)}
                  aria-current={tab === key ? 'page' : undefined}
                >
                  <span className={styles.rowIcon}><Icon size={19} strokeWidth={2} /></span>
                  <span className={styles.rowLabel}>{label}</span>
                  <ChevronRight size={17} className={styles.rowChev} />
                </button>
              ))}
            </div>

            <div className={styles.group}>
              <div className={styles.themeRow}>
                <span className={styles.rowLabel}>Theme</span>
                <div className="hd-seg" role="group" aria-label="Theme">
                  {THEMES.map(([key, label, Icon]) => (
                    <button key={key} type="button" aria-pressed={themePref === key} onClick={() => onTheme(key)}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
              </div>
              {signedIn && (
                <button type="button" className={styles.row} onClick={onRefresh} disabled={refreshing}>
                  <span className={styles.rowIcon}><RefreshCw size={19} strokeWidth={2} style={refreshing ? SPIN : undefined} /></span>
                  <span className={styles.rowLabel}>{refreshing ? 'Refreshing…' : 'Refresh now'}</span>
                  <span className={styles.rowNote}>{live ? 'live' : `next in ${countdown}s`}</span>
                </button>
              )}
              {signedIn && (
                <a className={styles.row} href="/api/auth/logout">
                  <span className={styles.rowIcon}><LogOut size={19} strokeWidth={2} /></span>
                  <span className={styles.rowLabel}>Disconnect</span>
                  {homeyName && <span className={styles.rowNote}>{homeyName}</span>}
                </a>
              )}
            </div>

            <div className={styles.foot}>Skovgaard Dashboard · v{version}</div>
          </div>
        </>
      )}
    </>
  );
}
