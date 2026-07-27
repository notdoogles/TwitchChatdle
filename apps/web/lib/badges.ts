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
  const slugs = badges ? Object.keys(badges) : [];
  const channelSlug = CHANNEL_PRIORITY.find((slug) => slugs.includes(slug));
  const globalSlug = GLOBAL_PRIORITY.find((slug) => slugs.includes(slug));
  return {
    channelBadge: channelSlug ? CHANNEL_BADGE_LABELS[channelSlug] : null,
    globalBadge: globalSlug ? GLOBAL_BADGE_LABELS[globalSlug] : null,
  };
}
