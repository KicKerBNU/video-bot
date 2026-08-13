import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { ImagesModule } from '../images/images.module';
import { FfmpegVideoEngine } from './engine/ffmpeg.engine';
import { VideoService } from './video.service';

@Module({
  imports: [AppConfigModule, ImagesModule],
  providers: [VideoService, FfmpegVideoEngine],
  exports: [VideoService],
})
export class VideoModule {}
