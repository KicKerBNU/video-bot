import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunResult } from '../common/types';
import { ResendEmailService } from '../publishers/resend-email.service';
import { DailyPipelineService } from './daily-pipeline.service';

@Injectable()
export class DailyCronService implements OnModuleInit {
  private readonly logger = new Logger(DailyCronService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pipeline: DailyPipelineService,
    private readonly resendEmail: ResendEmailService,
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
      `Daily pipeline cron registered: ${schedule} (${timeZone})`,
    );
  }

  private async handleCron(): Promise<void> {
    this.logger.log('Daily cron triggered');
    let result = await this.pipeline.run();
    let attempt = 1;

    if (result.status === 'failed') {
      const delayMs = this.appConfig.pipelineRetryDelayMs;
      this.logger.warn(
        `Pipeline failed (${result.message}); retrying in ${Math.round(delayMs / 1000)}s`,
      );
      await sleep(delayMs);
      this.logger.log('Daily cron retry starting');
      result = await this.pipeline.run();
      attempt = 2;
    }

    if (result.status === 'failed') {
      await this.notifyFailure(result, attempt);
    }

    this.logger.log(
      `Daily cron finished with status=${result.status} (attempt ${attempt})`,
    );
  }

  private async notifyFailure(
    result: PipelineRunResult,
    attempt: number,
  ): Promise<void> {
    try {
      await this.resendEmail.sendFailureAlert({
        message: result.message ?? 'Unknown pipeline failure',
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        attempt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not send failure alert email: ${message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
