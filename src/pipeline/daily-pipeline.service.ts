import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunResult, PublishResult } from '../common/types';
import { NewsService } from '../news/news.service';
import { StoreService } from '../store/store.service';
import { TtsService } from '../tts/tts.service';
import { VideoService } from '../video/video.service';
import { truncateScriptForShortForm } from '../video/caption-utils';
import { TwitterPublisherService } from '../publishers/twitter.service';
import { TikTokPublisherService } from '../publishers/tiktok.service';

@Injectable()
export class DailyPipelineService {
  private readonly logger = new Logger(DailyPipelineService.name);
  private running = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly newsService: NewsService,
    private readonly store: StoreService,
    private readonly tts: TtsService,
    private readonly video: VideoService,
    private readonly twitter: TwitterPublisherService,
    private readonly tiktok: TikTokPublisherService,
  ) {}

  async run(): Promise<PipelineRunResult> {
    if (this.running) {
      return {
        status: 'skipped',
        message: 'Pipeline already running',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
    }

    this.running = true;
    const startedAt = new Date().toISOString();

    try {
      const script = await this.newsService.fetchNextUnpublished((id) =>
        this.store.isPosted(id),
      );

      if (!script) {
        const result: PipelineRunResult = {
          status: 'skipped',
          message: 'No unpublished news scripts found',
          startedAt,
          finishedAt: new Date().toISOString(),
        };
        this.store.saveRun(result);
        return result;
      }

      this.logger.log(`Processing news ${script.id}: ${script.title}`);

      const spokenText = truncateScriptForShortForm(
        [script.hook, script.body].filter(Boolean).join('. '),
      );
      const ttsResult = await this.tts.synthesize(spokenText, script.id);
      const videoPath = await this.video.render({
        script,
        audioPath: ttsResult.audioPath,
        durationMs: ttsResult.durationMs,
        words: ttsResult.words,
      });

      const publishes: PublishResult[] = [];

      if (this.appConfig.skipPublish) {
        this.logger.warn('SKIP_PUBLISH=true — video generated only');
      } else {
        const twitterResult = await this.twitter.publish(script, videoPath);
        publishes.push(twitterResult);

        const tiktokResult = await this.tiktok.publish(script, videoPath);
        publishes.push(tiktokResult);
      }

      this.store.savePosted({
        newsId: script.id,
        title: script.title,
        videoPath,
        twitterPostId: publishes.find((p) => p.platform === 'twitter')?.postId,
        tiktokPostId: publishes.find((p) => p.platform === 'tiktok')?.postId,
        postedAt: new Date().toISOString(),
      });

      const result: PipelineRunResult = {
        status: 'posted',
        newsId: script.id,
        videoPath,
        publishes,
        message: this.appConfig.skipPublish
          ? 'Generated video; publish skipped'
          : 'Published to configured platforms',
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.store.saveRun(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pipeline failed: ${message}`);
      const result: PipelineRunResult = {
        status: 'failed',
        message,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.store.saveRun(result);
      return result;
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastRun: this.store.getLastRun(),
      lastPosted: this.store.getLastPosted(),
      cronSchedule: this.appConfig.cronSchedule,
      cronTimezone: this.appConfig.cronTimezone,
      brandName: this.appConfig.brandName,
      skipPublish: this.appConfig.skipPublish,
    };
  }
}
