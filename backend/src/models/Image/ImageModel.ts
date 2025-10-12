import { db } from '../../database/init';
import { ImageRecord, ImageMetadata } from '../../types/image';

/**
 * 기본 CRUD 작업을 담당하는 이미지 모델
 */
export class ImageModel {
  /**
   * 이미지 생성
   */
  static create(imageData: Omit<ImageRecord, 'id' | 'upload_date'>): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO images (
          filename, original_name, file_path, thumbnail_path, optimized_path,
          file_size, mime_type, width, height, metadata,
          ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
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
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });

      stmt.finalize();
    });
  }

  /**
   * ID로 이미지 조회
   */
  static findById(id: number): Promise<ImageRecord | null> {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM images WHERE id = ?',
        [id],
        (err, row: ImageRecord) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * 전체 이미지 목록 조회
   */
  static findAll(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: ImageRecord[], total: number }> {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * limit;

      // 총 개수 조회
      db.get('SELECT COUNT(*) as total FROM images', (err, countRow: any) => {
        if (err) {
          reject(err);
          return;
        }

        const total = countRow.total;

        // 페이지네이션된 데이터 조회
        db.all(
          `SELECT * FROM images ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
          [limit, offset],
          (err, rows: ImageRecord[]) => {
            if (err) {
              reject(err);
            } else {
              resolve({ images: rows || [], total });
            }
          }
        );
      });
    });
  }

  /**
   * 날짜 범위로 이미지 조회
   */
  static findByDateRange(
    startDate: string,
    endDate: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ images: ImageRecord[], total: number }> {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * limit;

      db.get(
        'SELECT COUNT(*) as total FROM images WHERE upload_date BETWEEN ? AND ?',
        [startDate, endDate],
        (err, countRow: any) => {
          if (err) {
            reject(err);
            return;
          }

          const total = countRow.total;

          db.all(
            `SELECT * FROM images
             WHERE upload_date BETWEEN ? AND ?
             ORDER BY upload_date DESC
             LIMIT ? OFFSET ?`,
            [startDate, endDate, limit, offset],
            (err, rows: ImageRecord[]) => {
              if (err) {
                reject(err);
              } else {
                resolve({ images: rows || [], total });
              }
            }
          );
        }
      );
    });
  }

  /**
   * 이미지 삭제
   */
  static delete(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // 먼저 관련된 그룹 연결 삭제
      db.run('DELETE FROM image_groups WHERE image_id = ?', [id], (err) => {
        if (err) {
          console.warn('Warning: Failed to remove image from groups:', err);
          // 그룹 삭제 실패해도 이미지 삭제는 계속 진행
        }

        // 이미지 삭제
        db.run('DELETE FROM images WHERE id = ?', [id], function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        });
      });
    });
  }

  /**
   * 메타데이터 업데이트
   */
  static updateMetadata(id: number, metadata: ImageMetadata): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE images SET metadata = ? WHERE id = ?',
        [JSON.stringify(metadata), id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 자동 태그 업데이트
   */
  static updateAutoTags(id: number, autoTags: string | null): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE images SET auto_tags = ? WHERE id = ?',
        [autoTags, id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }
}
