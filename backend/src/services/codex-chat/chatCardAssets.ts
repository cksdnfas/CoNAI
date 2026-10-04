import crypto from 'crypto'
import dns from 'dns'
import fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import path from 'path'
import sharp from 'sharp'
import { runtimePaths } from '../../config/runtimePaths'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/** Text written as `chat-asset:<name>` (the chat renders it from /api/codex-chat/assets/<name>). */
export const CHAT_ASSET_SCHEME = 'chat-asset:'
export const CHAT_ASSET_NAME_PATTERN = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/
const ASSET_MAX_BYTES = 10 * 1024 * 1024
const ASSET_MAX_PIXELS = 40_000_000
const ASSETS_PER_RUN = 30
const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3
const DOWNLOAD_CONCURRENCY = 4
const HOST_CACHE_MS = 10 * 60 * 1000
const FORMAT_EXTENSIONS: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif' }
const MIME_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** Markdown images and HTML <img> tags pointing at the web. */
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi

// Some networks block image hosts at DNS only (e.g. catbox.moe here); public resolvers still answer for them.
const fallbackResolver = new dns.promises.Resolver({ timeout: 4000, tries: 1 })
fallbackResolver.setServers(['1.1.1.1', '8.8.8.8'])
/** A blocked host makes the system resolver wait until it gives up; remember answers so a card pays that once. */
const hostCache = new Map<string, { expiresAt: number; addresses: Promise<Array<{ address: string; family: number }>> }>()

export function chatAssetsDir() {
  const dir = path.join(runtimePaths.saveDir, 'chat-assets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function chatAssetFile(name: string) {
  if (!CHAT_ASSET_NAME_PATTERN.test(name)) return null
  const file = path.join(chatAssetsDir(), name)
  return fs.existsSync(file) ? { path: file, mimeType: MIME_TYPES[name.split('.')[1]] } : null
}

/** Private, loopback, link-local, CGNAT, multicast and reserved addresses are never fetched. */
function isPublicAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)))
  }
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7))
  return !(lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff'))
}

async function lookupHost(host: string) {
  try {
    return await dns.promises.lookup(host, { all: true })
  } catch {
    const [v4, v6] = await Promise.all([fallbackResolver.resolve4(host).catch(() => []), fallbackResolver.resolve6(host).catch(() => [])])
    return [...v4.map((address) => ({ address, family: 4 })), ...v6.map((address) => ({ address, family: 6 }))]
  }
}

/** The host's addresses (system resolver, then public resolvers); every one of them must be public. */
async function resolvePublicHost(host: string) {
  let addresses: Array<{ address: string; family: number }>
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }]
  } else {
    let cached = hostCache.get(host)
    if (!cached || cached.expiresAt < Date.now()) {
      cached = { expiresAt: Date.now() + HOST_CACHE_MS, addresses: lookupHost(host) }
      hostCache.set(host, cached)
    }
    addresses = await cached.addresses
  }
  if (addresses.length === 0) {
    hostCache.delete(host)
    throw new Error('host not found')
  }
  if (!addresses.every((entry) => isPublicAddress(entry.address))) throw new Error('private address')
  return addresses[0]
}

/** GET an image, connecting only to the public address resolved above (redirects are checked the same way). */
async function download(url: string, redirectsLeft = MAX_REDIRECTS): Promise<Buffer> {
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('unsupported protocol')
  const resolved = await resolvePublicHost(target.hostname.replace(/^\[|\]$/g, ''))
  return await new Promise<Buffer>((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http
    const request = client.get(target, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (CoNAI chat card import)', Accept: 'image/*' },
      lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options?.all) callback(null, [resolved])
        else callback(null, resolved.address, resolved.family)
      }) as never,
    }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) { reject(new Error('too many redirects')); return }
        download(new URL(response.headers.location, target).toString(), redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (status !== 200) { response.resume(); reject(new Error(`HTTP ${status}`)); return }
      if (Number(response.headers['content-length'] ?? 0) > ASSET_MAX_BYTES) { response.destroy(); reject(new Error('too large')); return }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > ASSET_MAX_BYTES) { response.destroy(); reject(new Error('too large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('timed out')))
    request.on('error', reject)
  })
}

/** Keep a downloaded image under its content hash, after checking it really is one. */
async function storeImage(buffer: Buffer) {
  const metadata = await sharp(buffer, { limitInputPixels: ASSET_MAX_PIXELS, animated: true }).metadata()
  const extension = metadata.format ? FORMAT_EXTENSIONS[metadata.format] : undefined
  if (!extension) throw new Error('not an image')
  const name = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`
  const file = path.join(chatAssetsDir(), name)
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer)
  return name
}

export function findImageUrls(texts: string[]) {
  const urls = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(MARKDOWN_IMAGE)) urls.add(match[2])
    for (const match of text.matchAll(HTML_IMAGE)) urls.add(match[1])
  }
  return [...urls]
}

export type LocalizedImages = { saved: Map<string, string>; failed: Array<{ url: string; reason: string }> }

/**
 * Copy the web images a card's text shows into CoNAI, so they keep showing when the host is blocked here or the link
 * dies later. Links that cannot be fetched stay as they are.
 */
export async function localizeImages(texts: string[]): Promise<LocalizedImages> {
  const saved = new Map<string, string>()
  const failed: LocalizedImages['failed'] = []
  const queue = findImageUrls(texts).slice(0, ASSETS_PER_RUN)
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        saved.set(url, `${CHAT_ASSET_SCHEME}${await storeImage(await download(url))}`)
      } catch (error) {
        failed.push({ url, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))
  return { saved, failed }
}

/** Point saved links at their copies; an HTML <img> becomes a Markdown image (raw HTML is not rendered in chat). */
export function rewriteImageLinks(text: string, saved: Map<string, string>) {
  if (saved.size === 0 || !text) return text
  return text
    .replace(MARKDOWN_IMAGE, (whole, alt: string, url: string) => saved.has(url) ? `![${alt}](${saved.get(url)})` : whole)
    .replace(HTML_IMAGE, (whole, url: string) => {
      if (!saved.has(url)) return whole
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(whole)?.[1] ?? ''
      return `![${alt.replace(/[[\]]/g, '')}](${saved.get(url)})`
    })
}

/** Stored chat messages that still show a saved link (e.g. greetings already posted) get the copy too. */
export function rewriteStoredMessages(saved: Map<string, string>) {
  if (saved.size === 0) return 0
  const db = getUserSettingsDb()
  let changed = 0
  db.transaction(() => {
    const rows = db.prepare('SELECT id, content, alternatives FROM codex_chat_messages WHERE ' + [...saved.keys()].map(() => 'instr(content, ?) > 0').join(' OR '))
      .all(...saved.keys()) as Array<{ id: number; content: string; alternatives: string | null }>
    const update = db.prepare('UPDATE codex_chat_messages SET content = ?, alternatives = ? WHERE id = ?')
    for (const row of rows) {
      let alternatives = row.alternatives
      if (alternatives) {
        try {
          const parsed = JSON.parse(alternatives) as Array<{ content?: string }>
          alternatives = JSON.stringify(parsed.map((entry) => ({ ...entry, content: rewriteImageLinks(entry.content ?? '', saved) })))
        } catch {
          // Leave unreadable alternatives as they are.
        }
      }
      update.run(rewriteImageLinks(row.content, saved), alternatives, row.id)
      changed += 1
    }
  })()
  return changed
}
