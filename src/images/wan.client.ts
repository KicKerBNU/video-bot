import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

interface WanGenerateResponse {
  ok?: boolean;
  image_base64?: string;
  detail?: string;
}

/**
 * Local Wan2.1 image worker client (no cloud credits).
 * Expects workers/wan/server.py running at WAN_API_URL.
 */
@Injectable()
export class WanImageClient {
  private readonly logger = new Logger(WanImageClient.name);

  constructor(private readonly appConfig: AppConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.appConfig.wanApiUrl);
  }

  async generateImageBuffer(prompt: string): Promise<Buffer> {
    if (!this.isConfigured) {
      throw new Error('WAN_API_URL is not configured');
    }

    const endpoint = `${this.appConfig.wanApiUrl.replace(/\/$/, '')}/generate`;
    this.logger.log(`Wan generate → ${endpoint}`);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.appConfig.wanTimeoutMs,
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          width: this.appConfig.wanImageWidth,
          height: this.appConfig.wanImageHeight,
          steps: this.appConfig.wanSteps,
          guidance_scale: this.appConfig.wanGuidanceScale,
        }),
      });

      const payload = (await response.json()) as WanGenerateResponse;
      if (!response.ok) {
        throw new Error(
          `Wan ${response.status}: ${payload.detail ?? JSON.stringify(payload).slice(0, 300)}`,
        );
      }

      if (!payload.image_base64) {
        throw new Error('Wan returned no image_base64');
      }

      const bytes = Buffer.from(payload.image_base64, 'base64');
      if (bytes.length < 1000) {
        throw new Error('Wan returned an empty/invalid image');
      }
      return bytes;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Wan timed out after ${this.appConfig.wanTimeoutMs}ms — is the local worker running?`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
