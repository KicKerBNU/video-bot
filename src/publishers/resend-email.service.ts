import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import { Resend } from 'resend';
import { AppConfigService } from '../config/app-config.service';
import { PublishResult, VideoScript } from '../common/types';
import {
  buildTikTokCaption,
  buildTwitterCaption,
  digestHeadlines,
  scriptHashtags,
} from './post-captions';

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
    const twitterCaption = buildTwitterCaption(script);
    const tiktokCaption = buildTikTokCaption(script);
    const html = this.buildHtml(script, brand, twitterCaption, tiktokCaption);
    const text = this.buildText(script, brand, twitterCaption, tiktokCaption);

    this.logger.log(
      `Sending ${filename} (${Math.round(info.size / 1024)}KB) via Resend → ${to.join(', ')}`,
    );

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: this.appConfig.resendFromEmail,
      to,
      subject,
      html,
      text,
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

  private buildHtml(
    script: VideoScript,
    brand: string,
    twitterCaption: string,
    tiktokCaption: string,
  ): string {
    const title = escapeHtml(script.title);
    const hashtags = escapeHtml(scriptHashtags(script, 6).join(' '));
    const headlines = digestHeadlines(script)
      .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
      .join('');
    const twitterBlock = escapeHtml(twitterCaption);
    const tiktokBlock = escapeHtml(tiktokCaption);

    return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:600px;margin:0 auto;padding:24px;">
    <p style="letter-spacing:0.12em;text-transform:uppercase;color:#888;font-size:12px;margin:0 0 16px;">${escapeHtml(brand)} daily digest</p>
    <h1 style="font-size:22px;margin:0 0 8px;">${title}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555;"><strong>Hashtags:</strong> ${hashtags}</p>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Headlines</h2>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#333;">${headlines}</ul>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for X / Twitter</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${twitterBlock}</pre>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for TikTok</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${tiktokBlock}</pre>

    <p style="margin-top:8px;font-size:15px;">Today's vertical video is attached as <strong>video.mp4</strong>.</p>
    <p style="margin-top:24px;font-size:12px;color:#999;">Sent automatically after generation. No links in the X caption (cheaper on Pay Per Use).</p>
  </body>
</html>`;
  }

  private buildText(
    script: VideoScript,
    brand: string,
    twitterCaption: string,
    tiktokCaption: string,
  ): string {
    const headlines = digestHeadlines(script)
      .map((line) => `- ${line}`)
      .join('\n');
    const hashtags = scriptHashtags(script, 6).join(' ');

    return [
      `${brand} daily digest`,
      '',
      `TITLE: ${script.title}`,
      `HASHTAGS: ${hashtags}`,
      '',
      'HEADLINES:',
      headlines,
      '',
      '--- COPY FOR X / TWITTER ---',
      twitterCaption,
      '',
      '--- COPY FOR TIKTOK ---',
      tiktokCaption,
      '',
      'Video attached: video.mp4',
    ].join('\n');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
