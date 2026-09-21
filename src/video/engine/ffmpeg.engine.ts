import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { basename, join } from 'path';
import sharp from 'sharp';
import { AppConfigService } from '../../config/app-config.service';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '../../common/video-constants';
import { VideoScript, WordTimestamp } from '../../common/types';
import { ImageService } from '../../images/image.service';
import { buildCaptionChunks } from '../caption-utils';
import {
  createCaptionOverlays,
  createSegmentTitleOverlays,
  createWatermarkOverlay,
  TimedOverlay,
} from './overlays';
import { timeSegments } from '../segment-timing';

export interface FfmpegRenderInput {
  script: VideoScript;
  audioPath: string;
  durationMs: number;
  words: WordTimestamp[];
  outputDir: string;
  outputPath: string;
  forceReuseImages?: boolean;
}

interface SlideOverlay {
  inputPath: string;
  startSec: number;
  endSec: number;
}

/**
 * Custom Node video engine: related stills + readable captions + FFmpeg + Edge TTS.
 */
@Injectable()
export class FfmpegVideoEngine {
  private readonly logger = new Logger(FfmpegVideoEngine.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly images: ImageService,
  ) {}

  async render(input: FfmpegRenderInput): Promise<string> {
    await this.assertFfmpegAvailable();

    const { script, audioPath, durationMs, words, outputDir, outputPath } =
      input;
    const totalSeconds = Math.max(durationMs + 400, 3000) / 1000;

    const watermarkPath = join(outputDir, 'watermark.png');
    const veilPath = join(outputDir, 'veil.png');
    const filterScriptPath = join(outputDir, 'filter.txt');

    await createWatermarkOverlay({
      outputPath: watermarkPath,
      brandName: this.appConfig.brandName,
    });
    await this.createVeil(veilPath);

    const segments = script.segments?.length
      ? script.segments
      : [
          {
            id: 'main',
            title: script.title,
            spokenHint: script.title,
            searchQuery: script.title,
          },
        ];

    const timed = timeSegments(segments, words, durationMs);
    const prepared = await this.images.prepareSegmentImages({
      segments,
      outputDir,
      forceReuseImages: input.forceReuseImages,
    });

    const imageBySegment = new Map(
      prepared.map((image) => [image.segmentId, image.path]),
    );

    const slides: SlideOverlay[] = timed.map((item) => ({
      inputPath: imageBySegment.get(item.segment.id) ?? prepared[0]?.path,
      startSec: item.startMs / 1000,
      endSec: Math.max(item.endMs / 1000, item.startMs / 1000 + 0.4),
    }));

    if (slides.length === 0 || !slides[0]?.inputPath) {
      throw new Error('No slide images available for render');
    }

    // Cover the full timeline with the first still as base (no green lead-in).
    slides[0].startSec = 0;
    slides[slides.length - 1].endSec = totalSeconds;
    const backgroundPath = slides[0].inputPath;

    const captions = buildCaptionChunks(words);
    const captionOverlays = await createCaptionOverlays({
      outputDir,
      captions,
    });
    const titleOverlays = await createSegmentTitleOverlays({
      outputDir,
      timedSegments: timed,
    });

    const { args, filterScript } = this.buildFfmpegArgs({
      audioPath,
      totalSeconds,
      slides,
      captionOverlays,
      titleOverlays,
      watermarkPath,
      veilPath,
      backgroundPath,
      outputFileName: basename(outputPath),
    });
    await writeFile(filterScriptPath, filterScript, 'utf8');

    this.logger.log(
      `Rendering image slideshow (${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps, ${totalSeconds.toFixed(1)}s, ${slides.length} slides, ${captionOverlays.length} captions) → ${basename(outputPath)}`,
    );

    await this.runFfmpeg(args, false, outputDir);
    this.logger.log(`FFmpeg render complete: ${outputPath}`);
    return outputPath;
  }

  private async createVeil(outputPath: string): Promise<void> {
    const svg = `
      <svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="veil" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.28"/>
            <stop offset="45%" stop-color="#000000" stop-opacity="0.04"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.42"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#veil)"/>
      </svg>
    `;
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
  }

  private buildFfmpegArgs(params: {
    audioPath: string;
    totalSeconds: number;
    slides: SlideOverlay[];
    captionOverlays: TimedOverlay[];
    titleOverlays: TimedOverlay[];
    watermarkPath: string;
    veilPath: string;
    backgroundPath: string;
    outputFileName: string;
  }): { args: string[]; filterScript: string } {
    const {
      audioPath,
      totalSeconds,
      slides,
      captionOverlays,
      titleOverlays,
      watermarkPath,
      veilPath,
      backgroundPath,
      outputFileName,
    } = params;

    const args: string[] = [
      '-y',
      '-loop',
      '1',
      '-framerate',
      String(VIDEO_FPS),
      '-t',
      totalSeconds.toFixed(3),
      '-i',
      this.toCwdRelative(backgroundPath),
      '-i',
      audioPath,
    ];

    for (const slide of slides) {
      args.push(
        '-loop',
        '1',
        '-framerate',
        String(VIDEO_FPS),
        '-t',
        totalSeconds.toFixed(3),
        '-i',
        this.toCwdRelative(slide.inputPath),
      );
    }

    args.push(
      '-loop',
      '1',
      '-framerate',
      String(VIDEO_FPS),
      '-t',
      totalSeconds.toFixed(3),
      '-i',
      basename(veilPath),
    );

    const textOverlays = [...titleOverlays, ...captionOverlays];
    for (const overlay of textOverlays) {
      args.push(
        '-loop',
        '1',
        '-framerate',
        String(VIDEO_FPS),
        '-t',
        totalSeconds.toFixed(3),
        '-i',
        basename(overlay.file),
      );
    }

    args.push(
      '-loop',
      '1',
      '-framerate',
      String(VIDEO_FPS),
      '-t',
      totalSeconds.toFixed(3),
      '-i',
      basename(watermarkPath),
    );

    const slideCount = slides.length;
    const veilIndex = 2 + slideCount;
    const textStartIndex = veilIndex + 1;
    const watermarkIndex = textStartIndex + textOverlays.length;

    const scriptLines: string[] = [
      `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,format=rgba[base]`,
    ];

    let prev = 'base';
    slides.forEach((slide, index) => {
      const inputIndex = index + 2;
      const scaled = `s${index}`;
      const next = `v${index}`;
      const enable = `between(t\\,${slide.startSec.toFixed(3)}\\,${slide.endSec.toFixed(3)})`;
      scriptLines.push(
        `[${inputIndex}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=rgba[${scaled}]`,
      );
      scriptLines.push(
        `[${prev}][${scaled}]overlay=0:0:format=auto:enable='${enable}'[${next}]`,
      );
      prev = next;
    });

    const afterSlides = slides.length === 0 ? 'base' : `v${slides.length - 1}`;
    scriptLines.push(
      `[${veilIndex}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=rgba[veil]`,
    );
    scriptLines.push(`[${afterSlides}][veil]overlay=0:0:format=auto[veiled]`);

    let textPrev = 'veiled';
    textOverlays.forEach((overlay, index) => {
      const inputIndex = textStartIndex + index;
      const scaled = `tx${index}`;
      const next = `t${index}`;
      const enable = `between(t\\,${overlay.startSec.toFixed(3)}\\,${overlay.endSec.toFixed(3)})`;
      scriptLines.push(`[${inputIndex}:v]format=rgba[${scaled}]`);
      scriptLines.push(
        `[${textPrev}][${scaled}]overlay=${overlay.x}:${overlay.y}:format=auto:enable='${enable}'[${next}]`,
      );
      textPrev = next;
    });

    scriptLines.push(`[${watermarkIndex}:v]format=rgba[wm]`);
    scriptLines.push(
      `[${textPrev}][wm]overlay=0:${VIDEO_HEIGHT - 140}:format=auto,format=yuv420p[vfinal]`,
    );
    scriptLines.push(`[1:a]apad[aout]`);

    args.push(
      '-filter_complex_script',
      'filter.txt',
      '-map',
      '[vfinal]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-r',
      String(VIDEO_FPS),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputFileName,
    );

    return { args, filterScript: scriptLines.join(';\n') };
  }

  /** Paths relative to the render outputDir (ffmpeg cwd). */
  private toCwdRelative(absolutePath: string): string {
    const fileName = basename(absolutePath);
    if (absolutePath.includes('/images/')) {
      return join('images', fileName);
    }
    return fileName;
  }

  private async assertFfmpegAvailable(): Promise<void> {
    try {
      await this.runFfmpeg(['-version'], true);
    } catch {
      throw new Error(
        'ffmpeg not found on PATH. Install ffmpeg to use the custom Node video engine.',
      );
    }
  }

  private runFfmpeg(
    args: string[],
    quiet = false,
    cwd?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, {
        cwd,
        stdio: quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      if (!quiet && child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `ffmpeg exited with code ${code}: ${stderr.slice(-1200) || 'no output'}`,
          ),
        );
      });
    });
  }
}
