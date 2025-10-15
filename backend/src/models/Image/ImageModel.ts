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
        prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      imageData.batch_index
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
}
