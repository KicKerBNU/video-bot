import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { StoreService } from './store.service';

@Module({
  imports: [AppConfigModule],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
