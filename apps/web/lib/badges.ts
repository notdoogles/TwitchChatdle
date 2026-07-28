import { getChannelBadgeSlugs, getGlobalBadgeSlugs } from './badgeImages';

// Twitch's chat `badges` IRC tag mixes two conceptually different things:
// badges granted by Twitch globally (Prime/Turbo, Partner, Staff, ...) vs
// badges tied to a chatter's relationship with *this* channel (mod, VIP,
// subscriber, founder, ...). The tag itself doesn't separate them. Slugs
// Twitch has had for a long time are classified instantly from the fixed
// lists below; anything not in these lists falls back to asking Twitch's
// live Helix badge data (see findRepresentativeBadgeSlugs) so newly added
// badges (e.g. "lead_moderator", "social-sharing") still work without a
// code change here. Used by lib/game.ts to build the easy-mode "global
// badge" (round 2) and "channel badge" (round 4) hints.
const CHANNEL_BADGE_LABELS: Record<string, string> = {
  broadcaster: 'Broadcaster',
  moderator: 'Moderator',
  lead_moderator: 'Lead Moderator',
  vip: 'VIP',
  founder: 'Founder',
  subscriber: 'Subscriber',
  'sub-gifter': 'Sub Gifter',
  'sub-gift-leader': 'Sub Gift Leader',
  bits: 'Bits',
  'bits-leader': 'Bits Leader',
  'hype-train': 'Hype Train',
};

const GLOBAL_BADGE_LABELS: Record<string, string> = {
  staff: 'Staff',
  admin: 'Admin',
  global_mod: 'Global Mod',
  partner: 'Partner',
  turbo: 'Turbo',
  premium: 'Prime',
  'clip-champ': 'Clip Champ',
  'artist-badge': 'Artist',
  'glhf-pledge': 'GLHF Pledge',
  'twitch-recap-2023': 'Recap',
  'social-sharing': 'Social Sharing',
};

// Highest-priority slug first, used when a chatter has more than one badge
// in the same category so the hint only ever surfaces one representative
// badge.
const CHANNEL_PRIORITY = Object.keys(CHANNEL_BADGE_LABELS);
const GLOBAL_PRIORITY = Object.keys(GLOBAL_BADGE_LABELS);

// Turns an unrecognized-but-live-confirmed slug into a readable label,
// e.g. "lead_moderator" -> "Lead Moderator", so a badge Twitch just shipped
// still shows *something* instead of silently disappearing while this
// file's label maps are stale.
function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export interface ClassifiedBadges {
  globalBadge: string | null;
  channelBadge: string | null;
}

export async function classifyBadges(
  badges: Record<string, string> | null | undefined,
  channel: string
): Promise<ClassifiedBadges> {
  const { channelSlug, globalSlug } = await findRepresentativeBadgeSlugs(badges, channel);
  return {
    channelBadge: channelSlug ? (CHANNEL_BADGE_LABELS[channelSlug] ?? prettifySlug(channelSlug)) : null,
    globalBadge: globalSlug ? (GLOBAL_BADGE_LABELS[globalSlug] ?? prettifySlug(globalSlug)) : null,
  };
}

export interface RepresentativeBadgeSlugs {
  channelSlug: string | null;
  channelVersion: string | null;
  globalSlug: string | null;
  globalVersion: string | null;
}

// Same representative-badge-per-category selection as classifyBadges, but
// keeps the raw slug + version (e.g. "moderator"/"1") instead of resolving
// to a display label. lib/badgeImages.ts needs the slug+version pair to
// look up the actual badge image from Twitch's Badges API, which
// classifyBadges's label-only return value discards.
export async function findRepresentativeBadgeSlugs(
  badges: Record<string, string> | null | undefined,
  channel: string
): Promise<RepresentativeBadgeSlugs> {
  const slugs = badges ? Object.keys(badges) : [];
  if (slugs.length === 0) {
    return { channelSlug: null, channelVersion: null, globalSlug: null, globalVersion: null };
  }

  // Prefer the known priority lists first so a chatter with several badges
  // in the same category still always surfaces the same representative
  // one (e.g. moderator over subscriber) without needing a network call.
  let channelSlug = CHANNEL_PRIORITY.find((slug) => slugs.includes(slug)) ?? null;
  let globalSlug = GLOBAL_PRIORITY.find((slug) => slugs.includes(slug)) ?? null;

  // For any slug the static lists don't recognize, ask Twitch's live Helix
  // badge data which category it actually belongs to. Returns null (not
  // an empty set) when that data can't be fetched -- e.g. no
  // TWITCH_CLIENT_ID/SECRET configured -- in which case unrecognized
  // slugs are simply ignored, same as before this lookup existed.
  const unclassified = slugs.filter((slug) => slug !== channelSlug && slug !== globalSlug);
  if (unclassified.length > 0) {
    const [liveChannelSlugs, liveGlobalSlugs] = await Promise.all([
      channelSlug ? null : getChannelBadgeSlugs(channel),
      globalSlug ? null : getGlobalBadgeSlugs(),
    ]);

    if (!channelSlug && liveChannelSlugs) {
      channelSlug = unclassified.find((slug) => liveChannelSlugs.has(slug)) ?? null;
    }
    if (!globalSlug && liveGlobalSlugs) {
      globalSlug = unclassified.find((slug) => slug !== channelSlug && liveGlobalSlugs.has(slug)) ?? null;
    }
  }

  return {
    channelSlug,
    channelVersion: channelSlug ? badges![channelSlug] : null,
    globalSlug,
    globalVersion: globalSlug ? badges![globalSlug] : null,
  };
}
