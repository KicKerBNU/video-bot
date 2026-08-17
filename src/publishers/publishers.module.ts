import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { TwitterPublisherService } from './twitter.service';
import { TikTokPublisherService } from './tiktok.service';
import { ResendEmailService } from './resend-email.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    TwitterPublisherService,
    TikTokPublisherService,
    ResendEmailService,
  ],
  exports: [
    TwitterPublisherService,
    TikTokPublisherService,
    ResendEmailService,
  ],
})
export class PublishersModule {}
