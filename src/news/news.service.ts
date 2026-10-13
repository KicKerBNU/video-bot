import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { DigestKind, VideoScript } from '../common/types';

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
const TECH_DIGEST_ID = /^digest-\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async fetchLatestScripts(
    kind: DigestKind = 'tech',
  ): Promise<VideoScript[]> {
    const url =
      kind === 'work'
        ? this.appConfig.newsApiWorkUrl
        : this.appConfig.newsApiUrl;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.appConfig.newsApiKey) {
      headers.Authorization = `Bearer ${this.appConfig.newsApiKey}`;
    }

    this.logger.log(`Fetching ${kind} digest from ${url}`);

    const maxAttempts = 4;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `News API failed (${response.status}): ${body.slice(0, 500)}`,
          );
        }

        const payload = (await response.json()) as DigestPayload;
        const scripts = this.normalizeDigest(payload, kind);

        this.logger.log(
          `Normalized ${scripts.length} script(s) from ${kind} digest`,
        );
        return scripts;
      } catch (error) {
        lastError = error;
        const message = formatFetchError(error);
        if (attempt === maxAttempts) {
          break;
        }
        const delayMs = attempt * 5_000;
        this.logger.warn(
          `Digest fetch attempt ${attempt}/${maxAttempts} failed (${message}); retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const message = formatFetchError(lastError);
    throw new Error(`Digest fetch failed after ${maxAttempts} attempts: ${message}`);
  }

  async fetchNextUnpublished(
    isPosted: (id: string) => boolean,
    kind: DigestKind = 'tech',
  ): Promise<VideoScript | null> {
    const scripts = await this.fetchLatestScripts(kind);
    const daily = scripts.find((script) =>
      kind === 'work'
        ? script.id.startsWith('digest-work-')
        : TECH_DIGEST_ID.test(script.id),
    );
    if (daily && !isPosted(daily.id)) {
      return daily;
    }

    return null;
  }

  async fetchNextUnpublishedBullet(
    isPosted: (id: string) => boolean,
    kind: DigestKind = 'tech',
  ): Promise<VideoScript | null> {
    const scripts = await this.fetchLatestScripts(kind);
    const bulletPrefix = kind === 'work' ? 'bullet-work-' : 'bullet-';
    return (
      scripts.find(
        (script) =>
          script.id.startsWith(bulletPrefix) && !isPosted(script.id),
      ) ?? null
    );
  }

  private normalizeDigest(
    payload: DigestPayload,
    kind: DigestKind,
  ): VideoScript[] {
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
      kind,
      dayId,
      headline,
      bullets,
      publishedAt,
    });

    // Also expose each bullet as its own script (stable ids) for future use.
    const bulletScripts = bullets.map((bullet, index) =>
      this.buildBulletScript({
        kind,
        dayId,
        index,
        bullet,
        publishedAt,
      }),
    );

    return [dailyScript, ...bulletScripts];
  }

  private buildDailyDigestScript(params: {
    kind: DigestKind;
    dayId: string;
    headline: string;
    bullets: DigestBullet[];
    publishedAt: string;
  }): VideoScript {
    const { kind, dayId, headline, bullets, publishedAt } = params;
    const bodyParts = bullets.map((bullet, index) => {
      const prefix =
        index === 0 ? 'First' : index === bullets.length - 1 ? 'Finally' : 'Next';
      return `${prefix}: ${bullet.title!.trim()}. ${bullet.summary!.trim()}`;
    });

    const isWork = kind === 'work';
    const intro = isWork
      ? `Here is today's work and jobs digest.`
      : `Here is today's AI news digest.`;
    const body = [intro, `Top story: ${headline}.`, ...bodyParts].join(' ');

    const segments = [
      {
        id: 'intro',
        title: headline,
        summary: bullets[0]?.summary?.trim(),
        spokenHint: 'Here is today',
        ...this.toVisualAssets(headline, bullets[0]?.summary?.trim()),
      },
      ...bullets.map((bullet, index) => ({
        id: `bullet-${index + 1}`,
        title: bullet.title!.trim(),
        summary: bullet.summary!.trim(),
        spokenHint: bullet.title!.trim().split(/\s+/).slice(0, 4).join(' '),
        ...this.toVisualAssets(bullet.title!.trim(), bullet.summary!.trim()),
      })),
      {
        id: 'closing',
        title: isWork ? 'Work and jobs studio' : 'AI news studio',
        summary: headline,
        spokenHint: "That's all for today",
        searchQuery: isWork
          ? 'modern office open workspace desks'
          : 'news studio microphone desk',
        imagePrompt: this.toImagePrompt(
          isWork
            ? 'modern open-plan office with empty desks and soft daylight, city skyline through glass, no screens with text, cinematic editorial photo'
            : 'modern broadcast news desk with soft cinematic lighting, empty unmarked monitors turned off, microphone and city skyline bokeh through window',
          isWork
            ? 'modern office open workspace desks'
            : 'news studio microphone desk',
        ),
      },
    ];

    return {
      id: isWork ? `digest-work-${dayId}` : `digest-${dayId}`,
      title: headline,
      body,
      hook: isWork ? `Work and jobs for ${dayId}` : `AI news for ${dayId}`,
      hashtags: isWork
        ? ['#AI', '#Jobs', '#FutureOfWork']
        : ['#AI', '#TechNews', '#AINews'],
      publishedAt,
      segments,
    };
  }

  private buildBulletScript(params: {
    kind: DigestKind;
    dayId: string;
    index: number;
    bullet: DigestBullet;
    publishedAt: string;
  }): VideoScript {
    const { kind, dayId, index, bullet, publishedAt } = params;
    const title = bullet.title!.trim();
    const summary = bullet.summary!.trim();
    const source = bullet.source?.trim();
    const slug = this.slugify(title);
    const hash = createHash('sha1')
      .update(`${kind}:${dayId}:${index}:${title}`)
      .digest('hex')
      .slice(0, 8);
    const idPrefix = kind === 'work' ? 'bullet-work' : 'bullet';

    return {
      id: `${idPrefix}-${dayId}-${index + 1}-${slug || hash}`,
      title,
      body: `${title}. ${summary}`,
      hook: source ? `From ${source}` : undefined,
      hashtags:
        kind === 'work'
          ? ['#AI', '#Jobs', '#FutureOfWork']
          : ['#AI', '#TechNews'],
      publishedAt,
      segments: [
        {
          id: 'main',
          title,
          summary,
          spokenHint: title.split(/\s+/).slice(0, 4).join(' '),
          ...this.toVisualAssets(title, summary),
        },
      ],
    };
  }

  private toVisualAssets(
    title: string,
    summary?: string,
  ): { searchQuery: string; imagePrompt: string } {
    const scene = this.resolveVisualScene(title, summary);
    return {
      searchQuery: scene.searchQuery,
      imagePrompt: this.toImagePrompt(scene.scene, scene.searchQuery),
    };
  }

  /**
   * Map story meaning → concrete B-roll (IPO → Wall Street, chips → fabs, etc.).
   * Avoid feeding raw headlines into the image model (causes gibberish text).
   */
  private resolveVisualScene(
    title: string,
    summary?: string,
  ): { searchQuery: string; scene: string } {
    const text = `${title} ${summary ?? ''}`.toLowerCase();

    const rules: Array<{
      test: RegExp;
      searchQuery: string;
      scene: string;
    }> = [
      {
        test: /\b(ipo|stock exchange|nasdaq|nyse|wall street|public listing|goes public|share price|equity offering)\b/,
        searchQuery: 'wall street stock exchange',
        scene:
          'New York Stock Exchange building facade and Wall Street financial district, Charging Bull area, American flags, stone architecture, busy Manhattan street, golden hour',
      },
      {
        test: /\b(funding|financing|investment|investors|raises? \$|series [a-d]|valuation|capital raise|billion.?dollar round)\b/,
        searchQuery: 'financial district skyline',
        scene:
          'Manhattan financial district skyline with glass skyscrapers, Wall Street canyon, luxury office tower exteriors, reflective windows, dusk city lights',
      },
      {
        test: /\b(merger|acquisition|acquires|buyout|takeover)\b/,
        searchQuery: 'corporate skyscraper handshake skyline',
        scene:
          'two modern glass corporate towers facing each other in a financial district, dramatic sky, editorial architecture photography',
      },
      {
        test: /\b(security|cyber|hack|breach|malware|ransomware)\b/,
        searchQuery: 'cybersecurity lock server room',
        scene:
          'dark server cage with a large physical padlock on a rack door, moody teal lighting, tense security atmosphere',
      },
      {
        test: /\b(gpu|chip|semiconductor|nvidia|intel|tsmc|foundry|silicon)\b/,
        searchQuery: 'semiconductor chip factory',
        scene:
          'close-up of semiconductor wafers and GPU hardware in a cleanroom fab, cyan lighting, precision machinery, no readable markings',
      },
      {
        test: /\b(data center|infrastructure|cloud|server farm|compute)\b/,
        searchQuery: 'data center server aisle',
        scene:
          'long aisle of data center server racks with blue LED glow, thick power cables, cold corridor perspective',
      },
      {
        test: /\b(users|consumers?|mobile app|smartphone|chatbot|assistant)\b/,
        searchQuery: 'people using smartphones city',
        scene:
          'crowded modern city plaza at night, people holding smartphones with soft glowing screens turned away from camera so no UI is readable, neon bokeh',
      },
      {
        test: /\b(robot|humanoid|automation|factory)\b/,
        searchQuery: 'humanoid robot factory',
        scene:
          'humanoid robot standing on a factory floor among industrial machines, cinematic side light, no logos',
      },
      {
        test: /\b(regulation|congress|law|policy|lawsuit|antitrust|government)\b/,
        searchQuery: 'government building columns',
        scene:
          'classical government building with tall stone columns and steps, overcast sky, authoritative editorial photo',
      },
      {
        test: /\b(openai|anthropic|deepmind|model|llm|training)\b/,
        searchQuery: 'ai research laboratory',
        scene:
          'AI research laboratory with GPU clusters and cable trays, cool blue light, scientists blurred in background out of focus, no screens with text',
      },
    ];

    for (const rule of rules) {
      if (rule.test.test(text)) {
        return { searchQuery: rule.searchQuery, scene: rule.scene };
      }
    }

    return {
      searchQuery: this.toSearchQuery(title),
      scene: `${this.toSearchQuery(title)}, real-world technology scene, editorial news B-roll`,
    };
  }

  private toImagePrompt(scene: string, searchQuery: string): string {
    return [
      'Photorealistic cinematic news B-roll still photograph only,',
      'vertical 9:16 framing, editorial photography, dramatic lighting,',
      `scene: ${scene}.`,
      `visual keywords: ${searchQuery}.`,
      'Real physical world only, empty of readable graphics.',
      'Absolutely no text anywhere, no letters, no words, no numbers,',
      'no captions, no subtitles, no logos, no watermarks, no signage,',
      'no posters, no billboards, no tickers, no stock charts,',
      'no computer monitors showing UI, no phone screens with apps,',
      'no HUD, no green bars, no overlays of any kind.',
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
        /ai|model|security|cyber|chip|gpu|data|cloud|robot|server|lab|tech|ipo|stock|finance/i.test(
          token,
        ),
      )
      .slice(0, 2);

    const parts = [brand, ...visualHints, tokens[0]].filter(Boolean) as string[];
    const unique = [...new Set(parts.map((part) => part.toLowerCase()))];

    if (unique.length === 0) {
      return 'artificial intelligence technology';
    }

    return unique.slice(0, 3).join(' ').trim();
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

/** Include undici/Node cause (ENOTFOUND, ECONNRESET, etc.) — plain "fetch failed" hides it. */
function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code =
      'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : undefined;
    parts.push(code ? `${cause.message} [${code}]` : cause.message);
  } else if (cause != null) {
    parts.push(String(cause));
  }
  return parts.filter(Boolean).join(' — ');
}
