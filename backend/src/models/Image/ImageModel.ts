import { db } from '../../database/init';
import { ImageRecord, ImageMetadata } from '../../types/image';

/**
 * 기본 CRUD 작업을 담당하는 이미지 모델
 */
export class ImageModel {
  /**
   * 이미지 생성
   */
  static async create(imageData: Omit<ImageRecord, 'id' | 'upload_date'>): Promise<number> {
    const info = db.prepare(`
      INSERT INTO images (
        filename, original_name, file_path, thumbnail_path, optimized_path,
        file_size, mime_type, width, height, metadata,
        ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
        prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
        auto_tags, duration, fps, video_codec, audio_codec, bitrate,
        perceptual_hash, color_histogram
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      imageData.filename,
      imageData.original_name,
      imageData.file_path,
      imageData.thumbnail_path,
      imageData.optimized_path,
      imageData.file_size,
      imageData.mime_type,
      imageData.width,
      imageData.height,
      imageData.metadata,
      imageData.ai_tool,
      imageData.model_name,
      imageData.lora_models,
      imageData.steps,
      imageData.cfg_scale,
      imageData.sampler,
      imageData.seed,
      imageData.scheduler,
      imageData.prompt,
      imageData.negative_prompt,
      imageData.denoise_strength,
      imageData.generation_time,
      imageData.batch_size,
      imageData.batch_index,
      imageData.auto_tags,
      imageData.duration,
      imageData.fps,
      imageData.video_codec,
      imageData.audio_codec,
      imageData.bitrate,
      imageData.perceptual_hash,
      imageData.color_histogram
    );

    return info.lastInsertRowid as number;
  }

  /**
   * ID로 이미지 조회
   */
  static async findById(id: number): Promise<ImageRecord | null> {
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRecord | undefined;
    return row || null;
  }

  /**
   * 전체 이미지 목록 조회
   */
  static async findAll(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: ImageRecord[], total: number }> {
    const offset = (page - 1) * limit;

    // 총 개수 조회
    const countRow = db.prepare('SELECT COUNT(*) as total FROM images').get() as any;
    const total = countRow.total;

    // 페이지네이션된 데이터 조회
    const rows = db.prepare(
      `SELECT * FROM images ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(limit, offset) as ImageRecord[];

    return { images: rows || [], total };
  }

  /**
   * 날짜 범위로 이미지 조회
   */
  static async findByDateRange(
    startDate: string,
    endDate: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ images: ImageRecord[], total: number }> {
    const offset = (page - 1) * limit;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM images WHERE upload_date BETWEEN ? AND ?'
    ).get(startDate, endDate) as any;
    const total = countRow.total;

    const rows = db.prepare(`
      SELECT * FROM images
      WHERE upload_date BETWEEN ? AND ?
      ORDER BY upload_date DESC
      LIMIT ? OFFSET ?
    `).all(startDate, endDate, limit, offset) as ImageRecord[];

    return { images: rows || [], total };
  }

  /**
   * 이미지 삭제
   */
  static async delete(id: number): Promise<boolean> {
    // 먼저 관련된 그룹 연결 삭제
    try {
      db.prepare('DELETE FROM image_groups WHERE image_id = ?').run(id);
    } catch (err) {
      console.warn('Warning: Failed to remove image from groups:', err);
    }

    // 이미지 삭제
    const info = db.prepare('DELETE FROM images WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 메타데이터 업데이트
   */
  static async updateMetadata(id: number, metadata: ImageMetadata): Promise<boolean> {
    const info = db.prepare(
      'UPDATE images SET metadata = ? WHERE id = ?'
    ).run(JSON.stringify(metadata), id);
    return info.changes > 0;
  }

  /**
   * 자동 태그 업데이트
   */
  static async updateAutoTags(id: number, autoTags: string | null): Promise<boolean> {
    const info = db.prepare(
      'UPDATE images SET auto_tags = ? WHERE id = ?'
    ).run(autoTags, id);
    return info.changes > 0;
  }

  /**
   * 랜덤 이미지 조회 (전체 이미지에서)
   */
  static async getRandomImage(): Promise<ImageRecord | null> {
    const row = db.prepare(`
      SELECT * FROM images
      ORDER BY RANDOM()
      LIMIT 1
    `).get() as ImageRecord | undefined;
    return row || null;
  }

  /**
   * 검색 조건에 맞는 이미지 중 랜덤 조회
   */
  static async getRandomFromSearch(searchParams: any): Promise<ImageRecord | null> {
    const {
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width,
      max_width,
      min_height,
      max_height,
      min_file_size,
      max_file_size,
      start_date,
      end_date,
      group_id
    } = searchParams;

    const conditions: string[] = [];
    const params: any[] = [];

    // 프롬프트 검색 (긍정)
    if (search_text) {
      conditions.push('prompt LIKE ?');
      params.push(`%${search_text}%`);
    }

    // 네거티브 프롬프트 검색
    if (negative_text) {
      conditions.push('negative_prompt LIKE ?');
      params.push(`%${negative_text}%`);
    }

    // AI 도구
    if (ai_tool) {
      conditions.push('ai_tool = ?');
      params.push(ai_tool);
    }

    // 모델명
    if (model_name) {
      conditions.push('model_name = ?');
      params.push(model_name);
    }

    // 이미지 크기 필터
    if (min_width) {
      conditions.push('width >= ?');
      params.push(min_width);
    }
    if (max_width) {
      conditions.push('width <= ?');
      params.push(max_width);
    }
    if (min_height) {
      conditions.push('height >= ?');
      params.push(min_height);
    }
    if (max_height) {
      conditions.push('height <= ?');
      params.push(max_height);
    }

    // 파일 크기 필터
    if (min_file_size) {
      conditions.push('file_size >= ?');
      params.push(min_file_size);
    }
    if (max_file_size) {
      conditions.push('file_size <= ?');
      params.push(max_file_size);
    }

    // 날짜 범위 필터
    if (start_date && end_date) {
      conditions.push('upload_date BETWEEN ? AND ?');
      params.push(start_date, end_date);
    }

    // 그룹 ID 필터
    if (group_id !== undefined && group_id !== null) {
      conditions.push(`id IN (SELECT image_id FROM image_groups WHERE group_id = ?)`);
      params.push(group_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM images ${whereClause} ORDER BY RANDOM() LIMIT 1`;

    const row = db.prepare(query).get(...params) as ImageRecord | undefined;
    return row || null;
  }
}
