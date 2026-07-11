import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const distDir = path.resolve(process.cwd(), 'dist')
const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf8')
const initialAssetMatches = [
  ...indexHtml.matchAll(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/g),
  ...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/assets\/([^"]+\.js)"/g),
]
const initialAssets = Array.from(new Set(initialAssetMatches.map((match) => match[1])))
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
