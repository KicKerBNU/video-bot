import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'fs/promises';
import { Resend } from 'resend';
import { AppConfigService } from '../config/app-config.service';
import { PublishResult, VideoScript } from '../common/types';
import {
  buildThreadsCaption,
  buildTikTokCaption,
  buildTwitterCaption,
  buildYoutubeCaption,
  digestHeadlines,
  scriptHashtags,
} from './post-captions';

/** Resend hard limit is ~40MB after base64; stay well under. */
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

export interface DailyVideoEmailMeta {
  edgeVideoPath: string;
  cloneVideoPath?: string;
  cloneError?: string;
}

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
    threadsImagePath?: string,
    youtubeThumbnailPath?: string,
    meta?: DailyVideoEmailMeta,
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

    const edgePath = meta?.edgeVideoPath ?? videoPath;
    const clonePath = meta?.cloneVideoPath;
    const info = await stat(edgePath);
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Video too large for Resend attachment (${Math.round(info.size / 1024 / 1024)}MB)`,
      );
    }

    const brand = this.appConfig.brandName;
    const subject = `${brand} daily digest — ${script.title}`.slice(0, 120);
    const twitterCaption = buildTwitterCaption(script);
    const tiktokCaption = buildTikTokCaption(script);
    const threadsCaption = buildThreadsCaption(script);
    const youtubeCaption = buildYoutubeCaption(script);
    const html = this.buildHtml(
      script,
      brand,
      twitterCaption,
      tiktokCaption,
      threadsCaption,
      youtubeCaption,
      Boolean(threadsImagePath),
      Boolean(youtubeThumbnailPath),
      meta,
    );
    const text = this.buildText(
      script,
      brand,
      twitterCaption,
      tiktokCaption,
      threadsCaption,
      youtubeCaption,
      Boolean(threadsImagePath),
      Boolean(youtubeThumbnailPath),
      meta,
    );

    const attachments: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }> = [
      {
        filename: 'video-edge.mp4',
        content: await readFile(edgePath),
        contentType: 'video/mp4',
      },
    ];

    if (clonePath) {
      const cloneInfo = await stat(clonePath);
      if (cloneInfo.size <= MAX_ATTACHMENT_BYTES) {
        attachments.push({
          filename: 'video-clone.mp4',
          content: await readFile(clonePath),
          contentType: 'video/mp4',
        });
      } else {
        this.logger.warn('Clone video too large to attach; skipping');
      }
    }

    if (threadsImagePath) {
      const threadsInfo = await stat(threadsImagePath);
      if (threadsInfo.size <= MAX_ATTACHMENT_BYTES) {
        attachments.push({
          filename: 'threads.jpg',
          content: await readFile(threadsImagePath),
          contentType: 'image/jpeg',
        });
      } else {
        this.logger.warn('Threads image too large to attach; skipping');
      }
    }

    if (youtubeThumbnailPath) {
      const thumbInfo = await stat(youtubeThumbnailPath);
      if (thumbInfo.size <= MAX_ATTACHMENT_BYTES) {
        attachments.push({
          filename: 'youtube-thumbnail.jpg',
          content: await readFile(youtubeThumbnailPath),
          contentType: 'image/jpeg',
        });
      } else {
        this.logger.warn('YouTube thumbnail too large to attach; skipping');
      }
    }

    this.logger.log(
      `Sending ${attachments.map((a) => a.filename).join(' + ')} (${Math.round(info.size / 1024)}KB edge) via Resend → ${to.join(', ')}`,
    );

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: this.appConfig.resendFromEmail,
      to,
      subject,
      html,
      text,
      attachments,
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

  /**
   * Alert when the daily video pipeline ultimately fails (after retries).
   * Independent of SKIP_EMAIL — you still want to know generation broke.
   */
  async sendFailureAlert(params: {
    message: string;
    startedAt: string;
    finishedAt: string;
    attempt?: number;
  }): Promise<void> {
    const apiKey = this.appConfig.resendApiKey;
    const to = this.appConfig.resendToEmails;
    if (!apiKey || to.length === 0) {
      this.logger.warn('Resend not configured — failure alert skipped');
      return;
    }

    const brand = this.appConfig.brandName;
    const attemptLabel =
      params.attempt && params.attempt > 1
        ? ` after ${params.attempt} attempts`
        : '';
    const subject = `${brand} daily video FAILED${attemptLabel}`.slice(0, 120);
    const when = new Date(params.finishedAt).toLocaleString('en-GB');
    const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <p style="letter-spacing:0.12em;text-transform:uppercase;color:#b91c1c;font-size:12px;margin:0 0 16px;">${escapeHtml(brand)} alert</p>
    <h1 style="font-size:22px;margin:0 0 12px;">Daily video generation failed</h1>
    <p style="font-size:15px;color:#333;">The pipeline could not generate today's video${escapeHtml(attemptLabel)}.</p>
    <p style="font-size:14px;background:#fef2f2;border-radius:10px;padding:14px;"><strong>Error:</strong> ${escapeHtml(params.message)}</p>
    <p style="font-size:13px;color:#666;margin-top:20px;">Started: ${escapeHtml(params.startedAt)}<br/>Finished: ${escapeHtml(params.finishedAt)} (${escapeHtml(when)} local)</p>
    <p style="font-size:13px;color:#666;">Check logs: <code>logs/macos/app.stdout.log</code> / <code>app.stderr.log</code>, or run <code>POST /pipeline/run</code> manually.</p>
  </body>
</html>`;
    const text = [
      `${brand} daily video FAILED${attemptLabel}`,
      '',
      `Error: ${params.message}`,
      `Started: ${params.startedAt}`,
      `Finished: ${params.finishedAt}`,
      '',
      'Check logs/macos/app.stdout.log or POST /pipeline/run manually.',
    ].join('\n');

    this.logger.log(`Sending failure alert via Resend → ${to.join(', ')}`);
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: this.appConfig.resendFromEmail,
      to,
      subject,
      html,
      text,
      tags: [
        { name: 'source', value: 'video-gen' },
        { name: 'type', value: 'failure-alert' },
      ],
    });

    if (error) {
      throw new Error(`Resend failure-alert error: ${error.message}`);
    }
    this.logger.log(`Failure alert sent: ${data?.id ?? 'unknown'}`);
  }

  private buildHtml(
    script: VideoScript,
    brand: string,
    twitterCaption: string,
    tiktokCaption: string,
    threadsCaption: string,
    youtubeCaption: string,
    hasThreadsImage: boolean,
    hasYoutubeThumbnail: boolean,
    meta?: DailyVideoEmailMeta,
  ): string {
    const title = escapeHtml(script.title);
    const hashtags = escapeHtml(scriptHashtags(script, 6).join(' '));
    const headlines = digestHeadlines(script)
      .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
      .join('');
    const twitterBlock = escapeHtml(twitterCaption);
    const tiktokBlock = escapeHtml(tiktokCaption);
    const threadsBlock = escapeHtml(threadsCaption);
    const youtubeBlock = escapeHtml(youtubeCaption);
    const attachmentsNote = this.attachmentsNote(
      hasThreadsImage,
      hasYoutubeThumbnail,
      Boolean(meta?.cloneVideoPath),
    );
    const ttsBanner = this.ttsBannerHtml(meta);

    return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:600px;margin:0 auto;padding:24px;">
    <p style="letter-spacing:0.12em;text-transform:uppercase;color:#888;font-size:12px;margin:0 0 16px;">${escapeHtml(brand)} daily digest</p>
    ${ttsBanner}
    <h1 style="font-size:22px;margin:0 0 8px;">${title}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555;"><strong>Hashtags:</strong> ${hashtags}</p>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Headlines</h2>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#333;">${headlines}</ul>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for X / Twitter</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${twitterBlock}</pre>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for TikTok</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${tiktokBlock}</pre>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for Threads</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#666;">Post <strong>threads.jpg</strong> with this caption:</p>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${threadsBlock}</pre>

    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for YouTube Shorts</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#666;">Upload <strong>video-edge.mp4</strong> (or clone) as a Short, set custom thumbnail to <strong>youtube-thumbnail.jpg</strong>. First line = title; rest = description:</p>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${youtubeBlock}</pre>

    <p style="margin-top:8px;font-size:15px;">${attachmentsNote}</p>
    <p style="margin-top:24px;font-size:12px;color:#999;">Sent automatically after generation. <strong>video-edge.mp4</strong> = default Edge voice; <strong>video-clone.mp4</strong> = your local clone when available.</p>
  </body>
</html>`;
  }

  private buildText(
    script: VideoScript,
    brand: string,
    twitterCaption: string,
    tiktokCaption: string,
    threadsCaption: string,
    youtubeCaption: string,
    hasThreadsImage: boolean,
    hasYoutubeThumbnail: boolean,
    meta?: DailyVideoEmailMeta,
  ): string {
    const headlines = digestHeadlines(script)
      .map((line) => `- ${line}`)
      .join('\n');
    const hashtags = scriptHashtags(script, 6).join(' ');
    const ttsLine = this.ttsBannerText(meta);

    return [
      `${brand} daily digest`,
      '',
      ...(ttsLine ? [ttsLine, ''] : []),
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
      '--- COPY FOR THREADS (use threads.jpg) ---',
      threadsCaption,
      '',
      '--- COPY FOR YOUTUBE SHORTS (use youtube-thumbnail.jpg) ---',
      youtubeCaption,
      '',
      this.attachmentsNote(
        hasThreadsImage,
        hasYoutubeThumbnail,
        Boolean(meta?.cloneVideoPath),
        false,
      ),
    ].join('\n');
  }

  private ttsBannerHtml(meta?: DailyVideoEmailMeta): string {
    if (!meta) {
      return '';
    }
    if (meta.cloneVideoPath) {
      return `<p style="font-size:13px;background:#ecfdf5;border-radius:10px;padding:12px;margin:0 0 16px;color:#065f46;"><strong>Two videos attached:</strong> <code>video-edge.mp4</code> (default voice) + <code>video-clone.mp4</code> (your clone).</p>`;
    }
    const reason = meta.cloneError
      ? ` — ${escapeHtml(meta.cloneError)}`
      : '';
    return `<p style="font-size:13px;background:#fefce8;border-radius:10px;padding:12px;margin:0 0 16px;color:#854d0e;"><strong>One video attached:</strong> <code>video-edge.mp4</code> (default voice). Clone not available${reason}.</p>`;
  }

  private ttsBannerText(meta?: DailyVideoEmailMeta): string | null {
    if (!meta) {
      return null;
    }
    if (meta.cloneVideoPath) {
      return 'VIDEOS: video-edge.mp4 (default) + video-clone.mp4 (clone)';
    }
    return `VIDEOS: video-edge.mp4 only${meta.cloneError ? ` — clone skipped: ${meta.cloneError}` : ''}`;
  }

  private attachmentsNote(
    hasThreadsImage: boolean,
    hasYoutubeThumbnail: boolean,
    hasClone: boolean,
    html = true,
  ): string {
    const parts = [
      'video-edge.mp4 (default voice)',
      ...(hasClone ? ['video-clone.mp4 (your clone voice)'] : []),
    ];
    if (hasThreadsImage) {
      parts.push('threads.jpg (Threads)');
    }
    if (hasYoutubeThumbnail) {
      parts.push('youtube-thumbnail.jpg (YouTube custom thumbnail)');
    }
    if (html) {
      return `Attachments: ${parts
        .map((part) => {
          const file = part.split(' ')[0];
          return `<strong>${file}</strong>${part.slice(file.length)}`;
        })
        .join(' + ')}.`;
    }
    return `Attachments: ${parts.join(' + ')}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
