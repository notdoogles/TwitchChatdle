'use client';

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type Preference = 'system' | 'light' | 'dark';

function applyTheme(pref: Preference) {
  if (pref === 'system') {
    localStorage.removeItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', systemDark ? 'dark' : 'light');
  } else {
    localStorage.setItem('theme', pref);
    document.documentElement.setAttribute('data-theme', pref);
  }
}

export default function ThemeToggle() {
  const [pref, setPref] = useState<Preference>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    setPref(stored === 'light' || stored === 'dark' ? stored : 'system');

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!localStorage.getItem('theme')) {
        document.documentElement.setAttribute('data-theme', mql.matches ? 'dark' : 'light');
      }
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  function choose(next: Preference) {
    setPref(next);
    applyTheme(next);
  }

  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {(['system', 'light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={pref === option ? styles.active : styles.option}
          onClick={() => choose(option)}
          aria-pressed={pref === option}
        >
          {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}
