/**
 * 데이터베이스의 모든 경로를 정규화하는 스크립트
 * Windows 드라이브 문자를 대문자로 통일
 *
 * 사용법:
 * npm run ts-node backend/scripts/normalize-paths.ts
 */

import { db } from '../src/database/init';
import { normalizeWindowsDriveLetter } from '../src/utils/pathResolver';

interface PathRecord {
  id: number;
  original_file_path: string;
}

function normalizeImageFilesPaths(): void {
  console.log('🔄 image_files 테이블 경로 정규화 시작...');

  // 모든 레코드 조회
  const records = db.prepare('SELECT id, original_file_path FROM image_files')
    .all() as PathRecord[];

  console.log(`총 ${records.length}개의 레코드 발견`);

  let updatedCount = 0;
  let unchangedCount = 0;

  const updateStmt = db.prepare(
    'UPDATE image_files SET original_file_path = ? WHERE id = ?'
  );

  for (const record of records) {
    const normalizedPath = normalizeWindowsDriveLetter(record.original_file_path);

    if (normalizedPath !== record.original_file_path) {
      updateStmt.run(normalizedPath, record.id);
      updatedCount++;
      console.log(`  ✅ ID ${record.id}: ${record.original_file_path} → ${normalizedPath}`);
    } else {
      unchangedCount++;
    }
  }

  console.log(`\n✅ 정규화 완료:`);
  console.log(`  - 업데이트됨: ${updatedCount}개`);
  console.log(`  - 변경 없음: ${unchangedCount}개`);
}

function findAndRemoveDuplicates(): void {
  console.log('\n🔍 중복 레코드 검사 시작...');

  // 정규화된 경로 기준으로 중복 찾기
  const duplicates = db.prepare(`
    SELECT original_file_path, COUNT(*) as count
    FROM image_files
    GROUP BY UPPER(original_file_path)
    HAVING count > 1
  `).all() as Array<{ original_file_path: string; count: number }>;

  if (duplicates.length === 0) {
    console.log('✅ 중복 레코드 없음');
    return;
  }

  console.log(`⚠️ ${duplicates.length}개의 중복 경로 발견`);

  for (const dup of duplicates) {
    console.log(`\n  경로: ${dup.original_file_path} (${dup.count}개)`);

    // 해당 경로의 모든 레코드 조회 (대소문자 무시)
    const records = db.prepare(`
      SELECT id, original_file_path, file_modified_date, composite_hash
      FROM image_files
      WHERE UPPER(original_file_path) = UPPER(?)
      ORDER BY id ASC
    `).all(dup.original_file_path) as Array<{
      id: number;
      original_file_path: string;
      file_modified_date: string;
      composite_hash: string | null;
    }>;

    // 첫 번째 레코드는 유지, 나머지는 삭제
    const [keepRecord, ...deleteRecords] = records;

    console.log(`    유지: ID ${keepRecord.id} (${keepRecord.original_file_path})`);

    for (const deleteRecord of deleteRecords) {
      db.prepare('DELETE FROM image_files WHERE id = ?').run(deleteRecord.id);
      console.log(`    삭제: ID ${deleteRecord.id} (${deleteRecord.original_file_path})`);
    }
  }

  console.log(`\n✅ 중복 제거 완료`);
}

function main(): void {
  console.log('=== 데이터베이스 경로 정규화 스크립트 ===\n');

  try {
    // Step 1: 중복 제거 먼저 수행 (UNIQUE constraint 충돌 방지)
    findAndRemoveDuplicates();

    // Step 2: 경로 정규화
    normalizeImageFilesPaths();

    console.log('\n✅ 모든 작업 완료');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    process.exit(1);
  }
}

main();
