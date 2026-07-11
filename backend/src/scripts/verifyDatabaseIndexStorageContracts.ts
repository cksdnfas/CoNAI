import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { down, up } from '../database/migrations/026_prune_redundant_indexes';

const projectRoot = path.resolve(__dirname, '../../..');
const initialMigration = fs.readFileSync(
  path.join(projectRoot, 'backend/src/database/migrations/000_create_all_tables.ts'),
  'utf8',
);
const performanceMigration = fs.readFileSync(
  path.join(projectRoot, 'backend/src/database/migrations/008_add_performance_indexes.ts'),
  'utf8',
);

assert.doesNotMatch(initialMigration, /idx_files_path/);
assert.doesNotMatch(performanceMigration, /idx_image_files_original_file_path/);

async function main(): Promise<void> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE media_auto_tag_index (
      composite_hash TEXT NOT NULL,
      tag_type TEXT NOT NULL,
      source_path TEXT NOT NULL,
      search_key TEXT NOT NULL,
      PRIMARY KEY (composite_hash, tag_type, source_path, search_key)
    );
    CREATE INDEX idx_media_auto_tag_hash_type
      ON media_auto_tag_index(composite_hash, tag_type);

    CREATE TABLE image_files (
      original_file_path TEXT NOT NULL UNIQUE
    );
    CREATE INDEX idx_files_path ON image_files(original_file_path);
    CREATE INDEX idx_image_files_original_file_path ON image_files(original_file_path);
  `);

  await up(db);
  const afterUp = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name IN (
        'idx_media_auto_tag_hash_type',
        'idx_files_path',
        'idx_image_files_original_file_path'
      )
  `).all();
  assert.equal(afterUp.length, 0);

  await down(db);
  const afterDown = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name IN (
        'idx_media_auto_tag_hash_type',
        'idx_files_path',
        'idx_image_files_original_file_path'
      )
  `).all();
  assert.equal(afterDown.length, 3);
  db.close();

  console.log('✅ Database index storage contracts verified');
}

void main();
