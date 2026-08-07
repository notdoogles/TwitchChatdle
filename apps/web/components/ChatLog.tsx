'use client';

import { useEffect, useRef } from 'react';
import styles from './GameBoard.module.css';
import { NONE_LABEL, RoundHint, maskForHint } from '@/lib/hints';
import type { Status } from './roundState';

interface ChatLogProps {
  lines: string[];
  isOver: boolean;
  showAllMessages: boolean;
  easyMode: boolean;
  hints: RoundHint;
  answerHint: RoundHint;
  correctUsername: string | null;
  status: Status;
  errorMsg: string | null;
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

export default function ChatLog({
  lines,
  isOver,
  showAllMessages,
  easyMode,
  hints,
  answerHint,
  correctUsername,
  status,
  errorMsg,
}: ChatLogProps) {
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Keep the newest revealed message in view when the chat log scrolls
  // internally (long messages can overflow its capped height). When the
  // player reveals all messages at the end, jump to the top so they read
  // from #1.
  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = showAllMessages ? 0 : el.scrollHeight;
  }, [lines, showAllMessages]);

  return (
    <div
      className={`${styles.chatLog}${isOver ? '' : ` ${styles.chatLogScroll}`}`}
      ref={chatLogRef}
    >
      {lines.map((text, i) => (
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
                  {/* Hard mode keeps the fixed-length mask even if hints
                      exist; maskForHint({}) yields the default length. */}
                  {maskForHint(easyMode ? hints : {})}
                </span>
              </>
            )}
          </span>
          <span className={styles.message}>{text}</span>
        </div>
      ))}

      {status === 'error' && errorMsg && <div className={`${styles.systemLine} ${styles.lose}`}>{errorMsg}</div>}
    </div>
  );
}
