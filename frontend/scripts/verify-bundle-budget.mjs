import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const distDir = path.resolve(process.cwd(), 'dist')
const distIndexPath = path.join(distDir, 'index.html')

function newestMtimeMs(targetPath) {
  const stat = statSync(targetPath)
  if (!stat.isDirectory()) return stat.mtimeMs
  return readdirSync(targetPath, { withFileTypes: true }).reduce(
    (newest, entry) => Math.max(newest, newestMtimeMs(path.join(targetPath, entry.name))),
    stat.mtimeMs,
  )
}

const buildInputPaths = [
  'src',
  'index.html',
  'package.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
].map((relativePath) => path.resolve(process.cwd(), relativePath))
const newestBuildInputMtimeMs = Math.max(...buildInputPaths.map(newestMtimeMs))
const distIndexMtimeMs = statSync(distIndexPath).mtimeMs

if (distIndexMtimeMs < newestBuildInputMtimeMs) {
  console.warn('Bundle budget is reading dist output older than a build input; run the frontend production build for a source-current measurement')
}

const indexHtml = readFileSync(distIndexPath, 'utf8')
const initialAssetMatches = [
  ...indexHtml.matchAll(/<script[^>]+src="\.?\/assets\/([^"]+\.js)"/g),
  ...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.?\/assets\/([^"]+\.js)"/g),
]
const initialAssets = Array.from(new Set(initialAssetMatches.map((match) => match[1])))

if (initialAssets.length === 0) {
  throw new Error('No initial JS assets detected in dist/index.html — asset detection no longer matches the build output')
}
const initialGzipBytes = initialAssets.reduce(
  (total, fileName) => total + gzipSync(readFileSync(path.join(distDir, 'assets', fileName))).byteLength,
  0,
)
const budgetBytes = 250 * 1024
const forbiddenInitialAssets = initialAssets.filter((fileName) => /(?:konva|image-list)/i.test(fileName))

if (initialGzipBytes > budgetBytes) {
  throw new Error(`Initial JS budget exceeded: ${(initialGzipBytes / 1024).toFixed(2)}KB gzip > 250KB`)
}

if (forbiddenInitialAssets.length > 0) {
  throw new Error(`Lazy feature vendor preloaded: ${forbiddenInitialAssets.join(', ')}`)
}

console.log(`Initial JS: ${(initialGzipBytes / 1024).toFixed(2)}KB gzip (${initialAssets.length} assets)`)
