import sharp from 'sharp';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '../../common/video-constants';

/**
 * Creates a vertical branded gradient background (MoviePy-style still frame).
 * Forest/lime palette — readable, not the default purple AI look.
 */
export async function createBackgroundImage(outputPath: string): Promise<void> {
  const width = VIDEO_WIDTH;
  const height = VIDEO_HEIGHT;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#06251F"/>
          <stop offset="45%" stop-color="#0B3A31"/>
          <stop offset="100%" stop-color="#102820"/>
        </linearGradient>
        <radialGradient id="glowA" cx="20%" cy="15%" r="45%">
          <stop offset="0%" stop-color="#C8F560" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#C8F560" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glowB" cx="80%" cy="80%" r="40%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.07"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#glowA)"/>
      <rect width="100%" height="100%" fill="url(#glowB)"/>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}
