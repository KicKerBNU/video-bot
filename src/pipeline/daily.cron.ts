import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../config/app-config.service';
import { DigestKind, PipelineRunResult } from '../common/types';
import { ResendEmailService } from '../publishers/resend-email.service';
import { StoreService } from '../store/store.service';
import { DailyPipelineService } from './daily-pipeline.service';

const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class DailyCronService implements OnModuleInit {
  private readonly logger = new Logger(DailyCronService.name);
  private techCronRunning = false;
  private workCronRunning = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pipeline: DailyPipelineService,
    private readonly resendEmail: ResendEmailService,
    private readonly store: StoreService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timeZone = this.appConfig.cronTimezone;
    this.registerJob(
      'daily-video-pipeline',
      this.appConfig.cronSchedule,
      timeZone,
      'tech',
    );
    this.registerJob(
      'daily-work-video-pipeline',
      this.appConfig.cronWorkSchedule,
      timeZone,
      'work',
    );
  }

  private registerJob(
    name: string,
    schedule: string,
    timeZone: string,
    kind: DigestKind,
  ): void {
    const job = new CronJob(
      schedule,
      () => {
        void this.handleCron(kind);
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.logger.log(
      `${kind} pipeline cron registered: ${schedule} (${timeZone}); up to ${this.appConfig.pipelineRetryAttempts} attempts every ${Math.round(this.appConfig.pipelineRetryDelayMs / 60_000)}min`,
    );
  }

  private async handleCron(kind: DigestKind): Promise<void> {
    if (kind === 'tech' ? this.techCronRunning : this.workCronRunning) {
      this.logger.warn(
        `${kind} cron already in progress — skipping overlapping trigger`,
      );
      return;
    }

    if (kind === 'tech') {
      this.techCronRunning = true;
    } else {
      this.workCronRunning = true;
    }

    this.logger.log(`${kind} cron triggered`);

    const maxAttempts = this.appConfig.pipelineRetryAttempts;
    const delayMs = this.appConfig.pipelineRetryDelayMs;
    let result: PipelineRunResult | undefined;
    let attempt = 0;

    try {
      for (attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          this.logger.warn(
            `Waiting ${Math.round(delayMs / 60_000)}min before ${kind} attempt ${attempt}/${maxAttempts}`,
          );
          await sleep(delayMs);
        }

        this.logger.log(
          `${kind} cron attempt ${attempt}/${maxAttempts}`,
        );
        result = await this.pipeline.run(kind);

        if (result.status === 'posted') {
          break;
        }

        if (result.status === 'skipped' && this.isTodaysDigestPosted(kind)) {
          this.logger.log(
            `Today's ${kind} digest already posted (${this.todayDigestId(kind)}) — stopping retries`,
          );
          break;
        }

        const reason = result.message ?? result.status;
        if (attempt < maxAttempts) {
          this.logger.warn(
            `${kind} attempt ${attempt}/${maxAttempts} did not post (${reason}); will retry`,
          );
        } else {
          this.logger.error(
            `${kind} attempt ${attempt}/${maxAttempts} did not post (${reason}); giving up`,
          );
        }
      }

      if (result && result.status === 'failed') {
        await this.notifyFailure(result, attempt, kind);
      } else if (
        result &&
        result.status === 'skipped' &&
        !this.isTodaysDigestPosted(kind)
      ) {
        await this.notifyFailure(
          {
            ...result,
            status: 'failed',
            message:
              result.message ??
              `Today's ${kind} digest (${this.todayDigestId(kind)}) was not available after ${maxAttempts} attempts`,
          },
          attempt,
          kind,
        );
      }

      this.logger.log(
        `${kind} cron finished with status=${result?.status ?? 'unknown'} (attempt ${attempt}/${maxAttempts})`,
      );
    } finally {
      if (kind === 'tech') {
        this.techCronRunning = false;
      } else {
        this.workCronRunning = false;
      }
    }
  }

  private todayDigestId(kind: DigestKind): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LISBON_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    const dayId = `${year}-${month}-${day}`;
    return kind === 'work' ? `digest-work-${dayId}` : `digest-${dayId}`;
  }

  private isTodaysDigestPosted(kind: DigestKind): boolean {
    return this.store.isPosted(this.todayDigestId(kind));
  }

  private async notifyFailure(
    result: PipelineRunResult,
    attempt: number,
    kind: DigestKind,
  ): Promise<void> {
    const delaysMs = [0, 30_000, 120_000, 300_000, 900_000];
    let lastError = 'unknown';

    for (let i = 0; i < delaysMs.length; i++) {
      const waitMs = delaysMs[i];
      if (waitMs > 0) {
        this.logger.warn(
          `${kind} failure alert retry ${i + 1}/${delaysMs.length} in ${Math.round(waitMs / 1000)}s`,
        );
        await sleep(waitMs);
      }

      try {
        await this.resendEmail.sendFailureAlert({
          message: result.message ?? `Unknown ${kind} pipeline failure`,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          attempt,
        });
        this.logger.log(
          `${kind} failure alert emailed (try ${i + 1}/${delaysMs.length})`,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `${kind} failure alert try ${i + 1}/${delaysMs.length} failed: ${lastError}`,
        );
      }
    }

    this.logger.error(
      `Could not send ${kind} failure alert email after ${delaysMs.length} tries: ${lastError}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
