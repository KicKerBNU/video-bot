import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import {
  VoicePackService,
  VoiceScriptMode,
} from './voice-pack.service';

@Controller('voice-pack')
export class VoicePackController {
  constructor(private readonly voicePack: VoicePackService) {}

  @Get('scripts')
  listScripts(@Query('mode') mode?: string) {
    const normalized = (mode ?? 'all').toLowerCase();
    const allowed: VoiceScriptMode[] = ['short', 'long', 'focus', 'all'];
    const selected = allowed.includes(normalized as VoiceScriptMode)
      ? (normalized as VoiceScriptMode)
      : 'all';
    return this.voicePack.listScripts(selected);
  }

  @Get('audio/:id')
  async audio(@Param('id') id: string, @Res() res: Response) {
    const path = await this.voicePack.getAudioPath(id.replace(/\.wav$/i, ''));
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(path).pipe(res);
  }

  @Post(':id/audio')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 40 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('id') id: string,
    @UploadedFile()
    file?: { buffer: Buffer; originalname: string; size: number },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Expected multipart field "audio"');
    }
    const item = await this.voicePack.saveRecording(
      id,
      file.buffer,
      file.originalname || 'take.webm',
    );
    const list = await this.voicePack.listScripts(item.mode);
    return {
      ok: true,
      item,
      completedCount: list.completedCount,
      total: list.total,
      nextId: list.nextId,
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.voicePack.deleteRecording(id);
    return this.voicePack.listScripts('all');
  }

  @Post('rebuild')
  rebuild() {
    return this.voicePack.rebuildApproved();
  }
}
