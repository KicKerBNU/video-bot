import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Captions } from './Captions';
import type { NewsVideoProps } from './types';

export const NewsVideo: React.FC<NewsVideoProps> = ({
  title,
  hook,
  brandName,
  audioFileUrl,
  captions,
  fps,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const introOpacity = interpolate(frame, [0, 12, 55, 75], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bgShift = interpolate(frame, [0, durationInFrames], [0, 40], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, #06251F ${bgShift}%, #0B3A31 45%, #102820 100%)`,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 15%, rgba(200,245,96,0.18), transparent 42%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.06), transparent 35%)',
        }}
      />

      <AbsoluteFill
        style={{
          opacity: introOpacity,
          justifyContent: 'flex-start',
          padding: '140px 72px 0',
        }}
      >
        <div
          style={{
            fontFamily: 'Georgia, Times New Roman, serif',
            fontSize: 28,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#C8F560',
            marginBottom: 28,
          }}
        >
          {brandName}
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'Georgia, Times New Roman, serif',
            fontSize: 78,
            lineHeight: 1.05,
            color: '#F7F4EF',
            maxWidth: 900,
          }}
        >
          {title}
        </h1>
        {hook ? (
          <p
            style={{
              marginTop: 28,
              fontFamily: 'Helvetica Neue, Arial, sans-serif',
              fontSize: 34,
              lineHeight: 1.35,
              color: 'rgba(247,244,239,0.82)',
              maxWidth: 860,
            }}
          >
            {hook}
          </p>
        ) : null}
      </AbsoluteFill>

      <Captions captions={captions} fps={fps} />

      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 72,
        }}
      >
        <div
          style={{
            fontFamily: 'Helvetica Neue, Arial, sans-serif',
            fontSize: 24,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(247,244,239,0.55)',
          }}
        >
          {brandName}
        </div>
      </AbsoluteFill>

      {audioFileUrl ? (
        <Sequence from={70}>
          <Audio src={audioFileUrl} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
