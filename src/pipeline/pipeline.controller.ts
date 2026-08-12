import { Controller, Get, Post } from '@nestjs/common';
import { DailyPipelineService } from './daily-pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: DailyPipelineService) {}

  @Post('run')
  run() {
    return this.pipeline.run();
  }

  @Get('status')
  status() {
    return this.pipeline.getStatus();
  }
}
