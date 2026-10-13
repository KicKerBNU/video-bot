import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { WordTimestamp } from '../common/types';

interface LocalTtsResponse {
  ok?: boolean;
  audio_base64?: string;
  mime_type?: string;
  durationMs?: number;
  words?: WordTimestamp[];
  detail?: string;
}

export interface LocalTtsHealth {
  ok: boolean;
  reachable: boolean;
  voiceReady: boolean;
  voice: string;
  loaded: boolean;
  device?: string;
  packCount?: number;
  packUsed?: number;
  legacyWav?: boolean;
  kokoroReady?: boolean;
  kokoroVoice?: string;
  detail?: string;
}

/**
 * Local XTTS voice-clone worker client.
 * Expects workers/tts/server.py running at LOCAL_TTS_URL.
 */
@Injectable()
export class LocalTtsClient {
  private readonly logger = new Logger(LocalTtsClient.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async health(): Promise<LocalTtsHealth> {
    const voice = this.appConfig.localTtsVoice;
    const endpoint = `${this.appConfig.localTtsUrl}/health`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        const payload = (await response.json()) as {
          ok?: boolean;
          voice_ready?: boolean;
          voice?: string;
          loaded?: boolean;
          device?: string;
          pack_count?: number;
          pack_used?: number;
          legacy_wav?: boolean;
          kokoro_ready?: boolean;
          kokoro_voice?: string;
        };
        if (!response.ok) {
          return {
            ok: false,
            reachable: true,
            voiceReady: false,
            voice,
            loaded: false,
            detail: `HTTP ${response.status}`,
          };
        }
        return {
          ok: Boolean(payload.ok),
          reachable: true,
          voiceReady: Boolean(payload.voice_ready),
          voice: payload.voice ?? voice,
          loaded: Boolean(payload.loaded),
          device: payload.device,
          packCount: payload.pack_count ?? 0,
          packUsed: payload.pack_used ?? 0,
          legacyWav: Boolean(payload.legacy_wav),
          kokoroReady: Boolean(payload.kokoro_ready),
          kokoroVoice: payload.kokoro_voice,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reachable: false,
        voiceReady: false,
        voice,
        loaded: false,
        detail,
      };
    }
  }

  async synthesize(
    text: string,
    voice: string,
  ): Promise<{ audio: Buffer; durationMs: number; words: WordTimestamp[] }> {
    const endpoint = `${this.appConfig.localTtsUrl}/synthesize`;
    this.logger.log(`Local TTS synthesize → ${endpoint} (${voice})`);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.appConfig.localTtsTimeoutMs,
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          language: 'en',
          speaker_wav: voice,
        }),
      });

      const payload = (await response.json()) as LocalTtsResponse;
      if (!response.ok) {
        throw new Error(
          `Local TTS ${response.status}: ${payload.detail ?? JSON.stringify(payload).slice(0, 300)}`,
        );
      }

      if (!payload.audio_base64) {
        throw new Error('Local TTS returned no audio_base64');
      }

      const audio = Buffer.from(payload.audio_base64, 'base64');
      if (audio.length < 1000) {
        throw new Error('Local TTS returned empty audio');
      }

      const words = Array.isArray(payload.words) ? payload.words : [];
      const durationMs =
        payload.durationMs && payload.durationMs > 0
          ? payload.durationMs
          : words.length > 0
            ? words[words.length - 1].endMs
            : 1000;

      return { audio, durationMs, words };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Local TTS timed out after ${this.appConfig.localTtsTimeoutMs}ms — is yarn tts:serve running?`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Kokoro-82M — used as Edge TTS fallback when Microsoft blocks free Edge. */
  async synthesizeKokoro(
    text: string,
    voice?: string,
  ): Promise<{ audio: Buffer; durationMs: number; words: WordTimestamp[] }> {
    const endpoint = `${this.appConfig.localTtsUrl}/synthesize-kokoro`;
    this.logger.log(
      `Kokoro TTS synthesize → ${endpoint} (${voice ?? 'default'})`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.appConfig.localTtsTimeoutMs,
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          ...(voice ? { voice } : {}),
          language: 'en-us',
        }),
      });

      const payload = (await response.json()) as LocalTtsResponse;
      if (!response.ok) {
        throw new Error(
          `Kokoro TTS ${response.status}: ${payload.detail ?? JSON.stringify(payload).slice(0, 300)}`,
        );
      }

      if (!payload.audio_base64) {
        throw new Error('Kokoro TTS returned no audio_base64');
      }

      const audio = Buffer.from(payload.audio_base64, 'base64');
      if (audio.length < 1000) {
        throw new Error('Kokoro TTS returned empty audio');
      }

      const words = Array.isArray(payload.words) ? payload.words : [];
      const durationMs =
        payload.durationMs && payload.durationMs > 0
          ? payload.durationMs
          : words.length > 0
            ? words[words.length - 1].endMs
            : 1000;

      return { audio, durationMs, words };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Kokoro TTS timed out after ${this.appConfig.localTtsTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
