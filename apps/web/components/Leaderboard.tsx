'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './Leaderboard.module.css';

type Period = 'daily' | 'weekly' | 'alltime';

interface LeaderboardEntry {
  rank: number;
  username: string;
  points: number;
  guessesUsed?: number | null;
  isYou: boolean;
}

interface LeaderboardData {
  period: Period;
  gameDate: string;
  entries: LeaderboardEntry[];
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'alltime', label: 'All-time' },
];

// Fetches /api/leaderboard for the selected period. `refreshSignal` (bumped
// by GameBoard when a round ends) triggers a refetch so a fresh solve shows
// up without a page reload. `isYou` highlighting is computed server-side
// from the session cookie, so it just works after a login redirect.
export default function Leaderboard({ signedIn, refreshSignal = 0 }: { signedIn: boolean; refreshSignal?: number }) {
  const [period, setPeriod] = useState<Period>('daily');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (p: Period) => {
    setFailed(false);
    try {
      const res = await fetch(`/api/leaderboard?period=${p}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [load, period, refreshSignal]);

  const emptyText =
    period === 'daily'
      ? 'No solves yet today — be the first!'
      : period === 'weekly'
        ? 'No solves yet this week.'
        : 'No solves recorded yet.';

  return (
    <section className={styles.card} aria-label="Leaderboard">
      <div className={styles.header}>
        <span className={styles.title}>Leaderboard</span>
        <div className={styles.tabs} role="group" aria-label="Leaderboard period">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={period === key ? styles.tabActive : styles.tab}
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className={styles.note}>Couldn&apos;t load the leaderboard.</p>
      ) : !data ? (
        <p className={styles.note}>Loading…</p>
      ) : data.entries.length === 0 ? (
        <p className={styles.note}>{emptyText}</p>
      ) : (
        <ol className={styles.list}>
          {data.entries.map((e) => (
            <li key={e.rank} className={e.isYou ? `${styles.row} ${styles.you}` : styles.row}>
              <span className={styles.rank}>{e.rank}</span>
              <span className={styles.name}>{e.username}</span>
              <span className={styles.score}>
                {period === 'daily' && e.guessesUsed != null
                  ? `${e.guessesUsed} guess${e.guessesUsed === 1 ? '' : 'es'}`
                  : `${e.points} pts`}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className={styles.footer}>
        {signedIn
          ? 'Your row is highlighted. Results are recorded when you finish a round.'
          : 'Sign in with Twitch to appear here.'}
      </p>
    </section>
  );
}
