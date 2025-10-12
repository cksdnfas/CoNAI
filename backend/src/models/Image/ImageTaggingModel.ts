import { db } from '../../database/init';
import { ImageRecord } from '../../types/image';

/**
 * 태깅 관련 작업을 담당하는 이미지 모델
 */
export class ImageTaggingModel {
  /**
   * 미태깅 이미지 조회 (auto_tags가 NULL인 이미지)
   */
  static findUntagged(limit: number = 100): Promise<ImageRecord[]> {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM images WHERE auto_tags IS NULL ORDER BY upload_date DESC LIMIT ?`,
        [limit],
        (err, rows: ImageRecord[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * 전체 이미지 ID 조회 (일괄 처리용)
   */
  static findAllIds(limit?: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const query = limit
        ? `SELECT id FROM images ORDER BY upload_date DESC LIMIT ?`
        : `SELECT id FROM images ORDER BY upload_date DESC`;

      const params = limit ? [limit] : [];

      db.all(query, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => row.id));
        }
      });
    });
  }

  /**
   * 미태깅 이미지 개수 조회
   */
  static countUntagged(): Promise<number> {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM images WHERE auto_tags IS NULL`,
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row.count);
          }
        }
      );
    });
  }
}
