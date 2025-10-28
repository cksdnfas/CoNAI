import Database from 'better-sqlite3';
import fs from 'fs';
import { MigrationManager } from './migrationManager';
import { runtimePaths } from '../config/runtimePaths';
import { checkLegacyDatabase, showUpgradeNotice } from '../utils/versionCheck';

const DB_PATH = runtimePaths.databaseFile;

// 데이터베이스 디렉토리 생성
const dbDir = runtimePaths.databaseDir;
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(DB_PATH);
export const migrationManager = new MigrationManager(db);

export const initializeDatabase = async (): Promise<void> => {
  try {
    // 데이터베이스 파일이 새로 생성되는지 확인
    const isNewDatabase = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0;

    if (!isNewDatabase) {
      // 기존 데이터베이스 - 레거시 버전 체크
      console.log('🔍 기존 데이터베이스 검사 중...');
      const legacyCheck = checkLegacyDatabase(db);

      if (legacyCheck.isLegacy) {
        showUpgradeNotice(legacyCheck);
        process.exit(1);
      }

      console.log('✅ 기존 데이터베이스에 연결되었습니다.');
    } else {
      console.log('✅ 새로운 데이터베이스가 생성되었습니다.');
    }

    // 마이그레이션 실행 (신규 시스템 테이블 생성)
    console.log('🔄 마이그레이션 실행 중...');
    await migrationManager.migrate();

    console.log('🎉 데이터베이스 초기화가 완료되었습니다!');
  } catch (error) {
    console.error('❌ 데이터베이스 초기화 중 오류 발생:', error);
    throw error;
  }
};

// 데이터베이스 연결 종료
export const closeDatabase = (): void => {
  db.close();
};
