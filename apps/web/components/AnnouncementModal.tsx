'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './AnnouncementModal.module.css';

// Cookie that records the "don't show this again" choice. Kept here (not in a
// lib file) because it's only ever used by this component and by page.tsx,
// which imports the constant to skip rendering the modal on repeat visits.
export const ANNOUNCEMENT_COOKIE = 'chatdle_announcement_dismissed';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// One-time on-load announcement of the Twitch login / leaderboard feature.
// The server decides whether to mount this at all (cookie absent), so repeat
// visitors never see it flash before hydration.
export default function AnnouncementModal() {
  const [open, setOpen] = useState(true);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Keep the cookie in sync with the checkbox: ticking saves the choice so
  // the notice stays hidden no matter how the modal is closed; unticking
  // expires it so the notice comes back.
  function toggleDontShowAgain() {
    setDontShowAgain((prev) => {
      const value = !prev;
      document.cookie = `${ANNOUNCEMENT_COOKIE}=${value ? '1' : ''}; path=/; samesite=lax; max-age=${value ? ONE_YEAR_SECONDS : 0}`;
      return value;
    });
  }

  // While the modal is open: lock body scroll, close on Escape, and move
  // focus to the close button for keyboard/screen-reader users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={() => setOpen(false)}
          aria-label="Close announcement"
        >
          ×
        </button>

        <h2 id="announcement-heading" className={styles.heading}>
          New: Twitch login &amp; leaderboards
        </h2>

        <p className={styles.intro}>
          You can now sign in with Twitch to track your scores on the leaderboard. Signing in
          is completely optional — you only need it if you want to be included on the
          leaderboard.
        </p>

        <p className={styles.intro}>The only information we receive from Twitch is your username.</p>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={dontShowAgain} onChange={toggleDontShowAgain} />
          Don&apos;t show this again
        </label>

        <button type="button" className={styles.gotItButton} onClick={() => setOpen(false)}>
          Got it
        </button>
      </div>
    </div>
  );
}
