import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { TwitterApi } from 'twitter-api-v2';
import { AppConfigService } from '../config/app-config.service';
import { PublishResult, VideoScript } from '../common/types';

@Injectable()
export class TwitterPublisherService {
  private readonly logger = new Logger(TwitterPublisherService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async publish(script: VideoScript, videoPath: string): Promise<PublishResult> {
    const client = new TwitterApi({
      appKey: this.appConfig.twitterConsumerKey,
      appSecret: this.appConfig.twitterConsumerSecret,
      accessToken: this.appConfig.twitterAccessToken,
      accessSecret: this.appConfig.twitterAccessTokenSecret,
    });

    const mediaData = await readFile(videoPath);
    this.logger.log(`Uploading video to Twitter for ${script.id}`);

    const mediaId = await client.v1.uploadMedia(mediaData, {
      mimeType: 'video/mp4',
      target: 'tweet',
    });

    const text = this.buildTweetText(script);
    const tweet = await client.v2.tweet({
      text,
      media: { media_ids: [mediaId] },
    });

    const postId = tweet.data.id;
    this.logger.log(`Tweet created: ${postId}`);

    return {
      platform: 'twitter',
      postId,
      url: `https://x.com/i/status/${postId}`,
    };
  }

  private buildTweetText(script: VideoScript): string {
    // Never include URLs — X Pay Per Use charges ~$0.20 for posts with links
    // vs ~$0.015 for media/text posts without URLs.
    const hashtags = (script.hashtags ?? ['#AI', '#TechNews'])
      .slice(0, 3)
      .join(' ');
    const base = `${script.title}\n\n${hashtags}`;
    return base.length > 270 ? `${base.slice(0, 267)}...` : base;
  }
}
