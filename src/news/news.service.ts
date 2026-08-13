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

    const segments = [
      {
        id: 'intro',
        title: headline,
        summary: bullets[0]?.summary?.trim(),
        spokenHint: 'Here is today',
        searchQuery: this.toSearchQuery(headline),
        imagePrompt: this.toKlingPrompt(headline, bullets[0]?.summary?.trim()),
      },
      ...bullets.map((bullet, index) => ({
        id: `bullet-${index + 1}`,
        title: bullet.title!.trim(),
        summary: bullet.summary!.trim(),
        spokenHint: bullet.title!.trim().split(/\s+/).slice(0, 4).join(' '),
        searchQuery: this.toSearchQuery(bullet.title!.trim()),
        imagePrompt: this.toKlingPrompt(
          bullet.title!.trim(),
          bullet.summary!.trim(),
        ),
      })),
      {
        id: 'closing',
        title: 'AI news studio',
        summary: headline,
        spokenHint: "That's all for today",
        searchQuery: this.toSearchQuery(`${headline} artificial intelligence`),
        imagePrompt: this.toKlingPrompt(
          'Modern AI news studio desk with holographic screens',
          `Wrapping up today's top story: ${headline}`,
        ),
      },
    ];

    return {
      id: `digest-${dayId}`,
      title: headline,
      body,
      hook: `AI news for ${dayId}`,
      hashtags: ['#AI', '#TechNews', '#AINews'],
      publishedAt,
      segments,
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
      segments: [
        {
          id: 'main',
          title,
          summary,
          spokenHint: title.split(/\s+/).slice(0, 4).join(' '),
          searchQuery: this.toSearchQuery(title),
          imagePrompt: this.toKlingPrompt(title, summary),
        },
      ],
    };
  }

  private toKlingPrompt(title: string, _summary?: string): string {
    // Keep prompts visual-only. Passing raw headlines/summaries makes models
    // paint gibberish text and UI bars onto the stills.
    const visualSubject = this.toSearchQuery(title) || 'artificial intelligence technology';
    return [
      'Photorealistic cinematic news B-roll still photograph only,',
      'vertical 9:16 framing, editorial photography, dramatic lighting,',
      `visual subject: ${visualSubject}, real physical world scene.`,
      'Prefer hardware, data centers, chips, cables, city skylines, labs,',
      'hands-free product photography, empty environments.',
      'Absolutely no text anywhere, no letters, no words, no numbers,',
      'no captions, no subtitles, no logos, no watermarks, no signage,',
      'no posters, no billboards, no labels, no stickers,',
      'no computer monitors showing UI, no phone screens, no dashboards,',
      'no HUD, no green bars, no color bars, no overlays of any kind.',
      'Blank unmarked surfaces only.',
    ].join(' ');
  }

  private toSearchQuery(value: string): string {
    const stop = new Set([
      'a',
      'an',
      'the',
      'and',
      'or',
      'for',
      'to',
      'of',
      'in',
      'on',
      'with',
      'from',
      'as',
      'by',
      'at',
      'is',
      'are',
      'its',
      'into',
      'over',
      'after',
      'before',
      'about',
      'seeks',
      'secures',
      'deploys',
      'breach',
      'billion',
      'million',
      'public',
      'capital',
      'competition',
      'focused',
      'alliance',
      'financing',
      'infrastructure',
    ]);

    const known = [
      'nvidia',
      'openai',
      'intel',
      'google',
      'microsoft',
      'meta',
      'amazon',
      'apple',
      'tesla',
      'anthropic',
      'deepmind',
    ];

    const lower = value.toLowerCase();
    const brand = known.find((name) => lower.includes(name));

    const tokens = value
      .replace(/[$€£0-9]/g, ' ')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stop.has(token.toLowerCase()));

    const visualHints = tokens
      .filter((token) =>
        /ai|model|security|cyber|chip|gpu|data|cloud|robot|server|lab|tech/i.test(
          token,
        ),
      )
      .slice(0, 2);

    const parts = [brand, ...visualHints, tokens[0]].filter(Boolean) as string[];
    const unique = [...new Set(parts.map((part) => part.toLowerCase()))];

    if (unique.length === 0) {
      return 'artificial intelligence technology';
    }

    // Keep queries short and visual for stock/CC image search.
    return `${unique.slice(0, 3).join(' ')} technology`.trim();
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
