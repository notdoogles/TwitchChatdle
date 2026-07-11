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

type Status = 'loading' | 'playing' | 'won' | 'lost' | 'error';

interface GameBoardProps {
  gameName?: string;
  winnerMessage?: string;
  loserMessage?: string;
  winnerImages?: string[];
  loserImages?: string[];
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
}

// Picks (once) a random image from the given pool, so it stays the same
// for the rest of the day instead of changing on every re-render. Returns
// null if the pool is empty (e.g. no images were dropped into
// public/static/winners or public/static/losers).
function pickResultImage(pool: string[]): string | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
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

export default function GameBoard({
  gameName = DEFAULT_GAME_NAME,
  winnerMessage = DEFAULT_WINNER_MESSAGE,
  loserMessage = DEFAULT_LOSER_MESSAGE,
  winnerImages = [],
  loserImages = [],
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
  const [correctUsername, setCorrectUsername] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<string[] | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Loads (or resumes) today's round. Runs once per calendar day: the
  // server always returns the same answer for the day, and any saved
  // progress/result for that day is restored from localStorage instead of
  // starting over.
  const loadToday = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const today = getGameDate();
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
        setResultImage(
          stored.resultImage ??
            (stored.status === 'won' ? pickResultImage(winnerImages) : stored.status === 'lost' ? pickResultImage(loserImages) : null)
        );
        setAllMessages(stored.allMessages ?? null);
        setShowAllMessages(false);
        setGuessValue('');
        setStatus(stored.status);
        if (stored.status === 'playing') {
          requestAnimationFrame(() => inputRef.current?.focus());
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
        };
        persist(storagePrefix, initial);
        setLines(initial.lines);
        setGuesses([]);
        setCorrectUsername(null);
        setResultImage(null);
        setAllMessages(null);
        setShowAllMessages(false);
        setGuessValue('');
        setStatus('playing');
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }, [storagePrefix, winnerImages, loserImages]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // Countdown to the next midnight EST, shown once today's game is over.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return;
    const tick = () => setCountdown(formatCountdown(getMsUntilNextGameDate()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

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

      if (data.correct) {
        newStatus = 'won';
        newCorrectUsername = data.correctUsername ?? null;
        newResultImage = pickResultImage(winnerImages);
        newAllMessages = data.allMessages ?? null;
      } else {
        if (data.nextMessage) newLines = [...lines, data.nextMessage];
        if (data.gameOver) {
          newStatus = 'lost';
          newCorrectUsername = data.correctUsername ?? null;
          newResultImage = pickResultImage(loserImages);
          newAllMessages = data.allMessages ?? null;
        }
      }

      setGuesses(newGuesses);
      setLines(newLines);
      setStatus(newStatus);
      setCorrectUsername(newCorrectUsername);
      setResultImage(newResultImage);
      setAllMessages(newAllMessages);
      setShowAllMessages(false);
      setGuessValue('');

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
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  const guessesRemaining = maxGuesses - guesses.length;
  const isOver = status === 'won' || status === 'lost';

  const displayedLines = isOver && showAllMessages && allMessages ? allMessages : lines;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.panelTitle}>chat</span>
      </div>

      <div className={styles.chatLog}>
        {displayedLines.map((text, i) => (
          <div key={i} className={styles.chatLine}>
            <span className={styles.username}>{isOver && showAllMessages ? correctUsername : '???'}</span>
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
          <input
            ref={inputRef}
            className={styles.input}
            list="username-hints"
            value={guessValue}
            onChange={(e) => setGuessValue(e.target.value)}
            placeholder="Guess a username..."
            autoComplete="off"
            aria-label="Guess a username"
          />
          <datalist id="username-hints">
            {usernameHints.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="submit" className={styles.sendButton}>
            Guess
          </button>
        </form>
      )}

      {status === 'loading' && <div className={styles.loading}>Loading today's message…</div>}

      {isOver && (
        <div className={styles.results}>
          <div className={`${styles.resultBanner} ${status === 'won' ? styles.win : styles.lose}`}>
            <h2 className={styles.resultHeading}>
              {status === 'won' ? winnerMessage : loserMessage}
            </h2>
            {resultImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.resultImage}
                src={resultImage}
                alt={status === 'won' ? 'Winner' : 'Loser'}
              />
            )}
          </div>

          <div className={`${styles.systemLine} ${status === 'won' ? styles.win : styles.lose}`}>
            It was <strong>{correctUsername}</strong>.
          </div>

          {status === 'won' && allMessages && !showAllMessages && (
            <button type="button" className={styles.showMessagesButton} onClick={() => setShowAllMessages(true)}>
              Show all 5 messages
            </button>
          )}

          <ol className={styles.guessList}>
            {guesses.map((g, i) => {
              const isCorrect = correctUsername !== null && g.trim().toLowerCase() === correctUsername.toLowerCase();
              return (
                <li key={i} className={isCorrect ? styles.guessCorrect : styles.guessWrong}>
                  <span className={styles.guessIcon}>{isCorrect ? '✅' : '❌'}</span>
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
  );
}

