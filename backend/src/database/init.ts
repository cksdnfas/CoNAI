import Database from 'better-sqlite3';
import fs from 'fs';
import { MigrationManager } from './migrationManager';
import { runtimePaths } from '../config/runtimePaths';

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
    const isNewDatabase = !fs.existsSync(DB_PATH);

    if (isNewDatabase) {
      console.log('✅ 새로운 데이터베이스가 생성되었습니다.');
    } else {
      console.log('✅ 기존 데이터베이스에 연결되었습니다.');
    }

    // 기본 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        thumbnail_path VARCHAR(500) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        width INTEGER,
        height INTEGER,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        UNIQUE(file_path)
      )
    `);
    console.log('✅ Images 테이블이 준비되었습니다.');

    // 프롬프트 수집 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        usage_count INTEGER DEFAULT 1,
        group_id INTEGER,
        synonyms TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(prompt)
      )
    `);
    console.log('✅ Prompt Collection 테이블이 준비되었습니다.');

    // 네거티브 프롬프트 수집 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS negative_prompt_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        usage_count INTEGER DEFAULT 1,
        group_id INTEGER,
        synonyms TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(prompt)
      )
    `);
    console.log('✅ Negative Prompt Collection 테이블이 준비되었습니다.');

    // 프롬프트 그룹 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_visible BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_name)
      )
    `);
    console.log('✅ Prompt Groups 테이블이 준비되었습니다.');

    // 네거티브 프롬프트 그룹 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS negative_prompt_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_visible BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_name)
      )
    `);
    console.log('✅ Negative Prompt Groups 테이블이 준비되었습니다.');

    // 기본 인덱스 생성
    const indexes = [
      { name: 'idx_upload_date', table: 'images', column: 'upload_date' },
      { name: 'idx_filename', table: 'images', column: 'filename' },
      { name: 'idx_mime_type', table: 'images', column: 'mime_type' },
      { name: 'idx_prompt_usage', table: 'prompt_collection', column: 'usage_count' },
      { name: 'idx_prompt_group', table: 'prompt_collection', column: 'group_id' },
      { name: 'idx_negative_prompt_usage', table: 'negative_prompt_collection', column: 'usage_count' },
      { name: 'idx_negative_prompt_group', table: 'negative_prompt_collection', column: 'group_id' },
      { name: 'idx_prompt_groups_order', table: 'prompt_groups', column: 'display_order' },
      { name: 'idx_prompt_groups_visible', table: 'prompt_groups', column: 'is_visible' },
      { name: 'idx_negative_groups_order', table: 'negative_prompt_groups', column: 'display_order' },
      { name: 'idx_negative_groups_visible', table: 'negative_prompt_groups', column: 'is_visible' }
    ];

    indexes.forEach(index => {
      try {
        db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
      } catch (err) {
        console.warn(`⚠️  Warning creating index ${index.name}:`, err);
      }
    });
    console.log('✅ 기본 데이터베이스 인덱스가 설정되었습니다.');

    // 마이그레이션 실행
    console.log('🔄 마이그레이션을 확인합니다...');
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
