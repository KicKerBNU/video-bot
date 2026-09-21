import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export interface VoiceScriptItem {
  id: string;
  text: string;
  words: number;
  recordSeconds: number;
  hasCloser: boolean;
  completed: boolean;
  durationSec: number | null;
  recordedAt: string | null;
  audioUrl: string | null;
}

interface ProgressFile {
  voice: string;
  updatedAt: string;
  completed: Record<
    string,
    { at: string; durationSec: number; bytes: number }
  >;
}

@Injectable()
export class VoicePackService {
  private readonly logger = new Logger(VoicePackService.name);
  private readonly scriptsDir = join(
    process.cwd(),
    'workers/tts/voices/scripts',
  );
  private readonly packDir = join(
    process.cwd(),
    'workers/tts/voices/everton/pack',
  );
  private readonly progressPath = join(this.packDir, 'progress.json');
  private readonly manifestPath = join(this.scriptsDir, 'manifest.json');

  async listScripts(): Promise<{
    voice: string;
    total: number;
    completedCount: number;
    nextId: string | null;
    scripts: VoiceScriptItem[];
  }> {
    const manifest = await this.readManifest();
    const progress = await this.readProgress();
    const scripts: VoiceScriptItem[] = [];

    for (const entry of manifest.scripts) {
      const text = (
        await readFile(join(this.scriptsDir, entry.file), 'utf8')
      ).trim();
      const wavPath = join(this.packDir, `${entry.id}.wav`);
      const exists = await this.fileExists(wavPath);
      const meta = progress.completed[entry.id];
      const durationSec = exists
        ? (meta?.durationSec ?? (await this.probeDuration(wavPath)))
        : null;

      scripts.push({
        id: entry.id,
        text,
        words: entry.words,
        recordSeconds: entry.recordSeconds,
        hasCloser: entry.hasCloser,
        completed: exists,
        durationSec,
        recordedAt: meta?.at ?? null,
        audioUrl: exists ? `/voice-pack/audio/${entry.id}` : null,
      });
    }

    const completedCount = scripts.filter((s) => s.completed).length;
    const next = scripts.find((s) => !s.completed);

    return {
      voice: manifest.voice,
      total: scripts.length,
      completedCount,
      nextId: next?.id ?? null,
      scripts,
    };
  }

  async saveRecording(
    id: string,
    buffer: Buffer,
    originalName: string,
  ): Promise<VoiceScriptItem> {
    const normalized = this.normalizeId(id);
    const manifest = await this.readManifest();
    const entry = manifest.scripts.find((s) => s.id === normalized);
    if (!entry) {
      throw new NotFoundException(`Unknown script id ${normalized}`);
    }
    if (!buffer?.length) {
      throw new BadRequestException('Empty audio upload');
    }

    await mkdir(this.packDir, { recursive: true });
    const ext = this.guessExt(originalName);
    const rawPath = join(this.packDir, `${normalized}-upload${ext}`);
    const wavPath = join(this.packDir, `${normalized}.wav`);
    const rawKeep = join(this.packDir, `${normalized}-raw.wav`);

    await writeFile(rawPath, buffer);
    await this.convertToWav(rawPath, wavPath);
    // Keep a raw copy as wav for pack-qa / debugging
    try {
      await writeFile(rawKeep, await readFile(wavPath));
    } catch {
      /* ignore */
    }
    await unlink(rawPath).catch(() => undefined);

    const durationSec = await this.probeDuration(wavPath);
    if (durationSec < 5) {
      await unlink(wavPath).catch(() => undefined);
      throw new BadRequestException(
        `Recording too short (${durationSec.toFixed(1)}s). Hold Finish after you finish speaking.`,
      );
    }

    const progress = await this.readProgress();
    const info = await readFile(wavPath);
    progress.completed[normalized] = {
      at: new Date().toISOString(),
      durationSec: Math.round(durationSec * 100) / 100,
      bytes: info.length,
    };
    progress.updatedAt = new Date().toISOString();
    await writeFile(
      this.progressPath,
      `${JSON.stringify(progress, null, 2)}\n`,
    );

    // Fire-and-forget pack QA so XTTS multi-ref stays fresh
    void this.rebuildApproved().catch((err) =>
      this.logger.warn(`pack-qa after upload failed: ${String(err)}`),
    );

    const list = await this.listScripts();
    const item = list.scripts.find((s) => s.id === normalized);
    if (!item) {
      throw new NotFoundException(normalized);
    }
    return item;
  }

  async deleteRecording(id: string): Promise<void> {
    const normalized = this.normalizeId(id);
    const wavPath = join(this.packDir, `${normalized}.wav`);
    const rawPath = join(this.packDir, `${normalized}-raw.wav`);
    await unlink(wavPath).catch(() => undefined);
    await unlink(rawPath).catch(() => undefined);
    const progress = await this.readProgress();
    delete progress.completed[normalized];
    progress.updatedAt = new Date().toISOString();
    await writeFile(
      this.progressPath,
      `${JSON.stringify(progress, null, 2)}\n`,
    );
    void this.rebuildApproved().catch(() => undefined);
  }

  async getAudioPath(id: string): Promise<string> {
    const normalized = this.normalizeId(id);
    const wavPath = join(this.packDir, `${normalized}.wav`);
    if (!(await this.fileExists(wavPath))) {
      throw new NotFoundException(`No recording for ${normalized}`);
    }
    return wavPath;
  }

  async rebuildApproved(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const py = join(process.cwd(), 'workers/tts/.venv/bin/python');
      const script = join(process.cwd(), 'scripts/tts-pack-qa.py');
      const child = spawn(py, [script], {
        cwd: process.cwd(),
        env: process.env,
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true, message: 'approved.json rebuilt' });
        } else {
          resolve({
            ok: false,
            message: stderr.slice(-400) || `pack-qa exit ${code}`,
          });
        }
      });
    });
  }

  private normalizeId(id: string): string {
    const digits = id.replace(/\D/g, '');
    if (!digits) {
      throw new BadRequestException('Invalid script id');
    }
    return digits.padStart(2, '0');
  }

  private async readManifest(): Promise<{
    voice: string;
    scripts: Array<{
      id: string;
      file: string;
      words: number;
      recordSeconds: number;
      hasCloser: boolean;
    }>;
  }> {
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      return JSON.parse(raw) as {
        voice: string;
        scripts: Array<{
          id: string;
          file: string;
          words: number;
          recordSeconds: number;
          hasCloser: boolean;
        }>;
      };
    } catch {
      throw new NotFoundException(
        'Script manifest missing — run yarn tts:scripts',
      );
    }
  }

  private async readProgress(): Promise<ProgressFile> {
    try {
      const raw = await readFile(this.progressPath, 'utf8');
      return JSON.parse(raw) as ProgressFile;
    } catch {
      return {
        voice: 'everton',
        updatedAt: new Date().toISOString(),
        completed: {},
      };
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private guessExt(name: string): string {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.wav')) return '.wav';
    if (lower.endsWith('.mp3')) return '.mp3';
    if (lower.endsWith('.ogg')) return '.ogg';
    if (lower.endsWith('.m4a')) return '.m4a';
    return '.webm';
  }

  private convertToWav(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'ffmpeg',
        [
          '-y',
          '-i',
          input,
          '-af',
          'highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-sample_fmt',
          's16',
          output,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let err = '';
      child.stderr.on('data', (c: Buffer) => {
        err += c.toString();
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg failed: ${err.slice(-300)}`));
      });
    });
  }

  private probeDuration(path: string): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=nw=1:nk=1',
          path,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString();
      });
      child.on('close', () => {
        resolve(Number.parseFloat(out.trim()) || 0);
      });
    });
  }
}
