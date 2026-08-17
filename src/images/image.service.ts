import { Injectable, Logger } from '@nestjs/common';
import { access, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { AppConfigService } from '../config/app-config.service';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '../common/video-constants';
import { ScriptSegment } from '../common/types';
import { createBackgroundImage } from '../video/engine/background';
import { HuggingFaceImageClient } from './huggingface.client';
import { KlingImageClient } from './kling.client';
import { WanImageClient } from './wan.client';

interface OpenverseResult {
  title?: string;
  url?: string;
  thumbnail?: string;
}

interface OpenverseResponse {
  results?: OpenverseResult[];
}

export interface PreparedImage {
  segmentId: string;
  path: string;
  query: string;
  provider: 'wan' | 'huggingface' | 'kling' | 'openverse' | 'fallback';
}

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly wan: WanImageClient,
    private readonly huggingFace: HuggingFaceImageClient,
    private readonly kling: KlingImageClient,
  ) {}

  async prepareSegmentImages(params: {
    segments: ScriptSegment[];
    outputDir: string;
  }): Promise<PreparedImage[]> {
    const { segments, outputDir } = params;
    const imagesDir = join(outputDir, 'images');
    await mkdir(imagesDir, { recursive: true });

    const prepared: PreparedImage[] = [];
    const usedUrls = new Set<string>();
    const provider = this.appConfig.imageProvider;

    if (provider === 'wan' && !this.wan.isConfigured) {
      this.logger.warn(
        'IMAGE_PROVIDER=wan but WAN_API_URL missing — falling back to Openverse',
      );
    }
    if (provider === 'huggingface' && !this.huggingFace.isConfigured) {
      this.logger.warn(
        'IMAGE_PROVIDER=huggingface but HF_TOKEN missing — falling back to Openverse',
      );
    }
    if (provider === 'kling' && !this.kling.isConfigured) {
      this.logger.warn(
        'IMAGE_PROVIDER=kling but Kling key missing — falling back to Openverse',
      );
    }

    for (const [index, segment] of segments.entries()) {
      const target = join(imagesDir, `segment-${index}-${segment.id}.jpg`);
      const reuseImages = this.appConfig.reuseImages;

      if (reuseImages) {
        try {
          await access(target);
          prepared.push({
            segmentId: segment.id,
            path: target,
            query: segment.searchQuery,
            provider: 'wan',
          });
          this.logger.log(`Reusing cached image for ${segment.id}`);
          continue;
        } catch {
          // Fall through to generate.
        }
      }

      try {
        let providerUsed: PreparedImage['provider'] = 'openverse';

        if (provider === 'wan' && this.wan.isConfigured) {
          const prompt = this.buildAiPrompt(segment);
          this.logger.log(`Wan generating image for ${segment.id}`);
          const buffer = await this.wan.generateImageBuffer(prompt);
          await this.fitBuffer(buffer, target);
          providerUsed = 'wan';
        } else if (provider === 'huggingface' && this.huggingFace.isConfigured) {
          const prompt = this.buildAiPrompt(segment);
          this.logger.log(`Hugging Face generating image for ${segment.id}`);
          const buffer = await this.huggingFace.generateImageBuffer(prompt);
          await this.fitBuffer(buffer, target);
          providerUsed = 'huggingface';
        } else if (provider === 'kling' && this.kling.isConfigured) {
          const prompt = this.buildAiPrompt(segment);
          this.logger.log(`Kling generating image for ${segment.id}`);
          const url = await this.kling.generateImageUrl(prompt);
          usedUrls.add(url);
          await this.downloadAndFit(url, target);
          providerUsed = 'kling';
        } else {
          const url = await this.findOpenverseUrl(segment.searchQuery, usedUrls);
          if (!url) {
            throw new Error('No image candidates');
          }
          usedUrls.add(url);
          await this.downloadAndFit(url, target);
          providerUsed = 'openverse';
        }

        prepared.push({
          segmentId: segment.id,
          path: target,
          query: segment.searchQuery,
          provider: providerUsed,
        });
        this.logger.log(
          `Image ready for ${segment.id} via ${providerUsed}: ${segment.searchQuery}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Primary image provider failed for "${segment.searchQuery}" (${message}); trying Openverse`,
        );

        try {
          const url = await this.findOpenverseUrl(segment.searchQuery, usedUrls);
          if (!url) {
            throw new Error('No Openverse candidates');
          }
          usedUrls.add(url);
          await this.downloadAndFit(url, target);
          prepared.push({
            segmentId: segment.id,
            path: target,
            query: segment.searchQuery,
            provider: 'openverse',
          });
          this.logger.log(`Image ready for ${segment.id} via openverse fallback`);
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
          this.logger.warn(
            `Openverse also failed (${fallbackMessage}); using solid fallback`,
          );
          const fallback = join(
            imagesDir,
            `segment-${index}-${segment.id}-fallback.png`,
          );
          await createBackgroundImage(fallback);
          prepared.push({
            segmentId: segment.id,
            path: fallback,
            query: segment.searchQuery,
            provider: 'fallback',
          });
        }
      }
    }

    return prepared;
  }

  private buildAiPrompt(segment: ScriptSegment): string {
    if (segment.imagePrompt?.trim()) {
      return segment.imagePrompt.trim();
    }

    return [
      'Photorealistic vertical news B-roll still photograph only, cinematic lighting,',
      `visual subject: ${segment.searchQuery || segment.title}.`,
      'Real physical scene, unmarked surfaces, no screens displaying content.',
      'Absolutely no text, letters, words, numbers, captions, logos, signage,',
      'monitors with UI, dashboards, HUD, green bars, or overlays.',
    ].join(' ');
  }

  private async findOpenverseUrl(
    query: string,
    usedUrls: Set<string>,
  ): Promise<string | null> {
    const attempts = [
      query,
      query.replace(/\stechnology$/i, '').trim(),
      query.split(/\s+/).slice(0, 2).join(' '),
      'artificial intelligence',
    ].filter(
      (value, index, arr) => value.length > 0 && arr.indexOf(value) === index,
    );

    for (const attempt of attempts) {
      const params = new URLSearchParams({
        q: attempt,
        page_size: '12',
        mature: 'false',
      });

      const response = await fetch(
        `https://api.openverse.org/v1/images/?${params.toString()}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ZanshinAI-video-gen/1.0',
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(`Openverse ${response.status} for "${attempt}"`);
        continue;
      }

      const payload = (await response.json()) as OpenverseResponse;
      const candidates = (payload.results ?? [])
        .map((item) => item.url || item.thumbnail)
        .filter((url): url is string => Boolean(url))
        .filter((url) => !usedUrls.has(url))
        .filter(
          (url) =>
            /\.(jpe?g|png|webp)(\?|$)/i.test(url) ||
            url.includes('upload.wikimedia.org'),
        );

      if (candidates[0]) {
        return candidates[0];
      }
    }

    return null;
  }

  private async downloadAndFit(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ZanshinAI-video-gen/1.0',
        Accept: 'image/*',
      },
    });
    if (!response.ok) {
      throw new Error(`Download failed ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await this.fitBuffer(Buffer.from(arrayBuffer), outputPath);
  }

  private async fitBuffer(raw: Buffer, outputPath: string): Promise<void> {
    await sharp(raw)
      .rotate()
      .resize(VIDEO_WIDTH, VIDEO_HEIGHT, {
        fit: 'cover',
        position: 'attention',
      })
      .jpeg({ quality: 85 })
      .toFile(outputPath);
  }
}
