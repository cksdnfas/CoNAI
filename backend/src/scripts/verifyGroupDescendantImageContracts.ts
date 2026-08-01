import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-group-descendants-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

async function main() {
  const { db, closeDatabase } = await import('../database/init')
  const { findImagesByGroupQuery } = await import('../models/GroupImageQueries')
  const { AutoFolderGroupImageModel } = await import('../models/AutoFolderGroup')

  try {
    db.exec(`
      CREATE TABLE rating_tiers (
        id INTEGER PRIMARY KEY,
        tier_name TEXT NOT NULL,
        min_score REAL NOT NULL,
        max_score REAL,
        tier_order INTEGER NOT NULL,
        color TEXT,
        feed_visibility TEXT NOT NULL DEFAULT 'show'
      );
      CREATE TABLE media_metadata (
        composite_hash TEXT PRIMARY KEY,
        width INTEGER,
        height INTEGER,
        thumbnail_path TEXT,
        prompt TEXT,
        negative_prompt TEXT,
        seed INTEGER,
        steps INTEGER,
        cfg_scale REAL,
        sampler TEXT,
        model_name TEXT,
        first_seen_date TEXT,
        metadata_updated_date TEXT,
        rating_score REAL,
        postprocess_status TEXT
      );
      CREATE TABLE image_files (
        id INTEGER PRIMARY KEY,
        composite_hash TEXT NOT NULL,
        original_file_path TEXT,
        file_status TEXT,
        file_type TEXT,
        file_size INTEGER,
        mime_type TEXT,
        folder_id INTEGER,
        scan_date TEXT
      );
      CREATE TABLE watched_folders (id INTEGER PRIMARY KEY, folder_name TEXT);
      CREATE TABLE groups (id INTEGER PRIMARY KEY, parent_id INTEGER);
      CREATE TABLE image_groups (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL,
        composite_hash TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        added_date TEXT NOT NULL,
        collection_type TEXT NOT NULL
      );
      CREATE TABLE auto_folder_groups (id INTEGER PRIMARY KEY, parent_id INTEGER);
      CREATE TABLE auto_folder_group_images (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL,
        composite_hash TEXT NOT NULL
      );

      INSERT INTO groups (id, parent_id) VALUES (1, NULL), (2, 1), (3, 2), (4, NULL);
      INSERT INTO auto_folder_groups (id, parent_id) VALUES (10, NULL), (11, 10), (12, NULL);

      INSERT INTO media_metadata (composite_hash, first_seen_date, metadata_updated_date, thumbnail_path, postprocess_status) VALUES
        ('root', '2026-07-05', '2026-07-05', '/thumbs/root.webp', 'ready'),
        ('child', '2026-07-04', '2026-07-04', '/thumbs/child.webp', 'ready'),
        ('grandchild', '2026-07-03', '2026-07-03', '/thumbs/grandchild.webp', 'ready'),
        ('shared', '2026-07-02', '2026-07-02', '/thumbs/shared.webp', 'ready'),
        ('outside', '2026-07-01', '2026-07-01', '/thumbs/outside.webp', 'ready');

      INSERT INTO image_groups (group_id, composite_hash, order_index, added_date, collection_type) VALUES
        (1, 'root', 1, '2026-07-05', 'manual'),
        (2, 'child', 2, '2026-07-04', 'auto'),
        (3, 'grandchild', 3, '2026-07-03', 'manual'),
        (2, 'shared', 4, '2026-07-02', 'auto'),
        (3, 'shared', 5, '2026-07-01', 'manual'),
        (4, 'outside', 1, '2026-07-01', 'manual');

      INSERT INTO auto_folder_group_images (group_id, composite_hash) VALUES
        (10, 'root'),
        (11, 'child'),
        (10, 'shared'),
        (11, 'shared'),
        (12, 'outside');
    `)

    const directCustom = findImagesByGroupQuery(1, 1, 20, undefined, undefined, false)
    assert.equal(directCustom.total, 1)
    assert.deepEqual(directCustom.images.map((image) => image.composite_hash), ['root'])

    const recursiveCustom = findImagesByGroupQuery(1, 1, 20, undefined, undefined, true)
    assert.equal(recursiveCustom.total, 4)
    assert.deepEqual(recursiveCustom.images.map((image) => image.composite_hash), ['root', 'child', 'grandchild', 'shared'])

    const firstCustomPage = findImagesByGroupQuery(1, 1, 2, undefined, undefined, true)
    const secondCustomPage = findImagesByGroupQuery(1, 2, 2, undefined, {
      orderIndex: firstCustomPage.nextCursorOrderIndex!,
      addedDate: firstCustomPage.nextCursorAddedDate!,
      compositeHash: firstCustomPage.nextCursorHash!,
      includeTotal: false,
    }, true)
    assert.deepEqual(
      [...firstCustomPage.images, ...secondCustomPage.images].map((image) => image.composite_hash),
      ['root', 'child', 'grandchild', 'shared'],
    )

    const recursiveAutoOnly = findImagesByGroupQuery(1, 1, 20, 'auto', undefined, true)
    assert.deepEqual(recursiveAutoOnly.images.map((image) => image.composite_hash), ['child', 'shared'])

    const directFolder = AutoFolderGroupImageModel.findImagesByGroup(10, 1, 20, { includeChildren: false })
    assert.deepEqual(directFolder.images.map((image) => image.composite_hash), ['root', 'shared'])

    const recursiveFolder = AutoFolderGroupImageModel.findImagesByGroup(10, 1, 20, { includeChildren: true })
    assert.deepEqual(recursiveFolder.images.map((image) => image.composite_hash), ['root', 'child', 'shared'])
    assert.equal(AutoFolderGroupImageModel.getImageCount(10, true), 3)

    const firstFolderPage = AutoFolderGroupImageModel.findImagesByGroup(10, 1, 2, { useCursor: true, includeChildren: true })
    const secondFolderPage = AutoFolderGroupImageModel.findImagesByGroup(10, 2, 2, {
      useCursor: true,
      includeChildren: true,
      cursorDate: firstFolderPage.nextCursorDate!,
      cursorHash: firstFolderPage.nextCursorHash!,
    })
    assert.deepEqual(
      [...firstFolderPage.images, ...secondFolderPage.images].map((image) => image.composite_hash),
      ['root', 'child', 'shared'],
    )
  } finally {
    closeDatabase()
    fs.rmSync(runtimeBase, { recursive: true, force: true })
  }
}

void main().then(() => {
  console.log('Group descendant image contracts verified.')
})
