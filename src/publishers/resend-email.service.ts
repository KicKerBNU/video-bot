import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import { Resend } from 'resend';
import { AppConfigService } from '../config/app-config.service';
import { PublishResult, VideoScript } from '../common/types';

/** Resend hard limit is ~40MB after base64; stay well under. */
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  get isConfigured(): boolean {
    return this.appConfig.isResendConfigured;
  }

  async sendDailyVideo(
    script: VideoScript,
    videoPath: string,
  ): Promise<PublishResult> {
    if (this.appConfig.skipEmail) {
      throw new Error('SKIP_EMAIL=true');
    }

    const apiKey = this.appConfig.resendApiKey;
    const to = this.appConfig.resendToEmails;
    if (!apiKey || to.length === 0) {
      throw new Error(
        'Resend not configured — set RESEND_API_KEY and RESEND_TO_EMAIL',
      );
    }

    const info = await stat(videoPath);
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Video too large for Resend attachment (${Math.round(info.size / 1024 / 1024)}MB)`,
      );
    }

    const videoBuffer = await readFile(videoPath);
    const filename = basename(videoPath) || 'video.mp4';
    const brand = this.appConfig.brandName;
    const subject = `${brand} daily digest — ${script.title}`.slice(0, 120);
    const html = this.buildHtml(script, brand);

    this.logger.log(
      `Sending ${filename} (${Math.round(info.size / 1024)}KB) via Resend → ${to.join(', ')}`,
    );

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: this.appConfig.resendFromEmail,
      to,
      subject,
      html,
      text: `${script.title}\n\nToday's ${brand} video is attached.\n`,
      attachments: [
        {
          filename,
          content: videoBuffer,
          contentType: 'video/mp4',
        },
      ],
      tags: [
        { name: 'source', value: 'video-gen' },
        { name: 'news_id', value: script.id.slice(0, 256) },
      ],
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }

    const postId = data?.id ?? 'unknown';
    this.logger.log(`Resend email sent: ${postId}`);

    return {
      platform: 'email',
      postId,
    };
  }

  private buildHtml(script: VideoScript, brand: string): string {
    const title = escapeHtml(script.title);
    const body = escapeHtml(script.body ?? '').replace(/\n/g, '<br/>');
    const hook = script.hook
      ? `<p style="color:#555;font-size:15px;">${escapeHtml(script.hook)}</p>`
      : '';

    return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <p style="letter-spacing:0.12em;text-transform:uppercase;color:#888;font-size:12px;margin:0 0 16px;">${escapeHtml(brand)} daily digest</p>
    <h1 style="font-size:22px;margin:0 0 12px;">${title}</h1>
    ${hook}
    <p style="font-size:15px;color:#333;">${body}</p>
    <p style="margin-top:24px;font-size:15px;">Today's vertical video is attached as <strong>video.mp4</strong>.</p>
    <p style="margin-top:32px;font-size:12px;color:#999;">Sent automatically after generation.</p>
  </body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
