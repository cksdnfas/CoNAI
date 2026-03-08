import { db } from '../../database/init';
import { ImageMetadataRecord } from '../../types/image';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../../utils/dynamicUpdate';

/**
 * 미디어 메타데이터 모델
 * 원본 파일 접근이 필요 없는 모든 작업의 핵심
 *
 * 사용 케이스:
 * - 미디어 브라우징 (썸네일은 캐시에 있음)
 * - 검색/필터 (prompt, model, tags 기반)
 * - 통계/분석 (모델 사용량, 프롬프트 분석)
 * - 그룹 관리 (composite_hash 기반)
 */
export class MediaMetadataModel {
  /**
   * composite_hash로 메타데이터 조회
   */
  static findByHash(compositeHash: string): ImageMetadataRecord | null {
    const row = db.prepare(
      'SELECT * FROM media_metadata WHERE composite_hash = ?'
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
      `SELECT * FROM media_metadata WHERE composite_hash IN (${placeholders})`
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

    const countRow = db.prepare('SELECT COUNT(*) as total FROM media_metadata').get() as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
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
      INSERT INTO media_metadata (
        composite_hash, perceptual_hash, dhash, ahash, color_histogram,
        width, height, thumbnail_path,
        ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
        prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
        auto_tags, duration, fps, video_codec, audio_codec, bitrate, rating_score, model_references,
        character_prompt_text, raw_nai_parameters
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.composite_hash, data.perceptual_hash, data.dhash, data.ahash, data.color_histogram,
      data.width, data.height, data.thumbnail_path,
      data.ai_tool, data.model_name, data.lora_models, data.steps, data.cfg_scale,
      data.sampler, data.seed, data.scheduler, data.prompt, data.negative_prompt,
      data.denoise_strength, data.generation_time, data.batch_size, data.batch_index,
      data.auto_tags, data.duration, data.fps, data.video_codec, data.audio_codec,
      data.bitrate, data.rating_score, data.model_references,
      data.character_prompt_text, data.raw_nai_parameters
    );

    return data.composite_hash;
  }

  /**
   * 메타데이터 업데이트
   */
  static update(compositeHash: string, updates: Partial<ImageMetadataRecord>): boolean {
    // 업데이트 가능한 필드들만 필터링
    const updatableFields = [
      'prompt', 'negative_prompt', 'auto_tags', 'rating_score',
      'ai_tool', 'model_name', 'lora_models', 'steps', 'cfg_scale',
      'sampler', 'seed', 'scheduler', 'denoise_strength',
      'generation_time', 'batch_size', 'batch_index',
      'thumbnail_path', 'width', 'height', 'model_references',
      'character_prompt_text', 'raw_nai_parameters'
    ];

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => updatableFields.includes(key))
    );

    const filteredUpdates = filterDefined(cleanUpdates);

    if (Object.keys(filteredUpdates).length === 0) return false;

    // metadata_updated_date는 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...filteredUpdates,
      metadata_updated_date: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery('media_metadata', finalUpdates, { composite_hash: compositeHash });
    const info = db.prepare(sql).run(...values);

    return info.changes > 0;
  }

  /**
   * 메타데이터 삭제 (CASCADE로 image_files도 삭제됨)
   */
  static delete(compositeHash: string): boolean {
    const info = db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(compositeHash);
    return info.changes > 0;
  }

  /**
   * 여러 메타데이터 삭제
   */
  static deleteMany(compositeHashes: string[]): number {
    if (compositeHashes.length === 0) return 0;

    const placeholders = compositeHashes.map(() => '?').join(',');
    const info = db.prepare(
      `DELETE FROM media_metadata WHERE composite_hash IN (${placeholders})`
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
      SELECT * FROM media_metadata
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
      'SELECT COUNT(*) as total FROM media_metadata WHERE ai_tool = ?'
    ).get(aiTool) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
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
      'SELECT COUNT(*) as total FROM media_metadata WHERE model_name = ?'
    ).get(modelName) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
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
      'SELECT COUNT(*) as total FROM media_metadata WHERE first_seen_date BETWEEN ? AND ?'
    ).get(startDate, endDate) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
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
      'SELECT COUNT(*) as total FROM media_metadata WHERE rating_score BETWEEN ? AND ?'
    ).get(minRating, maxRating) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
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
      FROM media_metadata
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
      FROM media_metadata
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
    const row = db.prepare('SELECT COUNT(*) as count FROM media_metadata').get() as { count: number };
    return row.count;
  }

  /**
   * composite_hash 존재 여부 확인
   */
  static exists(compositeHash: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM media_metadata WHERE composite_hash = ? LIMIT 1'
    ).get(compositeHash);
    return !!row;
  }

  /**
   * 파일 경로 포함 전체 조회 (image_files JOIN)
   * composite_hash가 NULL인 이미지는 제외 (해시 생성 완료된 이미지만 표시)
   */
  static findAllWithFiles(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'width' | 'height' | 'scan_date' | 'file_size';
    sortOrder?: 'ASC' | 'DESC';
  }): { items: any[], total: number } {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const sortBy = options.sortBy || 'first_seen_date';
    const sortOrder = options.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    // 카운트: composite_hash가 있는 이미지만 (해시 생성 완료)
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files
      WHERE file_status = 'active' AND composite_hash IS NOT NULL
    `).get() as { total: number };

    // composite_hash가 있는 이미지만 조회 (해시 생성 완료)
    // 인덱스 활용을 위해 sortBy에 따라 조건부 쿼리 실행
    let query: string;
    if (sortBy === 'scan_date') {
      // scan_date로 정렬 시 idx_files_scan_date_desc 인덱스 활용
      query = `
        SELECT
          mm.composite_hash,
          mm.perceptual_hash,
          mm.dhash,
          mm.ahash,
          mm.color_histogram,
          mm.width,
          mm.height,
          mm.thumbnail_path,
          mm.ai_tool,
          mm.model_name,
          mm.lora_models,
          mm.steps,
          mm.cfg_scale,
          mm.sampler,
          mm.seed,
          mm.scheduler,
          mm.prompt,
          mm.negative_prompt,
          mm.denoise_strength,
          mm.generation_time,
          mm.batch_size,
          mm.batch_index,
          mm.auto_tags,
          mm.duration,
          mm.fps,
          mm.video_codec,
          mm.audio_codec,
          mm.bitrate,
          mm.rating_score,
          mm.character_prompt_text,
          mm.raw_nai_parameters,
          mm.first_seen_date,
          mm.metadata_updated_date,
          if.id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date,
          if.file_type
        FROM image_files if
        LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
        WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
        ORDER BY if.scan_date ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    } else if (sortBy === 'file_size') {
      // file_size로 정렬 (image_files 테이블의 컬럼)
      query = `
        SELECT
          mm.composite_hash,
          mm.perceptual_hash,
          mm.dhash,
          mm.ahash,
          mm.color_histogram,
          mm.width,
          mm.height,
          mm.thumbnail_path,
          mm.ai_tool,
          mm.model_name,
          mm.lora_models,
          mm.steps,
          mm.cfg_scale,
          mm.sampler,
          mm.seed,
          mm.scheduler,
          mm.prompt,
          mm.negative_prompt,
          mm.denoise_strength,
          mm.generation_time,
          mm.batch_size,
          mm.batch_index,
          mm.auto_tags,
          mm.duration,
          mm.fps,
          mm.video_codec,
          mm.audio_codec,
          mm.bitrate,
          mm.rating_score,
          mm.character_prompt_text,
          mm.raw_nai_parameters,
          mm.first_seen_date,
          mm.metadata_updated_date,
          if.id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date,
          if.file_type
        FROM image_files if
        LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
        WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
        ORDER BY if.file_size ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    } else if (sortBy === 'first_seen_date') {
      // first_seen_date로 정렬 시 idx_metadata_first_seen_desc 인덱스 활용
      query = `
        SELECT
          mm.composite_hash,
          mm.perceptual_hash,
          mm.dhash,
          mm.ahash,
          mm.color_histogram,
          mm.width,
          mm.height,
          mm.thumbnail_path,
          mm.ai_tool,
          mm.model_name,
          mm.lora_models,
          mm.steps,
          mm.cfg_scale,
          mm.sampler,
          mm.seed,
          mm.scheduler,
          mm.prompt,
          mm.negative_prompt,
          mm.denoise_strength,
          mm.generation_time,
          mm.batch_size,
          mm.batch_index,
          mm.auto_tags,
          mm.duration,
          mm.fps,
          mm.video_codec,
          mm.audio_codec,
          mm.bitrate,
          mm.rating_score,
          mm.character_prompt_text,
          mm.raw_nai_parameters,
          mm.first_seen_date,
          mm.metadata_updated_date,
          if.id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date,
          if.file_type
        FROM image_files if
        LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
        WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
        ORDER BY mm.first_seen_date ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    } else {
      // 기타 metadata 필드로 정렬
      query = `
        SELECT
          mm.composite_hash,
          mm.perceptual_hash,
          mm.dhash,
          mm.ahash,
          mm.color_histogram,
          mm.width,
          mm.height,
          mm.thumbnail_path,
          mm.ai_tool,
          mm.model_name,
          mm.lora_models,
          mm.steps,
          mm.cfg_scale,
          mm.sampler,
          mm.seed,
          mm.scheduler,
          mm.prompt,
          mm.negative_prompt,
          mm.denoise_strength,
          mm.generation_time,
          mm.batch_size,
          mm.batch_index,
          mm.auto_tags,
          mm.duration,
          mm.fps,
          mm.video_codec,
          mm.audio_codec,
          mm.bitrate,
          mm.rating_score,
          mm.character_prompt_text,
          mm.raw_nai_parameters,
          mm.first_seen_date,
          mm.metadata_updated_date,
          if.id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status,
          if.scan_date,
          if.file_type
        FROM image_files if
        LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
        WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
        ORDER BY mm.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `;
    }

    const items = db.prepare(query).all(limit, offset);

    return { items, total: countRow.total };
  }

  /**
   * 커서 기반 페이지네이션으로 파일 경로 포함 조회 (무한 스크롤용)
   * 오프셋 기반과 달리 새 이미지가 추가되어도 목록이 뒤섞이지 않음
   *
   * cursorDate/cursorHash가 없으면 첫 페이지 반환
   */
  static findAllWithFilesCursor(options: {
    limit?: number;
    sortOrder?: 'ASC' | 'DESC';
    cursorDate?: string;
    cursorHash?: string;
  }): { items: any[], total: number, hasMore: boolean } {
    const limit = options.limit || 50;
    const sortOrder = options.sortOrder || 'DESC';
    const cursorDate = options.cursorDate;
    const cursorHash = options.cursorHash;

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files
      WHERE file_status = 'active' AND composite_hash IS NOT NULL
    `).get() as { total: number };

    let cursorCondition = '';
    const queryParams: any[] = [];

    if (cursorDate && cursorHash) {
      if (sortOrder === 'DESC') {
        cursorCondition = `AND (mm.first_seen_date < ? OR (mm.first_seen_date = ? AND mm.composite_hash < ?))`;
      } else {
        cursorCondition = `AND (mm.first_seen_date > ? OR (mm.first_seen_date = ? AND mm.composite_hash > ?))`;
      }
      queryParams.push(cursorDate, cursorDate, cursorHash);
    }

    const query = `
      SELECT
        mm.composite_hash,
        mm.perceptual_hash,
        mm.dhash,
        mm.ahash,
        mm.color_histogram,
        mm.width,
        mm.height,
        mm.thumbnail_path,
        mm.ai_tool,
        mm.model_name,
        mm.lora_models,
        mm.steps,
        mm.cfg_scale,
        mm.sampler,
        mm.seed,
        mm.scheduler,
        mm.prompt,
        mm.negative_prompt,
        mm.denoise_strength,
        mm.generation_time,
        mm.batch_size,
        mm.batch_index,
        mm.auto_tags,
        mm.duration,
        mm.fps,
        mm.video_codec,
        mm.audio_codec,
        mm.bitrate,
        mm.rating_score,
        mm.character_prompt_text,
        mm.raw_nai_parameters,
        mm.first_seen_date,
        mm.metadata_updated_date,
        if.id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status,
        if.scan_date,
        if.file_type
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
      ${cursorCondition}
      ORDER BY mm.first_seen_date ${sortOrder}, mm.composite_hash ${sortOrder}
      LIMIT ?
    `;

    queryParams.push(limit + 1);

    const items = db.prepare(query).all(...queryParams);
    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    return { items, total: countRow.total, hasMore };
  }

  /**
   * 지정된 composite_hash 목록에 해당하는 파일 포함 상세 정보 조회
   */
  static findByHashesWithFiles(compositeHashes: string[]): any[] {
    if (compositeHashes.length === 0) return [];

    const placeholders = compositeHashes.map(() => '?').join(',');
    const query = `
      SELECT
        mm.composite_hash,
        mm.perceptual_hash,
        mm.dhash,
        mm.ahash,
        mm.color_histogram,
        mm.width,
        mm.height,
        mm.thumbnail_path,
        mm.ai_tool,
        mm.model_name,
        mm.lora_models,
        mm.steps,
        mm.cfg_scale,
        mm.sampler,
        mm.seed,
        mm.scheduler,
        mm.prompt,
        mm.negative_prompt,
        mm.denoise_strength,
        mm.generation_time,
        mm.batch_size,
        mm.batch_index,
        mm.auto_tags,
        mm.duration,
        mm.fps,
        mm.video_codec,
        mm.audio_codec,
        mm.bitrate,
        mm.rating_score,
        mm.first_seen_date,
        mm.metadata_updated_date,
        if.id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status,
        if.scan_date,
        if.file_type
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active'
        AND if.composite_hash IN (${placeholders})
    `;

    const items = db.prepare(query).all(...compositeHashes);
    return items;
  }

  /**
   * 랜덤 이미지 조회 (파일 경로 포함)
   * composite_hash가 있는 이미지만 조회
   *
   * Note: Using OFFSET with random index instead of ORDER BY RANDOM()
   * to ensure true randomness on each call
   */
  static getRandomImage(): any | null {
    // First, get the total count of active images
    const countStmt = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files if
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
    `);
    const countRow = countStmt.get() as { total: number };

    if (!countRow || countRow.total === 0) {
      return null;
    }

    // Generate a random offset
    const randomOffset = Math.floor(Math.random() * countRow.total);
    console.log('[MediaMetadataModel] Random offset:', randomOffset, 'out of', countRow.total);

    // Get the image at that offset
    const stmt = db.prepare(`
      SELECT
        mm.composite_hash,
        mm.perceptual_hash,
        mm.dhash,
        mm.ahash,
        mm.color_histogram,
        mm.width,
        mm.height,
        mm.thumbnail_path,
        mm.ai_tool,
        mm.model_name,
        mm.lora_models,
        mm.steps,
        mm.cfg_scale,
        mm.sampler,
        mm.seed,
        mm.scheduler,
        mm.prompt,
        mm.negative_prompt,
        mm.denoise_strength,
        mm.generation_time,
        mm.batch_size,
        mm.batch_index,
        mm.auto_tags,
        mm.duration,
        mm.fps,
        mm.video_codec,
        mm.audio_codec,
        mm.bitrate,
        mm.character_prompt_text,
        mm.raw_nai_parameters,
        mm.first_seen_date,
        mm.metadata_updated_date,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status,
        if.scan_date,
        if.file_type
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
      LIMIT 1 OFFSET ?
    `);

    const row = stmt.get(randomOffset);

    // Log to verify randomness
    console.log('[MediaMetadataModel] Random image selected:', (row as any)?.composite_hash?.substring(0, 8));

    return row || null;
  }
}
