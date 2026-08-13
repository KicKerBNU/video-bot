import { Injectable, Logger } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { AppConfigService } from '../config/app-config.service';

interface KlingTaskCreated {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string;
  };
}

interface KlingImageTask {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: {
      images?: Array<{ url?: string; index?: number }>;
    };
  };
}

/**
 * Kling AI (Kuaishou) text-to-image client.
 * Supports:
 * - KLING_API_KEY as Bearer token (single key)
 * - or KLING_ACCESS_KEY + KLING_SECRET_KEY JWT auth
 */
@Injectable()
export class KlingImageClient {
  private readonly logger = new Logger(KlingImageClient.name);

  constructor(private readonly appConfig: AppConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.appConfig.klingApiKey ||
        (this.appConfig.klingAccessKey && this.appConfig.klingSecretKey),
    );
  }

  async generateImageUrl(prompt: string): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('Kling API key is not configured');
    }

    const token = this.getAuthToken();
    const baseUrl = this.appConfig.klingApiBaseUrl;
    const createResponse = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model_name: this.appConfig.klingImageModel,
        prompt,
        n: 1,
        aspect_ratio: '9:16',
        resolution: this.appConfig.klingImageResolution,
        negative_prompt:
          'text, watermark, logo, subtitle, caption, blurry, low quality, distorted faces',
      }),
    });

    const created = (await createResponse.json()) as KlingTaskCreated;
    if (!createResponse.ok || created.code !== 0 || !created.data?.task_id) {
      throw new Error(
        `Kling create failed (${createResponse.status}): ${created.message ?? JSON.stringify(created).slice(0, 300)}`,
      );
    }

    const taskId = created.data.task_id;
    this.logger.log(`Kling image task created: ${taskId}`);
    return this.waitForImageUrl(taskId, token, baseUrl);
  }

  private async waitForImageUrl(
    taskId: string,
    token: string,
    baseUrl: string,
  ): Promise<string> {
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.sleep(3000);
      const response = await fetch(
        `${baseUrl}/v1/images/generations/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
      );
      const payload = (await response.json()) as KlingImageTask;
      const status = payload.data?.task_status;

      if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
        throw new Error(
          `Kling poll failed: ${payload.message ?? payload.data?.task_status_msg ?? response.status}`,
        );
      }

      if (status === 'succeed') {
        const url = payload.data?.task_result?.images?.[0]?.url;
        if (!url) {
          throw new Error('Kling succeeded but returned no image URL');
        }
        return url;
      }

      if (status === 'failed') {
        throw new Error(
          `Kling generation failed: ${payload.data?.task_status_msg ?? 'unknown'}`,
        );
      }

      this.logger.log(`Kling task ${taskId} status=${status ?? 'pending'}`);
    }

    throw new Error(`Kling task ${taskId} timed out`);
  }

  private getAuthToken(): string {
    if (this.appConfig.klingApiKey) {
      return this.appConfig.klingApiKey;
    }

    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        iss: this.appConfig.klingAccessKey,
        exp: now + 1800,
        nbf: now - 5,
      },
      this.appConfig.klingSecretKey!,
      {
        algorithm: 'HS256',
        header: { alg: 'HS256', typ: 'JWT' },
      },
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
