import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getChannel, getGameName } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';
import { getChannelStats, type ChannelStats } from '@/lib/stats';
import styles from './stats.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const gameName = getGameName(resolveHost(headers()));
  return { title: `${gameName} stats` };
}

// All-time chat stats for the channel, computed server-side straight from
// the ingest DB (see lib/stats.ts for the queries). Everything is per
// tenant: the hostname picks the channel and database, same as the game.
export default async function StatsPage() {
  const host = resolveHost(headers());
  const channel = getChannel(host);
  const gameName = getGameName(host);

  let stats: ChannelStats | null = null;
  let error: string | null = null;
  if (channel) {
    try {
      stats = await getChannelStats(channel, host);
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
        <p className={styles.subtitle}>How {gameName}&apos;s chat has been talking, all-time.</p>
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
            <RankedList title="Top chatters" items={stats.topChatters.map((c) => ({ label: c.username, value: c.messageCount, valueText: pluralize(c.messageCount, 'message') }))} />
            <RankedList title="Name colors" items={stats.topColors.map((c) => ({ label: c.label, value: c.count, valueText: pluralize(c.count, 'chatter'), swatch: c.hex }))} />
            <RankedList title="Channel badges" items={stats.topChannelBadges.map((b) => ({ label: b.label, value: b.count, valueText: pluralize(b.count, 'chatter') }))} />
            <RankedList title="Global badges" items={stats.topGlobalBadges.map((b) => ({ label: b.label, value: b.count, valueText: pluralize(b.count, 'chatter') }))} />
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

// Shared ranked list card (chatters, colors, badges). Items can carry an
// optional color swatch rendered before the label.
function RankedList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; valueText: string; swatch?: string }[];
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
              <span className={styles.name}>{item.label}</span>
              <span className={styles.value}>{item.valueText}</span>
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
        <ul className={styles.emoteList}>
          {stats.topEmotes.map((emote, i) => (
            <li key={emote.id} className={styles.emoteItem}>
              <span className={styles.rank}>{i + 1}</span>
              <img
                className={styles.emoteImg}
                src={emote.imageUrl}
                alt={emote.code}
                title={`${emote.code} · ${pluralize(emote.count, 'time')}`}
                loading="lazy"
              />
              <span className={styles.emoteCode}>{emote.code}</span>
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
