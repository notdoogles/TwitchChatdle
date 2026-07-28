// Twitch's chat `badges` IRC tag mixes two conceptually different things:
// badges granted by Twitch globally (Prime/Turbo, Partner, Staff, ...) vs
// badges tied to a chatter's relationship with *this* channel (mod, VIP,
// subscriber, founder, ...). The tag itself doesn't separate them, so this
// module classifies by a fixed slug list. Used by lib/game.ts to build the
// easy-mode "global badge" (round 2) and "channel badge" (round 4) hints.
const CHANNEL_BADGE_LABELS: Record<string, string> = {
  broadcaster: 'Broadcaster',
  moderator: 'Moderator',
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
};

// Highest-priority slug first, used when a chatter has more than one badge
// in the same category so the hint only ever surfaces one representative
// badge.
const CHANNEL_PRIORITY = Object.keys(CHANNEL_BADGE_LABELS);
const GLOBAL_PRIORITY = Object.keys(GLOBAL_BADGE_LABELS);

export interface ClassifiedBadges {
  globalBadge: string | null;
  channelBadge: string | null;
}

export function classifyBadges(badges: Record<string, string> | null | undefined): ClassifiedBadges {
  const { channelSlug, globalSlug } = findRepresentativeBadgeSlugs(badges);
  return {
    channelBadge: channelSlug ? CHANNEL_BADGE_LABELS[channelSlug] : null,
    globalBadge: globalSlug ? GLOBAL_BADGE_LABELS[globalSlug] : null,
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
export function findRepresentativeBadgeSlugs(
  badges: Record<string, string> | null | undefined
): RepresentativeBadgeSlugs {
  const slugs = badges ? Object.keys(badges) : [];
  const channelSlug = CHANNEL_PRIORITY.find((slug) => slugs.includes(slug)) ?? null;
  const globalSlug = GLOBAL_PRIORITY.find((slug) => slugs.includes(slug)) ?? null;
  return {
    channelSlug,
    channelVersion: channelSlug ? badges![channelSlug] : null,
    globalSlug,
    globalVersion: globalSlug ? badges![globalSlug] : null,
  };
}
