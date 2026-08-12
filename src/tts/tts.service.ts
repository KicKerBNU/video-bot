import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { AppConfigService } from '../config/app-config.service';
import { TtsResult, WordTimestamp } from '../common/types';

interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenLabsResponse {
  audio_base64?: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async synthesize(text: string, newsId: string): Promise<TtsResult> {
    const voiceId = this.appConfig.elevenLabsVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;

    this.logger.log(`Synthesizing TTS for news ${newsId}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.appConfig.elevenLabsApiKey,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `ElevenLabs TTS failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as ElevenLabsResponse;
    if (!payload.audio_base64) {
      throw new Error('ElevenLabs response missing audio_base64');
    }

    const outputDir = join(process.cwd(), this.appConfig.outputDir, newsId);
    await mkdir(outputDir, { recursive: true });
    const audioPath = join(outputDir, 'narration.mp3');

    const audioBuffer = Buffer.from(payload.audio_base64, 'base64');
    await pipeline(Readable.from(audioBuffer), createWriteStream(audioPath));

    const alignment = payload.normalized_alignment ?? payload.alignment;
    const words = this.alignmentToWords(alignment);
    const durationMs =
      words.length > 0
        ? words[words.length - 1].endMs
        : Math.max(1000, Math.round((audioBuffer.length / 16000) * 1000));

    this.logger.log(
      `TTS ready: ${words.length} words, ~${Math.round(durationMs / 1000)}s`,
    );

    return { audioPath, durationMs, words };
  }

  private alignmentToWords(
    alignment: ElevenLabsAlignment | undefined,
  ): WordTimestamp[] {
    if (
      !alignment?.characters ||
      !alignment.character_start_times_seconds ||
      !alignment.character_end_times_seconds
    ) {
      return [];
    }

    const { characters, character_start_times_seconds, character_end_times_seconds } =
      alignment;

    const words: WordTimestamp[] = [];
    let current = '';
    let startMs = 0;
    let endMs = 0;

    const flush = () => {
      const word = current.trim();
      if (word) {
        words.push({ word, startMs, endMs });
      }
      current = '';
    };

    for (let i = 0; i < characters.length; i += 1) {
      const char = characters[i];
      const charStart = Math.round(character_start_times_seconds[i] * 1000);
      const charEnd = Math.round(character_end_times_seconds[i] * 1000);

      if (/\s/.test(char)) {
        flush();
        continue;
      }

      if (!current) {
        startMs = charStart;
      }
      current += char;
      endMs = charEnd;
    }

    flush();
    return words;
  }
}
