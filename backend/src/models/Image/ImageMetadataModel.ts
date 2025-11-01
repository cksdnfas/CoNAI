import { db } from '../../database/init';
import { ImageMetadataRecord } from '../../types/image';

/**
 * 이미지 메타데이터 모델
 * 원본 파일 접근이 필요 없는 모든 작업의 핵심
 *
 * 사용 케이스:
 * - 이미지 브라우징 (썸네일은 캐시에 있음)
 * - 검색/필터 (prompt, model, tags 기반)
 * - 통계/분석 (모델 사용량, 프롬프트 분석)
 * - 그룹 관리 (composite_hash 기반)
 */
export class ImageMetadataModel {
  /**
   * composite_hash로 메타데이터 조회
   */
  static findByHash(compositeHash: string): ImageMetadataRecord | null {
    const row = db.prepare(
      'SELECT * FROM image_metadata WHERE composite_hash = ?'
    ).get(compositeHash);
    return row as ImageMetadataRecord | null;
  }

  /**
   * 여러 composite_hash로 메타데이터 조회
   */
  static findByHashes(compositeHashes: string[]): ImageMetadataRecord[] {
    if (compositeHashes.length === 0) return [];

    const placeholders = compositeHashes.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM image_metadata WHERE composite_hash IN (${placeholders})`
    ).all(...compositeHashes);
    return rows as ImageMetadataRecord[];
  }

  /**
   * 모든 메타데이터 조회 (페이지네이션)
   * 브라우징, 검색, 필터링의 기본
   */
  static findAll(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'rating_score' | 'model_name' | 'metadata_updated_date';
    sortOrder?: 'ASC' | 'DESC';
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const sortBy = options.sortBy || 'first_seen_date';
    const sortOrder = options.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM image_metadata').get() as { total: number };

    const items = db.prepare(`
      SELECT * FROM image_metadata
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 메타데이터 생성
   */
  static create(data: Omit<ImageMetadataRecord, 'first_seen_date' | 'metadata_updated_date'>): string {
    db.prepare(`
      INSERT INTO image_metadata (
        composite_hash, perceptual_hash, dhash, ahash, color_histogram,
        width, height, thumbnail_path, optimized_path,
        ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
        prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
        auto_tags, duration, fps, video_codec, audio_codec, bitrate, rating_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.composite_hash, data.perceptual_hash, data.dhash, data.ahash, data.color_histogram,
      data.width, data.height, data.thumbnail_path, data.optimized_path,
      data.ai_tool, data.model_name, data.lora_models, data.steps, data.cfg_scale,
      data.sampler, data.seed, data.scheduler, data.prompt, data.negative_prompt,
      data.denoise_strength, data.generation_time, data.batch_size, data.batch_index,
      data.auto_tags, data.duration, data.fps, data.video_codec, data.audio_codec,
      data.bitrate, data.rating_score
    );

    return data.composite_hash;
  }

  /**
   * 메타데이터 업데이트
   */
  static update(compositeHash: string, updates: Partial<ImageMetadataRecord>): boolean {
    const fields: string[] = [];
    const values: any[] = [];

    // 업데이트 가능한 필드들
    const updatableFields = [
      'prompt', 'negative_prompt', 'auto_tags', 'rating_score',
      'ai_tool', 'model_name', 'lora_models', 'steps', 'cfg_scale',
      'sampler', 'seed', 'scheduler', 'denoise_strength',
      'generation_time', 'batch_size', 'batch_index',
      'thumbnail_path', 'optimized_path', 'width', 'height'
    ];

    for (const field of updatableFields) {
      if (updates[field as keyof ImageMetadataRecord] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field as keyof ImageMetadataRecord]);
      }
    }

    if (fields.length === 0) return false;

    fields.push('metadata_updated_date = CURRENT_TIMESTAMP');
    values.push(compositeHash);

    const info = db.prepare(`
      UPDATE image_metadata SET ${fields.join(', ')} WHERE composite_hash = ?
    `).run(...values);

    return info.changes > 0;
  }

  /**
   * 메타데이터 삭제 (CASCADE로 image_files도 삭제됨)
   */
  static delete(compositeHash: string): boolean {
    const info = db.prepare('DELETE FROM image_metadata WHERE composite_hash = ?').run(compositeHash);
    return info.changes > 0;
  }

  /**
   * 여러 메타데이터 삭제
   */
  static deleteMany(compositeHashes: string[]): number {
    if (compositeHashes.length === 0) return 0;

    const placeholders = compositeHashes.map(() => '?').join(',');
    const info = db.prepare(
      `DELETE FROM image_metadata WHERE composite_hash IN (${placeholders})`
    ).run(...compositeHashes);

    return info.changes;
  }

  /**
   * 검색 (프롬프트, 모델명 기반)
   */
  static search(query: string, options?: {
    limit?: number;
    offset?: number;
  }): ImageMetadataRecord[] {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    return db.prepare(`
      SELECT * FROM image_metadata
      WHERE prompt LIKE ? OR negative_prompt LIKE ? OR model_name LIKE ?
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit, offset) as ImageMetadataRecord[];
  }

  /**
   * AI 도구별 필터
   */
  static findByAITool(aiTool: string, options?: {
    page?: number;
    limit?: number;
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM image_metadata WHERE ai_tool = ?'
    ).get(aiTool) as { total: number };

    const items = db.prepare(`
      SELECT * FROM image_metadata
      WHERE ai_tool = ?
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(aiTool, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 모델명별 필터
   */
  static findByModel(modelName: string, options?: {
    page?: number;
    limit?: number;
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM image_metadata WHERE model_name = ?'
    ).get(modelName) as { total: number };

    const items = db.prepare(`
      SELECT * FROM image_metadata
      WHERE model_name = ?
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(modelName, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 날짜 범위 필터 (메서드 오버로드: page/limit 숫자 직접 전달)
   */
  static findByDateRange(
    startDate: string,
    endDate: string,
    page?: number,
    limit?: number
  ): { items: ImageMetadataRecord[], total: number } {
    const _page = page || 1;
    const _limit = limit || 20;
    const offset = (_page - 1) * _limit;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM image_metadata WHERE first_seen_date BETWEEN ? AND ?'
    ).get(startDate, endDate) as { total: number };

    const items = db.prepare(`
      SELECT * FROM image_metadata
      WHERE first_seen_date BETWEEN ? AND ?
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(startDate, endDate, _limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 평점별 필터
   */
  static findByRating(
    minRating: number,
    maxRating: number = 5,
    options?: {
      page?: number;
      limit?: number;
    }
  ): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM image_metadata WHERE rating_score BETWEEN ? AND ?'
    ).get(minRating, maxRating) as { total: number };

    const items = db.prepare(`
      SELECT * FROM image_metadata
      WHERE rating_score BETWEEN ? AND ?
      ORDER BY rating_score DESC, first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(minRating, maxRating, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 통계: AI 도구별 개수
   */
  static getAIToolStats(): Array<{ ai_tool: string; count: number }> {
    return db.prepare(`
      SELECT ai_tool, COUNT(*) as count
      FROM image_metadata
      WHERE ai_tool IS NOT NULL
      GROUP BY ai_tool
      ORDER BY count DESC
    `).all() as Array<{ ai_tool: string; count: number }>;
  }

  /**
   * 통계: 모델별 개수
   */
  static getModelStats(): Array<{ model_name: string; count: number }> {
    return db.prepare(`
      SELECT model_name, COUNT(*) as count
      FROM image_metadata
      WHERE model_name IS NOT NULL
      GROUP BY model_name
      ORDER BY count DESC
      LIMIT 50
    `).all() as Array<{ model_name: string; count: number }>;
  }

  /**
   * 총 개수
   */
  static count(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM image_metadata').get() as { count: number };
    return row.count;
  }

  /**
   * composite_hash 존재 여부 확인
   */
  static exists(compositeHash: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM image_metadata WHERE composite_hash = ? LIMIT 1'
    ).get(compositeHash);
    return !!row;
  }

  /**
   * 파일 경로 포함 전체 조회 (image_files JOIN)
   * Phase 1 지원: composite_hash가 NULL인 이미지도 조회
   */
  static findAllWithFiles(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'width' | 'height' | 'scan_date';
    sortOrder?: 'ASC' | 'DESC';
  }): { items: any[], total: number } {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const sortBy = options.sortBy || 'first_seen_date';
    const sortOrder = options.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    // 카운트: image_files (composite_hash 있는 것) + image_metadata (composite_hash 없는 것)
    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT composite_hash FROM image_metadata
        UNION ALL
        SELECT id as composite_hash FROM image_files WHERE composite_hash IS NULL AND file_status = 'active'
      )
    `).get() as { total: number };

    // Phase 1 + Phase 2 이미지 모두 조회
    // 1. composite_hash가 있는 이미지 (정상 처리 완료)
    // 2. composite_hash가 NULL인 이미지 (Phase 1만 완료)
    // 인덱스 활용을 위해 COALESCE 제거 - sortBy에 따라 조건부 쿼리 실행
    let query: string;
    if (sortBy === 'scan_date') {
      // scan_date로 정렬 시 idx_files_scan_date_desc 인덱스 활용
      query = `
        SELECT
          im.composite_hash,
          im.perceptual_hash,
          im.dhash,
          im.ahash,
          im.color_histogram,
          im.width,
          im.height,
          im.thumbnail_path,
          im.optimized_path,
          im.ai_tool,
          im.model_name,
          im.lora_models,
          im.steps,
          im.cfg_scale,
          im.sampler,
          im.seed,
          im.scheduler,
          im.prompt,
          im.negative_prompt,
          im.denoise_strength,
          im.generation_time,
          im.batch_size,
          im.batch_index,
          im.auto_tags,
          im.first_seen_date,
          im.metadata_updated_date,
          if.id as file_id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date
        FROM image_files if
        LEFT JOIN image_metadata im ON if.composite_hash = im.composite_hash
        WHERE if.file_status = 'active'
        ORDER BY if.scan_date ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    } else if (sortBy === 'first_seen_date') {
      // first_seen_date로 정렬 시 idx_metadata_first_seen_desc 인덱스 활용
      // NULL 값 처리: metadata가 없는 경우 scan_date 폴백
      query = `
        SELECT
          im.composite_hash,
          im.perceptual_hash,
          im.dhash,
          im.ahash,
          im.color_histogram,
          im.width,
          im.height,
          im.thumbnail_path,
          im.optimized_path,
          im.ai_tool,
          im.model_name,
          im.lora_models,
          im.steps,
          im.cfg_scale,
          im.sampler,
          im.seed,
          im.scheduler,
          im.prompt,
          im.negative_prompt,
          im.denoise_strength,
          im.generation_time,
          im.batch_size,
          im.batch_index,
          im.auto_tags,
          im.first_seen_date,
          im.metadata_updated_date,
          if.id as file_id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date,
          CASE WHEN im.first_seen_date IS NULL THEN if.scan_date ELSE im.first_seen_date END as sort_date
        FROM image_files if
        LEFT JOIN image_metadata im ON if.composite_hash = im.composite_hash
        WHERE if.file_status = 'active'
        ORDER BY sort_date ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    } else {
      // 기타 metadata 필드로 정렬 - 폴백 로직 유지
      query = `
        SELECT
          im.composite_hash,
          im.perceptual_hash,
          im.dhash,
          im.ahash,
          im.color_histogram,
          im.width,
          im.height,
          im.thumbnail_path,
          im.optimized_path,
          im.ai_tool,
          im.model_name,
          im.lora_models,
          im.steps,
          im.cfg_scale,
          im.sampler,
          im.seed,
          im.scheduler,
          im.prompt,
          im.negative_prompt,
          im.denoise_strength,
          im.generation_time,
          im.batch_size,
          im.batch_index,
          im.auto_tags,
          im.first_seen_date,
          im.metadata_updated_date,
          if.id as file_id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date
        FROM image_files if
        LEFT JOIN image_metadata im ON if.composite_hash = im.composite_hash
        WHERE if.file_status = 'active'
        ORDER BY COALESCE(im.${sortBy}, if.scan_date) ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    }

    const items = db.prepare(query).all(limit, offset);

    return { items, total: countRow.total };
  }

  /**
   * 랜덤 이미지 조회 (파일 경로 포함)
   */
  static getRandomImage(): any | null {
    const row = db.prepare(`
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM image_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ORDER BY RANDOM()
      LIMIT 1
    `).get();

    return row || null;
  }
}
