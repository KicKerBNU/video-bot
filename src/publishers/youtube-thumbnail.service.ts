import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { AppConfigService } from '../config/app-config.service';
import { VideoScript } from '../common/types';

/**
 * YouTube Shorts custom thumbnail (Studio, desktop).
 * Spec: https://support.google.com/youtube/answer/72431
 * — 9:16 aspect, recommended 2160×3840, JPG/PNG, min height 640.
 */
const THUMB_WIDTH = 2160;
const THUMB_HEIGHT = 3840;
const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class YoutubeThumbnailService {
  private readonly logger = new Logger(YoutubeThumbnailService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Vertical 9:16 thumbnail for YouTube Shorts custom upload.
   * Bold title over topic B-roll — readable at small sizes.
   */
  async render(script: VideoScript, outputDir: string): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'youtube-thumbnail.jpg');
    const brand = this.appConfig.brandName.toUpperCase();
    const dateLabel = formatDigestDate(script);
    const title = wrapText(shortenTitle(script.title), 22).slice(0, 5);

    const titleSvg = title
      .map(
        (line, index) =>
          `<text x="180" y="${1180 + index * 140}" fill="#F5F2EA" font-family="Georgia, 'Times New Roman', serif" font-size="118" font-weight="700">${escapeXml(line)}</text>`,
      )
      .join('');

    const overlaySvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" viewBox="0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0A09" stop-opacity="0.5"/>
      <stop offset="40%" stop-color="#0B0A09" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#0B0A09" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#scrim)"/>
  <rect x="120" y="120" width="${THUMB_WIDTH - 240}" height="${THUMB_HEIGHT - 240}" fill="none" stroke="rgba(245,242,234,0.22)" stroke-width="4"/>
  <text x="180" y="320" fill="#B8B4AC" font-family="Arial, Helvetica, sans-serif" font-size="48" letter-spacing="12">${escapeXml(brand)}</text>
  <text x="180" y="440" fill="#C4A574" font-family="Arial, Helvetica, sans-serif" font-size="56" letter-spacing="8">DAILY AI DIGEST</text>
  <text x="180" y="560" fill="#F5F2EA" font-family="Arial, Helvetica, sans-serif" font-size="64" letter-spacing="6">${escapeXml(dateLabel)}</text>
  ${titleSvg}
  <text x="180" y="${THUMB_HEIGHT - 220}" fill="#A39E94" font-family="Arial, Helvetica, sans-serif" font-size="44" letter-spacing="8">YOUTUBE SHORTS</text>
</svg>`);

    const backgroundPath = await this.resolveBackground(outputDir);
    const base = backgroundPath
      ? sharp(backgroundPath).rotate().resize(THUMB_WIDTH, THUMB_HEIGHT, {
          fit: 'cover',
          position: 'attention',
        })
      : sharp({
          create: {
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            channels: 3,
            background: '#141210',
          },
        });

    if (!backgroundPath) {
      this.logger.warn(
        'No segment still found for YouTube thumbnail background; using solid fallback',
      );
    } else {
      this.logger.log(`YouTube thumbnail background: ${backgroundPath}`);
    }

    await base
      .composite([{ input: overlaySvg, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    const meta = await sharp(outputPath).metadata();
    if (meta.width !== THUMB_WIDTH || meta.height !== THUMB_HEIGHT) {
      throw new Error(
        `YouTube Shorts thumbnail must be ${THUMB_WIDTH}x${THUMB_HEIGHT} (9:16); got ${meta.width}x${meta.height}`,
      );
    }

    this.logger.log(
      `YouTube thumbnail ready: ${outputPath} (${meta.width}x${meta.height}, 9:16 Shorts)`,
    );
    return outputPath;
  }

  private async resolveBackground(outputDir: string): Promise<string | null> {
    const imagesDir = join(outputDir, 'images');
    const candidates = [
      'segment-0-intro.jpg',
      'segment-1-bullet-1.jpg',
      'segment-2-bullet-2.jpg',
      'segment-3-bullet-3.jpg',
    ];

    for (const name of candidates) {
      const path = join(imagesDir, name);
      try {
        await access(path);
        return path;
      } catch {
        // try next
      }
    }
    return null;
  }
}

function shortenTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= 90) {
    return clean;
  }
  const cut = clean.slice(0, 89);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 50 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function formatDigestDate(script: VideoScript): string {
  const fromId = script.id.match(/^digest-(?:work-)?(\d{4}-\d{2}-\d{2})$/)?.[1];
  const iso = script.publishedAt?.slice(0, 10) || fromId;
  const date = iso ? new Date(`${iso}T12:00:00Z`) : new Date();

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LISBON_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(date)
    .toUpperCase()
    .replace(/,/g, '');
}

function wrapText(value: string, maxChars: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
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
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
