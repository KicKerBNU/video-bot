import sharp from 'sharp';
import { join } from 'path';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '../../common/video-constants';
import { CaptionChunk, WordTimestamp } from '../../common/types';

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

function wrapTitleLines(title: string, maxChars = 22): string[] {
  const words = title.trim().split(/\s+/);
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
  return lines.slice(0, 4);
}

export async function createIntroOverlay(params: {
  outputPath: string;
  title: string;
  hook?: string;
  brandName: string;
}): Promise<void> {
  const { outputPath, title, hook, brandName } = params;
  const width = VIDEO_WIDTH;
  const height = 980;
  const titleLines = wrapTitleLines(title);

  const titleSvg = titleLines
    .map(
      (line, index) =>
        `<text x="70" y="${200 + index * 78}" font-family="Georgia, serif" font-size="68" font-weight="700" fill="#F7F4EF">${escapeXml(line)}</text>`,
    )
    .join('\n');

  const hookY = 200 + titleLines.length * 78 + 40;
  const hookSvg = hook
    ? `<text x="70" y="${hookY}" font-family="Helvetica Neue, Arial, sans-serif" font-size="32" fill="#D2D2D2">${escapeXml(hook.slice(0, 64))}</text>`
    : '';

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="70" y="90" font-family="Helvetica Neue, Arial, sans-serif" font-size="28" letter-spacing="6" fill="#C8F560" font-weight="700">${escapeXml(brandName.toUpperCase())}</text>
      ${titleSvg}
      ${hookSvg}
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

export async function createCaptionOverlays(params: {
  outputDir: string;
  captions: CaptionChunk[];
  introMs: number;
}): Promise<TimedOverlay[]> {
  const { outputDir, captions, introMs } = params;
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

      const startSec = (active.startMs + introMs) / 1000;
      const endSec =
        w < chunk.words.length - 1
          ? (chunk.words[w + 1].startMs + introMs) / 1000
          : (chunk.endMs + introMs + 80) / 1000;

      overlays.push({
        file,
        startSec,
        endSec: Math.max(endSec, startSec + 0.05),
        x: 0,
        y: Math.round(VIDEO_HEIGHT * 0.42),
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
  const text = words.map((word) => word.word.toUpperCase()).join(' ');

  // Approximate centered layout with tspans for highlight colors.
  const tspans = words
    .map((word, index) => {
      const color = index <= activeIndex ? '#C8F560' : '#F7F4EF';
      const spacer = index < words.length - 1 ? '  ' : '';
      return `<tspan fill="${color}">${escapeXml(word.word.toUpperCase())}${spacer}</tspan>`;
    })
    .join('');

  // Keep a shadow layer using the plain uppercase line.
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial Black, Helvetica Neue, Arial, sans-serif"
        font-size="62" font-weight="900"
        stroke="#0B1F1A" stroke-width="10" paint-order="stroke">${escapeXml(text)}</text>
      <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial Black, Helvetica Neue, Arial, sans-serif"
        font-size="62" font-weight="900">${tspans}</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
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
