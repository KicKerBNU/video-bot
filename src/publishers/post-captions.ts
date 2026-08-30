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

/**
 * Ready-to-paste X / Twitter caption (no URLs).
 * Tuned for For You ranking: replies/quotes/shares beat likes
 * (see xai-org/x-algorithm ReplyWeight=5, QuoteWeight=5, ShareViaCopyLink=20).
 */
export function buildTwitterCaption(script: VideoScript): string {
  const hashtags = scriptHashtags(script, 3).join(' ');
  const hook = shortenHeadline(script.title, 140);
  const prompt = engagementPrompt(script.title, digestHeadlines(script));

  const candidates = [
    [hook, '', prompt, '', 'Quote with your take.', '', hashtags].join('\n'),
    [hook, '', prompt, '', hashtags].join('\n'),
    [hook, '', 'Quote with your take.', '', hashtags].join('\n'),
    `${hook}\n\n${hashtags}`,
  ];

  for (const text of candidates) {
    if (text.length <= 270) {
      return text;
    }
  }

  return `${hook.slice(0, 240)}…\n\n${hashtags}`.slice(0, 270);
}

/** Ready-to-paste TikTok caption with headline list + hashtags. */
export function buildTikTokCaption(script: VideoScript): string {
  const headlines = digestHeadlines(script);
  const prompt = engagementPrompt(script.title, headlines);
  const lines =
    headlines.length > 1
      ? [
          script.title,
          '',
          prompt,
          '',
          'Also in today’s AI digest:',
          ...headlines.slice(0, 4).map((line) => `• ${line}`),
          '',
          'Comment your take 👇',
          '',
          scriptHashtags(script, 6).join(' '),
        ]
      : [
          script.title,
          '',
          prompt,
          '',
          'Comment your take 👇',
          '',
          scriptHashtags(script, 6).join(' '),
        ];

  return lines.join('\n');
}

/**
 * Ready-to-paste YouTube Shorts title + description.
 * Title first line (≤100 chars); rest is description for Studio.
 */
export function buildYoutubeCaption(script: VideoScript): string {
  const headlines = digestHeadlines(script);
  const hashtags = [...scriptHashtags(script, 5), '#Shorts'].join(' ');
  const title = shortenHeadline(script.title, 100);
  const lines = [
    title,
    '',
    "Today's AI digest:",
    ...headlines.slice(0, 4).map((line) => `• ${line}`),
    '',
    hashtags,
  ];
  return lines.join('\n');
}

/**
 * Ready-to-paste Threads caption.
 * Threads text limit is ~500 characters — keep it shorter than TikTok.
 */
export function buildThreadsCaption(script: VideoScript): string {
  const headlines = digestHeadlines(script);
  const hashtags = scriptHashtags(script, 3).join(' ');
  const prompt = engagementPrompt(script.title, headlines);
  const bulletLines =
    headlines.length > 1
      ? headlines.slice(0, 3).map((line) => `• ${line}`)
      : [];

  const candidates = [
    [script.title, '', prompt, '', ...bulletLines, '', 'Reply with your take.', '', hashtags]
      .filter(Boolean)
      .join('\n'),
    [script.title, '', prompt, '', 'Reply with your take.', '', hashtags]
      .filter(Boolean)
      .join('\n'),
    [script.title, '', ...bulletLines, '', hashtags].filter(Boolean).join('\n'),
    `${script.title}\n\n${hashtags}`,
  ];

  for (const text of candidates) {
    if (text.length <= 500) {
      return text;
    }
  }

  return `${script.title.slice(0, 470)}…\n\n${hashtags}`.slice(0, 500);
}

function shortenHeadline(title: string, maxChars: number): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const cut = clean.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Opinion prompt keyed off the lead story — pushes replies/quotes over passive likes.
 */
function engagementPrompt(title: string, headlines: string[]): string {
  // Prefer the top bullet so one secondary theme (e.g. security) doesn't dominate.
  const text = `${headlines[0] ?? title} ${title}`.toLowerCase();

  if (/\b(ipo|valuation|funding|financing|raises?|billion|capital|record quarter|earnings)\b/.test(text)) {
    return 'Signal or hype — where does the real value land?';
  }
  if (/\b(users?|mau|dau|downloads?|adoption)\b/.test(text)) {
    return 'Distribution win, or actual product love?';
  }
  if (/\b(open.?source|open.?weight|huggingface|qwen|llama|acquisition)\b/.test(text)) {
    return 'Do open models keep closing the gap on closed labs?';
  }
  if (/\b(nvidia|gpu|chip|semiconductor|data center|infrastructure)\b/.test(text)) {
    return 'Infrastructure boom… or bubble?';
  }
  if (/\b(security|breach|hack|vulnerabilit|malware|ransomware)\b/.test(text)) {
    return 'Is AI making security better — or just exposing more attack surface?';
  }
  if (/\b(regulation|lawsuit|antitrust|congress|policy|ban)\b/.test(text)) {
    return 'Will regulation catch up before the next wave ships?';
  }
  if (/\b(anthropic|openai|google|gemini|xai|grok|meta)\b/.test(text)) {
    return 'Who actually has the lead right now?';
  }

  return 'What part of this matters most for the next 12 months?';
}
