import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { VideoScript } from '../common/types';

interface DigestBullet {
  title?: string;
  summary?: string;
  source?: string;
}

interface DigestPayload {
  ok?: boolean;
  digest?: {
    timestamp?: string;
    headline?: string;
    bullets?: DigestBullet[];
  };
}

const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async fetchLatestScripts(): Promise<VideoScript[]> {
    const url = this.appConfig.newsApiUrl;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.appConfig.newsApiKey) {
      headers.Authorization = `Bearer ${this.appConfig.newsApiKey}`;
    }

    this.logger.log(`Fetching digest from ${url}`);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `News API failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as DigestPayload;
    const scripts = this.normalizeDigest(payload);

    this.logger.log(`Normalized ${scripts.length} script(s) from digest`);
    return scripts;
  }

  async fetchNextUnpublished(
    isPosted: (id: string) => boolean,
  ): Promise<VideoScript | null> {
    const scripts = await this.fetchLatestScripts();
    // Prefer the combined daily digest for the once-per-day post.
    const daily = scripts.find((script) => script.id.startsWith('digest-'));
    if (daily && !isPosted(daily.id)) {
      return daily;
    }

    return null;
  }

  async fetchNextUnpublishedBullet(
    isPosted: (id: string) => boolean,
  ): Promise<VideoScript | null> {
    const scripts = await this.fetchLatestScripts();
    return (
      scripts.find(
        (script) => script.id.startsWith('bullet-') && !isPosted(script.id),
      ) ?? null
    );
  }

  private normalizeDigest(payload: DigestPayload): VideoScript[] {
    const digest = payload.digest;
    if (!digest) {
      throw new Error('Digest API response missing digest object');
    }

    const bullets = (digest.bullets ?? []).filter(
      (bullet) => bullet.title?.trim() && bullet.summary?.trim(),
    );

    if (bullets.length === 0) {
      this.logger.warn('Digest has no usable bullets');
      return [];
    }

    const publishedAt = digest.timestamp ?? new Date().toISOString();
    const dayId = this.toLisbonDayId(publishedAt);
    const headline =
      digest.headline?.trim() || bullets[0].title!.trim();

    // One daily video script assembled from all bullets.
    const dailyScript = this.buildDailyDigestScript({
      dayId,
      headline,
      bullets,
      publishedAt,
    });

    // Also expose each bullet as its own script (stable ids) for future use.
    const bulletScripts = bullets.map((bullet, index) =>
      this.buildBulletScript({
        dayId,
        index,
        bullet,
        publishedAt,
      }),
    );

    return [dailyScript, ...bulletScripts];
  }

  private buildDailyDigestScript(params: {
    dayId: string;
    headline: string;
    bullets: DigestBullet[];
    publishedAt: string;
  }): VideoScript {
    const { dayId, headline, bullets, publishedAt } = params;
    const bodyParts = bullets.map((bullet, index) => {
      const prefix =
        index === 0 ? 'First' : index === bullets.length - 1 ? 'Finally' : 'Next';
      return `${prefix}: ${bullet.title!.trim()}. ${bullet.summary!.trim()}`;
    });

    const body = [
      `Here is today's AI news digest.`,
      `Top story: ${headline}.`,
      ...bodyParts,
    ].join(' ');

    return {
      id: `digest-${dayId}`,
      title: headline,
      body,
      hook: `AI news for ${dayId}`,
      hashtags: ['#AI', '#TechNews', '#AINews'],
      publishedAt,
    };
  }

  private buildBulletScript(params: {
    dayId: string;
    index: number;
    bullet: DigestBullet;
    publishedAt: string;
  }): VideoScript {
    const { dayId, index, bullet, publishedAt } = params;
    const title = bullet.title!.trim();
    const summary = bullet.summary!.trim();
    const source = bullet.source?.trim();
    const slug = this.slugify(title);
    const hash = createHash('sha1')
      .update(`${dayId}:${index}:${title}`)
      .digest('hex')
      .slice(0, 8);

    return {
      id: `bullet-${dayId}-${index + 1}-${slug || hash}`,
      title,
      body: `${title}. ${summary}`,
      hook: source ? `From ${source}` : undefined,
      hashtags: ['#AI', '#TechNews'],
      publishedAt,
    };
  }

  private toLisbonDayId(isoTimestamp: string): string {
    const date = new Date(isoTimestamp);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LISBON_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      return isoTimestamp.slice(0, 10);
    }

    return `${year}-${month}-${day}`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }
}
