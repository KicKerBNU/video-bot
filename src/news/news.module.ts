import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { NewsService } from './news.service';

@Module({
  imports: [AppConfigModule],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
