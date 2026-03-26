import { db } from '../../database/init';
import { ImageFileRecord } from '../../types/image';

/**
 * 이미지 파일 위치 모델
 * 다운로드, 삭제, 폴더 스캔 전용
 *
 * 사용 케이스:
 * - 원본 이미지 다운로드
 * - 파일 삭제
 * - 폴더 스캔 관리
 */
export class ImageFileModel {
  /**
   * composite_hash로 활성 파일 조회
   */
  static findActiveByHash(compositeHash: string): ImageFileRecord[] {
    return db.prepare(`
      SELECT * FROM image_files
      WHERE composite_hash = ? AND file_status = 'active'
      ORDER BY last_verified_date DESC
    `).all(compositeHash) as ImageFileRecord[];
  }

  /**
   * composite_hash로 모든 파일 조회 (상태 무관)
   */
  static findAllByHash(compositeHash: string): ImageFileRecord[] {
    return db.prepare(`
      SELECT * FROM image_files
      WHERE composite_hash = ?
      ORDER BY file_status, last_verified_date DESC
    `).all(compositeHash) as ImageFileRecord[];
  }

  /**
   * 파일 ID로 조회
   */
  static findById(id: number): ImageFileRecord | null {
    return db.prepare(
      'SELECT * FROM image_files WHERE id = ?'
    ).get(id) as ImageFileRecord | null;
  }

  /**
   * 파일 경로로 조회
   */
  static findByPath(path: string): ImageFileRecord | null {
    return db.prepare(
      'SELECT * FROM image_files WHERE original_file_path = ?'
    ).get(path) as ImageFileRecord | null;
  }

  /**
   * 폴더 ID로 조회
   */
  static findByFolder(folderId: number, options?: {
    status?: 'active' | 'missing' | 'deleted';
    limit?: number;
    offset?: number;
  }): ImageFileRecord[] {
    let query = 'SELECT * FROM image_files WHERE folder_id = ?';
    const params: any[] = [folderId];

    if (options?.status) {
      query += ' AND file_status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY scan_date DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      if (options?.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    return db.prepare(query).all(...params) as ImageFileRecord[];
  }

  /**
   * 파일 레코드 생성
   */
  static create(data: Omit<ImageFileRecord, 'id' | 'scan_date' | 'last_verified_date'>): number {
    const info = db.prepare(`
      INSERT INTO image_files (
        composite_hash, file_type, original_file_path, folder_id,
        file_status, file_size, mime_type, file_modified_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.composite_hash,
      data.file_type,
      data.original_file_path,
      data.folder_id,
      data.file_status,
      data.file_size,
      data.mime_type,
      data.file_modified_date
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 파일 상태 업데이트
   */
  static updateStatus(id: number, status: 'active' | 'missing' | 'deleted'): boolean {
    const info = db.prepare(`
      UPDATE image_files
      SET file_status = ?, last_verified_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);

    return info.changes > 0;
  }

  /**
   * 파일 경로로 상태 업데이트
   */
  static updateStatusByPath(path: string, status: 'active' | 'missing' | 'deleted'): boolean {
    const info = db.prepare(`
      UPDATE image_files
      SET file_status = ?, last_verified_date = CURRENT_TIMESTAMP
      WHERE original_file_path = ?
    `).run(status, path);

    return info.changes > 0;
  }

  /**
   * 파일 크기/수정시각 동기화
   */
  static updateFileStats(id: number, updates: { fileSize: number; fileModifiedDate: string | null; mimeType?: string | null }): boolean {
    const info = db.prepare(`
      UPDATE image_files
      SET file_size = ?, file_modified_date = ?, mime_type = COALESCE(?, mime_type), last_verified_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(updates.fileSize, updates.fileModifiedDate, updates.mimeType ?? null, id);

    return info.changes > 0;
  }

  /**
   * 파일 검증 시간 업데이트
   */
  static updateVerified(id: number): boolean {
    const info = db.prepare(`
      UPDATE image_files
      SET last_verified_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return info.changes > 0;
  }

  /**
   * 파일 레코드 삭제
   */
  static delete(id: number): boolean {
    const info = db.prepare('DELETE FROM image_files WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 파일 경로로 삭제
   */
  static deleteByPath(path: string): boolean {
    const info = db.prepare('DELETE FROM image_files WHERE original_file_path = ?').run(path);
    return info.changes > 0;
  }

  /**
   * composite_hash의 모든 파일 삭제
   */
  static deleteAllByHash(compositeHash: string): number {
    const info = db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(compositeHash);
    return info.changes;
  }

  /**
   * 폴더의 missing 상태 파일들을 삭제
   */
  static cleanupMissingFiles(folderId: number): number {
    const info = db.prepare(`
      DELETE FROM image_files
      WHERE folder_id = ? AND file_status = 'missing'
    `).run(folderId);

    return info.changes;
  }

  /**
   * 오래된 missing 상태 파일들 정리 (N일 이상)
   */
  static cleanupOldMissingFiles(days: number): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffISO = cutoffDate.toISOString();

    const info = db.prepare(`
      DELETE FROM image_files
      WHERE file_status = 'missing'
        AND last_verified_date < ?
    `).run(cutoffISO);

    return info.changes;
  }

  /**
   * 통계: 폴더별 파일 개수
   */
  static getCountByFolder(folderId: number): {
    total: number;
    active: number;
    missing: number;
    deleted: number;
  } {
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN file_status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN file_status = 'missing' THEN 1 ELSE 0 END) as missing,
        SUM(CASE WHEN file_status = 'deleted' THEN 1 ELSE 0 END) as deleted
      FROM image_files
      WHERE folder_id = ?
    `).get(folderId) as any;

    return {
      total: result.total || 0,
      active: result.active || 0,
      missing: result.missing || 0,
      deleted: result.deleted || 0
    };
  }

  /**
   * 총 활성 파일 개수
   */
  static countActive(): number {
    const row = db.prepare(
      "SELECT COUNT(*) as count FROM image_files WHERE file_status = 'active'"
    ).get() as { count: number };
    return row.count;
  }

  /**
   * 파일 경로 존재 여부 확인
   */
  static exists(path: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM image_files WHERE original_file_path = ? LIMIT 1'
    ).get(path);
    return !!row;
  }

  /**
   * composite_hash에 대한 활성 파일 존재 여부
   */
  static hasActiveFiles(compositeHash: string): boolean {
    const row = db.prepare(
      "SELECT 1 FROM image_files WHERE composite_hash = ? AND file_status = 'active' LIMIT 1"
    ).get(compositeHash);
    return !!row;
  }

  /**
   * 폴더의 모든 파일을 missing으로 표시 (스캔 전 준비)
   */
  static markAllAsMissing(folderId: number): number {
    const info = db.prepare(`
      UPDATE image_files
      SET file_status = 'missing'
      WHERE folder_id = ? AND file_status = 'active'
    `).run(folderId);

    return info.changes;
  }

  /**
   * 파일 경로 업데이트 (폴더 이동 시)
   */
  static updatePath(id: number, newPath: string): boolean {
    const info = db.prepare(`
      UPDATE image_files
      SET original_file_path = ?, last_verified_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newPath, id);

    return info.changes > 0;
  }
}
