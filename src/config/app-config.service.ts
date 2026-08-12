import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return Number(this.config.get<string>('PORT') ?? 3000);
  }

  get newsApiUrl(): string {
    return this.config.getOrThrow<string>('NEWS_API_URL');
  }

  get newsApiKey(): string | undefined {
    const key = this.config.get<string>('NEWS_API_KEY');
    return key && key.length > 0 ? key : undefined;
  }

  /** Microsoft Edge neural voice (free, no API key). */
  get edgeTtsVoice(): string {
    return (
      this.config.get<string>('EDGE_TTS_VOICE') ?? 'en-US-GuyNeural'
    );
  }

  get twitterApiKey(): string {
    return this.config.getOrThrow<string>('TWITTER_API_KEY');
  }

  get twitterApiSecret(): string {
    return this.config.getOrThrow<string>('TWITTER_API_SECRET');
  }

  get twitterAccessToken(): string {
    return this.config.getOrThrow<string>('TWITTER_ACCESS_TOKEN');
  }

  get twitterAccessSecret(): string {
    return this.config.getOrThrow<string>('TWITTER_ACCESS_SECRET');
  }

  get tiktokClientKey(): string {
    return this.config.getOrThrow<string>('TIKTOK_CLIENT_KEY');
  }

  get tiktokClientSecret(): string {
    return this.config.getOrThrow<string>('TIKTOK_CLIENT_SECRET');
  }

  get tiktokAccessToken(): string {
    return this.config.getOrThrow<string>('TIKTOK_ACCESS_TOKEN');
  }

  get cronSchedule(): string {
    // Digest publishes at 08:00 UTC; wait 1 minute before generating.
    return this.config.get<string>('CRON_SCHEDULE') ?? '1 8 * * *';
  }

  get cronTimezone(): string {
    return this.config.get<string>('CRON_TIMEZONE') ?? 'UTC';
  }

  get brandName(): string {
    return this.config.get<string>('BRAND_NAME') ?? 'AI Daily';
  }

  get skipPublish(): boolean {
    return (this.config.get<string>('SKIP_PUBLISH') ?? 'false') === 'true';
  }

  get dataDir(): string {
    return this.config.get<string>('DATA_DIR') ?? 'data';
  }

  get outputDir(): string {
    return this.config.get<string>('OUTPUT_DIR') ?? 'output';
  }
}
