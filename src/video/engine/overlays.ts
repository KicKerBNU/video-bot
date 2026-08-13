import sharp from 'sharp';
import { join } from 'path';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '../../common/video-constants';
import { CaptionChunk, ScriptSegment, WordTimestamp } from '../../common/types';

export interface TimedOverlay {
  file: string;
  startSec: number;
  endSec: number;
  x: number;
  y: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxChars = 28): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

export async function createSegmentTitleOverlays(params: {
  outputDir: string;
  timedSegments: Array<{ segment: ScriptSegment; startMs: number; endMs: number }>;
}): Promise<TimedOverlay[]> {
  const { outputDir, timedSegments } = params;
  const overlays: TimedOverlay[] = [];

  for (const [index, item] of timedSegments.entries()) {
    const title = (item.segment.title || '').trim();
    if (!title) {
      continue;
    }

    const file = join(
      outputDir,
      `segment-title-${String(index).padStart(2, '0')}.png`,
    );
    await renderSegmentTitlePng(file, title);

    overlays.push({
      file,
      startSec: item.startMs / 1000,
      endSec: Math.max(item.endMs / 1000, item.startMs / 1000 + 0.4),
      x: 0,
      y: 120,
    });
  }

  return overlays;
}

async function renderSegmentTitlePng(
  outputPath: string,
  title: string,
): Promise<void> {
  const lines = wrapLines(title, 34);
  const height = 220;
  const lineSvg = lines
    .map(
      (line, index) =>
        `<text x="70" y="${90 + index * 48}" font-family="Helvetica Neue, Arial, sans-serif" font-size="40" font-weight="700" fill="#F7F4EF">${escapeXml(line)}</text>`,
    )
    .join('\n');

  const svg = `
    <svg width="${VIDEO_WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="40" y="36" width="${VIDEO_WIDTH - 80}" height="${height - 56}" rx="18" fill="#000000" fill-opacity="0.9"/>
      ${lineSvg}
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

export async function createCaptionOverlays(params: {
  outputDir: string;
  captions: CaptionChunk[];
}): Promise<TimedOverlay[]> {
  const { outputDir, captions } = params;
  const overlays: TimedOverlay[] = [];
  let index = 0;

  for (const chunk of captions) {
    for (let w = 0; w < chunk.words.length; w += 1) {
      const active = chunk.words[w];
      const file = join(
        outputDir,
        `caption-${String(index).padStart(4, '0')}.png`,
      );
      await renderCaptionPng(file, chunk.words, w);

      const startSec = active.startMs / 1000;
      const endSec =
        w < chunk.words.length - 1
          ? chunk.words[w + 1].startMs / 1000
          : (chunk.endMs + 80) / 1000;

      overlays.push({
        file,
        startSec,
        endSec: Math.max(endSec, startSec + 0.05),
        x: 0,
        y: Math.round(VIDEO_HEIGHT * 0.58),
      });
      index += 1;
    }
  }

  return overlays;
}

async function renderCaptionPng(
  outputPath: string,
  words: WordTimestamp[],
  activeIndex: number,
): Promise<void> {
  const width = VIDEO_WIDTH;
  const height = 420;
  const displayWords = words.flatMap((word) => {
    const cleaned = word.word.replace(/[^\p{L}\p{N}'-]+/gu, '');
    const base = cleaned || word.word;
    return base
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([0-9])([A-Za-z])/g, '$1 $2')
      .replace(/([A-Za-z])([0-9])/g, '$1 $2')
      .split(/\s+/)
      .map((part) => part.toUpperCase())
      .filter(Boolean);
  });
  // Keep activeIndex roughly aligned by using original word count for highlight
  // line brightness only (full line lights up when any of its source words are active).
  const lines = wrapCaptionWords(displayWords, 22);

  // Single text nodes (not tspans) so spaces never collapse in Sharp/librsvg.
  const lineSvgs = lines
    .map((lineWords, lineIndex) => {
      const y = 78 + lineIndex * 70;
      const lineText = lineWords.join(' ');
      return `
        <text x="50%" y="${y}" text-anchor="middle"
          font-family="Helvetica Neue, Arial, sans-serif"
          font-size="48" font-weight="800" fill="#FFFFFF"
          stroke="#000000" stroke-width="10" paint-order="stroke">${escapeXml(lineText)}</text>`;
    })
    .join('\n');

  const boxHeight = Math.max(190, 56 + lines.length * 70);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="36" y="18" width="${width - 72}" height="${boxHeight}" rx="22" fill="#000000" fill-opacity="0.92"/>
      ${lineSvgs}
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function wrapCaptionWords(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const word of words) {
    const nextLen = currentLen === 0 ? word.length : currentLen + 2 + word.length;
    if (currentLen > 0 && nextLen > maxChars) {
      lines.push(current);
      current = [word];
      currentLen = word.length;
    } else {
      current.push(word);
      currentLen = nextLen;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

export async function createWatermarkOverlay(params: {
  outputPath: string;
  brandName: string;
}): Promise<void> {
  const { outputPath, brandName } = params;
  const svg = `
    <svg width="${VIDEO_WIDTH}" height="120" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="70" text-anchor="middle"
        font-family="Helvetica Neue, Arial, sans-serif"
        font-size="24" letter-spacing="6" fill="#8F8F8F">${escapeXml(brandName.toUpperCase())}</text>
    </svg>
  `;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}
