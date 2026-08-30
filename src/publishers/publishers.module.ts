import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { TwitterPublisherService } from './twitter.service';
import { TikTokPublisherService } from './tiktok.service';
import { ResendEmailService } from './resend-email.service';
import { ThreadsImageService } from './threads-image.service';
import { YoutubeThumbnailService } from './youtube-thumbnail.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    TwitterPublisherService,
    TikTokPublisherService,
    ResendEmailService,
    ThreadsImageService,
    YoutubeThumbnailService,
  ],
  exports: [
    TwitterPublisherService,
    TikTokPublisherService,
    ResendEmailService,
    ThreadsImageService,
    YoutubeThumbnailService,
  ],
})
export class PublishersModule {}
