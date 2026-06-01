import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface Migration {
  version: string;
  up: (db: Database.Database) => Promise<void>;
  down: (db: Database.Database) => Promise<void>;
}

function escapeSavepointName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

export class MigrationManager {
  private db: Database.Database;
  private migrationsPath: string;

  constructor(database: Database.Database) {
    this.db = database;
    this.migrationsPath = path.join(__dirname, 'migrations');
  }

  // 마이그레이션 테이블 생성
  private createMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version VARCHAR(255) NOT NULL UNIQUE,
        applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private hasMigrationsTable(): boolean {
    return !!this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'migrations'
    `).get();
  }

  // 적용된 마이그레이션 목록 조회
  private getAppliedMigrations(): string[] {
    const rows = this.db.prepare('SELECT version FROM migrations ORDER BY version').all() as any[];
    return rows.map(row => row.version);
  }

  // 마이그레이션 적용 기록
  private recordMigration(version: string): void {
    this.db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
  }

  // 마이그레이션 적용 기록 삭제
  private removeMigrationRecord(version: string): void {
    this.db.prepare('DELETE FROM migrations WHERE version = ?').run(version);
  }

  // 사용 가능한 마이그레이션 파일 목록 조회
  private async getAvailableMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];

    // 마이그레이션 경로 탐색: 개발/포터블/SEA 환경 지원
    const possiblePaths = [
      this.migrationsPath,  // 개발 환경: backend/src/database/migrations
      path.join(process.cwd(), 'app', 'migrations'),  // 포터블: portable-output/app/migrations
      path.join(path.dirname(process.argv[1] || ''), 'migrations'),  // 번들: dist/migrations
      path.join(__dirname, '..', 'migrations')  // 상대경로
    ];

    let migrationsPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        migrationsPath = p;
        break;
      }
    }

    if (!migrationsPath) {
      console.warn('⚠️  마이그레이션 폴더를 찾을 수 없습니다.');
      console.warn('   시도한 경로:', possiblePaths);
      return migrations;
    }

    const files = fs.readdirSync(migrationsPath)
      .filter(file => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsPath, file);
      const version = file.replace(/\.(ts|js)$/, '');

      try {
        const migrationModule = require(filePath);
        if (migrationModule.up && migrationModule.down) {
          migrations.push({
            version,
            up: migrationModule.up,
            down: migrationModule.down
          });
        } else {
          throw new Error(`Migration ${file} must export both up and down handlers`);
        }
      } catch (error) {
        throw new Error(`Failed to load migration ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return migrations;
  }

  // 마이그레이션 실행 (up)
  async migrate(): Promise<void> {
    let transactionStarted = false;
    try {
      const availableMigrations = await this.getAvailableMigrations();

      if (!this.hasMigrationsTable()) {
        this.createMigrationsTable();
      }

      let appliedMigrations = this.getAppliedMigrations();
      let pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.includes(migration.version)
      );

      if (pendingMigrations.length === 0) {
        console.log('✅ 모든 마이그레이션이 이미 적용되었습니다.');
        return;
      }

      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      this.createMigrationsTable();

      // Another split runtime process may have applied the same migrations while
      // this process waited for the startup write lock.
      appliedMigrations = this.getAppliedMigrations();
      pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.includes(migration.version)
      );

      if (pendingMigrations.length === 0) {
        console.log('✅ 모든 마이그레이션이 이미 적용되었습니다.');
        this.db.exec('COMMIT');
        transactionStarted = false;
        return;
      }

      console.log(`🔄 ${pendingMigrations.length}개의 마이그레이션을 적용합니다...`);

      for (const migration of pendingMigrations) {
        const savepointName = `migration_${escapeSavepointName(migration.version)}`;
        try {
          console.log(`📦 마이그레이션 적용 중: ${migration.version}`);
          this.db.exec(`SAVEPOINT ${savepointName}`);
          await migration.up(this.db);
          this.recordMigration(migration.version);
          this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
          console.log(`✅ 마이그레이션 완료: ${migration.version}`);
        } catch (error) {
          try {
            this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
          } catch {
            // Migration may have already closed or released the savepoint.
          }
          console.error(`❌ 마이그레이션 실패: ${migration.version}`, error);
          throw error;
        }
      }

      this.db.exec('COMMIT');
      transactionStarted = false;
      console.log('🎉 모든 마이그레이션이 성공적으로 완료되었습니다!');
    } catch (error) {
      if (transactionStarted) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // The connection may already have unwound the transaction.
        }
      }
      console.error('❌ 마이그레이션 실행 중 오류 발생:', error);
      throw error;
    }
  }

  // 마이그레이션 롤백 (down)
  async rollback(targetVersion?: string): Promise<void> {
    try {
      this.createMigrationsTable();

      const appliedMigrations = this.getAppliedMigrations();
      const availableMigrations = await this.getAvailableMigrations();

      if (appliedMigrations.length === 0) {
        console.log('✅ 롤백할 마이그레이션이 없습니다.');
        return;
      }

      // 롤백 대상 결정
      let migrationsToRollback: string[] = [];

      if (targetVersion) {
        const targetIndex = appliedMigrations.indexOf(targetVersion);
        if (targetIndex === -1) {
          throw new Error(`Target version ${targetVersion} not found in applied migrations`);
        }
        migrationsToRollback = appliedMigrations.slice(targetIndex).reverse();
      } else {
        // 마지막 마이그레이션만 롤백
        migrationsToRollback = [appliedMigrations[appliedMigrations.length - 1]];
      }

      console.log(`🔄 ${migrationsToRollback.length}개의 마이그레이션을 롤백합니다...`);

      for (const version of migrationsToRollback) {
        const migration = availableMigrations.find(m => m.version === version);
        if (!migration) {
          throw new Error(`Migration file not found: ${version}`);
        }

        try {
          console.log(`📦 마이그레이션 롤백 중: ${version}`);
          const savepointName = `migration_rollback_${escapeSavepointName(version)}`;
          this.db.exec(`SAVEPOINT ${savepointName}`);
          await migration.down(this.db);
          this.removeMigrationRecord(version);
          this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
          console.log(`✅ 마이그레이션 롤백 완료: ${version}`);
        } catch (error) {
          const savepointName = `migration_rollback_${escapeSavepointName(version)}`;
          try {
            this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
          } catch {
            // Migration may have already closed or released the savepoint.
          }
          console.error(`❌ 마이그레이션 롤백 실패: ${version}`, error);
          throw error;
        }
      }

      console.log('🎉 마이그레이션 롤백이 성공적으로 완료되었습니다!');
    } catch (error) {
      console.error('❌ 마이그레이션 롤백 중 오류 발생:', error);
      throw error;
    }
  }

  // 마이그레이션 상태 확인
  async status(): Promise<void> {
    try {
      this.createMigrationsTable();

      const appliedMigrations = this.getAppliedMigrations();
      const availableMigrations = await this.getAvailableMigrations();

      console.log('\n📊 마이그레이션 상태:');
      console.log('='.repeat(50));

      if (availableMigrations.length === 0) {
        console.log('📁 사용 가능한 마이그레이션이 없습니다.');
        return;
      }

      for (const migration of availableMigrations) {
        const isApplied = appliedMigrations.includes(migration.version);
        const status = isApplied ? '✅ 적용됨' : '⏳ 대기중';
        console.log(`${status} ${migration.version}`);
      }

      console.log('='.repeat(50));
      console.log(`총 ${availableMigrations.length}개 중 ${appliedMigrations.length}개 적용됨\n`);
    } catch (error) {
      console.error('❌ 마이그레이션 상태 확인 중 오류 발생:', error);
      throw error;
    }
  }
}
