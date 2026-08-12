import { Injectable, Logger } from '@nestjs/common';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { EdgeTTS } from 'edge-tts-universal';
import { AppConfigService } from '../config/app-config.service';
import { TtsResult, WordTimestamp } from '../common/types';

interface EdgeSubtitleCue {
  offset: number;
  duration: number;
  text: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async synthesize(text: string, newsId: string): Promise<TtsResult> {
    const voice = this.appConfig.edgeTtsVoice;
    this.logger.log(`Synthesizing Edge TTS (${voice}) for news ${newsId}`);

    const tts = new EdgeTTS(text, voice);
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    const outputDir = join(process.cwd(), this.appConfig.outputDir, newsId);
    await mkdir(outputDir, { recursive: true });
    const audioPath = join(outputDir, 'narration.mp3');
    await writeFile(audioPath, audioBuffer);

    const cues = (result.subtitle ?? []) as EdgeSubtitleCue[];
    const words = this.cuesToWords(cues);
    const durationMs =
      words.length > 0
        ? words[words.length - 1].endMs
        : Math.max(1000, Math.round((audioBuffer.length / 6000) * 1000));

    this.logger.log(
      `TTS ready: ${words.length} words, ~${Math.round(durationMs / 1000)}s`,
    );

    return { audioPath, durationMs, words };
  }

  /** Edge offsets/durations are in 100-nanosecond units. */
  private cuesToWords(cues: EdgeSubtitleCue[]): WordTimestamp[] {
    return cues
      .map((cue) => {
        const startMs = Math.round(cue.offset / 10_000);
        const endMs = Math.round((cue.offset + cue.duration) / 10_000);
        return {
          word: cue.text.trim(),
          startMs,
          endMs: Math.max(endMs, startMs + 40),
        };
      })
      .filter((word) => word.word.length > 0);
  }
}
