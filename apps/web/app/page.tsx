import GameBoard from '@/components/GameBoard';
import ThemeToggle from '@/components/ThemeToggle';
import { getGameName, getLoserMessage, getWinnerMessage } from '@/lib/config';
import { getResultImages } from '@/lib/resultImages';
import styles from './page.module.css';

export default function Home() {
  const gameName = getGameName();
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
        winnerMessage={getWinnerMessage()}
        loserMessage={getLoserMessage()}
        winnerImages={getResultImages('winners')}
        loserImages={getResultImages('losers')}
      />
    </main>
  );
}
