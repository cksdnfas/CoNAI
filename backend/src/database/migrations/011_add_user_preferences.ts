import { Database } from 'better-sqlite3';

export function up(db: Database): void {
  // Create user_preferences table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create index for faster lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_key
    ON user_preferences(key);
  `);

  // Insert default language setting
  db.exec(`
    INSERT OR IGNORE INTO user_preferences (key, value)
    VALUES ('language', 'ko');
  `);

  console.log('✅ Migration 011: user_preferences table created');
}

export function down(db: Database): void {
  db.exec('DROP TABLE IF EXISTS user_preferences;');
  console.log('✅ Migration 011 rollback: user_preferences table dropped');
}
