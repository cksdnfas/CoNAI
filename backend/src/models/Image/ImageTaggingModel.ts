import { db } from '../../database/init';

/**
 * 태깅 관련 작업을 담당하는 이미지 모델 (새 구조 기반)
 *
 * ✅ 새 구조 전환 완료: media_metadata 기반
 *
 * 변경사항:
 * - images 테이블 → media_metadata 테이블
 * - image_id → composite_hash
 * - upload_date → first_seen_date
 * - 모든 기존 기능 유지
 */
export class ImageTaggingModel {
  /**
   * 미태깅 이미지 조회 (auto_tags가 NULL인 이미지)
   * @returns 파일 정보 포함한 이미지 메타데이터
   */
  static async findUntagged(limit: number = 100): Promise<any[]> {
    const rows = db.prepare(`
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      WHERE im.auto_tags IS NULL
      ORDER BY im.first_seen_date DESC
      LIMIT ?
    `).all(limit) as any[];

    // 레거시 호환: composite_hash를 id로, first_seen_date를 upload_date로 매핑
    return rows.map(row => ({
      ...row,
      id: row.composite_hash,
      upload_date: row.first_seen_date
    }));
  }

  /**
   * 미태깅 이미지 개수 조회
   */
  static async countUntagged(): Promise<number> {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM media_metadata WHERE auto_tags IS NULL`
    ).get() as any;
    return row.count;
  }
}
