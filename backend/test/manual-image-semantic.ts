/**
 * Manual check of image embeddings with the real EmbeddingGemma 2 worker (CPU): index some files, search by text,
 * similar by content.
 *
 *   AI_RUNTIME_DIR=<dir with state.json> RUNTIME_MODELS_DIR=<hf hub cache> npx tsx test/manual-image-semantic.ts <image>...
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-image-semantic-manual-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

const QUERIES = ['anime girl with green hair in a swimsuit', '초록 머리 애니 소녀', 'a settings screen of a web app', 'chat window with messages', 'a bowl of soup']

async function main() {
  const files = process.argv.slice(2)
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const mainDb = await import('../src/database/init')
  await mainDb.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const db = mainDb.db

  const { settingsService } = await import('../src/services/settingsService')
  settingsService.updateEmbeddingSettings({ enabled: true, imageSearch: true })
  const { indexPendingImages, imageIndexCount, searchImagesByText, similarImagesByVector } = await import('../src/services/embeddings/imageIndex')
  const { textWorker } = await import('../src/services/aiWorker/textEmbeddingService')

  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const names = new Map<string, string>()
  files.forEach((file, index) => {
    const hash = (index + 1).toString(16).padStart(48, '0')
    names.set(hash, path.basename(file))
    db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
    db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_type, file_size, mime_type) VALUES (?, ?, ?, 'active', 'image', 1, 'image/png')").run(hash, path.resolve(file), folderId)
  })

  let t = Date.now()
  let looked = 0
  for (let done = await indexPendingImages(); done > 0; done = await indexPendingImages()) looked += done
  console.log(`indexed ${imageIndexCount()} of ${looked} in ${Date.now() - t}ms (first batch loads the model)`)
  for (const query of QUERIES) {
    t = Date.now()
    const hits = await searchImagesByText(query, 3)
    console.log(`${Date.now() - t}ms | ${query} →`, hits?.map((hit) => `${names.get(hit.compositeHash)}:${hit.score.toFixed(3)}`).join('  '))
  }
  const first = [...names.keys()][0]
  console.log(`similar to ${names.get(first)}:`, similarImagesByVector(first, 'content', 3)?.map((hit) => `${names.get(hit.compositeHash)}:${hit.score.toFixed(3)}`).join('  '))
  console.log('worker', JSON.stringify(textWorker.status()))
  await textWorker.stop()
}

main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
