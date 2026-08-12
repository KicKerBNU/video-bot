import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, statSync } from 'fs';
import { AppConfigService } from '../config/app-config.service';
import { PublishResult, VideoScript } from '../common/types';

interface TikTokInitResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface TikTokStatusResponse {
  data?: {
    status?: string;
    publicaly_available_post_id?: number[];
    publicly_available_post_id?: number[];
    fail_reason?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

@Injectable()
export class TikTokPublisherService {
  private readonly logger = new Logger(TikTokPublisherService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async publish(script: VideoScript, videoPath: string): Promise<PublishResult> {
    const fileSize = statSync(videoPath).size;
    const caption = this.buildCaption(script);

    this.logger.log(`Initializing TikTok upload for ${script.id}`);

    // Direct post when available; falls back to inbox upload semantics via post_info.
    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appConfig.tiktokAccessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: caption.slice(0, 2200),
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: fileSize,
            chunk_size: fileSize,
            total_chunk_count: 1,
          },
        }),
      },
    );

    const initPayload = (await initResponse.json()) as TikTokInitResponse;
    if (!initResponse.ok || !initPayload.data?.upload_url || !initPayload.data.publish_id) {
      // If direct post is not approved, retry as upload-to-inbox.
      this.logger.warn(
        `Direct TikTok post init failed (${initPayload.error?.code ?? initResponse.status}); trying inbox upload`,
      );
      return this.publishToInbox(script, videoPath, caption, fileSize);
    }

    await this.uploadVideo(initPayload.data.upload_url, videoPath, fileSize);
    const publishId = initPayload.data.publish_id;
    const postId = await this.waitForPublish(publishId);

    return {
      platform: 'tiktok',
      postId,
    };
  }

  private async publishToInbox(
    script: VideoScript,
    videoPath: string,
    caption: string,
    fileSize: number,
  ): Promise<PublishResult> {
    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appConfig.tiktokAccessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: fileSize,
            chunk_size: fileSize,
            total_chunk_count: 1,
          },
        }),
      },
    );

    const initPayload = (await initResponse.json()) as TikTokInitResponse;
    if (!initResponse.ok || !initPayload.data?.upload_url || !initPayload.data.publish_id) {
      throw new Error(
        `TikTok inbox init failed: ${initPayload.error?.message ?? initResponse.status} (caption prepared: ${caption.slice(0, 40)}…)`,
      );
    }

    await this.uploadVideo(initPayload.data.upload_url, videoPath, fileSize);
    this.logger.log(
      `TikTok inbox upload complete for ${script.id}; publish_id=${initPayload.data.publish_id}`,
    );

    return {
      platform: 'tiktok',
      postId: initPayload.data.publish_id,
    };
  }

  private async uploadVideo(
    uploadUrl: string,
    videoPath: string,
    fileSize: number,
  ): Promise<void> {
    const stream = createReadStream(videoPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fileSize),
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TikTok video upload failed (${response.status}): ${text.slice(0, 300)}`);
    }
  }

  private async waitForPublish(publishId: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await this.sleep(3000);
      const response = await fetch(
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.appConfig.tiktokAccessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({ publish_id: publishId }),
        },
      );

      const payload = (await response.json()) as TikTokStatusResponse;
      const status = payload.data?.status;
      this.logger.log(`TikTok publish status: ${status}`);

      if (status === 'PUBLISH_COMPLETE') {
        const ids =
          payload.data?.publicly_available_post_id ??
          payload.data?.publicaly_available_post_id ??
          [];
        return String(ids[0] ?? publishId);
      }

      if (status === 'FAILED') {
        throw new Error(
          `TikTok publish failed: ${payload.data?.fail_reason ?? payload.error?.message ?? 'unknown'}`,
        );
      }
    }

    return publishId;
  }

  private buildCaption(script: VideoScript): string {
    const hashtags = (script.hashtags ?? ['#AI', '#TechNews', '#TikTokNews'])
      .slice(0, 5)
      .join(' ');
    return `${script.title}\n\n${script.hook ?? ''}\n\n${hashtags}`.trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
