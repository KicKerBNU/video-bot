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
    const words: WordTimestamp[] = [];

    for (const cue of cues) {
      const parts = this.splitCueText(cue.text);
      if (parts.length === 0) {
        continue;
      }

      const startMs = Math.round(cue.offset / 10_000);
      const endMs = Math.max(
        startMs + 40,
        Math.round((cue.offset + cue.duration) / 10_000),
      );
      const slice = Math.max(40, (endMs - startMs) / parts.length);

      parts.forEach((part, index) => {
        const partStart = Math.round(startMs + index * slice);
        words.push({
          word: part,
          startMs: partStart,
          endMs: Math.round(partStart + slice),
        });
      });
    }

    return words;
  }

  /** Split subtitle cues that arrive glued ("500BillionFinancing"). */
  private splitCueText(text: string): string[] {
    return text
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([0-9])([A-Za-z])/g, '$1 $2')
      .replace(/([A-Za-z])([0-9])/g, '$1 $2')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
}
