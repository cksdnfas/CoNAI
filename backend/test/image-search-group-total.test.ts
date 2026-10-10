import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** search_images with group_id: the total counts the group's members, also right after the group changed. */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-search-group-total-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

async function boot() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { QueryCacheService } = await import('../src/services/QueryCacheService')
  QueryCacheService.initialize()
  return { db: main.db }
}

const hash = (n: number) => n.toString(16).padStart(48, '0')

test('search_images with group_id reports the group total', async () => {
  const { db } = await boot()
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const groupId = Number(db.prepare("INSERT INTO groups (name) VALUES ('sheets')").run().lastInsertRowid)
  const insertMedia = db.prepare("INSERT INTO media_metadata (composite_hash, prompt, first_seen_date) VALUES (?, 'p', '2026-01-02 00:00:00')")
  const insertFile = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type) VALUES (?, ?, ?, 'active', 1, 'image/png')")
  const addToGroup = db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type) VALUES (?, ?, 'manual')")
  db.transaction(() => {
    for (const n of [1, 2, 3]) {
      insertMedia.run(hash(n))
      insertFile.run(hash(n), `D:\\g\\${n}.png`, folderId)
    }
    addToGroup.run(groupId, hash(1))
  })()

  const { ImageSearchModel } = await import('../src/models/Image/ImageSearchModel')
  const first = await ImageSearchModel.advancedSearch({ group_id: groupId }, 1, 20, 'upload_date', 'DESC')
  assert.deepEqual([first.images.length, first.total], [1, 1])

  // The group grows (a batch saving its sheets into it); the next search must not report the old total.
  addToGroup.run(groupId, hash(2))
  addToGroup.run(groupId, hash(3))
  const second = await ImageSearchModel.advancedSearch({ group_id: groupId }, 1, 20, 'upload_date', 'DESC')
  assert.deepEqual([second.images.length, second.total], [3, 3])
})
