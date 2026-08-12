import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { TwitterPublisherService } from './twitter.service';
import { TikTokPublisherService } from './tiktok.service';

@Module({
  imports: [AppConfigModule],
  providers: [TwitterPublisherService, TikTokPublisherService],
  exports: [TwitterPublisherService, TikTokPublisherService],
})
export class PublishersModule {}
