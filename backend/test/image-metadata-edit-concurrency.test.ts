import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import sharp from 'sharp'
import { initializeAuthDb } from '../src/database/authDb'
import { db, initializeDatabase, closeDatabase } from '../src/database/init'
import { closeUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { ImageMetadataEditService } from '../src/services/imageMetadataEditService'
import { ImageMetadataWriteService } from '../src/services/imageMetadataWriteService'

const booted = (async () => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
})()

after(async () => {
  await booted
  closeUserSettingsDb()
  closeDatabase()
  await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
})

async function makeImage(hash: string) {
  await booted
  const directory = path.join(runtimePaths.uploadsDir, hash)
  await fs.promises.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, 'source.png')
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()
  await fs.promises.writeFile(filePath, bytes)
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare('INSERT INTO media_metadata (composite_hash, prompt) VALUES (?, ?)').run(hash, 'original')
  const fileId = Number(db.prepare(`
    INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type)
    VALUES (?, ?, ?, ?, 'image/png')
  `).run(hash, filePath, folderId, bytes.length).lastInsertRowid)
  return { directory, filePath, fileId, bytes }
}

function blockFirstRewrite(t: import('node:test').TestContext) {
  let started!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = ImageMetadataWriteService.writeBufferAsFormatBuffer.bind(ImageMetadataWriteService)
  let calls = 0
  t.mock.method(ImageMetadataWriteService, 'writeBufferAsFormatBuffer', async (...args) => {
    calls += 1
    if (calls === 1) {
      started()
      await gate
    }
    return original(...args)
  })
  t.after(() => release())
  return { entered, release, calls: () => calls }
}

test('concurrent metadata saves serialize, reject the stale save and preserve the committed replacement', async (t) => {
  const hash = 'a'.repeat(48)
  await makeImage(hash)
  const rewrite = blockFirstRewrite(t)
  const first = ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { prompt: 'first' } })
  await rewrite.entered
  const second = ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { model: 'second' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(rewrite.calls(), 1)
  rewrite.release()
  const [firstResult, staleResult] = await Promise.allSettled([first, second])
  assert.equal(firstResult.status, 'fulfilled')
  assert.equal(staleResult.status, 'rejected')
  if (firstResult.status !== 'fulfilled' || staleResult.status !== 'rejected') return
  assert.equal(staleResult.reason.status, 409)
  assert.ok(fs.existsSync(firstResult.value.image.original_file_path))
  const secondResult = await ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { model: 'second' } })

  assert.notEqual(firstResult.value.image.original_file_path, secondResult.image.original_file_path)
  assert.ok(fs.existsSync(secondResult.image.original_file_path))
  assert.equal((await sharp(secondResult.image.original_file_path).metadata()).format, 'png')
  const metadata = db.prepare('SELECT prompt, model_name FROM media_metadata WHERE composite_hash = ?').get(hash)
  assert.deepEqual(metadata, { prompt: 'first', model_name: 'second' })
  const files = db.prepare(`SELECT id, original_file_path FROM image_files WHERE composite_hash = ? AND file_status = 'active'`).all(hash)
  assert.deepEqual(files, [{ id: secondResult.image.file_id, original_file_path: secondResult.image.original_file_path }])
  const revisions = db.prepare('SELECT replacement_file_path, recycle_bin_path FROM image_metadata_edit_revisions WHERE composite_hash = ? ORDER BY id').all(hash) as Array<{ replacement_file_path: string; recycle_bin_path: string }>
  assert.deepEqual(revisions.map((row) => row.replacement_file_path), [firstResult.value.image.original_file_path, secondResult.image.original_file_path])
  assert.ok(revisions.every((row) => fs.existsSync(row.recycle_bin_path)))
})

test('a changed source file conflicts before commit without deleting the new source', async (t) => {
  const hash = 'b'.repeat(48)
  const image = await makeImage(hash)
  const rewrite = blockFirstRewrite(t)
  const saving = ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { prompt: 'edit' } })
  await rewrite.entered
  const changed = Buffer.concat([image.bytes, Buffer.from('external change')])
  await fs.promises.writeFile(image.filePath, changed)
  rewrite.release()
  await assert.rejects(saving, { status: 409 })

  assert.deepEqual(await fs.promises.readFile(image.filePath), changed)
  assert.deepEqual(await fs.promises.readdir(image.directory), ['source.png'])
  assert.deepEqual(db.prepare('SELECT id FROM image_files WHERE composite_hash = ? AND file_status = ?').all(hash, 'active'), [{ id: image.fileId }])
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM image_metadata_edit_revisions WHERE composite_hash = ?').get(hash) as { count: number }).count, 0)
})

test('a same-second metadata change conflicts before replacement', async (t) => {
  const hash = 'c'.repeat(48)
  const image = await makeImage(hash)
  const rewrite = blockFirstRewrite(t)
  const saving = ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { prompt: 'edit' } })
  await rewrite.entered
  db.prepare('UPDATE media_metadata SET prompt = ? WHERE composite_hash = ?').run('external edit', hash)
  rewrite.release()
  await assert.rejects(saving, { status: 409 })

  assert.equal((db.prepare('SELECT prompt FROM media_metadata WHERE composite_hash = ?').get(hash) as { prompt: string }).prompt, 'external edit')
  assert.deepEqual(await fs.promises.readFile(image.filePath), image.bytes)
  assert.deepEqual(await fs.promises.readdir(image.directory), ['source.png'])
})

test('scan and unrelated metadata changes do not conflict with an edit', async (t) => {
  const hash = 'd'.repeat(48)
  const image = await makeImage(hash)
  const rewrite = blockFirstRewrite(t)
  const saving = ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { prompt: 'edit' } })
  await rewrite.entered
  db.prepare("UPDATE image_files SET last_verified_date = '2030-01-01', scan_date = '2030-01-01' WHERE id = ?").run(image.fileId)
  db.prepare("UPDATE media_metadata SET model_name = 'other edit', rating_score = 1, metadata_updated_date = '2030-01-01' WHERE composite_hash = ?").run(hash)
  rewrite.release()
  const result = await saving
  assert.ok(fs.existsSync(result.image.original_file_path))
  assert.deepEqual(db.prepare('SELECT prompt, model_name, rating_score FROM media_metadata WHERE composite_hash = ?').get(hash),
    { prompt: 'edit', model_name: 'other edit', rating_score: 1 })
  const row = db.prepare('SELECT previous_metadata_json FROM image_metadata_edit_revisions WHERE composite_hash = ?').get(hash) as { previous_metadata_json: string }
  assert.equal(JSON.parse(row.previous_metadata_json).model_name, 'other edit')
})

test('metadata replacement uses the exclusive-copy fallback when hard links are unavailable', async (t) => {
  const hash = 'e'.repeat(48)
  await makeImage(hash)
  t.mock.method(fs.promises, 'link', async () => {
    throw Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' })
  })
  const result = await ImageMetadataEditService.saveMetadata(hash, { metadataPatch: { prompt: 'fallback' } })
  assert.ok(fs.existsSync(result.image.original_file_path))
  assert.equal((await sharp(result.image.original_file_path).metadata()).format, 'png')
})
