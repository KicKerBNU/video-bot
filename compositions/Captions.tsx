import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { CaptionChunk } from '../src/common/types';

type CaptionsProps = {
  captions: CaptionChunk[];
  fps: number;
};

export const Captions: React.FC<CaptionsProps> = ({ captions, fps }) => {
  const frame = useCurrentFrame();
  const nowMs = (frame / fps) * 1000;

  const active = captions.find(
    (chunk) => nowMs >= chunk.startMs && nowMs <= chunk.endMs + 80,
  );

  if (!active) {
    return null;
  }

  const localProgress = interpolate(
    nowMs,
    [active.startMs, active.startMs + 120, active.endMs],
    [0.92, 1, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 64px',
        top: '18%',
      }}
    >
      <div
        style={{
          transform: `scale(${localProgress})`,
          textAlign: 'center',
          maxWidth: 920,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: 'Arial Black, Helvetica Neue, sans-serif',
            fontSize: 72,
            lineHeight: 1.15,
            fontWeight: 900,
            color: '#F7F4EF',
            textTransform: 'uppercase',
            letterSpacing: '-0.02em',
            textShadow:
              '0 4px 0 #0B1F1A, 0 10px 28px rgba(0,0,0,0.45)',
          }}
        >
          {active.words.map((word, index) => {
            const isLit = nowMs >= word.startMs;
            return (
              <span
                key={`${word.word}-${index}`}
                style={{
                  color: isLit ? '#C8F560' : '#F7F4EF',
                  marginRight: 14,
                  display: 'inline-block',
                }}
              >
                {word.word}
              </span>
            );
          })}
        </p>
      </div>
    </AbsoluteFill>
  );
};
