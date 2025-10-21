import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  db.exec(`ALTER TABLE images ADD COLUMN auto_tags TEXT`);
  console.log('✅ Migration 005: Added auto_tags column to images table');
};

export const down = async (db: Database.Database): Promise<void> => {
  db.exec(`ALTER TABLE images DROP COLUMN auto_tags`);
  console.log('✅ Migration 005 rollback: Removed auto_tags column');
};
