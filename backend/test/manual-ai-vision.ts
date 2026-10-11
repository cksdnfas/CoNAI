/**
 * Manual end-to-end check of the unified AI worker through the tagger / Kaloscope facades (real models).
 *
 *   AI_RUNTIME_DIR=<dir with state.json> RUNTIME_MODELS_DIR=<hf hub cache> npx tsx test/manual-ai-vision.ts <image> [video]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-ai-vision-manual-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

async function main() {
  const [image, video] = process.argv.slice(2)
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()

  const { settingsService } = await import('../src/services/settingsService')
  settingsService.updateKaloscopeSettings({ enabled: true, device: 'auto' })
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  const { kaloscopeTaggerService } = await import('../src/services/kaloscopeTaggerService')
  const { analyzeMedia, visionWorker, MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY } = await import('../src/services/aiWorker/aiVisionService')
  const { vectorStore } = await import('../src/services/vectors/vectorStore')

  console.log('deps', await imageTaggerService.checkPythonDependencies())
  let t = Date.now()
  const tagged = await imageTaggerService.tagImage(image)
  console.log('wd', tagged.success, tagged.model, (tagged.taglist || '').slice(0, 120), tagged.error, `${Date.now() - t}ms`)
  t = Date.now()
  const artists = await kaloscopeTaggerService.tagImage(image, { compositeHash: 'f'.repeat(48) })
  console.log('kaloscope', artists.success, artists.model, artists.taglist?.slice(0, 120), 'style' in artists, artists.error, `${Date.now() - t}ms`)
  console.log('style rows', vectorStore.count(MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY))
  t = Date.now()
  const both = await analyzeMedia(image, false, { tagger: true, kaloscope: true }, { compositeHash: 'e'.repeat(48) })
  console.log('combined', both.tagger?.success, both.kaloscope?.success, `${Date.now() - t}ms`)
  console.log('status', JSON.stringify(visionWorker.status()), JSON.stringify(await kaloscopeTaggerService.getStatus()))
  console.log('server', JSON.stringify(await kaloscopeTaggerService.getServerStatus()))

  if (video) {
    t = Date.now()
    const clip = await analyzeMedia(video, true, { tagger: true, kaloscope: true }, { compositeHash: 'd'.repeat(48) })
    console.log('video', clip.tagger?.success, (clip.tagger?.taglist || '').slice(0, 100), clip.kaloscope?.success, clip.kaloscope?.taglist?.slice(0, 80), clip.tagger?.error, `${Date.now() - t}ms`)
  }

  await imageTaggerService.unloadModel()
  console.log('after wd unload', JSON.stringify(visionWorker.status()))
  await kaloscopeTaggerService.unloadModel()
  console.log('after all unload', JSON.stringify(visionWorker.status()))
  await visionWorker.stop()
  console.log('missing file', JSON.stringify(await imageTaggerService.tagImage(path.join(root, 'nope.png'))))
  await visionWorker.stop()
  fs.rmSync(root, { recursive: true, force: true })
}

main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
