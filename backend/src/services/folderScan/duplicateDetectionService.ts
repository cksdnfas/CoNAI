import { db } from '../../database/init';
import { normalizeWindowsDriveLetter } from '../../utils/pathResolver';

/**
 * 중복 이미지 감지 서비스
 */
export class DuplicateDetectionService {
  /**
   * Bulk 쿼리로 기존 해시 검색
   */
  static checkExistingHashes(allHashes: string[]): Set<string> {
    if (allHashes.length === 0) return new Set();

    const SQLITE_MAX_PARAMS = 999;
    const existingHashSet = new Set<string>();

    for (let i = 0; i < allHashes.length; i += SQLITE_MAX_PARAMS) {
      const hashChunk = allHashes.slice(i, i + SQLITE_MAX_PARAMS);
      const placeholders = hashChunk.map(() => '?').join(',');

      const existingMetadata = db.prepare(`
        SELECT composite_hash FROM image_metadata
        WHERE composite_hash IN (${placeholders})
      `).all(...hashChunk) as Array<{ composite_hash: string }>;

      existingMetadata.forEach(m => existingHashSet.add(m.composite_hash));
    }

    console.log(`  기존 이미지 검색: ${allHashes.length}개 중 ${existingHashSet.size}개 발견`);

    return existingHashSet;
  }

  /**
   * 경로로 기존 파일 확인
   * Windows 경로의 드라이브 문자를 정규화하여 비교
   */
  static getExistingFileByPath(filePath: string): { id: number; composite_hash: string | null } | undefined {
    const normalizedPath = normalizeWindowsDriveLetter(filePath);
    return db.prepare(
      'SELECT id, composite_hash FROM image_files WHERE original_file_path = ?'
    ).get(normalizedPath) as { id: number; composite_hash: string | null } | undefined;
  }

  /**
   * 파일 상태 업데이트 (재발견)
   */
  static updateFileStatus(fileId: number, stats: any): void {
    db.prepare(`
      UPDATE image_files
      SET file_status = 'active',
          last_verified_date = ?,
          file_modified_date = ?,
          file_size = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      stats.mtime.toISOString(),
      stats.size,
      fileId
    );
  }
}