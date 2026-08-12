import { Injectable, Logger } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { AppConfigService } from '../config/app-config.service';
import { VideoScript, WordTimestamp } from '../common/types';
import { FfmpegVideoEngine } from './engine/ffmpeg.engine';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly engine: FfmpegVideoEngine,
  ) {}

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

    this.logger.log(`Rendering with custom FFmpeg engine for ${script.id}`);

    return this.engine.render({
      script,
      audioPath,
      durationMs,
      words,
      outputDir,
      outputPath,
    });
  }
}
