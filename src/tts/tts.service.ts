import { Injectable, Logger } from '@nestjs/common';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { EdgeTTS } from 'edge-tts-universal';
import { AppConfigService } from '../config/app-config.service';
import { TtsResult, WordTimestamp } from '../common/types';
import { LocalTtsClient, LocalTtsHealth } from './local-tts.client';

interface EdgeSubtitleCue {
  offset: number;
  duration: number;
  text: string;
}

export type TtsForceProvider = 'edge' | 'local';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private lastResultMeta: {
    provider: 'local' | 'edge' | 'kokoro';
    fallbackReason?: string;
    at: string;
  } | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly localTts: LocalTtsClient,
  ) {}

  getLastResultMeta() {
    return this.lastResultMeta;
  }

  async getLocalHealth(): Promise<LocalTtsHealth | null> {
    return this.localTts.health();
  }

  async synthesize(
    text: string,
    newsId: string,
    options?: {
      forceProvider?: TtsForceProvider;
      audioFileName?: string;
    },
  ): Promise<TtsResult> {
    const force = options?.forceProvider;
    const audioFileName = options?.audioFileName;

    const wantLocal =
      force === 'local' ||
      (force !== 'edge' && this.appConfig.ttsProvider === 'local');

    if (wantLocal) {
      const health = await this.localTts.health();
      if (!health.reachable) {
        const reason = `Local TTS worker unreachable (${health.detail ?? 'down'})`;
        if (force === 'local') {
          throw new Error(reason);
        }
        this.logger.error(`${reason}; falling back to Edge`);
        return this.synthesizeDefaultVoice(text, newsId, reason, audioFileName);
      }
      if (!health.voiceReady) {
        const reason = `Local TTS voice sample missing (need workers/tts/voices/${this.appConfig.localTtsVoice}.wav or voice pack)`;
        if (force === 'local') {
          throw new Error(reason);
        }
        this.logger.error(`${reason}; falling back to Edge`);
        return this.synthesizeDefaultVoice(text, newsId, reason, audioFileName);
      }

      try {
        return await this.synthesizeLocal(text, newsId, audioFileName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason = `Local TTS failed (${message})`;
        if (force === 'local') {
          throw error instanceof Error ? error : new Error(reason);
        }
        this.logger.error(`${reason}; falling back to Edge`);
        return this.synthesizeDefaultVoice(text, newsId, reason, audioFileName);
      }
    }

    return this.synthesizeDefaultVoice(text, newsId, undefined, audioFileName);
  }

  /**
   * Default non-clone voice: Microsoft Edge first, then local Kokoro-82M
   * (never the XTTS clone — that track is separate).
   */
  private async synthesizeDefaultVoice(
    text: string,
    newsId: string,
    priorReason?: string,
    audioFileName = 'narration.mp3',
  ): Promise<TtsResult> {
    try {
      return await this.synthesizeEdge(text, newsId, priorReason, audioFileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = priorReason
        ? `${priorReason}; Edge also failed (${message})`
        : `Edge TTS failed (${message})`;
      this.logger.error(`${reason}; falling back to Kokoro-82M`);
      return this.synthesizeKokoro(text, newsId, reason, audioFileName);
    }
  }

  private async synthesizeLocal(
    text: string,
    newsId: string,
    audioFileName = 'narration-clone.mp3',
  ): Promise<TtsResult> {
    const voice = this.appConfig.localTtsVoice;
    this.logger.log(`Synthesizing local TTS (${voice}) for news ${newsId}`);

    const result = await this.localTts.synthesize(text, voice);
    const outputDir = join(process.cwd(), this.appConfig.outputDir, newsId);
    await mkdir(outputDir, { recursive: true });
    const audioPath = join(outputDir, audioFileName);
    await writeFile(audioPath, result.audio);

    this.logger.log(
      `Local TTS ready: ${result.words.length} words, ~${Math.round(result.durationMs / 1000)}s`,
    );

    this.lastResultMeta = {
      provider: 'local',
      at: new Date().toISOString(),
    };

    return {
      audioPath,
      durationMs: result.durationMs,
      words: result.words,
      provider: 'local',
    };
  }

  private async synthesizeKokoro(
    text: string,
    newsId: string,
    fallbackReason: string,
    audioFileName = 'narration.mp3',
  ): Promise<TtsResult> {
    this.logger.log(`Synthesizing Kokoro-82M for news ${newsId}`);

    const health = await this.localTts.health();
    if (!health.reachable) {
      throw new Error(
        `Kokoro unavailable — local TTS worker down (${health.detail ?? 'unreachable'})`,
      );
    }
    if (!health.kokoroReady) {
      throw new Error(
        'Kokoro models missing — run yarn tts:kokoro:setup then restart the TTS worker',
      );
    }

    const result = await this.localTts.synthesizeKokoro(text);
    const outputDir = join(process.cwd(), this.appConfig.outputDir, newsId);
    await mkdir(outputDir, { recursive: true });
    const audioPath = join(outputDir, audioFileName);
    await writeFile(audioPath, result.audio);

    this.logger.log(
      `Kokoro ready: ${result.words.length} words, ~${Math.round(result.durationMs / 1000)}s`,
    );

    this.lastResultMeta = {
      provider: 'kokoro',
      fallbackReason,
      at: new Date().toISOString(),
    };

    return {
      audioPath,
      durationMs: result.durationMs,
      words: result.words,
      provider: 'kokoro',
      fallbackReason,
    };
  }

  private async synthesizeEdge(
    text: string,
    newsId: string,
    fallbackReason?: string,
    audioFileName = 'narration.mp3',
  ): Promise<TtsResult> {
    const voice = this.appConfig.edgeTtsVoice;
    const timeoutMs = 25_000;
    this.logger.log(
      `Synthesizing Edge TTS (${voice}) for news ${newsId}${
        fallbackReason ? ` [fallback: ${fallbackReason}]` : ''
      }`,
    );

    const tts = new EdgeTTS(text, voice);
    const result = await Promise.race([
      tts.synthesize(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Edge TTS timed out after ${Math.round(timeoutMs / 1000)}s (Microsoft speech WebSocket hung/403)`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    const outputDir = join(process.cwd(), this.appConfig.outputDir, newsId);
    await mkdir(outputDir, { recursive: true });
    const audioPath = join(outputDir, audioFileName);
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

    this.lastResultMeta = {
      provider: 'edge',
      fallbackReason,
      at: new Date().toISOString(),
    };

    return {
      audioPath,
      durationMs,
      words,
      provider: 'edge',
      fallbackReason,
    };
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
