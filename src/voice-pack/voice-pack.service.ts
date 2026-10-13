import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export type VoiceScriptMode = 'short' | 'long' | 'focus' | 'all';

export interface VoiceScriptItem {
  id: string;
  text: string;
  words: number;
  recordSeconds: number;
  minSeconds: number;
  hasCloser: boolean;
  mode: 'short' | 'long' | 'focus';
  completed: boolean;
  durationSec: number | null;
  recordedAt: string | null;
  audioUrl: string | null;
}

interface ManifestScript {
  id: string;
  file: string;
  words: number;
  recordSeconds: number;
  minSeconds?: number;
  hasCloser: boolean;
  mode?: 'short' | 'long' | 'focus';
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
  private readonly shortManifestPath = join(this.scriptsDir, 'manifest.json');
  private readonly longManifestPath = join(
    this.scriptsDir,
    'long',
    'manifest.json',
  );
  private readonly focusManifestPath = join(
    this.scriptsDir,
    'focus',
    'manifest.json',
  );

  async listScripts(mode: VoiceScriptMode = 'all'): Promise<{
    voice: string;
    mode: VoiceScriptMode;
    total: number;
    completedCount: number;
    nextId: string | null;
    scripts: VoiceScriptItem[];
  }> {
    const entries = await this.readAllManifestScripts();
    const progress = await this.readProgress();
    const scripts: VoiceScriptItem[] = [];

    for (const entry of entries) {
      const scriptMode =
        entry.mode === 'long'
          ? 'long'
          : entry.mode === 'focus'
            ? 'focus'
            : 'short';
      if (mode !== 'all' && scriptMode !== mode) {
        continue;
      }
      const textPath = join(this.scriptsDir, entry.file);
      const text = (await readFile(textPath, 'utf8')).trim();
      const wavPath = join(this.packDir, `${entry.id}.wav`);
      const exists = await this.fileExists(wavPath);
      const meta = progress.completed[entry.id];
      const durationSec = exists
        ? (meta?.durationSec ?? (await this.probeDuration(wavPath)))
        : null;
      const minSeconds =
        entry.minSeconds ??
        (scriptMode === 'long' ? 22 : scriptMode === 'focus' ? 20 : 12);

      scripts.push({
        id: entry.id,
        text,
        words: entry.words,
        recordSeconds: entry.recordSeconds,
        minSeconds,
        hasCloser: entry.hasCloser,
        mode: scriptMode,
        completed: exists,
        durationSec,
        recordedAt: meta?.at ?? null,
        audioUrl: exists ? `/voice-pack/audio/${entry.id}` : null,
      });
    }

    const completedCount = scripts.filter((s) => s.completed).length;
    const next = scripts.find((s) => !s.completed);

    return {
      voice: 'everton',
      mode,
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
    const entries = await this.readAllManifestScripts();
    const entry = entries.find((s) => s.id === normalized);
    if (!entry) {
      throw new NotFoundException(`Unknown script id ${normalized}`);
    }
    if (!buffer?.length) {
      throw new BadRequestException('Empty audio upload');
    }

    const scriptMode =
      entry.mode === 'long'
        ? 'long'
        : entry.mode === 'focus'
          ? 'focus'
          : 'short';
    const minSeconds =
      entry.minSeconds ??
      (scriptMode === 'long' ? 22 : scriptMode === 'focus' ? 20 : 12);

    await mkdir(this.packDir, { recursive: true });
    const ext = this.guessExt(originalName);
    const rawPath = join(this.packDir, `${normalized}-upload${ext}`);
    const wavPath = join(this.packDir, `${normalized}.wav`);
    const rawKeep = join(this.packDir, `${normalized}-raw.wav`);

    await writeFile(rawPath, buffer);
    await this.convertToWav(rawPath, wavPath);
    try {
      await writeFile(rawKeep, await readFile(wavPath));
    } catch {
      /* ignore */
    }
    await unlink(rawPath).catch(() => undefined);

    const durationSec = await this.probeDuration(wavPath);
    if (durationSec < minSeconds) {
      await unlink(wavPath).catch(() => undefined);
      await unlink(rawKeep).catch(() => undefined);
      throw new BadRequestException(
        `Recording too short (${durationSec.toFixed(1)}s). Need at least ${minSeconds}s — read the full script, then Finish.`,
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

    void this.rebuildApproved().catch((err) =>
      this.logger.warn(`pack-qa after upload failed: ${String(err)}`),
    );

    const list = await this.listScripts('all');
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

  /** Accepts 01–40, L01–L20, or F01–F15. */
  private normalizeId(id: string): string {
    const raw = id.trim().toUpperCase();
    const longMatch = /^L0*(\d{1,2})$/.exec(raw);
    if (longMatch) {
      return `L${longMatch[1].padStart(2, '0')}`;
    }
    const focusMatch = /^F0*(\d{1,2})$/.exec(raw);
    if (focusMatch) {
      return `F${focusMatch[1].padStart(2, '0')}`;
    }
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      throw new BadRequestException('Invalid script id');
    }
    return digits.padStart(2, '0');
  }

  private async readAllManifestScripts(): Promise<ManifestScript[]> {
    const short = await this.readManifestFile(this.shortManifestPath, 'short');
    const long = await this.readManifestFile(this.longManifestPath, 'long');
    const focus = await this.readManifestFile(this.focusManifestPath, 'focus');
    return [...short, ...long, ...focus];
  }

  private async readManifestFile(
    path: string,
    fallbackMode: 'short' | 'long' | 'focus',
  ): Promise<ManifestScript[]> {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { scripts?: ManifestScript[] };
      return (parsed.scripts ?? []).map((s) => ({
        ...s,
        mode: s.mode ?? fallbackMode,
      }));
    } catch {
      if (fallbackMode === 'short') {
        throw new NotFoundException(
          'Script manifest missing — run yarn tts:scripts',
        );
      }
      this.logger.warn(`Manifest missing at ${path}`);
      return [];
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
