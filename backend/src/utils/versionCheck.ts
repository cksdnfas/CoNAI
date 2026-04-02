import Database from 'better-sqlite3';

/**
 * 레거시 데이터베이스 체크 결과
 */
export interface LegacyCheckResult {
  isLegacy: boolean;
  hasImagesTable: boolean;
  hasImageMetadataTable: boolean;
  imageCount: number;
  promptCount: number;
  groupCount: number;
}

/**
 * 구버전 데이터베이스 검사
 */
export function checkLegacyDatabase(db: Database.Database): LegacyCheckResult {
  const result: LegacyCheckResult = {
    isLegacy: false,
    hasImagesTable: false,
    hasImageMetadataTable: false,
    imageCount: 0,
    promptCount: 0,
    groupCount: 0
  };

  try {
    // images 테이블 존재 여부 확인
    const imagesTable = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='images'
    `).get();
    result.hasImagesTable = !!imagesTable;

    // media_metadata 테이블 존재 여부 확인
    const metadataTable = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='media_metadata'
    `).get();
    result.hasImageMetadataTable = !!metadataTable;

    // 레거시 판정: images 테이블은 있지만 media_metadata는 없는 경우
    result.isLegacy = result.hasImagesTable && !result.hasImageMetadataTable;

    // 기존 데이터 카운트 (레거시인 경우에만)
    if (result.isLegacy) {
      // 이미지 수
      const imageCountResult = db.prepare('SELECT COUNT(*) as count FROM images').get() as { count: number };
      result.imageCount = imageCountResult.count;

      // 프롬프트 수
      try {
        const promptCountResult = db.prepare('SELECT COUNT(*) as count FROM prompt_collection').get() as { count: number };
        result.promptCount = promptCountResult.count;
      } catch {
        result.promptCount = 0;
      }

      // 그룹 수
      try {
        const groupCountResult = db.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
        result.groupCount = groupCountResult.count;
      } catch {
        result.groupCount = 0;
      }
    }
  } catch (error) {
    console.error('레거시 데이터베이스 체크 중 오류:', error);
  }

  return result;
}

/**
 * 업그레이드 안내 메시지 출력
 */
export function showUpgradeNotice(check: LegacyCheckResult): void {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                  🚨 버전 업그레이드 감지                           ║');
  console.log('╠════════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                    ║');
  console.log('║  기존 데이터베이스가 감지되었습니다.                                ║');
  console.log('║  새 버전은 완전히 새로운 데이터 구조를 사용합니다.                  ║');
  console.log('║                                                                    ║');
  console.log('║  ⚠️  자동 마이그레이션을 지원하지 않습니다.                         ║');
  console.log('║                                                                    ║');
  console.log('╠════════════════════════════════════════════════════════════════════╣');
  console.log('║  📋 업그레이드 절차                                                 ║');
  console.log('╠════════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                    ║');
  console.log('║  1. 💾 원본 이미지 백업                                             ║');
  console.log('║     uploads/ 폴더 전체를 안전한 곳에 복사하세요                     ║');
  console.log('║                                                                    ║');
  console.log('║  2. 🗑️  데이터베이스 파일 삭제                                      ║');
  console.log('║     - database/images.db                                          ║');
  console.log('║     - database/user.db                                            ║');
  console.log('║     - database/auth.db                                            ║');
  console.log('║                                                                    ║');
  console.log('║  3. ▶️  서버 재시작                                                 ║');
  console.log('║     새로운 데이터베이스가 자동으로 생성됩니다                        ║');
  console.log('║                                                                    ║');
  console.log('║  4. 📂 폴더 스캔                                                     ║');
  console.log('║     업로드한 이미지를 다시 스캔하여 등록하세요                       ║');
  console.log('║     (API: POST /api/folders/scan-all)                             ║');
  console.log('║                                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  console.log('현재 데이터:');
  console.log(`  - 이미지: ${check.imageCount.toLocaleString()}개`);
  console.log(`  - 프롬프트: ${check.promptCount.toLocaleString()}개`);
  console.log(`  - 그룹: ${check.groupCount.toLocaleString()}개`);
  console.log('\n');
  console.log('⚠️  백업 후 위 파일들을 삭제하고 다시 실행하세요.');
  console.log('\n');
}
