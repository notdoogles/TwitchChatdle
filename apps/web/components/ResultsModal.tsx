'use client';

import { useEffect, useRef } from 'react';
import styles from './GameBoard.module.css';

// Result media may be a still image or a video (.mp4/.webm) -- dropped into
// public/static/winners or public/static/losers alongside images (see the
// matching ALLOWED_EXTENSIONS in lib/resultImages.ts). Used to decide
// whether to render a <video> instead of an <img> below.
const VIDEO_EXTENSIONS = ['.mp4', '.webm'];
function isVideoSrc(src: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => src.toLowerCase().endsWith(ext));
}

interface ResultsModalProps {
  open: boolean;
  status: 'won' | 'lost';
  winnerMessage: string;
  loserMessage: string;
  winnerGif?: string;
  resultImage: string | null;
  shareLabel: string;
  shareClass: string;
  onShare: () => void;
  onClose: () => void;
  onViewAll: () => void;
}

export default function ResultsModal({
  open,
  status,
  winnerMessage,
  loserMessage,
  winnerGif,
  resultImage,
  shareLabel,
  shareClass,
  onShare,
  onClose,
  onViewAll,
}: ResultsModalProps) {
  const modalCloseRef = useRef<HTMLButtonElement>(null);

  // While the results modal is open: lock body scroll, close on Escape, and
  // move focus to its close button for keyboard/screen-reader users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalCloseRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={modalCloseRef}
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label="Close results"
        >
          ×
        </button>

        <div className={`${styles.resultBanner} ${status === 'won' ? styles.win : styles.lose}`}>
          <h2 id="result-heading" className={styles.resultHeading}>
            {status === 'won' ? winnerMessage : loserMessage}
          </h2>
          {status === 'won' && winnerGif && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.resultGif} src={winnerGif} alt="" />
          )}
          {resultImage && isVideoSrc(resultImage) && (
            <video className={styles.resultImage} src={resultImage} autoPlay muted loop playsInline />
          )}
          {resultImage && !isVideoSrc(resultImage) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.resultImage}
              src={resultImage}
              alt={status === 'won' ? 'Winner' : 'Loser'}
            />
          )}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={shareClass} onClick={onShare} aria-live="polite">
            {shareLabel}
          </button>
          <button type="button" className={styles.sendButton} onClick={onViewAll}>
            View all messages
          </button>
        </div>
      </div>
    </div>
  );
}
