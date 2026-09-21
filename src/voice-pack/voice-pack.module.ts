import { Module } from '@nestjs/common';
import { VoicePackController } from './voice-pack.controller';
import { VoicePackService } from './voice-pack.service';

@Module({
  controllers: [VoicePackController],
  providers: [VoicePackService],
  exports: [VoicePackService],
})
export class VoicePackModule {}
