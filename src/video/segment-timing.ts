import { ScriptSegment, WordTimestamp } from '../common/types';

export interface TimedSegment {
  segment: ScriptSegment;
  startMs: number;
  endMs: number;
}

/**
 * Aligns script segments to TTS word timings using spoken hints.
 * Falls back to even time slices when hints cannot be matched.
 */
export function timeSegments(
  segments: ScriptSegment[],
  words: WordTimestamp[],
  durationMs: number,
): TimedSegment[] {
  if (segments.length === 0) {
    return [];
  }

  if (words.length === 0) {
    return evenSlices(segments, durationMs);
  }

  const joined = words.map((word) => word.word.toLowerCase());
  const starts: number[] = [];

  for (const segment of segments) {
    const hintTokens = segment.spokenHint
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);

    let matchedIndex = -1;
    if (hintTokens.length > 0) {
      for (let i = 0; i <= joined.length - hintTokens.length; i += 1) {
        const window = joined.slice(i, i + hintTokens.length);
        if (hintTokens.every((token, idx) => window[idx]?.startsWith(token.slice(0, 4)))) {
          matchedIndex = i;
          break;
        }
      }
    }

    starts.push(matchedIndex >= 0 ? words[matchedIndex].startMs : -1);
  }

  // If too many misses, use even slices.
  const misses = starts.filter((value) => value < 0).length;
  if (misses > Math.ceil(segments.length / 2)) {
    return evenSlices(segments, durationMs);
  }

  // Fill unmatched starts by interpolation.
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i] >= 0) {
      continue;
    }
    const prev = [...starts.slice(0, i)].reverse().find((value) => value >= 0);
    const next = starts.slice(i + 1).find((value) => value >= 0);
    if (prev !== undefined && next !== undefined) {
      starts[i] = Math.round((prev + next) / 2);
    } else if (prev !== undefined) {
      starts[i] = Math.min(durationMs, prev + 1500);
    } else if (next !== undefined) {
      starts[i] = Math.max(0, next - 1500);
    } else {
      starts[i] = Math.round((i / segments.length) * durationMs);
    }
  }

  // Ensure monotonic starts.
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] <= starts[i - 1]) {
      starts[i] = starts[i - 1] + 500;
    }
  }

  // Always cover the full video — never leave a branded-green gap at t=0.
  starts[0] = 0;

  return segments.map((segment, index) => ({
    segment,
    startMs: starts[index],
    endMs: index === segments.length - 1 ? durationMs : starts[index + 1],
  }));
}

function evenSlices(
  segments: ScriptSegment[],
  durationMs: number,
): TimedSegment[] {
  const slice = durationMs / segments.length;
  return segments.map((segment, index) => ({
    segment,
    startMs: Math.round(index * slice),
    endMs: Math.round((index + 1) * slice),
  }));
}
