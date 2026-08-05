import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { down, up } from '../database/migrations/026_prune_redundant_indexes';
import {
  down as downVisibilityIndex,
  up as upVisibilityIndex,
} from '../database/migrations/027_add_media_visibility_index';

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

  await verifyVisibilityIndexMigration();

  console.log('✅ Database index storage contracts verified');
}

/**
 * Migration 027 exists so the home feed total can be counted without touching the
 * wide media_metadata rows. Assert both the re-run safety and the property that
 * makes it worth having: the count plan must stay inside the index.
 */
async function verifyVisibilityIndexMigration(): Promise<void> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE media_metadata (
      composite_hash TEXT PRIMARY KEY,
      prompt TEXT,
      rating_score INTEGER,
      postprocess_status TEXT
    );
    CREATE TABLE image_files (
      id INTEGER PRIMARY KEY,
      composite_hash TEXT,
      file_status TEXT NOT NULL
    );
    CREATE INDEX idx_files_composite_status
      ON image_files(composite_hash, file_status) WHERE file_status = 'active';
  `);

  await upVisibilityIndex(db);
  // Re-running a migration must never fail (idempotent).
  await upVisibilityIndex(db);

  const indexSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_media_metadata_visibility'
  `).get() as { sql: string } | undefined;

  assert.ok(indexSql, 'migration 027 must create idx_media_metadata_visibility');
  for (const column of ['rating_score', 'postprocess_status', 'composite_hash']) {
    assert.match(
      indexSql!.sql,
      new RegExp(column),
      `idx_media_metadata_visibility must cover ${column} so the feed count stays inside the index`,
    );
  }

  const countPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT COUNT(*) as total
    FROM media_metadata mm
    WHERE (mm.rating_score IS NULL OR NOT ((mm.rating_score >= 15)))
      AND COALESCE(mm.postprocess_status, 'ready') = 'ready'
      AND EXISTS (
        SELECT 1 FROM image_files activefile
        WHERE activefile.composite_hash = mm.composite_hash AND activefile.file_status = 'active'
      )
  `).all() as Array<{ detail: string }>;
  const planText = countPlan.map((row) => row.detail).join(' | ');

  assert.match(
    planText,
    /COVERING INDEX idx_media_metadata_visibility/,
    `feed total count must scan the covering visibility index, got: ${planText}`,
  );

  await downVisibilityIndex(db);
  const afterDown = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_media_metadata_visibility'
  `).all();
  assert.equal(afterDown.length, 0, 'migration 027 rollback must drop the visibility index');
  // Rolling back twice must also be safe.
  await downVisibilityIndex(db);

  db.close();
}

void main();
