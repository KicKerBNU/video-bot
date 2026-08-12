import type { CaptionChunk } from '../src/common/types';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '../src/common/video-constants';

export { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH };

export type NewsVideoProps = {
  title: string;
  hook?: string;
  brandName: string;
  audioFileUrl: string;
  durationInFrames: number;
  captions: CaptionChunk[];
  fps: number;
};

export const defaultNewsVideoProps: NewsVideoProps = {
  title: 'AI news of the day',
  hook: 'Here is what matters in AI today',
  brandName: 'AI Daily',
  audioFileUrl: '',
  durationInFrames: 300,
  captions: [
    {
      text: 'Welcome to AI Daily',
      startMs: 0,
      endMs: 2000,
      words: [
        { word: 'Welcome', startMs: 0, endMs: 500 },
        { word: 'to', startMs: 500, endMs: 700 },
        { word: 'AI', startMs: 700, endMs: 1100 },
        { word: 'Daily', startMs: 1100, endMs: 2000 },
      ],
    },
  ],
  fps: VIDEO_FPS,
};
