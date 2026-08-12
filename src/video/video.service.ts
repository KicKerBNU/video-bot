import { Injectable, Logger } from '@nestjs/common';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { AppConfigService } from '../config/app-config.service';
import { CaptionChunk, VideoScript, WordTimestamp } from '../common/types';
import { VIDEO_FPS } from '../common/video-constants';
import { buildCaptionChunks } from './caption-utils';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private bundleLocationPromise: Promise<string> | null = null;

  constructor(private readonly appConfig: AppConfigService) {}

  async render(params: {
    script: VideoScript;
    audioPath: string;
    durationMs: number;
    words: WordTimestamp[];
  }): Promise<string> {
    const { script, audioPath, durationMs, words } = params;
    const outputDir = join(
      process.cwd(),
      this.appConfig.outputDir,
      script.id,
    );
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'video.mp4');

    const captions: CaptionChunk[] = buildCaptionChunks(words);
    const introPaddingMs = Math.round((70 / VIDEO_FPS) * 1000);
    const totalMs = durationMs + introPaddingMs + 500;
    const durationInFrames = Math.max(
      VIDEO_FPS,
      Math.ceil((totalMs / 1000) * VIDEO_FPS),
    );

    const serveUrl = await this.getBundle();
    const inputProps = {
      title: script.title,
      hook: script.hook,
      brandName: this.appConfig.brandName,
      audioFileUrl: pathToFileURL(resolve(audioPath)).href,
      durationInFrames,
      captions: captions.map((chunk) => ({
        ...chunk,
        startMs: chunk.startMs + introPaddingMs,
        endMs: chunk.endMs + introPaddingMs,
        words: chunk.words.map((word) => ({
          ...word,
          startMs: word.startMs + introPaddingMs,
          endMs: word.endMs + introPaddingMs,
        })),
      })),
      fps: VIDEO_FPS,
    };

    this.logger.log(`Rendering Remotion composition for ${script.id}`);

    const composition = await selectComposition({
      serveUrl,
      id: 'NewsVideo',
      inputProps,
    });

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      overwrite: true,
    });

    this.logger.log(`Video rendered: ${outputPath}`);
    return outputPath;
  }

  private getBundle(): Promise<string> {
    if (!this.bundleLocationPromise) {
      const entry = resolve(process.cwd(), 'compositions/index.ts');
      this.logger.log(`Bundling Remotion entry ${entry}`);
      this.bundleLocationPromise = bundle({
        entryPoint: entry,
        webpackOverride: (config) => config,
      });
    }
    return this.bundleLocationPromise;
  }
}
