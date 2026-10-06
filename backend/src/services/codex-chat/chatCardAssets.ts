import crypto from 'crypto'
import dns from 'dns'
import fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import path from 'path'
import { resolveUploadsPath, runtimePaths } from '../../config/runtimePaths'
import { db as imagesDb } from '../../database/init'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { BackgroundProcessorService } from '../backgroundProcessorService'
import { assignGeneratedMediaToGroup } from '../generationTargetGroupService'
import { GroupPathService } from '../groupPathService'
import { findMediaUrls, MEDIA_HASH_PATTERN, MEDIA_MIME_TYPES, mediaLink, rewriteMediaLinks, sniffMediaExtension } from './chatMediaLinks'

/** Legacy card copies: `chat-asset:<sha256>.<ext>` served from saveDir/chat-assets, moved into the library at startup. */
export const CHAT_ASSET_SCHEME = 'chat-asset:'
export const CHAT_ASSET_NAME_PATTERN = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/
const LEGACY_ASSET_LINK = /chat-asset:([a-f0-9]{64}\.(?:png|jpg|webp|gif))/g
/** Library group the copies of one character's card media are filed under: `채팅 카드/<character>`. */
export const CHAT_CARD_GROUP_ROOT = '채팅 카드'
const MEDIA_MAX_BYTES = 50 * 1024 * 1024
const MEDIA_PER_RUN = 30
const REQUEST_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const DOWNLOAD_CONCURRENCY = 4
const HOST_CACHE_MS = 10 * 60 * 1000

// Some networks block image hosts at DNS only (e.g. catbox.moe here); public resolvers still answer for them.
const fallbackResolver = new dns.promises.Resolver({ timeout: 4000, tries: 1 })
fallbackResolver.setServers(['1.1.1.1', '8.8.8.8'])
/** A blocked host makes the system resolver wait until it gives up; remember answers so a card pays that once. */
const hostCache = new Map<string, { expiresAt: number; addresses: Promise<Array<{ address: string; family: number }>> }>()

function legacyAssetsDir() {
  return path.join(runtimePaths.saveDir, 'chat-assets')
}

export function chatAssetFile(name: string) {
  if (!CHAT_ASSET_NAME_PATTERN.test(name)) return null
  const file = path.join(legacyAssetsDir(), name)
  return fs.existsSync(file) ? { path: file, mimeType: MEDIA_MIME_TYPES[name.split('.')[1]] } : null
}

/** Card media lands in the default Upload folder, so it is indexed, thumbnailed and shown in the gallery like an upload. */
function cardMediaDir() {
  const dir = path.join(runtimePaths.uploadsDir, 'chat-cards')
  fs.mkdirSync(dir, { recursive: true })
  return dir
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

/** GET a file, connecting only to the public address resolved above (redirects are checked the same way). */
async function download(url: string, redirectsLeft = MAX_REDIRECTS): Promise<{ buffer: Buffer; finalUrl: string }> {
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('unsupported protocol')
  const resolved = await resolvePublicHost(target.hostname.replace(/^\[|\]$/g, ''))
  return await new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http
    const request = client.get(target, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (CoNAI chat card import)', Accept: 'image/*,video/*' },
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
      if (Number(response.headers['content-length'] ?? 0) > MEDIA_MAX_BYTES) { response.destroy(); reject(new Error('too large')); return }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MEDIA_MAX_BYTES) { response.destroy(); reject(new Error('too large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ buffer: Buffer.concat(chunks), finalUrl: target.toString() }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('timed out')))
    request.on('error', reject)
  })
}

/** Register a downloaded file in the image library (after checking what it really is); returns its library id. */
async function ingestMedia(buffer: Buffer) {
  const extension = await sniffMediaExtension(buffer)
  const file = path.join(cardMediaDir(), `${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer)
  const result = await BackgroundProcessorService.processSavedMediaFile(file, { mimeType: MEDIA_MIME_TYPES[extension], metadataMode: 'background', quiet: true })
  if (!result.compositeHash) throw new Error('not processed')
  return { compositeHash: result.compositeHash, extension }
}

/** The active library file of a media id, or null when it was deleted or went missing. */
export function activeMediaFile(compositeHash: string) {
  if (!MEDIA_HASH_PATTERN.test(compositeHash)) return null
  const row = imagesDb.prepare("SELECT original_file_path, mime_type, file_size FROM image_files WHERE composite_hash = ? AND file_status = 'active' ORDER BY id LIMIT 1")
    .get(compositeHash) as { original_file_path: string; mime_type: string | null; file_size: number | null } | undefined
  if (!row) return null
  const filePath = resolveUploadsPath(row.original_file_path)
  return fs.existsSync(filePath) ? { path: filePath, mimeType: row.mime_type ?? 'application/octet-stream', size: row.file_size } : null
}

type CardMediaRow = { source_url: string; composite_hash: string; extension: string; final_url: string | null }

function knownSource(url: string) {
  return getUserSettingsDb().prepare('SELECT source_url, composite_hash, extension, final_url FROM chat_card_media WHERE source_url = ?').get(url) as CardMediaRow | undefined
}

function rememberSource(url: string, compositeHash: string, extension: string, finalUrl: string | null) {
  getUserSettingsDb().prepare(`
    INSERT INTO chat_card_media (source_url, composite_hash, extension, final_url, updated_date) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_url) DO UPDATE SET composite_hash = excluded.composite_hash, extension = excluded.extension, final_url = excluded.final_url, updated_date = CURRENT_TIMESTAMP
  `).run(url, compositeHash, extension, finalUrl)
}

/** File these library ids under `채팅 카드/<character>`; a failure here never fails the copy itself. */
export function fileUnderCharacterGroup(characterName: string, compositeHashes: string[]) {
  if (compositeHashes.length === 0) return
  try {
    // eslint-disable-next-line no-control-regex
    const name = characterName.replace(/[/\\]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || '이름 없음'
    assignGeneratedMediaToGroup(GroupPathService.resolveOrCreate(`${CHAT_CARD_GROUP_ROOT}/${name}`).groupId, compositeHashes)
  } catch (error) {
    console.warn('⚠️ Could not file chat card media under a group:', error instanceof Error ? error.message : error)
  }
}

export type LocalizedMediaItem = { url: string; compositeHash: string; extension: string; finalUrl: string | null }
export type LocalizedMedia = {
  /** Web link → `media:` link of its library copy. */
  saved: Map<string, string>
  items: LocalizedMediaItem[]
  failed: Array<{ url: string; reason: string }>
  /** Links left for the next run (one run copies at most MEDIA_PER_RUN). */
  remaining: number
}

/**
 * Copy the web images and videos a card's text shows into the image library, so they keep showing when the host is
 * blocked here or the link dies later, and are browsable in the gallery under the character's group. A link copied
 * before is reused while its library copy exists. Links that cannot be fetched stay as they are.
 */
export async function localizeImages(texts: string[], options: { characterName?: string; only?: string[] } = {}): Promise<LocalizedMedia> {
  const saved = new Map<string, string>()
  const items: LocalizedMediaItem[] = []
  const failed: LocalizedMedia['failed'] = []
  const only = options.only ? new Set(options.only) : null
  const urls = findMediaUrls(texts).filter((url) => !only || only.has(url))
  const queue = urls.slice(0, MEDIA_PER_RUN)
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const known = only ? undefined : knownSource(url)
        let item: LocalizedMediaItem
        if (known && activeMediaFile(known.composite_hash)) {
          item = { url, compositeHash: known.composite_hash, extension: known.extension, finalUrl: known.final_url }
        } else {
          const { buffer, finalUrl } = await download(url.replace(/&amp;/g, '&'))
          const stored = await ingestMedia(buffer)
          item = { url, ...stored, finalUrl: finalUrl === url ? null : finalUrl }
          rememberSource(url, item.compositeHash, item.extension, item.finalUrl)
        }
        saved.set(url, mediaLink(item.compositeHash, item.extension))
        items.push(item)
      } catch (error) {
        failed.push({ url, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))
  fileUnderCharacterGroup(options.characterName ?? '', items.map((item) => item.compositeHash))
  return { saved, items, failed, remaining: Math.max(0, urls.length - MEDIA_PER_RUN) }
}

const PROFILE_TEXT_COLUMNS = ['system_prompt', 'greeting', 'prompt_sections', 'alternate_greetings', 'character_description', 'example_dialogue', 'user_persona']

/** Stored chat messages that still show a saved link (e.g. greetings already posted) get the copy too. */
export function rewriteStoredMessages(saved: Map<string, string>, rewrite: (text: string) => string = (text) => rewriteMediaLinks(text, saved)) {
  if (saved.size === 0) return 0
  const db = getUserSettingsDb()
  let changed = 0
  db.transaction(() => {
    const rows = db.prepare('SELECT id, content, alternatives FROM codex_chat_messages WHERE ' + [...saved.keys()].map(() => 'instr(content, ?) > 0 OR instr(COALESCE(alternatives, \'\'), ?) > 0').join(' OR '))
      .all(...[...saved.keys()].flatMap((key) => [key, key])) as Array<{ id: number; content: string; alternatives: string | null }>
    const update = db.prepare('UPDATE codex_chat_messages SET content = ?, alternatives = ? WHERE id = ?')
    for (const row of rows) {
      let alternatives = row.alternatives
      if (alternatives) {
        try {
          const parsed = JSON.parse(alternatives) as Array<{ content?: string }>
          alternatives = JSON.stringify(parsed.map((entry) => ({ ...entry, content: rewrite(entry.content ?? '') })))
        } catch {
          // Leave unreadable alternatives as they are.
        }
      }
      update.run(rewrite(row.content), alternatives, row.id)
      changed += 1
    }
  })()
  return changed
}

export type ChatMediaInfo = {
  compositeHash: string
  available: boolean
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  duration: number | null
  sourceUrl: string | null
  finalUrl: string | null
}

/** What the profile editor shows for each linked library copy: size, kind, and the link it was copied from. */
export function chatMediaInfo(compositeHashes: string[]): ChatMediaInfo[] {
  const hashes = [...new Set(compositeHashes.filter((hash) => MEDIA_HASH_PATTERN.test(hash)))]
  if (hashes.length === 0) return []
  const marks = hashes.map(() => '?').join(',')
  const metadata = new Map((imagesDb.prepare(`SELECT composite_hash, width, height, duration FROM media_metadata WHERE composite_hash IN (${marks})`).all(...hashes) as Array<{ composite_hash: string; width: number | null; height: number | null; duration: number | null }>)
    .map((row) => [row.composite_hash, row]))
  const sources = new Map((getUserSettingsDb().prepare(`SELECT source_url, composite_hash, extension, final_url FROM chat_card_media WHERE composite_hash IN (${marks}) ORDER BY updated_date DESC`).all(...hashes) as CardMediaRow[])
    .reverse().map((row) => [row.composite_hash, row]))
  return hashes.map((compositeHash) => {
    const file = activeMediaFile(compositeHash)
    const meta = metadata.get(compositeHash)
    const source = sources.get(compositeHash)
    return {
      compositeHash,
      available: Boolean(file),
      mimeType: file?.mimeType ?? null,
      fileSize: file?.size ?? null,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      duration: meta?.duration ?? null,
      sourceUrl: source?.source_url ?? null,
      finalUrl: source?.final_url ?? null,
    }
  })
}

/** Chat profiles (by name) and message count that show any of these library ids, for the gallery's delete warning. */
export function chatMediaUsage(compositeHashes: string[]) {
  const needles = [...new Set(compositeHashes.filter((hash) => MEDIA_HASH_PATTERN.test(hash)))].slice(0, 500).map((hash) => `media:${hash}.`)
  if (needles.length === 0) return { profiles: [] as string[], messages: 0 }
  const db = getUserSettingsDb()
  const profileMatch = PROFILE_TEXT_COLUMNS.flatMap((column) => needles.map(() => `instr(COALESCE(${column}, ''), ?) > 0`)).join(' OR ')
  const profiles = (db.prepare(`SELECT name FROM llm_chat_profiles WHERE ${profileMatch} ORDER BY name`).all(...PROFILE_TEXT_COLUMNS.flatMap(() => needles)) as Array<{ name: string }>).map((row) => row.name)
  const messages = (db.prepare(`SELECT COUNT(*) AS count FROM codex_chat_messages WHERE ${needles.map(() => 'instr(content, ?) > 0').join(' OR ')}`).get(...needles) as { count: number }).count
  return { profiles, messages }
}

/**
 * One-time move of the old `chat-asset:` copies into the image library: each file is registered, filed under its
 * character's group, and every profile and message link is pointed at the library copy. Files that cannot be moved
 * keep their old link (still served). Safe to run on every start: it only acts while old links remain.
 */
export async function migrateLegacyChatAssets() {
  if (!fs.existsSync(legacyAssetsDir())) return
  const db = getUserSettingsDb()
  const profileColumns = PROFILE_TEXT_COLUMNS.filter((column) => (db.prepare('SELECT 1 FROM pragma_table_info(\'llm_chat_profiles\') WHERE name = ?').get(column)))
  const profiles = db.prepare(`SELECT id, name, ${profileColumns.join(', ')} FROM llm_chat_profiles WHERE ${profileColumns.map((column) => `instr(COALESCE(${column}, ''), 'chat-asset:') > 0`).join(' OR ')}`)
    .all() as Array<Record<string, string | number | null>>
  const messageRows = db.prepare("SELECT content, alternatives FROM codex_chat_messages WHERE instr(content, 'chat-asset:') > 0 OR instr(COALESCE(alternatives, ''), 'chat-asset:') > 0").all() as Array<{ content: string; alternatives: string | null }>
  const names = new Set<string>()
  const collect = (value: unknown) => { if (typeof value === 'string') for (const match of value.matchAll(LEGACY_ASSET_LINK)) names.add(match[1]) }
  for (const row of profiles) profileColumns.forEach((column) => collect(row[column]))
  for (const row of messageRows) { collect(row.content); collect(row.alternatives) }
  if (names.size === 0) return

  const moved = new Map<string, string>()
  for (const name of names) {
    const file = chatAssetFile(name)
    if (!file) continue
    try {
      const { compositeHash, extension } = await ingestMedia(fs.readFileSync(file.path))
      moved.set(`${CHAT_ASSET_SCHEME}${name}`, mediaLink(compositeHash, extension))
    } catch (error) {
      console.warn(`⚠️ Could not move chat card image ${name} into the library:`, error instanceof Error ? error.message : error)
    }
  }
  if (moved.size === 0) return
  const replace = (text: string) => text.replace(LEGACY_ASSET_LINK, (whole) => moved.get(whole) ?? whole)

  db.transaction(() => {
    for (const row of profiles) {
      const values = profileColumns.map((column) => typeof row[column] === 'string' ? replace(row[column] as string) : row[column])
      db.prepare(`UPDATE llm_chat_profiles SET ${profileColumns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...values, row.id)
    }
  })()
  const messages = rewriteStoredMessages(moved, replace)
  for (const row of profiles) {
    const hashes = new Set<string>()
    for (const column of profileColumns) {
      const value = row[column]
      if (typeof value === 'string') for (const match of value.matchAll(LEGACY_ASSET_LINK)) {
        const link = moved.get(match[0])
        if (link) hashes.add(link.slice('media:'.length).split('.')[0])
      }
    }
    fileUnderCharacterGroup(String(row.name ?? ''), [...hashes])
  }
  console.log(`🖼️ Moved ${moved.size} chat card image(s) into the image library (${profiles.length} profile(s), ${messages} message(s) updated)`)
}
