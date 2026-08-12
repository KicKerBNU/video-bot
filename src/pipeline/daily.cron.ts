import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../config/app-config.service';
import { DailyPipelineService } from './daily-pipeline.service';

@Injectable()
export class DailyCronService implements OnModuleInit {
  private readonly logger = new Logger(DailyCronService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pipeline: DailyPipelineService,
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
    const result = await this.pipeline.run();
    this.logger.log(`Daily cron finished with status=${result.status}`);
  }
}
