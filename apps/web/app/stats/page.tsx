import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getChannel, getGameName } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';
import { getCachedChannelStats, type ChannelStats } from '@/lib/stats';
import styles from './stats.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const gameName = getGameName(resolveHost(headers()));
  return { title: `${gameName} stats` };
}

// All-time chat stats for the channel, served from the channel_stats
// snapshot table (recomputed nightly by the /api/cron/daily maintenance
// cron; recomputed lazily on first read when no snapshot exists yet) so a
// visit doesn't re-run six full-table aggregation queries over the ingest
// DB. Everything is per tenant: the hostname picks the channel and database,
// same as the game.
export default async function StatsPage() {
  const host = resolveHost(headers());
  const channel = getChannel(host);
  const gameName = getGameName(host);

  let stats: ChannelStats | null = null;
  let error: string | null = null;
  if (channel) {
    try {
      stats = await getCachedChannelStats(channel, host);
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't load chat stats.";
    }
  } else {
    error = 'TWITCH_CHANNEL is not configured on the server.';
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link className={styles.backLink} href="/">
          ← {gameName}
        </Link>
        <h1 className={styles.title}>Chat stats</h1>
      </header>

      {error ? (
        <div className={styles.error}>
          <p>{error}</p>
          <Link className={styles.backLink} href="/">
            ← Back to the game
          </Link>
        </div>
      ) : stats ? (
        <>
          <section className={styles.overview} aria-label="Overview">
            <div className={styles.overviewItem}>
              <span className={styles.overviewValue}>{stats.overview.totalMessages.toLocaleString()}</span>
              <span className={styles.overviewLabel}>messages logged</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewValue}>{stats.overview.totalChatters.toLocaleString()}</span>
              <span className={styles.overviewLabel}>chatters</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewValue}>{stats.overview.totalEmoteUses.toLocaleString()}</span>
              <span className={styles.overviewLabel}>emotes used</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewValue}>{formatDate(stats.overview.firstMessageAt) ?? '—'}</span>
              <span className={styles.overviewLabel}>first message</span>
            </div>
          </section>

          <div className={styles.grid}>
            <RankedList
              title="Top chatters"
              items={stats.topChatters.map((c) => ({
                label: c.username,
                color: c.color ?? undefined,
                value: c.messageCount,
                valueText: pluralize(c.messageCount, 'message'),
              }))}
            />
            <RankedList
              title="Name colors"
              items={stats.topColors.map((c) => ({
                label: c.label,
                value: c.count,
                valueText: pluralize(c.count, 'chatter'),
                swatch: c.hex,
              }))}
            />
            <BadgeList title="Channel badges" badges={stats.topChannelBadges} />
            <BadgeList title="Global badges" badges={stats.topGlobalBadges} />
            <EmoteList title="Top emotes" stats={stats} />
            <WordCloud words={stats.wordCloud} />
          </div>
        </>
      ) : null}
    </main>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

// Shared ranked list card (chatters, colors). Items can carry an optional
// color swatch (before the label) and/or a font color for the label itself
// -- chatters render their name in their actual chat name color.
function RankedList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; valueText: string; swatch?: string; color?: string }[];
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing here yet.</p>
      ) : (
        <ol className={styles.list}>
          {items.map((item, i) => (
            <li key={item.label} className={styles.row}>
              <span className={styles.rank}>{i + 1}</span>
              {item.swatch && (
                <span className={styles.swatch} style={{ background: item.swatch }} aria-hidden="true" />
              )}
              <span className={styles.name} style={item.color ? { color: item.color } : undefined}>
                {item.label}
              </span>
              <span className={styles.value}>{item.valueText}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Badges are shown as their actual badge images (resolved from Twitch's
// Helix badge data by lib/badgeImages.ts), with the count beside each one.
// When no image could be resolved (e.g. no Twitch credentials configured)
// the row falls back to the badge's text label, same as the game's hints.
function BadgeList({ title, badges }: { title: string; badges: ChannelStats['topChannelBadges'] }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {badges.length === 0 ? (
        <p className={styles.empty}>Nothing here yet.</p>
      ) : (
        <ol className={styles.iconList}>
          {badges.map((badge, i) => (
            <li key={`${badge.slug}:${badge.version}`} className={styles.iconItem}>
              <span className={styles.rank}>{i + 1}</span>
              {badge.imageUrl ? (
                <img
                  className={styles.iconImg}
                  src={badge.imageUrl}
                  alt={badge.label}
                  title={`${badge.label} · ${pluralize(badge.count, 'chatter')}`}
                  loading="lazy"
                />
              ) : (
                <span className={styles.iconFallback}>{badge.label}</span>
              )}
              <span className={styles.value}>{pluralize(badge.count, 'chatter')}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Emotes are ranked by how often each one was posted, rendered from Twitch's
// public emoticon CDN by id (the code is the alt text / fallback).
function EmoteList({ title, stats }: { title: string; stats: ChannelStats }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {stats.topEmotes.length === 0 ? (
        <p className={styles.empty}>No emotes logged yet.</p>
      ) : (
        <ul className={styles.iconList}>
          {stats.topEmotes.map((emote, i) => (
            <li key={emote.id} className={styles.iconItem}>
              <span className={styles.rank}>{i + 1}</span>
              <img
                className={styles.iconImg}
                src={emote.imageUrl}
                alt={emote.code}
                title={`${emote.code} · ${pluralize(emote.count, 'time')}`}
                loading="lazy"
              />
              <span className={styles.iconCode}>{emote.code}</span>
              <span className={styles.value}>{pluralize(emote.count, 'time')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Word cloud: the channel's most-used words, sized by relative frequency
// (sqrt scale so the spread stays readable).
function WordCloud({ words }: { words: ChannelStats['wordCloud'] }) {
  const maxCount = words.length > 0 ? words[0].count : 1;
  return (
    <section className={styles.card} aria-label="Word cloud">
      <h2 className={styles.cardTitle}>Word cloud</h2>
      {words.length === 0 ? (
        <p className={styles.empty}>No words to show yet.</p>
      ) : (
        <div className={styles.cloud}>
          {words.map((w) => {
            const size = 12 + Math.round(24 * Math.sqrt(w.count / maxCount));
            return (
              <span key={w.word} className={styles.cloudWord} style={{ fontSize: size }} title={pluralize(w.count, 'time')}>
                {w.word}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
