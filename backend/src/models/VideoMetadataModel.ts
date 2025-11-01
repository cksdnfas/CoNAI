import Database from 'better-sqlite3';
import { db } from '../database/init';

export interface VideoMetadata {
  file_hash: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  video_codec?: string;
  audio_codec?: string;
  bitrate?: number;
  ai_tool?: string;
  model_name?: string;
  lora_models?: string;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  seed?: number;
  scheduler?: string;
  prompt?: string;
  negative_prompt?: string;
  denoise_strength?: number;
  generation_time?: number;
  batch_size?: number;
  batch_index?: number;
  auto_tags?: string;
  rating_score?: number;
  first_seen_date?: string;
  metadata_updated_date?: string;
}

export interface CreateVideoMetadataParams {
  file_hash: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  video_codec?: string;
  audio_codec?: string;
  bitrate?: number;
  ai_tool?: string;
  model_name?: string;
  lora_models?: string;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  seed?: number;
  scheduler?: string;
  prompt?: string;
  negative_prompt?: string;
  denoise_strength?: number;
  generation_time?: number;
  batch_size?: number;
  batch_index?: number;
  auto_tags?: string;
  rating_score?: number;
}

export class VideoMetadataModel {
  private db: Database.Database;

  constructor() {
    this.db = db;
  }

  /**
   * file_hash로 비디오 메타데이터 조회
   */
  findByFileHash(fileHash: string): VideoMetadata | null {
    const stmt = this.db.prepare(`
      SELECT * FROM video_metadata WHERE file_hash = ?
    `);
    return stmt.get(fileHash) as VideoMetadata | null;
  }

  /**
   * 새 비디오 메타데이터 생성
   */
  create(params: CreateVideoMetadataParams): VideoMetadata {
    const stmt = this.db.prepare(`
      INSERT INTO video_metadata (
        file_hash, duration, fps, width, height,
        video_codec, audio_codec, bitrate,
        ai_tool, model_name, lora_models, steps, cfg_scale,
        sampler, seed, scheduler, prompt, negative_prompt,
        denoise_strength, generation_time, batch_size, batch_index,
        auto_tags, rating_score
      ) VALUES (
        @file_hash, @duration, @fps, @width, @height,
        @video_codec, @audio_codec, @bitrate,
        @ai_tool, @model_name, @lora_models, @steps, @cfg_scale,
        @sampler, @seed, @scheduler, @prompt, @negative_prompt,
        @denoise_strength, @generation_time, @batch_size, @batch_index,
        @auto_tags, @rating_score
      )
    `);

    stmt.run(params);
    return this.findByFileHash(params.file_hash)!;
  }

  /**
   * 비디오 메타데이터 업데이트
   */
  update(fileHash: string, params: Partial<CreateVideoMetadataParams>): VideoMetadata | null {
    const updates: string[] = [];
    const values: Record<string, any> = { file_hash: fileHash };

    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'file_hash' && value !== undefined) {
        updates.push(`${key} = @${key}`);
        values[key] = value;
      }
    });

    if (updates.length === 0) {
      return this.findByFileHash(fileHash);
    }

    updates.push('metadata_updated_date = CURRENT_TIMESTAMP');

    const stmt = this.db.prepare(`
      UPDATE video_metadata
      SET ${updates.join(', ')}
      WHERE file_hash = @file_hash
    `);

    stmt.run(values);
    return this.findByFileHash(fileHash);
  }

  /**
   * 비디오 메타데이터 삭제
   */
  delete(fileHash: string): boolean {
    const stmt = this.db.prepare('DELETE FROM video_metadata WHERE file_hash = ?');
    const result = stmt.run(fileHash);
    return result.changes > 0;
  }

  /**
   * file_hash 존재 여부 확인
   */
  exists(fileHash: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM video_metadata WHERE file_hash = ? LIMIT 1');
    return stmt.get(fileHash) !== undefined;
  }

  /**
   * 모든 비디오 메타데이터 조회 (페이징 지원)
   */
  findAll(limit: number = 100, offset: number = 0): VideoMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM video_metadata
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as VideoMetadata[];
  }

  /**
   * 비디오 메타데이터 총 개수
   */
  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM video_metadata');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * AI 툴별 비디오 개수
   */
  countByAiTool(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT ai_tool, COUNT(*) as count
      FROM video_metadata
      WHERE ai_tool IS NOT NULL
      GROUP BY ai_tool
    `);
    const results = stmt.all() as Array<{ ai_tool: string; count: number }>;

    return results.reduce((acc, row) => {
      acc[row.ai_tool] = row.count;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * 프롬프트로 검색
   */
  searchByPrompt(searchTerm: string, limit: number = 50): VideoMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM video_metadata
      WHERE prompt LIKE ? OR negative_prompt LIKE ?
      ORDER BY first_seen_date DESC
      LIMIT ?
    `);
    const pattern = `%${searchTerm}%`;
    return stmt.all(pattern, pattern, limit) as VideoMetadata[];
  }

  /**
   * 자동 태그로 검색
   */
  searchByTag(tag: string, limit: number = 50): VideoMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM video_metadata
      WHERE auto_tags LIKE ?
      ORDER BY first_seen_date DESC
      LIMIT ?
    `);
    const pattern = `%${tag}%`;
    return stmt.all(pattern, limit) as VideoMetadata[];
  }
}

export default new VideoMetadataModel();
