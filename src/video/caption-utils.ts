import { CaptionChunk, WordTimestamp } from '../common/types';

const MAX_WORDS_PER_CHUNK = 4;

export function buildCaptionChunks(words: WordTimestamp[]): CaptionChunk[] {
  if (words.length === 0) {
    return [];
  }

  const chunks: CaptionChunk[] = [];

  for (let i = 0; i < words.length; i += MAX_WORDS_PER_CHUNK) {
    const slice = words.slice(i, i + MAX_WORDS_PER_CHUNK);
    chunks.push({
      text: slice.map((w) => w.word).join(' '),
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
      words: slice,
    });
  }

  return chunks;
}

export function truncateScriptForShortForm(
  body: string,
  maxChars = 900,
): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const cut = normalized.slice(0, maxChars);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );

  if (lastStop > maxChars * 0.5) {
    return cut.slice(0, lastStop + 1).trim();
  }

  return `${cut.trim()}…`;
}
