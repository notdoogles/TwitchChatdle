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
import { filterUsernameSuggestions } from '@/lib/usernameSuggestions';
import { DEFAULT_MASK_LENGTH, NONE_LABEL, RoundHint, maskForHint } from '@/lib/hints';

type Status = 'loading' | 'playing' | 'won' | 'lost' | 'error';

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

// Picks (once) a random image from the given pool, so it stays the same
// for the rest of the day instead of changing on every re-render. Returns
// null if the pool is empty (e.g. no images were dropped into
// public/static/winners or public/static/losers).
function pickResultImage(pool: string[]): string | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Result media may be a still image or a video (.mp4/.webm) -- dropped into
// public/static/winners or public/static/losers alongside images (see the
// matching ALLOWED_EXTENSIONS in lib/resultImages.ts). Used to decide
// whether to render a <video> instead of an <img> below.
const VIDEO_EXTENSIONS = ['.mp4', '.webm'];
function isVideoSrc(src: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => src.toLowerCase().endsWith(ext));
}

// Skipped messages are recorded in the same guesses list (so they consume a
// guess and show up in the round history), but are rendered distinctly from
// real wrong guesses since they're a pass, not a guess.
const SKIPPED_GUESS_LABEL = 'Skipped';
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

// Renders a real Twitch badge image when one was resolved server-side
// (see lib/badgeImages.ts); falls back to the plain text label (e.g. when
// badges.twitch.tv is unreachable, or the badge has no channel/global
// image at all) so the hint is never silently missing.
function BadgePill({ label, iconUrl }: { label: string; iconUrl?: string | null }) {
  if (iconUrl) {
    return <img src={iconUrl} alt={label} title={label} className={styles.badgeIcon} />;
  }
  return <span className={styles.badgePill}>{label}</span>;
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
}: GameBoardProps) {
  const storagePrefix = `${slugify(gameName)}:`;
  const [status, setStatus] = useState<Status>('loading');
  const [gameDate, setGameDate] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [maxGuesses, setMaxGuesses] = useState(0);
  const [usernameHints, setUsernameHints] = useState<string[]>([]);
  const [guessValue, setGuessValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);

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
  // starting over.
  const loadToday = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const today = getGameDate(new Date(), window.location.hostname, { resetHour, resetTimezone });
      cleanupOldEntries(storagePrefix, today);

      const res = await fetch('/api/game/new', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load today's round.");

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
        setGuessValue('');
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
        setGuessValue('');
        setStatus('playing');
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }, [storagePrefix, winnerImages, loserImages, resetHour, resetTimezone]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // Countdown to the next midnight EST, shown once today's game is over.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return;
    const tick = () => setCountdown(formatCountdown(getMsUntilNextGameDate(new Date(), window.location.hostname, { resetHour, resetTimezone })));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, resetHour, resetTimezone]);

  // Keep the newest revealed message in view when the chat log scrolls
  // internally (long messages can overflow its capped height). When the
  // player reveals all messages at the end, jump to the top so they read
  // from #1.
  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = showAllMessages ? 0 : el.scrollHeight;
  }, [lines, showAllMessages, allMessages]);

  // While the results modal is open: lock body scroll, close on Escape, and
  // move focus to its close button for keyboard/screen-reader users.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalCloseRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [modalOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roundId || !gameDate || !guessValue.trim() || status !== 'playing') return;

    const guessNumber = guesses.length;
    try {
      const res = await fetch('/api/game/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, guess: guessValue, guessNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not grade that guess.');

      const newGuesses = [...guesses, guessValue.trim()];
      let newLines = lines;
      let newStatus: Status = 'playing';
      let newCorrectUsername = correctUsername;
      let newResultImage = resultImage;
      let newAllMessages = allMessages;
      let newHints = hints;
      let newAnswerHint = answerHint;

      if (data.correct) {
        newStatus = 'won';
        newCorrectUsername = data.correctUsername ?? null;
        newResultImage = pickResultImage(winnerImages);
        newAllMessages = data.allMessages ?? null;
        newAnswerHint = data.answerHint ?? {};
      } else {
        if (data.nextMessage) newLines = [...lines, data.nextMessage];
        if (data.hint) newHints = { ...hints, ...data.hint };
        if (data.gameOver) {
          newStatus = 'lost';
          newCorrectUsername = data.correctUsername ?? null;
          newResultImage = pickResultImage(loserImages);
          newAllMessages = data.allMessages ?? null;
          newAnswerHint = data.answerHint ?? {};
        }
      }

      setGuesses(newGuesses);
      setLines(newLines);
      setStatus(newStatus);
      setHints(newHints);
      setAnswerHint(newAnswerHint);
      setCorrectUsername(newCorrectUsername);
      setResultImage(newResultImage);
      setAllMessages(newAllMessages);
      setModalOpen(newStatus === 'won' || newStatus === 'lost');
      setShowAllMessages(false);
      setGuessValue('');
      setShowSuggestions(false);
      setActiveSuggestion(-1);

      persist(storagePrefix, {
        gameDate,
        roundId,
        maxGuesses,
        lines: newLines,
        guesses: newGuesses,
        status: newStatus,
        correctUsername: newCorrectUsername,
        resultImage: newResultImage,
        allMessages: newAllMessages,
        hints: newHints,
        answerHint: newAnswerHint,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  // Skips the current message: advances to the next one and consumes a guess,
  // revealing the same easy-mode hint a wrong guess would (see skipMessage in
  // lib/game.ts). Skipping the last message ends the round as a loss, same as
  // running out of guesses.
  async function handleSkip() {
    if (!roundId || !gameDate || status !== 'playing') return;

    const guessNumber = guesses.length;
    try {
      const res = await fetch('/api/game/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, guessNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not skip that message.');

      const newGuesses = [...guesses, SKIPPED_GUESS_LABEL];
      let newLines = lines;
      let newStatus: Status = 'playing';
      let newCorrectUsername = correctUsername;
      let newResultImage = resultImage;
      let newAllMessages = allMessages;
      let newHints = hints;
      let newAnswerHint = answerHint;

      if (data.nextMessage) newLines = [...lines, data.nextMessage];
      if (data.hint) newHints = { ...hints, ...data.hint };
      if (data.gameOver) {
        newStatus = 'lost';
        newCorrectUsername = data.correctUsername ?? null;
        newResultImage = pickResultImage(loserImages);
        newAllMessages = data.allMessages ?? null;
        newAnswerHint = data.answerHint ?? {};
      }

      setGuesses(newGuesses);
      setLines(newLines);
      setStatus(newStatus);
      setHints(newHints);
      setAnswerHint(newAnswerHint);
      setCorrectUsername(newCorrectUsername);
      setResultImage(newResultImage);
      setAllMessages(newAllMessages);
      setModalOpen(newStatus === 'lost');
      setShowAllMessages(false);
      setGuessValue('');
      setShowSuggestions(false);
      setActiveSuggestion(-1);

      persist(storagePrefix, {
        gameDate,
        roundId,
        maxGuesses,
        lines: newLines,
        guesses: newGuesses,
        status: newStatus,
        correctUsername: newCorrectUsername,
        resultImage: newResultImage,
        allMessages: newAllMessages,
        hints: newHints,
        answerHint: newAnswerHint,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  const guessesRemaining = maxGuesses - guesses.length;
  const isOver = status === 'won' || status === 'lost';
  // Mode is locked once the round has any submitted guesses (or is over) so
  // switching mid-round can't retroactively hide/reveal hints already
  // shown; it unlocks again on the next day's fresh round.
  const modeLocked = guesses.length > 0 || isOver;
  const usernameMask = easyMode ? maskForHint(hints) : '?'.repeat(DEFAULT_MASK_LENGTH);

  const suggestions = filterUsernameSuggestions(usernameHints, guessValue);
  const suggestionsOpen = showSuggestions && suggestions.length > 0;

  function selectSuggestion(name: string) {
    setGuessValue(name);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
  }

  function handleGuessKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      // Only intercept Enter when a suggestion is highlighted, otherwise
      // let the form submit the typed guess as-is.
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  }

  const displayedLines = isOver && showAllMessages && allMessages ? allMessages : lines;

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

      <div
        className={`${styles.chatLog}${isOver ? '' : ` ${styles.chatLogScroll}`}`}
        ref={chatLogRef}
      >
        {displayedLines.map((text, i) => (
          <div key={i} className={styles.chatLine}>
            <span className={styles.username}>
              {/* Twitch renders a chatter's badges right-to-left (the
                  highest-priority badge sits closest to the username), so
                  each category's list -- and channel-before-global overall
                  -- is reversed here to match. */}
              {isOver && showAllMessages ? (
                <>
                  {(answerHint.channelBadges ?? [])
                    .slice()
                    .reverse()
                    .map((badge, badgeIndex) => (
                      <BadgePill key={`channel-${badgeIndex}`} label={badge.label} iconUrl={badge.iconUrl} />
                    ))}
                  {(answerHint.globalBadges ?? [])
                    .slice()
                    .reverse()
                    .map((badge, badgeIndex) => (
                      <BadgePill key={`global-${badgeIndex}`} label={badge.label} iconUrl={badge.iconUrl} />
                    ))}
                  <span style={answerHint.color ? { color: answerHint.color } : undefined}>
                    {correctUsername}
                  </span>
                </>
              ) : (
                <>
                  {easyMode && hints.channelBadges !== undefined && hints.channelBadges.length === 0 && (
                    <BadgePill label={NONE_LABEL} />
                  )}
                  {easyMode &&
                    (hints.channelBadges ?? [])
                      .slice()
                      .reverse()
                      .map((badge, badgeIndex) => (
                        <BadgePill key={`channel-${badgeIndex}`} label={badge.label} iconUrl={badge.iconUrl} />
                      ))}
                  {easyMode && hints.globalBadges !== undefined && hints.globalBadges.length === 0 && (
                    <BadgePill label={NONE_LABEL} />
                  )}
                  {easyMode &&
                    (hints.globalBadges ?? [])
                      .slice()
                      .reverse()
                      .map((badge, badgeIndex) => (
                        <BadgePill key={`global-${badgeIndex}`} label={badge.label} iconUrl={badge.iconUrl} />
                      ))}
                  {easyMode && hints.usernameLength !== undefined && (
                    <span className={styles.usernameLength}>({hints.usernameLength}) </span>
                  )}
                  <span
                    className={styles.usernameMask}
                    style={easyMode && hints.color ? { color: hints.color } : undefined}
                  >
                    {usernameMask}
                  </span>
                </>
              )}
            </span>
            <span className={styles.message}>{text}</span>
          </div>
        ))}

        {status === 'error' && errorMsg && <div className={`${styles.systemLine} ${styles.lose}`}>{errorMsg}</div>}
      </div>

      {!isOver && (
        <div className={styles.pips} aria-label={`${guessesRemaining} of ${maxGuesses} guesses left`}>
          {Array.from({ length: maxGuesses }).map((_, i) => (
            <span key={i} className={i < guessesRemaining ? styles.pipFull : styles.pipEmpty} />
          ))}
        </div>
      )}

      {status === 'playing' && (
        <form className={styles.inputRow} onSubmit={handleSubmit}>
          <div className={styles.inputWrap}>
            <input
              ref={inputRef}
              className={styles.input}
              value={guessValue}
              onChange={(e) => {
                setGuessValue(e.target.value);
                setShowSuggestions(true);
                setActiveSuggestion(-1);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              onKeyDown={handleGuessKeyDown}
              placeholder="Guess a username..."
              autoComplete="off"
              role="combobox"
              aria-expanded={suggestionsOpen}
              aria-controls="username-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                activeSuggestion >= 0 ? `username-suggestion-${activeSuggestion}` : undefined
              }
              aria-label="Guess a username"
            />
            {suggestionsOpen && (
              <ul className={styles.suggestions} id="username-suggestions" role="listbox">
                {suggestions.map((name, i) => (
                  <li
                    key={name}
                    id={`username-suggestion-${i}`}
                    role="option"
                    aria-selected={i === activeSuggestion}
                    className={i === activeSuggestion ? styles.suggestionActive : styles.suggestion}
                    // onMouseDown (not onClick) fires before the input's blur,
                    // and preventDefault keeps focus on the input.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(name);
                    }}
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className={styles.skipButton} onClick={handleSkip}>
            Skip
          </button>
          <button type="submit" className={styles.sendButton}>
            Guess
          </button>
        </form>
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

          <div className={styles.countdown}>Next chatter in {countdown}</div>
        </div>
      )}

      {status === 'error' && (
        <button type="button" className={styles.newRoundButton} onClick={loadToday}>
          Try again
        </button>
      )}
    </div>

    {isOver && modalOpen && (
      <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
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
            onClick={() => setModalOpen(false)}
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

          <button
            type="button"
            className={styles.sendButton}
            onClick={() => {
              setShowAllMessages(true);
              setModalOpen(false);
            }}
          >
            View all messages
          </button>
        </div>
      </div>
    )}

    </>
  );
}

