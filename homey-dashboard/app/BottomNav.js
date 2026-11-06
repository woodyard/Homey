'use client';

import { useEffect, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import styles from './BottomNav.module.css';

// Phones and small tablets: a fixed bar with the main tabs in thumb reach, and a More button for
// the rest. CSS hides it on wider screens, where the tab row in the header takes over.
// tabs: [key, label, Icon, shortLabel?] · primary: the keys that get a place in the bar.
export default function BottomNav({ tabs, primary, tab, onSelect }) {
  const [open, setOpen] = useState(false);

  const toItem = ([key, label, Icon, short]) => ({ key, label, Icon, short: short || label });
  const main = primary.map((key) => toItem(tabs.find((t) => t[0] === key)));
  const more = tabs.filter((t) => !primary.includes(t[0])).map(toItem);
  const activeMore = more.find((t) => t.key === tab);
  const MoreIcon = activeMore ? activeMore.Icon : Ellipsis;

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

  return (
    <div className={styles.wrap}>
      {open && (
        <>
          <button type="button" className={styles.backdrop} aria-label="Close menu" onClick={() => setOpen(false)} />
          <div id="bottom-nav-more" className={styles.sheet}>
            {more.map(({ key, label, Icon }) => (
              <button
                key={key} type="button" onClick={() => choose(key)}
                className={`${styles.sheetBtn} ${tab === key ? styles.sheetBtnActive : ''}`}
                aria-current={tab === key ? 'page' : undefined}
              >
                <Icon size={20} strokeWidth={2} />
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <nav className={styles.bar} aria-label="Sections">
        {main.map(({ key, short, Icon }) => (
          <button
            key={key} type="button" onClick={() => choose(key)}
            className={`${styles.barBtn} ${tab === key ? styles.barBtnActive : ''}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            <span className={styles.icon}><Icon size={20} strokeWidth={2} /></span>
            <span className={styles.label}>{short}</span>
          </button>
        ))}
        <button
          type="button" onClick={() => setOpen((v) => !v)}
          className={`${styles.barBtn} ${activeMore || open ? styles.barBtnActive : ''}`}
          aria-expanded={open} aria-controls="bottom-nav-more"
          aria-current={activeMore ? 'page' : undefined}
        >
          <span className={styles.icon}><MoreIcon size={20} strokeWidth={2} /></span>
          <span className={styles.label}>{activeMore ? activeMore.short : 'More'}</span>
        </button>
      </nav>
    </div>
  );
}
