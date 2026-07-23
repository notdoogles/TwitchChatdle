import { headers } from 'next/headers';
import GameBoard from '@/components/GameBoard';
import ThemeToggle from '@/components/ThemeToggle';
import { getGameName, getImagesSlug, getLoserMessage, getWinnerMessage } from '@/lib/config';
import { getResultImages } from '@/lib/resultImages';
import styles from './page.module.css';

export default function Home() {
  const host = headers().get('host');
  const gameName = getGameName(host);
  const imagesSlug = getImagesSlug(host);
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{gameName}</h1>
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
      />
    </main>
  );
}
