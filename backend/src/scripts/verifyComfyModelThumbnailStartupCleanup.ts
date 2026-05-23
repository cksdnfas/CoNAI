import * as assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

async function main() {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'conai-comfy-thumbnail-cleanup-'))
  process.env.RUNTIME_BASE_PATH = runtimeRoot

  const serviceModule = await import('../services/comfyModelThumbnailService')
  const cleanupComfyModelThumbnailStartupCache = serviceModule.cleanupComfyModelThumbnailStartupCache as unknown

  assert.equal(
    typeof cleanupComfyModelThumbnailStartupCache,
    'function',
    'Comfy model thumbnail service should export startup cache cleanup',
  )

  const cleanup = cleanupComfyModelThumbnailStartupCache as () => Promise<{ missingDeleted: number; sourceDeleted: number; errors: number }>
  const cacheRoot = path.join(runtimeRoot, 'temp', 'comfy-model-thumbnails')
  const sourcesRoot = path.join(cacheRoot, 'sources')
  const missingPath = path.join(cacheRoot, 'stale.missing.json')
  const webpPath = path.join(cacheRoot, 'cached.webp')
  const metadataPath = path.join(cacheRoot, 'keep.txt')
  const sourcePath = path.join(sourcesRoot, 'stale.source')

  await fs.mkdir(sourcesRoot, { recursive: true })
  await fs.writeFile(missingPath, '{"missingUntil":9999999999999}', 'utf8')
  await fs.writeFile(webpPath, 'cached thumbnail', 'utf8')
  await fs.writeFile(metadataPath, 'do not delete unrelated cache metadata', 'utf8')
  await fs.writeFile(sourcePath, 'stale source bytes', 'utf8')

  const report = await cleanup()

  assert.equal(report.missingDeleted, 1, 'startup cleanup should delete stale missing markers')
  assert.equal(report.sourceDeleted, 1, 'startup cleanup should delete stale source scratch files')
  assert.equal(report.errors, 0, 'startup cleanup should not report errors for valid cache files')
  assert.equal(existsSync(missingPath), false, 'missing marker should be removed')
  assert.equal(existsSync(sourcePath), false, 'source scratch file should be removed')
  assert.equal(existsSync(webpPath), true, 'successful webp thumbnail cache should be preserved')
  assert.equal(existsSync(metadataPath), true, 'unrelated cache files should be preserved')

  const emptyReport = await cleanup()
  assert.deepEqual(emptyReport, { missingDeleted: 0, sourceDeleted: 0, errors: 0 }, 'second cleanup should be idempotent')

  const indexSource = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8')
  assert.match(
    indexSource,
    /cleanupComfyModelThumbnailStartupCache[\s\S]*await cleanupComfyModelThumbnailStartupCache\(\)/,
    'backend startup should invoke Comfy model thumbnail startup cleanup',
  )

  await fs.rm(runtimeRoot, { recursive: true, force: true })
  console.log('Comfy model thumbnail startup cleanup contracts verified.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
