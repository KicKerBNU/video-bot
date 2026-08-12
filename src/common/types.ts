export interface VideoScript {
  id: string;
  title: string;
  body: string;
  hook?: string;
  hashtags?: string[];
  sourceUrl?: string;
  publishedAt?: string;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TtsResult {
  audioPath: string;
  durationMs: number;
  words: WordTimestamp[];
}

export interface CaptionChunk {
  text: string;
  startMs: number;
  endMs: number;
  words: WordTimestamp[];
}

export interface NewsVideoProps {
  title: string;
  hook?: string;
  brandName: string;
  audioFileUrl: string;
  durationInFrames: number;
  captions: CaptionChunk[];
  fps: number;
}

export interface PublishResult {
  platform: 'twitter' | 'tiktok';
  postId: string;
  url?: string;
}

export interface PipelineRunResult {
  status: 'posted' | 'skipped' | 'failed';
  newsId?: string;
  videoPath?: string;
  publishes?: PublishResult[];
  message?: string;
  startedAt: string;
  finishedAt: string;
}

export interface PostedRecord {
  newsId: string;
  title: string;
  videoPath: string;
  twitterPostId?: string;
  tiktokPostId?: string;
  postedAt: string;
}
