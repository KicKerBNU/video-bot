import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '../config/app-config.module';
import { NewsModule } from '../news/news.module';
import { StoreModule } from '../store/store.module';
import { TtsModule } from '../tts/tts.module';
import { VideoModule } from '../video/video.module';
import { PublishersModule } from '../publishers/publishers.module';
import { DailyPipelineService } from './daily-pipeline.service';
import { DailyCronService } from './daily.cron';
import { PipelineController } from './pipeline.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    NewsModule,
    StoreModule,
    TtsModule,
    VideoModule,
    PublishersModule,
  ],
  controllers: [PipelineController],
  providers: [DailyPipelineService, DailyCronService],
  exports: [DailyPipelineService],
})
export class PipelineModule {}
