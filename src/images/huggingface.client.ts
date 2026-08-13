import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Hugging Face Inference Providers text-to-image client.
 * Uses Together / fal-ai (FLUX.1-schnell is no longer on hf-inference).
 * https://huggingface.co/docs/inference-providers/tasks/text-to-image
 */
@Injectable()
export class HuggingFaceImageClient {
  private readonly logger = new Logger(HuggingFaceImageClient.name);

  constructor(private readonly appConfig: AppConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.appConfig.huggingFaceToken);
  }

  async generateImageBuffer(prompt: string): Promise<Buffer> {
    if (!this.isConfigured) {
      throw new Error('HF_TOKEN is not configured');
    }

    const errors: string[] = [];

    try {
      return await this.generateViaTogether(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`together: ${message}`);
      this.logger.warn(`HF together failed: ${message}`);
    }

    try {
      return await this.generateViaFal(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`fal-ai: ${message}`);
      this.logger.warn(`HF fal-ai failed: ${message}`);
    }

    throw new Error(`Hugging Face image generation failed: ${errors.join('; ')}`);
  }

  private async generateViaTogether(prompt: string): Promise<Buffer> {
    const endpoint =
      'https://router.huggingface.co/together/v1/images/generations';
    const response = await this.fetchWithRetry(endpoint, {
      model: this.appConfig.huggingFaceImageModel,
      prompt,
      width: this.appConfig.huggingFaceImageWidth,
      height: this.appConfig.huggingFaceImageHeight,
      response_format: 'b64_json',
    });

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: string;
    };

    const b64 = payload.data?.[0]?.b64_json;
    if (b64) {
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length < 1000) {
        throw new Error('Together returned an empty/invalid image');
      }
      return bytes;
    }

    const url = payload.data?.[0]?.url;
    if (url) {
      return this.downloadImage(url);
    }

    throw new Error(payload.error ?? 'Together returned no image data');
  }

  private async generateViaFal(prompt: string): Promise<Buffer> {
    const endpoint = 'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell';
    const response = await this.fetchWithRetry(endpoint, {
      prompt,
      image_size: {
        width: this.appConfig.huggingFaceImageWidth,
        height: this.appConfig.huggingFaceImageHeight,
      },
      sync_mode: true,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('image')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1000) {
        throw new Error('fal-ai returned an empty/invalid image');
      }
      return bytes;
    }

    const payload = (await response.json()) as {
      images?: Array<{ url?: string }>;
      image?: { url?: string };
      error?: string;
      detail?: unknown;
    };

    const url = payload.images?.[0]?.url ?? payload.image?.url;
    if (url) {
      return this.downloadImage(url);
    }

    throw new Error(
      payload.error ??
        (typeof payload.detail === 'string'
          ? payload.detail
          : 'fal-ai returned no image URL'),
    );
  }

  private async fetchWithRetry(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const maxAttempts = 8;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appConfig.huggingFaceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();
      let parsed: { error?: string; estimated_time?: number } = {};
      try {
        parsed = JSON.parse(bodyText) as {
          error?: string;
          estimated_time?: number;
        };
      } catch {
        parsed = { error: bodyText.slice(0, 300) };
      }

      if (
        response.status === 503 ||
        response.status === 429 ||
        /loading|currently loading/i.test(parsed.error ?? '')
      ) {
        const waitSec = Math.max(3, Math.ceil(parsed.estimated_time ?? 8));
        this.logger.log(
          `HF warming/rate-limited (attempt ${attempt}/${maxAttempts}), waiting ${waitSec}s`,
        );
        await this.sleep(waitSec * 1000);
        continue;
      }

      throw new Error(
        `HF ${response.status}: ${parsed.error ?? bodyText.slice(0, 300)}`,
      );
    }

    throw new Error('HF image generation timed out while model was loading');
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image (${response.status})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000) {
      throw new Error('Downloaded image was empty/invalid');
    }
    return bytes;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
