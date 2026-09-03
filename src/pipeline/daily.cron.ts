import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunResult } from '../common/types';
import { ResendEmailService } from '../publishers/resend-email.service';
import { StoreService } from '../store/store.service';
import { DailyPipelineService } from './daily-pipeline.service';

const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class DailyCronService implements OnModuleInit {
  private readonly logger = new Logger(DailyCronService.name);
  private cronRunning = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pipeline: DailyPipelineService,
    private readonly resendEmail: ResendEmailService,
    private readonly store: StoreService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const schedule = this.appConfig.cronSchedule;
    const timeZone = this.appConfig.cronTimezone;
    const job = new CronJob(
      schedule,
      () => {
        void this.handleCron();
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob('daily-video-pipeline', job);
    job.start();
    this.logger.log(
      `Daily pipeline cron registered: ${schedule} (${timeZone}); up to ${this.appConfig.pipelineRetryAttempts} attempts every ${Math.round(this.appConfig.pipelineRetryDelayMs / 60_000)}min`,
    );
  }

  private async handleCron(): Promise<void> {
    if (this.cronRunning) {
      this.logger.warn('Daily cron already in progress — skipping overlapping trigger');
      return;
    }

    this.cronRunning = true;
    this.logger.log('Daily cron triggered');

    const maxAttempts = this.appConfig.pipelineRetryAttempts;
    const delayMs = this.appConfig.pipelineRetryDelayMs;
    let result: PipelineRunResult | undefined;
    let attempt = 0;

    try {
      for (attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          this.logger.warn(
            `Waiting ${Math.round(delayMs / 60_000)}min before attempt ${attempt}/${maxAttempts}`,
          );
          await sleep(delayMs);
        }

        this.logger.log(`Daily cron attempt ${attempt}/${maxAttempts}`);
        result = await this.pipeline.run();

        if (result.status === 'posted') {
          break;
        }

        if (result.status === 'skipped' && this.isTodaysDigestPosted()) {
          this.logger.log(
            `Today's digest already posted (${this.todayDigestId()}) — stopping retries`,
          );
          break;
        }

        const reason = result.message ?? result.status;
        if (attempt < maxAttempts) {
          this.logger.warn(
            `Attempt ${attempt}/${maxAttempts} did not post (${reason}); will retry for today's digest`,
          );
        } else {
          this.logger.error(
            `Attempt ${attempt}/${maxAttempts} did not post (${reason}); giving up`,
          );
        }
      }

      if (result && result.status === 'failed') {
        await this.notifyFailure(result, attempt);
      } else if (
        result &&
        result.status === 'skipped' &&
        !this.isTodaysDigestPosted()
      ) {
        await this.notifyFailure(
          {
            ...result,
            status: 'failed',
            message:
              result.message ??
              `Today's digest (${this.todayDigestId()}) was not available after ${maxAttempts} attempts`,
          },
          attempt,
        );
      }

      this.logger.log(
        `Daily cron finished with status=${result?.status ?? 'unknown'} (attempt ${attempt}/${maxAttempts})`,
      );
    } finally {
      this.cronRunning = false;
    }
  }

  private todayDigestId(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LISBON_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `digest-${year}-${month}-${day}`;
  }

  private isTodaysDigestPosted(): boolean {
    return this.store.isPosted(this.todayDigestId());
  }

  private async notifyFailure(
    result: PipelineRunResult,
    attempt: number,
  ): Promise<void> {
    const delaysMs = [0, 30_000, 120_000, 300_000, 900_000];
    let lastError = 'unknown';

    for (let i = 0; i < delaysMs.length; i++) {
      const waitMs = delaysMs[i];
      if (waitMs > 0) {
        this.logger.warn(
          `Failure alert retry ${i + 1}/${delaysMs.length} in ${Math.round(waitMs / 1000)}s`,
        );
        await sleep(waitMs);
      }

      try {
        await this.resendEmail.sendFailureAlert({
          message: result.message ?? 'Unknown pipeline failure',
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          attempt,
        });
        this.logger.log(
          `Failure alert emailed (try ${i + 1}/${delaysMs.length})`,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failure alert try ${i + 1}/${delaysMs.length} failed: ${lastError}`,
        );
      }
    }

    this.logger.error(
      `Could not send failure alert email after ${delaysMs.length} tries: ${lastError}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
