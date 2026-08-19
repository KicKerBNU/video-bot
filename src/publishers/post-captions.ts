import { VideoScript } from '../common/types';

const DEFAULT_HASHTAGS = ['#AI', '#TechNews', '#AINews'];

export function scriptHashtags(script: VideoScript, limit = 3): string[] {
  const tags = (script.hashtags?.length ? script.hashtags : DEFAULT_HASHTAGS).map(
    (tag) => (tag.startsWith('#') ? tag : `#${tag}`),
  );
  return tags.slice(0, limit);
}

/** Bullet headlines from the digest (skips intro/closing framing). */
export function digestHeadlines(script: VideoScript): string[] {
  const fromSegments = (script.segments ?? [])
    .filter((segment) => segment.id.startsWith('bullet-'))
    .map((segment) => segment.title.trim())
    .filter(Boolean);

  if (fromSegments.length > 0) {
    return fromSegments;
  }

  return script.title ? [script.title] : [];
}

/** Ready-to-paste X / Twitter caption (no URLs). */
export function buildTwitterCaption(script: VideoScript): string {
  const hashtags = scriptHashtags(script, 3).join(' ');
  const base = `${script.title}\n\n${hashtags}`;
  return base.length > 270 ? `${base.slice(0, 267)}...` : base;
}

/** Ready-to-paste TikTok caption with headline list + hashtags. */
export function buildTikTokCaption(script: VideoScript): string {
  const headlines = digestHeadlines(script);
  const lines =
    headlines.length > 1
      ? [
          script.title,
          '',
          'Also in today’s AI digest:',
          ...headlines.slice(0, 4).map((line) => `• ${line}`),
          '',
          scriptHashtags(script, 6).join(' '),
        ]
      : [script.title, '', scriptHashtags(script, 6).join(' ')];

  return lines.join('\n');
}
