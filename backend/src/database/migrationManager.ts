import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface Migration {
  version: string;
  up: (db: Database.Database) => Promise<void>;
  down: (db: Database.Database) => Promise<void>;
}

export interface MigrationOptions {
  requireBaseline?: boolean;
}

export const BASELINE_MIGRATION_VERSION = '000_create_all_tables';

/**
 * Migrations folded into the 000 baseline. Their files are gone; a DB that has 000 must have run every one of them.
 * A fresh DB gets them recorded together with 000, so the history looks the same either way.
 */
export const SQUASHED_MIGRATION_VERSIONS: readonly string[] = [
  '001_create_auto_folder_groups',
  '002_add_watcher_polling_interval',
  '003_create_civitai_tables',
  '004_add_model_references_column',
  '006_create_auto_prompt_tables',
  '007_add_parent_id_to_groups',
  '008_add_performance_indexes',
  '009_add_raw_nai_parameters',
  '010_add_character_prompt_text',
  '011_add_prompt_similarity_fields',
  '012_add_prompt_term_relations',
  '012_create_backup_sources',
  '013_add_prompt_taxonomy_tables',
  '013_create_image_metadata_edit_revisions',
  '014_add_rating_tier_feed_visibility',
  '015_drop_prompt_usage_taxonomy_tables',
  '016_add_comfyui_server_backend_capacity',
  '017_add_image_detail_lookup_index',
  '018_add_media_postprocess_visibility',
  '019_add_home_feed_cursor_index',
  '020_add_group_rematch_index',
  '021_add_graph_execution_node_io',
  '022_add_media_auto_tag_index',
  '023_prune_media_auto_tag_index_variants',
  '024_add_prompt_similarity_candidate_indexes',
  '025_add_auto_tag_stats_indexes',
  '026_prune_redundant_indexes',
  '027_add_media_visibility_index',
  '028_add_media_auto_tag_state',
  '029_add_generation_queue_debug_columns',
  '031_add_media_prompt_search_index',
  '032_add_generation_queue_input_refs',
  '033_reset_prefilled_watcher_polling',
  '034_add_background_media_retry_state',
  '035_add_generation_queue_idempotency',
];

/**
 * Squashed versions that never changed images.db: their table (generation_queue_jobs) lives in user.db, where
 * generationQueueSchema.ts applies them. A DB missing only these is complete; the record is filled in.
 */
const IMAGES_DB_NOOP_SQUASHED_VERSIONS: ReadonlySet<string> = new Set([
  '029_add_generation_queue_debug_columns',
  '032_add_generation_queue_input_refs',
  '035_add_generation_queue_idempotency',
]);

const SQUASHED_VERSION_SET: ReadonlySet<string> = new Set(SQUASHED_MIGRATION_VERSIONS);

/** Tables only an already initialised (or pre-migration legacy) images.db has. */
const EXISTING_LIBRARY_TABLES = ['media_metadata', 'image_files', 'images'];

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
    if (!this.hasMigrationsTable()) {
      return [];
    }
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

  private hasExistingLibraryTables(): boolean {
    const placeholders = EXISTING_LIBRARY_TABLES.map(() => '?').join(', ');
    return !!this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})
      LIMIT 1
    `).get(...EXISTING_LIBRARY_TABLES);
  }

  /**
   * baseline 이 합쳐 버린 마이그레이션을 이 DB 가 전부 거쳤는지 확인한다. 고칠 수 없는 상태면
   * 아무것도 바꾸기 전에 던진다. images.db 와 무관한 버전만 빠졌으면 기록해야 할 목록을 돌려준다.
   */
  private checkSquashedHistory(applied: readonly string[], baselinePending: boolean): string[] {
    if (baselinePending) {
      // 000 은 빈 DB 에서만 돈다. 기록 없이 테이블만 있는 DB 에 돌리면 합쳐진 001~035 의 ALTER 가
      // 빠진 채로 "최신" 으로 기록된다.
      if (this.hasExistingLibraryTables()) {
        throw new Error(
          '마이그레이션 기록이 없는데 미디어 테이블이 이미 있는 데이터베이스입니다. '
          + `baseline(${BASELINE_MIGRATION_VERSION})은 빈 데이터베이스에만 적용할 수 있습니다. `
          + 'migrations 테이블을 복구하거나 새 데이터베이스로 시작해 주세요.',
        );
      }
      return [];
    }

    if (!applied.includes(BASELINE_MIGRATION_VERSION)) {
      return [];
    }

    const missing = SQUASHED_MIGRATION_VERSIONS.filter((version) => !applied.includes(version));
    const blocking = missing.filter((version) => !IMAGES_DB_NOOP_SQUASHED_VERSIONS.has(version));
    if (blocking.length > 0) {
      throw new Error(
        '이 데이터베이스는 너무 오래돼서 이번 버전으로 바로 올릴 수 없습니다. '
        + `baseline(${BASELINE_MIGRATION_VERSION})에 합쳐진 마이그레이션 기록이 빠져 있습니다: ${blocking.join(', ')}. `
        + '마이그레이션 035 까지 들어 있는 이전 릴리스(26.9.29 이후)로 먼저 한 번 실행해 DB 를 올린 뒤 다시 시도해 주세요.',
      );
    }
    return missing;
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
      throw new Error(`마이그레이션 폴더를 찾을 수 없습니다. 시도한 경로: ${possiblePaths.join(', ')}`);
    }

    const files = fs.readdirSync(migrationsPath)
      .filter(file => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsPath, file);
      const version = file.replace(/\.(ts|js)$/, '');

      // A build folder that was never cleaned can still hold compiled copies of the squashed files.
      if (SQUASHED_VERSION_SET.has(version)) {
        continue;
      }

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
  async migrate(options: MigrationOptions = {}): Promise<void> {
    let transactionStarted = false;
    try {
      const availableMigrations = await this.getAvailableMigrations();

      if (
        options.requireBaseline === true
        && !availableMigrations.some((migration) => migration.version === BASELINE_MIGRATION_VERSION)
      ) {
        throw new Error(
          `신규 데이터베이스 초기화에 필요한 baseline migration(${BASELINE_MIGRATION_VERSION})을 찾을 수 없습니다.`,
        );
      }

      const readState = () => {
        const applied = this.getAppliedMigrations();
        const pending = availableMigrations.filter(
          migration => !applied.includes(migration.version)
        );
        const baselinePending = pending.some((migration) => migration.version === BASELINE_MIGRATION_VERSION);
        return { applied, pending, unrecordedSquashed: this.checkSquashedHistory(applied, baselinePending) };
      };

      let state = readState();

      if (state.pending.length === 0 && state.unrecordedSquashed.length === 0) {
        console.log('✅ 모든 마이그레이션이 이미 적용되었습니다.');
        return;
      }

      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      this.createMigrationsTable();

      // Another split runtime process may have applied the same migrations while
      // this process waited for the startup write lock.
      state = readState();
      const appliedMigrations = state.applied;
      const pendingMigrations = state.pending;

      if (pendingMigrations.length === 0 && state.unrecordedSquashed.length === 0) {
        console.log('✅ 모든 마이그레이션이 이미 적용되었습니다.');
        this.db.exec('COMMIT');
        transactionStarted = false;
        return;
      }

      for (const version of state.unrecordedSquashed) {
        this.recordMigration(version);
        console.log(`📝 images.db 와 무관한 통합 마이그레이션 기록 보충: ${version}`);
      }

      console.log(`🔄 ${pendingMigrations.length}개의 마이그레이션을 적용합니다...`);

      for (const migration of pendingMigrations) {
        const savepointName = `migration_${escapeSavepointName(migration.version)}`;
        try {
          console.log(`📦 마이그레이션 적용 중: ${migration.version}`);
          this.db.exec(`SAVEPOINT ${savepointName}`);
          await migration.up(this.db);
          this.recordMigration(migration.version);
          if (migration.version === BASELINE_MIGRATION_VERSION) {
            // The baseline already holds what these did; record them so every DB with 000 has the same history.
            SQUASHED_MIGRATION_VERSIONS
              .filter((version) => !appliedMigrations.includes(version))
              .forEach((version) => this.recordMigration(version));
          }
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

      const squashedTargets = migrationsToRollback.filter((version) => SQUASHED_VERSION_SET.has(version));
      if (squashedTargets.length > 0) {
        throw new Error(
          `baseline(${BASELINE_MIGRATION_VERSION})에 합쳐진 마이그레이션은 따로 롤백할 수 없습니다: ${squashedTargets.join(', ')}`,
        );
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

      const appliedSquashed = SQUASHED_MIGRATION_VERSIONS.filter((version) => appliedMigrations.includes(version)).length;
      console.log(`🗜️ baseline 에 통합된 이전 마이그레이션 ${appliedSquashed}/${SQUASHED_MIGRATION_VERSIONS.length}개 기록됨`);
      console.log('='.repeat(50));
      const appliedAvailable = availableMigrations.filter((migration) => appliedMigrations.includes(migration.version)).length;
      console.log(`총 ${availableMigrations.length}개 중 ${appliedAvailable}개 적용됨\n`);
    } catch (error) {
      console.error('❌ 마이그레이션 상태 확인 중 오류 발생:', error);
      throw error;
    }
  }
}
