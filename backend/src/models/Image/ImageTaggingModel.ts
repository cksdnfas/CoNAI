import { db } from '../../database/init';
import { ImageRecord } from '../../types/image';

/**
 * 태깅 관련 작업을 담당하는 이미지 모델
 */
export class ImageTaggingModel {
  /**
   * 미태깅 이미지 조회 (auto_tags가 NULL인 이미지)
   */
  static async findUntagged(limit: number = 100): Promise<ImageRecord[]> {
    const rows = db.prepare(
      `SELECT * FROM images WHERE auto_tags IS NULL ORDER BY upload_date DESC LIMIT ?`
    ).all(limit) as ImageRecord[];
    return rows || [];
  }

  /**
   * 전체 이미지 ID 조회 (일괄 처리용)
   */
  static async findAllIds(limit?: number): Promise<number[]> {
    const query = limit
      ? `SELECT id FROM images ORDER BY upload_date DESC LIMIT ?`
      : `SELECT id FROM images ORDER BY upload_date DESC`;

    const rows = limit
      ? db.prepare(query).all(limit) as any[]
      : db.prepare(query).all() as any[];

    return rows.map(row => row.id);
  }

  /**
   * 미태깅 이미지 개수 조회
   */
  static async countUntagged(): Promise<number> {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM images WHERE auto_tags IS NULL`
    ).get() as any;
    return row.count;
  }
}
