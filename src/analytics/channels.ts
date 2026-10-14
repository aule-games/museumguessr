// Channel tags (PH3, V12, ENG13). Every posted link carries utm_source with
// one of these values; the game turns it into the event property `src`.

/** Exact approved utm_source values. */
export const CHANNELS = [
  'webgames',
  'geoguessr',
  'reply',
  'share',
  'smoke',
  'hn',
  'museum',
  'arthistory',
  'glam',
  'discord',
] as const;

/** Patterned values: a city subreddit post, or a note to a museum's open-access team. */
export const CHANNEL_PATTERNS = [/^city-[a-z0-9]+(?:-[a-z0-9]+)*$/, /^oa-[a-z0-9]+(?:-[a-z0-9]+)*$/] as const;

const SHAPE = /^[a-z0-9-]{1,32}$/;

/** `src` is an approved channel, `none` when absent, `other` otherwise. */
export type Src = string;

export function isApprovedChannel(value: string): boolean {
  return (
    SHAPE.test(value) &&
    ((CHANNELS as readonly string[]).includes(value) || CHANNEL_PATTERNS.some((re) => re.test(value)))
  );
}

export function channelFrom(utmSource: string | null | undefined): Src {
  if (utmSource == null || utmSource === '') return 'none';
  return isApprovedChannel(utmSource) ? utmSource : 'other';
}

/** Re-validate a value read back from saved state (ENG13). */
export function revalidateSrc(value: unknown): Src {
  if (value === 'none' || value === 'other') return value;
  return typeof value === 'string' && isApprovedChannel(value) ? value : 'other';
}
