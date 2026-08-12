import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { AppConfigService } from '../../config/app-config.service';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '../../common/video-constants';
import { CaptionChunk, VideoScript, WordTimestamp } from '../../common/types';
import { buildCaptionChunks } from '../caption-utils';
import { createBackgroundImage } from './background';
import {
  TimedOverlay,
  createCaptionOverlays,
  createIntroOverlay,
  createWatermarkOverlay,
} from './overlays';

const INTRO_MS = 2300;

export interface FfmpegRenderInput {
  script: VideoScript;
  audioPath: string;
  durationMs: number;
  words: WordTimestamp[];
  outputDir: string;
  outputPath: string;
}

/**
 * Custom Node video engine: FFmpeg + Sharp overlays + ElevenLabs audio.
 * MoviePy-style pipeline without leaving Node (works without libass/drawtext).
 */
@Injectable()
export class FfmpegVideoEngine {
  private readonly logger = new Logger(FfmpegVideoEngine.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async render(input: FfmpegRenderInput): Promise<string> {
    await this.assertFfmpegAvailable();

    const { script, audioPath, durationMs, words, outputDir, outputPath } =
      input;

    const captions: CaptionChunk[] = buildCaptionChunks(words);
    const totalSeconds = Math.max(durationMs + INTRO_MS + 600, 3000) / 1000;

    const backgroundPath = join(outputDir, 'background.png');
    const introPath = join(outputDir, 'intro.png');
    const watermarkPath = join(outputDir, 'watermark.png');
    const filterScriptPath = join(outputDir, 'filter.txt');

    this.logger.log('Generating background + caption overlays');
    await createBackgroundImage(backgroundPath);
    await createIntroOverlay({
      outputPath: introPath,
      title: script.title,
      hook: script.hook,
      brandName: this.appConfig.brandName,
    });
    await createWatermarkOverlay({
      outputPath: watermarkPath,
      brandName: this.appConfig.brandName,
    });

    const captionOverlays = await createCaptionOverlays({
      outputDir,
      captions,
      introMs: INTRO_MS,
    });

    const timedOverlays: TimedOverlay[] = [
      {
        file: introPath,
        startSec: 0,
        endSec: INTRO_MS / 1000,
        x: 0,
        y: 120,
      },
      {
        file: watermarkPath,
        startSec: 0,
        endSec: totalSeconds,
        x: 0,
        y: VIDEO_HEIGHT - 140,
      },
      ...captionOverlays,
    ];

    const { args, filterScript } = this.buildFfmpegArgs({
      audioPath,
      totalSeconds,
      audioDelayMs: INTRO_MS,
      overlays: timedOverlays,
    });
    await writeFile(filterScriptPath, filterScript, 'utf8');

    this.logger.log(
      `Rendering with FFmpeg (${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps, ${totalSeconds.toFixed(1)}s, ${timedOverlays.length} overlays)`,
    );

    await this.runFfmpeg(args, false, outputDir);
    this.logger.log(`FFmpeg render complete: ${outputPath}`);
    return outputPath;
  }

  private buildFfmpegArgs(params: {
    audioPath: string;
    totalSeconds: number;
    audioDelayMs: number;
    overlays: TimedOverlay[];
  }): { args: string[]; filterScript: string } {
    const { audioPath, totalSeconds, audioDelayMs, overlays } = params;

    const args: string[] = [
      '-y',
      '-loop',
      '1',
      '-framerate',
      String(VIDEO_FPS),
      '-t',
      totalSeconds.toFixed(3),
      '-i',
      'background.png',
      '-i',
      audioPath,
    ];

    for (const overlay of overlays) {
      args.push(
        '-loop',
        '1',
        '-t',
        totalSeconds.toFixed(3),
        '-i',
        basename(overlay.file),
      );
    }

    const scriptLines: string[] = [
      `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,format=rgba[base]`,
    ];

    if (overlays.length === 0) {
      scriptLines.push('[base]format=yuv420p[vfinal]');
    } else {
      let prev = 'base';
      overlays.forEach((overlay, index) => {
        const inputIndex = index + 2;
        const isLast = index === overlays.length - 1;
        const next = isLast ? 'vtmp' : `v${index}`;
        const enable = `between(t\\,${overlay.startSec.toFixed(3)}\\,${overlay.endSec.toFixed(3)})`;
        scriptLines.push(
          `[${prev}][${inputIndex}:v]overlay=x=${overlay.x}:y=${overlay.y}:format=auto:enable='${enable}'[${next}]`,
        );
        prev = next;
      });
      scriptLines.push('[vtmp]format=yuv420p[vfinal]');
    }

    scriptLines.push(
      `[1:a]adelay=${audioDelayMs}|${audioDelayMs},apad[aout]`,
    );

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
      'video.mp4',
    );

    return { args, filterScript: scriptLines.join(';\n') };
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
