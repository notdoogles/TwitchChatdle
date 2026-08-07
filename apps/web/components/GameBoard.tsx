'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './GameBoard.module.css';
import {
  DEFAULT_GAME_NAME,
  DEFAULT_LOSER_MESSAGE,
  DEFAULT_WINNER_MESSAGE,
  getGameDate,
  getMsUntilNextGameDate,
  slugify,
} from '@/lib/config';
import { SKIPPED_GUESS_LABEL, buildShareText } from '@/lib/shareText';
import type { RoundHint } from '@/lib/hints';
import { applyRoundResult, InitialRound, pickResultImage, RoundState, Status } from './roundState';
import ChatLog from './ChatLog';
import GuessForm from './GuessForm';
import ResultsModal from './ResultsModal';

interface GameBoardProps {
  gameName?: string;
  winnerMessage?: string;
  loserMessage?: string;
  winnerImages?: string[];
  loserImages?: string[];
  // Resolved server-side (app/page.tsx) since RESET_HOUR/RESET_TIMEZONE
  // are plain env vars and unreadable from the client bundle.
  resetHour?: number;
  resetTimezone?: string;
  // Optional extra gif always shown on a win, layered on top of the
  // randomly-picked winnerImages (see getWinnerGif() in lib/config.ts).
  winnerGif?: string;
  // Today's round, resolved server-side (app/page.tsx) so the first paint
  // shows the first message instead of a client round trip + loading state.
  // Null when the server couldn't build one (see initialError).
  initialRound?: InitialRound | null;
  // Server-side failure message (no channel configured, not enough messages
  // yet, DB down). Seeded once into the error state; "Try again" re-runs the
  // client fetch so it can recover without a full page reload.
  initialError?: string | null;
}

interface StoredState {
  gameDate: string;
  roundId: string;
  maxGuesses: number;
  lines: string[];
  guesses: string[];
  status: Status;
  correctUsername: string | null;
  resultImage: string | null;
  allMessages: string[] | null;
  hints: RoundHint;
  // The chatter's full color/badge info once the round ends -- independent
  // of `hints` (which only reflects however many easy-mode hints were
  // unlocked during play) so the final reveal always shows the real
  // chatter's color/badges even after a fast win.
  answerHint: RoundHint;
}

// Key (scoped under storagePrefix, not per-day) for the easy/hard mode
// preference.
const MODE_STORAGE_KEY = 'mode';

// Skipped messages are recorded in the same guesses list (so they consume a
// guess and show up in the round history), but are rendered distinctly from
// real wrong guesses since they're a pass, not a guess. The sentinel label is
// shared with lib/shareText.ts so the share grid matches this UI.
function isSkippedGuess(g: string): boolean {
  return g === SKIPPED_GUESS_LABEL;
}

// Same game-day boundary the server uses to pick the day's answer
// (lib/config.ts getGameDate, configurable via RESET_HOUR/RESET_TIMEZONE)
// -- computed client-side purely to key the localStorage entry, so it
// naturally rolls over at the same moment.
function storageKey(prefix: string, gameDate: string): string {
  return `${prefix}${gameDate}`;
}

function loadStored(prefix: string, gameDate: string): StoredState | null {
  try {
    const raw = localStorage.getItem(storageKey(prefix, gameDate));
    if (!raw) return null;
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

function persist(prefix: string, state: StoredState) {
  try {
    localStorage.setItem(storageKey(prefix, state.gameDate), JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- game still
    // works, it just won't remember today's result across a refresh.
  }
}

// Drops any previous days' saved results so localStorage doesn't grow
// forever with one entry per day this has ever been played.
function cleanupOldEntries(prefix: string, gameDate: string) {
  try {
    const keep = storageKey(prefix, gameDate);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== keep) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Copies `text` to the clipboard, falling back to a hidden-textarea +
// execCommand('copy') where the async Clipboard API is unavailable (older
// browsers, non-secure contexts). Rejects if neither path can copy.
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path (e.g. clipboard-write permission denied).
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('Copy failed.');
}

export default function GameBoard({
  gameName = DEFAULT_GAME_NAME,
  winnerMessage = DEFAULT_WINNER_MESSAGE,
  loserMessage = DEFAULT_LOSER_MESSAGE,
  winnerImages = [],
  loserImages = [],
  resetHour,
  resetTimezone,
  winnerGif,
  initialRound,
  initialError,
}: GameBoardProps) {
  const storagePrefix = `${slugify(gameName)}:`;
  const [status, setStatus] = useState<Status>('loading');
  const [gameDate, setGameDate] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [maxGuesses, setMaxGuesses] = useState(0);
  const [usernameHints, setUsernameHints] = useState<string[]>([]);
  const [correctUsername, setCorrectUsername] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<string[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');
  const [easyMode, setEasyMode] = useState(true);
  const [hints, setHints] = useState<RoundHint>({});
  const [answerHint, setAnswerHint] = useState<RoundHint>({});
  // Feedback for the Share button: 'copied'/'error' are shown on the button
  // label itself and reset back to 'idle' after a couple of seconds.
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle');
  // True while a guess/skip request is in flight: guards against a rapid
  // double-Enter submitting the same guess twice with a stale guessNumber.
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The SSR error is seeded once; "Try again" must fall through to the real
  // client fetch instead of re-showing the same server error forever.
  const initialErrorUsed = useRef(false);

  // Easy/hard mode is a persistent player preference, independent of any
  // single day's round (unlike the rest of localStorage state below, which
  // is keyed per game day). Loaded once on mount. Easy mode is the default
  // for first-time players (no stored preference yet); only an explicit
  // 'hard' choice opts out.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${storagePrefix}${MODE_STORAGE_KEY}`);
      setEasyMode(stored !== 'hard');
    } catch {
      // ignore -- default to easy mode
    }
  }, [storagePrefix]);

  function chooseMode(nextEasy: boolean) {
    setEasyMode(nextEasy);
    try {
      localStorage.setItem(`${storagePrefix}${MODE_STORAGE_KEY}`, nextEasy ? 'easy' : 'hard');
    } catch {
      // ignore -- preference just won't persist across reloads
    }
  }

  // Loads (or resumes) today's round. Runs once per calendar day: the
  // server always returns the same answer for the day, and any saved
  // progress/result for that day is restored from localStorage instead of
  // starting over. When the server component already resolved the round
  // (initialRound), that's used directly and no client fetch happens.
  const loadToday = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    setShareState('idle');
    try {
      const today = getGameDate(new Date(), window.location.hostname, { resetHour, resetTimezone });
      cleanupOldEntries(storagePrefix, today);

      let data: { roundId: string; maxGuesses: number; message: string; usernameHints?: string[] };
      if (initialRound && initialRound.gameDate === today) {
        // Matches what /api/game/new returns, minus guessesRemaining which
        // this code path doesn't use.
        data = initialRound;
      } else if (initialError && !initialErrorUsed.current) {
        initialErrorUsed.current = true;
        setErrorMsg(initialError);
        setStatus('error');
        return;
      } else {
        const res = await fetch('/api/game/new', { method: 'POST' });
        const fetched = await res.json();
        if (!res.ok) throw new Error(fetched.error ?? "Could not load today's round.");
        data = fetched;
      }

      setGameDate(today);
      setRoundId(data.roundId);
      setMaxGuesses(data.maxGuesses);
      setUsernameHints(data.usernameHints ?? []);

      const stored = loadStored(storagePrefix, today);
      if (stored && stored.roundId === data.roundId) {
        setLines(stored.lines);
        setGuesses(stored.guesses);
        setCorrectUsername(stored.correctUsername);
        setHints(stored.hints ?? {});
        setAnswerHint(stored.answerHint ?? {});
        setResultImage(
          stored.resultImage ??
            (stored.status === 'won' ? pickResultImage(winnerImages) : stored.status === 'lost' ? pickResultImage(loserImages) : null)
        );
        setAllMessages(stored.allMessages ?? null);
        setModalOpen(stored.status === 'won' || stored.status === 'lost');
        setShowAllMessages(false);
        setStatus(stored.status);
        if (stored.status === 'playing') {
          requestAnimationFrame(() => inputRef.current?.focus());
        } else if (
          (stored.status === 'won' || stored.status === 'lost') &&
          !stored.allMessages &&
          stored.correctUsername &&
          stored.guesses.length > 0
        ) {
          // A finished round saved without its full message set (e.g.
          // persisted by an older build) would resume with an empty results
          // transcript. Re-grade the already-known correct answer to recover
          // the messages -- the guess endpoint only returns them for a
          // correct guess, so this exposes nothing the player doesn't
          // already have.
          try {
            const recoverRes = await fetch('/api/game/guess', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roundId: data.roundId,
                guess: stored.correctUsername,
                guessNumber: stored.guesses.length - 1,
              }),
            });
            const recovered = await recoverRes.json();
            if (recoverRes.ok && Array.isArray(recovered.allMessages)) {
              setAllMessages(recovered.allMessages);
              const recoveredAnswerHint = recovered.answerHint ?? {};
              setAnswerHint(recoveredAnswerHint);
              persist(storagePrefix, { ...stored, allMessages: recovered.allMessages, answerHint: recoveredAnswerHint });
            }
          } catch {
            // Best-effort recovery -- the transcript falls back to the
            // messages already revealed during play.
          }
        }
      } else {
        const initial: StoredState = {
          gameDate: today,
          roundId: data.roundId,
          maxGuesses: data.maxGuesses,
          lines: [data.message],
          guesses: [],
          status: 'playing',
          correctUsername: null,
          resultImage: null,
          allMessages: null,
          hints: {},
          answerHint: {},
        };
        persist(storagePrefix, initial);
        setLines(initial.lines);
        setGuesses([]);
        setCorrectUsername(null);
        setHints({});
        setAnswerHint({});
        setResultImage(null);
        setAllMessages(null);
        setModalOpen(false);
        setShowAllMessages(false);
        setStatus('playing');
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }, [storagePrefix, winnerImages, loserImages, resetHour, resetTimezone, initialRound, initialError]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // Countdown to the next midnight EST, shown once today's game is over.
  // Background tabs throttle setInterval, so the shown value can go stale;
  // recompute the moment the tab becomes visible again.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return;
    const tick = () => setCountdown(formatCountdown(getMsUntilNextGameDate(new Date(), window.location.hostname, { resetHour, resetTimezone })));
    tick();
    const id = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, resetHour, resetTimezone]);

  // Applies a guess/skip response to local state and persists it. Shared by
  // handleSubmit and handleSkip so the two flows can't drift apart.
  function commitRoundResult(next: RoundState, openModal: boolean) {
    setGuesses(next.guesses);
    setLines(next.lines);
    setStatus(next.status);
    setHints(next.hints);
    setAnswerHint(next.answerHint);
    setCorrectUsername(next.correctUsername);
    setResultImage(next.resultImage);
    setAllMessages(next.allMessages);
    setModalOpen(openModal);
    setShowAllMessages(false);
  }

  async function handleSubmit(guess: string): Promise<boolean> {
    if (!roundId || !gameDate || status !== 'playing' || submitting) return false;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/game/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, guess, guessNumber: guesses.length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not grade that guess.');

      const { state: next, openModal } = applyRoundResult(
        { guesses, lines, status, correctUsername, resultImage, allMessages, hints, answerHint },
        data,
        guess.trim(),
        winnerImages,
        loserImages
      );
      commitRoundResult(next, openModal);
      persist(storagePrefix, { gameDate, roundId, maxGuesses, ...next });
      return true;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // Skips the current message: advances to the next one and consumes a guess,
  // revealing the same easy-mode hint a wrong guess would (see skipMessage in
  // lib/game.ts). Skipping the last message ends the round as a loss, same as
  // running out of guesses.
  async function handleSkip() {
    if (!roundId || !gameDate || status !== 'playing' || submitting) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/game/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, guessNumber: guesses.length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not skip that message.');

      const { state: next, openModal } = applyRoundResult(
        { guesses, lines, status, correctUsername, resultImage, allMessages, hints, answerHint },
        data,
        SKIPPED_GUESS_LABEL,
        winnerImages,
        loserImages
      );
      commitRoundResult(next, openModal);
      persist(storagePrefix, { gameDate, roundId, maxGuesses, ...next });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  // Copies a Wordle-style summary of the finished round (see lib/shareText.ts)
  // to the clipboard; the button label doubles as the success/failure toast.
  async function handleShare() {
    if (!gameDate || (status !== 'won' && status !== 'lost')) return;
    const text = buildShareText({
      gameName,
      gameDate,
      guesses,
      maxGuesses,
      status,
      url: window.location.origin,
    });
    try {
      await copyToClipboard(text);
      setShareState('copied');
    } catch {
      setShareState('error');
    }
    window.setTimeout(() => setShareState('idle'), 2000);
  }

  const guessesRemaining = maxGuesses - guesses.length;
  const isOver = status === 'won' || status === 'lost';
  // Mode is locked once the round has any submitted guesses (or is over) so
  // switching mid-round can't retroactively hide/reveal hints already
  // shown; it unlocks again on the next day's fresh round.
  const modeLocked = guesses.length > 0 || isOver;

  const displayedLines = isOver && showAllMessages && allMessages ? allMessages : lines;
  const shareLabel = shareState === 'copied' ? 'Copied!' : shareState === 'error' ? 'Copy failed' : 'Share';
  const shareClass = shareState === 'copied' ? `${styles.sendButton} ${styles.shareCopied}` : styles.sendButton;
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <>
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.panelTitle}>chat</span>
        <div className={styles.modeGroup} role="group" aria-label="Difficulty">
          {(['hard', 'easy'] as const).map((option) => {
            const active = easyMode === (option === 'easy');
            return (
              <button
                key={option}
                type="button"
                className={active ? styles.modeActive : styles.modeOption}
                onClick={() => chooseMode(option === 'easy')}
                disabled={modeLocked}
                aria-pressed={active}
              >
                {option === 'easy' ? 'Easy' : 'Hard'}
              </button>
            );
          })}
        </div>
      </div>

      <ChatLog
        lines={displayedLines}
        isOver={isOver}
        showAllMessages={showAllMessages}
        easyMode={easyMode}
        hints={hints}
        answerHint={answerHint}
        correctUsername={correctUsername}
        status={status}
        errorMsg={errorMsg}
      />

      {!isOver && (
        <div className={styles.pips} aria-label={`${guessesRemaining} of ${maxGuesses} guesses left`}>
          {Array.from({ length: maxGuesses }).map((_, i) => (
            <span key={i} className={i < guessesRemaining ? styles.pipFull : styles.pipEmpty} />
          ))}
        </div>
      )}

      {status === 'playing' && (
        <GuessForm
          usernameHints={usernameHints}
          submitting={submitting}
          inputRef={inputRef}
          onSubmitGuess={handleSubmit}
          onSkip={handleSkip}
        />
      )}

      {/* Wrong guesses so far, shown live as the player makes them so they
          can see who they've already ruled out -- same list/styling as the
          end-of-round reveal below, just without the correct/incorrect
          styling since a correct guess ends the round immediately (nothing
          in this list, while still playing, can be correct). */}
      {status === 'playing' && guesses.length > 0 && (
        <div className={styles.guessHistory}>
          <ol className={styles.guessList}>
            {guesses.map((g, i) => (
              <li key={i} className={isSkippedGuess(g) ? styles.guessSkipped : styles.guessWrong}>
                {!isSkippedGuess(g) && <span className={styles.guessIcon}>❌</span>}
                {g}
              </li>
            ))}
          </ol>
        </div>
      )}

      {status === 'loading' && <div className={styles.loading}>Loading today&apos;s message…</div>}

      {isOver && (
        <div className={styles.results}>
          <div className={`${styles.systemLine} ${status === 'won' ? styles.win : styles.lose}`}>
            It was <strong>{correctUsername}</strong>.
          </div>

          {!showAllMessages && (
            <button type="button" className={styles.viewResultsButton} onClick={() => setModalOpen(true)}>
              View result
            </button>
          )}

          <ol className={styles.guessList}>
            {guesses.map((g, i) => {
              const isCorrect = correctUsername !== null && g.trim().toLowerCase() === correctUsername.toLowerCase();
              return (
                <li key={i} className={isSkippedGuess(g) ? styles.guessSkipped : isCorrect ? styles.guessCorrect : styles.guessWrong}>
                  {!isSkippedGuess(g) && <span className={styles.guessIcon}>{isCorrect ? '✅' : '❌'}</span>}
                  {g}
                </li>
              );
            })}
          </ol>

          <button type="button" className={shareClass} onClick={handleShare} aria-live="polite">
            {shareLabel}
          </button>

          <div className={styles.countdown}>Next chatter in {countdown}</div>
        </div>
      )}

      {status === 'error' && (
        <button type="button" className={styles.newRoundButton} onClick={loadToday}>
          Try again
        </button>
      )}
    </div>

    {(status === 'won' || status === 'lost') && (
      <ResultsModal
        open={modalOpen}
        status={status}
        winnerMessage={winnerMessage}
        loserMessage={loserMessage}
        winnerGif={winnerGif}
        resultImage={resultImage}
        shareLabel={shareLabel}
        shareClass={shareClass}
        onShare={handleShare}
        onClose={closeModal}
        onViewAll={() => {
          setShowAllMessages(true);
          setModalOpen(false);
        }}
      />
    )}

    </>
  );
}
