import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { TtsService } from './tts.service';

@Module({
  imports: [AppConfigModule],
  providers: [TtsService],
  exports: [TtsService],
})
export class TtsModule {}
