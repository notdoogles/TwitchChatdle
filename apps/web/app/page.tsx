import { headers } from 'next/headers';
import GameBoard from '@/components/GameBoard';
import RulesModal from '@/components/RulesModal';
import ThemeToggle from '@/components/ThemeToggle';
import { getChannel, getGameName, getImagesSlug, getLoserMessage, getResetHour, getResetTimezone, getWinnerGif, getWinnerMessage } from '@/lib/config';
import { createRound } from '@/lib/game';
import type { InitialRound } from '@/components/roundState';
import { resolveHost } from '@/lib/previewTenant';
import { getResultImages } from '@/lib/resultImages';
import styles from './page.module.css';

export default async function Home() {
  const host = resolveHost(headers());
  const gameName = getGameName(host);
  const imagesSlug = getImagesSlug(host);
  const channel = getChannel(host);

  // Resolve today's round server-side so the first paint shows the first
  // message instead of a loading spinner + client round trip. The pick is
  // deterministic per (channel, day) and the insert is idempotent, so doing
  // this on every render is safe (a bot/crawler creating the day's round
  // first is harmless -- everyone gets the same pick). Failures (no channel
  // configured, not enough messages yet, DB down) are passed through as
  // initialError so GameBoard can show its usual error state.
  let initialRound: InitialRound | null = null;
  let initialError: string | null = null;
  if (channel) {
    try {
      const round = await createRound(channel, host);
      initialRound = {
        gameDate: round.gameDate,
        roundId: round.roundId,
        maxGuesses: round.maxGuesses,
        message: round.message,
        usernameHints: round.usernameHints,
      };
    } catch (err) {
      initialError = err instanceof Error ? err.message : "Could not load today's round.";
    }
  } else {
    initialError = 'TWITCH_CHANNEL is not configured on the server.';
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{gameName}</h1>
            <RulesModal />
          </div>
          <p className={styles.subtitle}>Five messages. Five guesses. Who said it?</p>
        </div>
        <ThemeToggle />
      </div>
      <GameBoard
        gameName={gameName}
        winnerMessage={getWinnerMessage(host)}
        loserMessage={getLoserMessage(host)}
        winnerImages={getResultImages('winners', imagesSlug)}
        loserImages={getResultImages('losers', imagesSlug)}
        resetHour={getResetHour(host)}
        resetTimezone={getResetTimezone(host)}
        winnerGif={getWinnerGif(host)}
        initialRound={initialRound}
        initialError={initialError}
      />
    </main>
  );
}
