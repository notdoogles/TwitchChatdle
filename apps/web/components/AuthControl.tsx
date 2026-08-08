'use client';

import type { SessionUser } from '@/lib/auth';
import styles from './AuthControl.module.css';

// Header control: "Sign in with Twitch" for guests, the player's Twitch
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
      Sign in with Twitch
    </a>
  );
}
