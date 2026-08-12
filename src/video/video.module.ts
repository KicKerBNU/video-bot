import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { VideoService } from './video.service';

@Module({
  imports: [AppConfigModule],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
