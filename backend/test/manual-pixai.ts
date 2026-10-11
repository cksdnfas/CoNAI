/**
 * Manual check of the PixAI tagger (GPU) through the tagger facade and the auto-tag merge.
 *
 *   AI_RUNTIME_DIR=<dir with state.json> RUNTIME_MODELS_DIR=<hf hub cache> npx tsx test/manual-pixai.ts <image>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-pixai-manual-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

async function main() {
  const [image] = process.argv.slice(2)
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const mainDb = await import('../src/database/init')
  await mainDb.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()

  const { settingsService } = await import('../src/services/settingsService')
  const { aiGpuReady, visionWorker } = await import('../src/services/aiWorker/aiVisionService')
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  const { buildMergedAutoTags } = await import('../src/services/hashTaggingService')

  console.log('gpu ready', await aiGpuReady())
  console.log('models', settingsService.getModelsList().map((model) => `${model.name}:${model.downloaded}${model.requiresGpu ? ':gpu' : ''}`).join(' '))
  settingsService.updateTaggerSettings({ enabled: true, model: 'pixai-v1', device: 'auto' })
  let t = Date.now()
  const first = await imageTaggerService.tagImage(image)
  console.log('first', first.success, first.model, `${Date.now() - t}ms`, first.error ?? '')
  t = Date.now()
  const tagged = await imageTaggerService.tagImage(image)
  console.log('warm', `${Date.now() - t}ms`)
  console.log('rating', tagged.rating)
  console.log('general', Object.keys(tagged.general ?? {}).slice(0, 15).join(', '))
  console.log('character', tagged.character, 'artist', tagged.artist, 'meta', Object.keys(tagged.meta ?? {}))
  const merged = JSON.parse(buildMergedAutoTags(null, tagged) as unknown as string)
  console.log('merged keys', Object.keys(merged), 'artist kept', Boolean(merged.artist || merged.tagger?.artist))
  console.log('worker', JSON.stringify(visionWorker.status()))

  settingsService.updateTaggerSettings({ model: 'vit' })
  t = Date.now()
  const wd = await imageTaggerService.tagImage(image)
  console.log('back to wd', wd.success, wd.model, `${Date.now() - t}ms`)
  await visionWorker.stop()
}

main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
