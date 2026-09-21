import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { LocalTtsClient } from './local-tts.client';
import { TtsService } from './tts.service';

@Module({
  imports: [AppConfigModule],
  providers: [TtsService, LocalTtsClient],
  exports: [TtsService],
})
export class TtsModule {}
