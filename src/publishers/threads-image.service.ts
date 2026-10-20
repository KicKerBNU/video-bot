import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { AppConfigService } from '../config/app-config.service';
import { getLocalTimeZone } from '../common/local-timezone';
import { VideoScript } from '../common/types';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '../common/video-constants';
import { digestHeadlines } from '../publishers/post-captions';

@Injectable()
export class ThreadsImageService {
  private readonly logger = new Logger(ThreadsImageService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Vertical still for Threads: topic B-roll background + date + headlines.
   */
  async render(script: VideoScript, outputDir: string): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'threads.jpg');
    const brand = this.appConfig.brandName.toUpperCase();
    const dateLabel = formatDigestDate(script);
    const headlines = digestHeadlines(script).slice(0, 4);
    const title = wrapText(script.title, 28).slice(0, 4);

    const titleSvg = title
      .map(
        (line, index) =>
          `<text x="96" y="${460 + index * 74}" fill="#F5F2EA" font-family="Georgia, 'Times New Roman', serif" font-size="60" font-weight="700">${escapeXml(line)}</text>`,
      )
      .join('');

    const bulletsSvg = headlines
      .map((headline, index) => {
        const y = 860 + index * 150;
        const lines = wrapText(headline, 36).slice(0, 3);
        const lineSvgs = lines
          .map(
            (line, lineIndex) =>
              `<text x="140" y="${y + lineIndex * 46}" fill="#F2EEE6" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="600">${escapeXml(line)}</text>`,
          )
          .join('');
        return `
          <circle cx="104" cy="${y - 12}" r="10" fill="#C4A574"/>
          ${lineSvgs}`;
      })
      .join('');

    const overlaySvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0A09" stop-opacity="0.55"/>
      <stop offset="35%" stop-color="#0B0A09" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0B0A09" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#scrim)"/>
  <rect x="64" y="64" width="${VIDEO_WIDTH - 128}" height="${VIDEO_HEIGHT - 128}" fill="none" stroke="rgba(245,242,234,0.18)" stroke-width="2"/>
  <text x="96" y="170" fill="#B8B4AC" font-family="Arial, Helvetica, sans-serif" font-size="26" letter-spacing="8">${escapeXml(brand)}</text>
  <text x="96" y="240" fill="#C4A574" font-family="Arial, Helvetica, sans-serif" font-size="28" letter-spacing="4">DAILY AI DIGEST</text>
  <text x="96" y="310" fill="#F5F2EA" font-family="Arial, Helvetica, sans-serif" font-size="34" letter-spacing="3">${escapeXml(dateLabel)}</text>
  ${titleSvg}
  <line x1="96" y1="800" x2="520" y2="800" stroke="rgba(196,165,116,0.65)" stroke-width="2"/>
  ${bulletsSvg}
  <text x="96" y="${VIDEO_HEIGHT - 120}" fill="#A39E94" font-family="Arial, Helvetica, sans-serif" font-size="24" letter-spacing="3">TODAY'S HEADLINES</text>
</svg>`);

    const backgroundPath = await this.resolveBackground(outputDir);
    const base = backgroundPath
      ? sharp(backgroundPath).rotate().resize(VIDEO_WIDTH, VIDEO_HEIGHT, {
          fit: 'cover',
          position: 'attention',
        })
      : sharp({
          create: {
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
            channels: 3,
            background: '#141210',
          },
        });

    if (!backgroundPath) {
      this.logger.warn(
        'No segment still found for Threads background; using solid fallback',
      );
    } else {
      this.logger.log(`Threads background: ${backgroundPath}`);
    }

    await base
      .composite([{ input: overlaySvg, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    this.logger.log(`Threads image ready: ${outputPath}`);
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

function formatDigestDate(script: VideoScript): string {
  const fromId = script.id.match(/^digest-(\d{4}-\d{2}-\d{2})$/)?.[1];
  const iso = script.publishedAt?.slice(0, 10) || fromId;
  const date = iso ? new Date(`${iso}T12:00:00Z`) : new Date();

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getLocalTimeZone(),
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
