import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { HuggingFaceImageClient } from './huggingface.client';
import { ImageService } from './image.service';
import { KlingImageClient } from './kling.client';
import { WanImageClient } from './wan.client';

@Module({
  imports: [AppConfigModule],
  providers: [
    ImageService,
    WanImageClient,
    HuggingFaceImageClient,
    KlingImageClient,
  ],
  exports: [ImageService],
})
export class ImagesModule {}
