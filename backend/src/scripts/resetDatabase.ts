import { db } from '../database/init';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 데이터베이스 완전 초기화 스크립트
 *
 * 작업 내용:
 * 1. 모든 테이블 데이터 삭제 (DROP 없음, 구조 유지)
 * 2. watched_folders에 기본 폴더 등록
 * 3. 새 구조만 유지
 */

interface ResetResult {
  deletedRecords: {
    [tableName: string]: number;
  };
  errors: string[];
}

export class DatabaseReset {
  /**
   * 데이터베이스 완전 초기화
   */
  static async reset(): Promise<ResetResult> {
    const result: ResetResult = {
      deletedRecords: {},
      errors: []
    };

    console.log('🗄️  데이터베이스 초기화 시작...\n');

    try {
      // 1. 모든 테이블 데이터 삭제 (순서 중요: 외래키 제약조건)
      await this.deleteAllData(result);

      // 2. 기본 폴더 등록
      await this.registerDefaultFolders();

      console.log('\n✅ 데이터베이스 초기화 완료');
      console.log('  삭제된 레코드:');
      Object.entries(result.deletedRecords).forEach(([table, count]) => {
        console.log(`    - ${table}: ${count}개`);
      });

      if (result.errors.length > 0) {
        console.log('\n⚠️  오류:');
        result.errors.forEach(err => console.log(`    - ${err}`));
      }

      return result;
    } catch (error) {
      console.error('❌ 데이터베이스 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * 모든 테이블 데이터 삭제
   */
  private static async deleteAllData(result: ResetResult): Promise<void> {
    // 순서: 자식 테이블 → 부모 테이블

    const tables = [
      // 자식 테이블
      'image_groups',
      'group_folders',
      'image_files',

      // 부모 테이블
      'image_metadata',
      'groups',
      'watched_folders',

      // 기타 테이블
      'prompt_collections',
      'prompt_groups',
      'prompt_synonyms',

      // 레거시 테이블 (있다면 삭제)
      'images'
    ];

    console.log('📋 테이블 데이터 삭제 중...');

    for (const table of tables) {
      try {
        // 테이블 존재 여부 확인
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get(table);

        if (!tableExists) {
          console.log(`  ⚠️  테이블이 존재하지 않습니다: ${table}`);
          continue;
        }

        // 데이터 삭제
        const info = db.prepare(`DELETE FROM ${table}`).run();
        result.deletedRecords[table] = info.changes;
        console.log(`  ✅ ${table}: ${info.changes}개 삭제`);
      } catch (error) {
        const errorMsg = `${table} 삭제 실패: ${error instanceof Error ? error.message : 'Unknown'}`;
        result.errors.push(errorMsg);
        console.error(`  ❌ ${errorMsg}`);
      }
    }

    // VACUUM 실행 (데이터베이스 최적화)
    try {
      console.log('\n🔧 데이터베이스 최적화 중 (VACUUM)...');
      db.exec('VACUUM');
      console.log('  ✅ 데이터베이스 최적화 완료');
    } catch (error) {
      console.warn('  ⚠️  VACUUM 실패:', error);
    }
  }

  /**
   * 기본 폴더 등록
   */
  private static async registerDefaultFolders(): Promise<void> {
    console.log('\n📁 기본 폴더 등록 중...');

    const defaultFolders = [
      {
        folder_path: `${runtimePaths.uploadsDir}/images`,
        folder_name: '직접 업로드 (이미지)'
      },
      {
        folder_path: `${runtimePaths.uploadsDir}/videos`,
        folder_name: '직접 업로드 (비디오)'
      }
    ];

    for (const folder of defaultFolders) {
      try {
        const info = db.prepare(`
          INSERT OR IGNORE INTO watched_folders (
            folder_path, folder_name, is_active, recursive
          ) VALUES (?, ?, 1, 1)
        `).run(folder.folder_path, folder.folder_name);

        if (info.changes > 0) {
          console.log(`  ✅ ${folder.folder_name} 등록`);
        } else {
          console.log(`  ℹ️  ${folder.folder_name} 이미 존재`);
        }
      } catch (error) {
        console.error(`  ❌ ${folder.folder_name} 등록 실패:`, error);
      }
    }
  }

  /**
   * 테이블 존재 여부 확인
   */
  static checkTables(): void {
    console.log('🔍 테이블 구조 확인...\n');

    const requiredTables = [
      'image_metadata',
      'image_files',
      'watched_folders',
      'groups',
      'image_groups'
    ];

    for (const table of requiredTables) {
      const exists = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name=?
      `).get(table);

      if (exists) {
        // 레코드 수 확인
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        console.log(`  ✅ ${table}: ${count.count}개 레코드`);
      } else {
        console.log(`  ❌ ${table}: 테이블이 존재하지 않습니다`);
      }
    }
  }
}

/**
 * 직접 실행
 */
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'check') {
    DatabaseReset.checkTables();
    process.exit(0);
  }

  console.log('⚠️  경고: 모든 데이터가 삭제됩니다!');
  console.log('계속하려면 5초 내에 Ctrl+C로 취소하세요...\n');

  setTimeout(() => {
    DatabaseReset.reset()
      .then(() => {
        console.log('\n✅ 초기화 완료');
        DatabaseReset.checkTables();
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ 초기화 실패:', error);
        process.exit(1);
      });
  }, 5000);
}
