import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunResult, PostedRecord } from '../common/types';

@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreService.name);
  private db!: Database.Database;
  private lastRun: PipelineRunResult | null = null;

  constructor(private readonly appConfig: AppConfigService) {}

  onModuleInit(): void {
    const dataDir = join(process.cwd(), this.appConfig.dataDir);
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'video-gen.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posted_items (
        news_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        video_path TEXT NOT NULL,
        twitter_post_id TEXT,
        tiktok_post_id TEXT,
        posted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        news_id TEXT,
        video_path TEXT,
        message TEXT,
        payload TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
    `);
    this.logger.log(`SQLite store ready at ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.db?.close();
  }

  isPosted(newsId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM posted_items WHERE news_id = ?')
      .get(newsId) as { ok: number } | undefined;
    return Boolean(row);
  }

  savePosted(record: PostedRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO posted_items (
          news_id, title, video_path, twitter_post_id, tiktok_post_id, posted_at
        ) VALUES (
          @newsId, @title, @videoPath, @twitterPostId, @tiktokPostId, @postedAt
        )
        ON CONFLICT(news_id) DO UPDATE SET
          title = excluded.title,
          video_path = excluded.video_path,
          twitter_post_id = COALESCE(excluded.twitter_post_id, posted_items.twitter_post_id),
          tiktok_post_id = COALESCE(excluded.tiktok_post_id, posted_items.tiktok_post_id),
          posted_at = excluded.posted_at
        `,
      )
      .run({
        newsId: record.newsId,
        title: record.title,
        videoPath: record.videoPath,
        twitterPostId: record.twitterPostId ?? null,
        tiktokPostId: record.tiktokPostId ?? null,
        postedAt: record.postedAt,
      });
  }

  getLastPosted(): PostedRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          news_id as newsId,
          title,
          video_path as videoPath,
          twitter_post_id as twitterPostId,
          tiktok_post_id as tiktokPostId,
          posted_at as postedAt
        FROM posted_items
        ORDER BY posted_at DESC
        LIMIT 1
        `,
      )
      .get() as PostedRecord | undefined;

    return row ?? null;
  }

  saveRun(result: PipelineRunResult): void {
    this.lastRun = result;
    this.db
      .prepare(
        `
        INSERT INTO pipeline_runs (
          status, news_id, video_path, message, payload, started_at, finished_at
        ) VALUES (
          @status, @newsId, @videoPath, @message, @payload, @startedAt, @finishedAt
        )
        `,
      )
      .run({
        status: result.status,
        newsId: result.newsId ?? null,
        videoPath: result.videoPath ?? null,
        message: result.message ?? null,
        payload: JSON.stringify(result),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      });
  }

  getLastRun(): PipelineRunResult | null {
    if (this.lastRun) {
      return this.lastRun;
    }

    const row = this.db
      .prepare(
        `
        SELECT payload
        FROM pipeline_runs
        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get() as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    this.lastRun = JSON.parse(row.payload) as PipelineRunResult;
    return this.lastRun;
  }
}
