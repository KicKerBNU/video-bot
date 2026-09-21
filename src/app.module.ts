import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { NewsModule } from './news/news.module';
import { StoreModule } from './store/store.module';
import { TtsModule } from './tts/tts.module';
import { VideoModule } from './video/video.module';
import { PublishersModule } from './publishers/publishers.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { VoicePackModule } from './voice-pack/voice-pack.module';

@Module({
  imports: [
    AppConfigModule,
    HealthModule,
    NewsModule,
    StoreModule,
    TtsModule,
    VideoModule,
    PublishersModule,
    PipelineModule,
    VoicePackModule,
  ],
})
export class AppModule {}
