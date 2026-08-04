'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './RulesModal.module.css';

// Copy for the "How to play" rules modal. Kept here (not in a lib file)
// because it's only ever rendered by this one component.
const HOW_TO_PLAY: string[] = [
  "A wrong guess reveals the next message and, in Easy mode, one extra hint.",
  "Win by guessing the chatter's username before you run out of guesses.",
  'Skip passes on the current message — it costs a guess but reveals the same hint a wrong guess would.',
];

const EASY_MODE_HINTS: string[] = [
  "Round 2: the chatter's global Twitch badge (Prime, Turbo, Partner, Staff, etc.)",
  "Round 3: the chatter's font color",
  "Round 4: the chatter's channel-specific badge (Mod, VIP, Subscriber, Founder, etc.)",
  "Round 5: the chatter's username length",
];

export default function RulesModal() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

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

  return (
    <>
      <button
        type="button"
        className={styles.infoButton}
        onClick={() => setOpen(true)}
        aria-label="Show rules"
        aria-describedby="rules-tooltip"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.5" r="1" fill="currentColor" />
        </svg>
        {/* The hover tooltip lives inside the button so it can be positioned
            relative to the icon without a wrapper element. */}
        <span id="rules-tooltip" className={styles.tooltip} role="tooltip">
          Rules
        </span>
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div
            className={styles.card}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-heading"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={closeRef}
              type="button"
              className={styles.close}
              onClick={() => setOpen(false)}
              aria-label="Close rules"
            >
              ×
            </button>

            <h2 id="rules-heading" className={styles.heading}>
              How to play
            </h2>

            <p className={styles.intro}>
              Each day a single Twitch chatter&apos;s messages are picked. Five messages, five guesses — guess the
              username before you run out.
            </p>

            <ul className={styles.list}>
              {HOW_TO_PLAY.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>

            <h3 className={styles.sectionTitle}>Easy vs. hard mode</h3>
            <p className={styles.intro}>
              Hard mode shows no hints at all — just a masked username. Easy mode adds one extra hint per message,
              building on the last:
            </p>
            <ul className={styles.list}>
              {EASY_MODE_HINTS.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>

            <p className={styles.intro}>A new round starts every day.</p>

            <button type="button" className={styles.gotItButton} onClick={() => setOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
