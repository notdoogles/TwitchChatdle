import { getChannelBadgeSlugs, getGlobalBadgeSlugs } from './badgeImages';

// Twitch's chat `badges` IRC tag mixes two conceptually different things:
// badges granted by Twitch globally (Prime/Turbo, Partner, Staff, ...) vs
// badges tied to a chatter's relationship with *this* channel (mod, VIP,
// subscriber, founder, ...). The tag itself doesn't separate them. Slugs
// Twitch has had for a long time are classified instantly from the fixed
// lists below; anything not in these lists falls back to asking Twitch's
// live Helix badge data (see classifyAllBadges) so newly added badges
// (e.g. "lead_moderator", "social-sharing") still work without a code
// change here. Used by lib/game.ts to build the easy-mode "global badges"
// (round 2) and "channel badges" (round 4) hints -- every badge a chatter
// has is shown, not just one representative per category.
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

export interface ClassifiedBadgeSlug {
  slug: string;
  version: string;
  label: string;
}

export interface ClassifiedBadges {
  channelBadges: ClassifiedBadgeSlug[];
  globalBadges: ClassifiedBadgeSlug[];
}

// Classifies every slug in a chatter's `badges` IRC tag into the channel
// or global category (dropping any that are neither), preserving the
// order Twitch sent them in. lib/game.ts uses the slug+version pair to
// resolve the actual badge image (lib/badgeImages.ts) and the label as a
// fallback for when no image is available.
export async function classifyAllBadges(
  badges: Record<string, string> | null | undefined,
  channel: string,
  host?: string | null
): Promise<ClassifiedBadges> {
  const slugs = badges ? Object.keys(badges) : [];
  if (slugs.length === 0) return { channelBadges: [], globalBadges: [] };

  const channelSlugs: string[] = [];
  const globalSlugs: string[] = [];
  const unclassified: string[] = [];

  for (const slug of slugs) {
    if (slug in CHANNEL_BADGE_LABELS) channelSlugs.push(slug);
    else if (slug in GLOBAL_BADGE_LABELS) globalSlugs.push(slug);
    else unclassified.push(slug);
  }

  // For any slug the static lists don't recognize, ask Twitch's live Helix
  // badge data which category it actually belongs to. Returns null (not
  // an empty set) when that data can't be fetched -- e.g. no
  // TWITCH_CLIENT_ID/SECRET configured -- in which case unrecognized
  // slugs are simply ignored, same as before this lookup existed.
  if (unclassified.length > 0) {
    const [liveChannelSlugs, liveGlobalSlugs] = await Promise.all([
      getChannelBadgeSlugs(channel, host),
      getGlobalBadgeSlugs(),
    ]);
    for (const slug of unclassified) {
      if (liveChannelSlugs?.has(slug)) channelSlugs.push(slug);
      else if (liveGlobalSlugs?.has(slug)) globalSlugs.push(slug);
    }
  }

  const toClassified = (slug: string): ClassifiedBadgeSlug => ({
    slug,
    version: badges![slug],
    label: CHANNEL_BADGE_LABELS[slug] ?? GLOBAL_BADGE_LABELS[slug] ?? prettifySlug(slug),
  });

  return {
    channelBadges: channelSlugs.map(toClassified),
    globalBadges: globalSlugs.map(toClassified),
  };
}
