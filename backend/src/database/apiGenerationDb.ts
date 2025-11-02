import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

const API_DB_PATH = path.join(runtimePaths.databaseDir, 'api-generation-history.db');

// Migration path resolution with multiple fallback strategies
// - Development: Reference source files directly
// - Production/Bundle: Use migrations in dist
// - Portable: Use migrations in app folder
// - SEA: Use migrations alongside executable
const getMigrationsPath = (): string => {
  const possiblePaths = [
    // Development: source files
    path.join(__dirname, '../../src/database/migrations/api-generation'),
    // Production: compiled in dist
    path.join(__dirname, 'migrations/api-generation'),
    // Portable: app/migrations/api-generation
    path.join(process.cwd(), 'app', 'migrations', 'api-generation'),
    // Bundle: relative to bundle location
    path.join(path.dirname(process.argv[1] || ''), 'migrations', 'api-generation'),
    // Alternative relative path
    path.join(__dirname, '../migrations/api-generation')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Return first path as fallback (will cause warning later)
  return possiblePaths[0];
};

const MIGRATIONS_PATH = getMigrationsPath();

/**
 * API Generation History Database Instance
 * Uses better-sqlite3 for synchronous operations
 * Separated from main images.db for API generation history tracking
 */
export let apiGenDb: Database.Database;

/**
 * Initialize API Generation History Database
 * - Creates database file if not exists
 * - Runs migrations automatically
 * - Synchronous operation (better-sqlite3 style)
 */
export function initializeApiGenerationDb(): void {
  try {
    // Ensure database directory exists
    const dbDir = path.dirname(API_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check if database is new
    const isNewDatabase = !fs.existsSync(API_DB_PATH);

    // Create database connection
    apiGenDb = new Database(API_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New API generation database created');
    } else {
      console.log('✅ Connected to existing API generation database');
    }

    // Attach main images database for cross-database queries
    attachMainDatabase();

    // Run migrations
    runMigrations();
  } catch (error) {
    console.error('Failed to initialize API generation database:', error);
    throw error;
  }
}

/**
 * Attach main images database for cross-database queries
 * Allows JOINs between api_generation_history and image_files/image_metadata tables
 */
function attachMainDatabase(): void {
  try {
    const MAIN_DB_PATH = path.join(runtimePaths.databaseDir, 'images.db');

    if (fs.existsSync(MAIN_DB_PATH)) {
      apiGenDb.exec(`ATTACH DATABASE '${MAIN_DB_PATH}' AS main_db`);
      console.log('✅ Main images database attached for cross-database queries');
    } else {
      console.warn('⚠️ Main images database not found, cross-database queries will fail');
    }
  } catch (error) {
    console.error('Failed to attach main database:', error);
    // Don't throw - allow API gen DB to work standalone
  }
}

/**
 * Create migrations tracking table
 */
function createMigrationsTable(): void {
  apiGenDb.exec(`
    CREATE TABLE IF NOT EXISTS api_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version VARCHAR(255) NOT NULL UNIQUE,
      applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(): string[] {
  const rows = apiGenDb.prepare('SELECT version FROM api_migrations ORDER BY version').all() as any[];
  return rows.map(row => row.version);
}

/**
 * Record a migration as applied
 */
function recordMigration(version: string): void {
  apiGenDb.prepare('INSERT INTO api_migrations (version) VALUES (?)').run(version);
}

/**
 * Create all tables directly (no migration files needed)
 */
function createTables(): void {
  console.log('📊 Creating API generation history tables...');

  // 1. API Generation history table
  apiGenDb.exec(`
    CREATE TABLE IF NOT EXISTS api_generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL CHECK(service_type IN ('comfyui', 'novelai')),
      generation_status TEXT NOT NULL DEFAULT 'pending' CHECK(generation_status IN ('pending', 'processing', 'completed', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      comfyui_workflow TEXT,
      comfyui_prompt_id TEXT,
      workflow_id INTEGER,
      workflow_name TEXT,
      group_id INTEGER,
      nai_model TEXT,
      nai_sampler TEXT,
      nai_seed INTEGER,
      nai_steps INTEGER,
      nai_scale REAL,
      nai_parameters TEXT,
      positive_prompt TEXT,
      negative_prompt TEXT,
      width INTEGER,
      height INTEGER,
      original_path TEXT,
      thumbnail_path TEXT,
      file_size INTEGER,
      linked_image_id INTEGER,
      assigned_group_id INTEGER,
      composite_hash TEXT,
      error_message TEXT,
      metadata TEXT
    )
  `);

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_api_gen_service_type ON api_generation_history(service_type)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_status ON api_generation_history(generation_status)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_created_at ON api_generation_history(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_linked_image ON api_generation_history(linked_image_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_composite_hash ON api_generation_history(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_workflow_id ON api_generation_history(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_group_id ON api_generation_history(group_id)'
  ];

  indexes.forEach(sql => apiGenDb.exec(sql));

  console.log('  ✅ API generation history tables created (1 table + indexes)');
}

/**
 * Run all migration files in order
 */
function runMigrations(): void {
  // Create migrations tracking table
  createMigrationsTable();

  // Check if migrations folder exists
  if (!fs.existsSync(MIGRATIONS_PATH)) {
    console.log('📊 No migrations folder found, creating tables directly...');
    createTables();
    return;
  }

  console.log(`📂 Using API generation migrations from: ${MIGRATIONS_PATH}`);

  // Get already applied migrations
  const appliedMigrations = getAppliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_PATH)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Filter out already applied migrations
  const pendingMigrations = files.filter(file => !appliedMigrations.includes(file));

  if (pendingMigrations.length === 0) {
    console.log('  ✓ All migrations already applied');
    return;
  }

  for (const file of pendingMigrations) {
    const filePath = path.join(MIGRATIONS_PATH, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      apiGenDb.exec(sql);
      recordMigration(file);
      console.log(`  ✓ Migration applied: ${file}`);
    } catch (error) {
      console.error(`  ✗ Migration failed: ${file}`, error);
      throw error;
    }
  }
}

/**
 * Close database connection
 */
export function closeApiGenerationDb(): void {
  if (apiGenDb) {
    apiGenDb.close();
    console.log('API Generation database connection closed');
  }
}

/**
 * Get database instance (use with caution)
 */
export function getApiGenDb(): Database.Database {
  if (!apiGenDb) {
    throw new Error('API Generation database not initialized');
  }
  return apiGenDb;
}
