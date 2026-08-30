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

  get imageProvider(): 'wan' | 'huggingface' | 'kling' | 'openverse' {
    const value = (this.config.get<string>('IMAGE_PROVIDER') ?? 'wan')
      .trim()
      .toLowerCase();
    if (value === 'huggingface') {
      return 'huggingface';
    }
    if (value === 'kling') {
      return 'kling';
    }
    if (value === 'openverse') {
      return 'openverse';
    }
    return 'wan';
  }

  /** Local Wan worker base URL, e.g. http://127.0.0.1:7860 */
  get wanApiUrl(): string {
    return (
      this.config.get<string>('WAN_API_URL') ?? 'http://127.0.0.1:7860'
    ).replace(/\/$/, '');
  }

  get wanImageWidth(): number {
    return Number(this.config.get<string>('WAN_IMAGE_WIDTH') ?? 480);
  }

  get wanImageHeight(): number {
    return Number(this.config.get<string>('WAN_IMAGE_HEIGHT') ?? 832);
  }

  get wanSteps(): number {
    return Number(this.config.get<string>('WAN_STEPS') ?? 30);
  }

  get wanGuidanceScale(): number {
    return Number(this.config.get<string>('WAN_GUIDANCE_SCALE') ?? 5);
  }

  get wanTimeoutMs(): number {
    return Number(this.config.get<string>('WAN_TIMEOUT_MS') ?? 600_000);
  }

  get huggingFaceToken(): string | undefined {
    const key =
      this.config.get<string>('HF_TOKEN') ??
      this.config.get<string>('HUGGINGFACE_TOKEN');
    return key && key.length > 0 ? key : undefined;
  }

  get huggingFaceImageModel(): string {
    return (
      this.config.get<string>('HF_IMAGE_MODEL') ??
      'black-forest-labs/FLUX.1-schnell'
    );
  }

  get huggingFaceImageWidth(): number {
    return Number(this.config.get<string>('HF_IMAGE_WIDTH') ?? 768);
  }

  get huggingFaceImageHeight(): number {
    return Number(this.config.get<string>('HF_IMAGE_HEIGHT') ?? 1344);
  }

  /** Single Bearer API key (supported by Kling Open Platform). */
  get klingApiKey(): string | undefined {
    const key = this.config.get<string>('KLING_API_KEY');
    return key && key.length > 0 ? key : undefined;
  }

  get klingAccessKey(): string | undefined {
    const key = this.config.get<string>('KLING_ACCESS_KEY');
    return key && key.length > 0 ? key : undefined;
  }

  get klingSecretKey(): string | undefined {
    const key = this.config.get<string>('KLING_SECRET_KEY');
    return key && key.length > 0 ? key : undefined;
  }

  get klingApiBaseUrl(): string {
    return (
      this.config.get<string>('KLING_API_BASE_URL') ??
      'https://api.klingai.com'
    ).replace(/\/$/, '');
  }

  get klingImageModel(): string {
    return this.config.get<string>('KLING_IMAGE_MODEL') ?? 'kling-v1-5';
  }

  get klingImageResolution(): '1k' | '2k' {
    const value = (this.config.get<string>('KLING_IMAGE_RESOLUTION') ?? '1k')
      .trim()
      .toLowerCase();
    return value === '2k' ? '2k' : '1k';
  }

  /** OAuth 1.0a Consumer Key (portal: Consumer Key) */
  get twitterConsumerKey(): string {
    return this.requireTwitterSecret(
      'TWITTER_CONSUMER_KEY',
      'TWITTER_API_KEY',
    );
  }

  /** OAuth 1.0a Consumer Secret (portal: Consumer Secret) */
  get twitterConsumerSecret(): string {
    return this.requireTwitterSecret(
      'TWITTER_CONSUMER_SECRET',
      'TWITTER_API_SECRET',
    );
  }

  /** OAuth 1.0a Access Token (portal: Access Token) */
  get twitterAccessToken(): string {
    return this.config.getOrThrow<string>('TWITTER_ACCESS_TOKEN');
  }

  /** OAuth 1.0a Access Token Secret (portal: Access Token Secret) */
  get twitterAccessTokenSecret(): string {
    return this.requireTwitterSecret(
      'TWITTER_ACCESS_TOKEN_SECRET',
      'TWITTER_ACCESS_SECRET',
    );
  }

  private requireTwitterSecret(primary: string, legacy: string): string {
    const value =
      this.config.get<string>(primary)?.trim() ||
      this.config.get<string>(legacy)?.trim();
    if (!value || value === 'replace-me') {
      throw new Error(`Missing Twitter credential: set ${primary} in .env`);
    }
    return value;
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
    return this.config.get<string>('BRAND_NAME') ?? 'ZanshinAI';
  }

  get closingLine(): string {
    const configured = this.config.get<string>('CLOSING_LINE')?.trim();
    if (configured) {
      return configured;
    }
    return `That's all for today's news on ${this.brandName}.`;
  }

  get skipPublish(): boolean {
    return (this.config.get<string>('SKIP_PUBLISH') ?? 'false') === 'true';
  }

  get resendApiKey(): string | undefined {
    const key = this.config.get<string>('RESEND_API_KEY')?.trim();
    return key && key.length > 0 ? key : undefined;
  }

  get resendFromEmail(): string {
    return (
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() ||
      'ZanshinAI <onboarding@resend.dev>'
    );
  }

  /** Comma-separated recipient list for daily video delivery. */
  get resendToEmails(): string[] {
    const raw = this.config.get<string>('RESEND_TO_EMAIL')?.trim() ?? '';
    return raw
      .split(/[,;\s]+/)
      .map((email) => email.trim())
      .filter((email) => email.includes('@'));
  }

  /** Email delivery is independent of SKIP_PUBLISH social posting. */
  get skipEmail(): boolean {
    return (this.config.get<string>('SKIP_EMAIL') ?? 'false') === 'true';
  }

  get isResendConfigured(): boolean {
    return Boolean(this.resendApiKey) && this.resendToEmails.length > 0;
  }

  /** Wait before a full pipeline retry after a failed daily cron run. */
  get pipelineRetryDelayMs(): number {
    return Number(this.config.get<string>('PIPELINE_RETRY_DELAY_MS') ?? 300_000);
  }

  /** Reuse existing segment stills (faster local re-renders). */
  get reuseImages(): boolean {
    const value = (
      this.config.get<string>('REUSE_IMAGES') ??
      process.env.REUSE_IMAGES ??
      'false'
    )
      .trim()
      .toLowerCase();
    return value === 'true' || value === '1';
  }

  get dataDir(): string {
    return this.config.get<string>('DATA_DIR') ?? 'data';
  }

  get outputDir(): string {
    return this.config.get<string>('OUTPUT_DIR') ?? 'output';
  }
}
