'use client';

import type { SessionUser } from '@/lib/auth';
import styles from './AuthControl.module.css';

// Header control: a "twitch login" button for guests, the player's Twitch
// display name + sign-out for signed-in users. The session itself lives in
// an httpOnly cookie, so this control needs no client state -- after the
// login/logout redirect the page server component re-resolves the session
// and re-renders with the right side.
export default function AuthControl({ user }: { user: SessionUser | null }) {
  if (user) {
    return (
      <div className={styles.box}>
        <span className={styles.username} title={user.username}>
          {user.username}
        </span>
        <a className={styles.link} href="/api/auth/logout">
          Sign out
        </a>
      </div>
    );
  }
  return (
    <a className={styles.signIn} href="/api/auth/login">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M4.3 1 1.9 6.8v13.6h5.1V24h2.9l2.9-3.6h4.3L22.1 15V1H4.3Zm16 13.1-3.4 3.4h-4.8l-2.9 3v-3H5.7V2.9h14.6v11.2Z m-2.9-8.4h-1.9v6.7h1.9V5.7Zm-5.3 0H10.2v6.7h1.9V5.7Z" />
      </svg>
      twitch login
    </a>
  );
}
