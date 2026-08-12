import React from 'react';
import { Composition } from 'remotion';
import { NewsVideo } from './Video';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  defaultNewsVideoProps,
} from './types';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NewsVideo"
        component={NewsVideo}
        durationInFrames={defaultNewsVideoProps.durationInFrames}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultNewsVideoProps}
        calculateMetadata={({ props }: { props: typeof defaultNewsVideoProps }) => ({
          durationInFrames: Math.max(1, props.durationInFrames),
          props,
        })}
      />
    </>
  );
};
