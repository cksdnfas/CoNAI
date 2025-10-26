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

    // Run migrations
    runMigrations();
  } catch (error) {
    console.error('Failed to initialize API generation database:', error);
    throw error;
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
 * Run all migration files in order
 */
function runMigrations(): void {
  if (!fs.existsSync(MIGRATIONS_PATH)) {
    console.warn(`⚠️  No migrations directory found for API generation DB`);
    console.warn(`   Searched path: ${MIGRATIONS_PATH}`);
    console.warn(`   API generation history features may not work correctly`);
    return;
  }

  console.log(`📂 Using API generation migrations from: ${MIGRATIONS_PATH}`);

  // Create migrations tracking table
  createMigrationsTable();

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
