'use client';

import { useEffect, useRef, useState } from 'react';
import Leaderboard from './Leaderboard';
import styles from './LeaderboardsModal.module.css';

// Header button + modal that shows the leaderboard on demand instead of
// always rendering it under the game. The Leaderboard card mounts only while
// the modal is open, so it fetches fresh data every time it's opened (no
// stale-day or stale-solve list). Modal behavior mirrors RulesModal: Escape
// or overlay click closes, body scroll locks, focus moves into the dialog.
export default function LeaderboardsModal({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" className={styles.button} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Leaderboards
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Leaderboards"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <Leaderboard signedIn={signedIn} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
