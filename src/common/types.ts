export interface ScriptSegment {
  id: string;
  title: string;
  summary?: string;
  /** Phrase used to align this segment to TTS word timings */
  spokenHint: string;
  /** Query used to find related still images (Openverse fallback) */
  searchQuery: string;
  /** Rich prompt for Kling AI image generation */
  imagePrompt?: string;
}

export interface VideoScript {
  id: string;
  title: string;
  body: string;
  hook?: string;
  hashtags?: string[];
  sourceUrl?: string;
  publishedAt?: string;
  segments?: ScriptSegment[];
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
  /** Which engine produced the audio for this run. */
  provider: 'local' | 'edge';
  /** Set when TTS_PROVIDER=local but Edge was used instead. */
  fallbackReason?: string;
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
  platform: 'twitter' | 'tiktok' | 'email';
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
