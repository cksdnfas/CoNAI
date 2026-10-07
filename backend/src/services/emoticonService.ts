import type Database from 'better-sqlite3'
import path from 'path';
import { db } from '../database/init';
import { resolveUploadsPath } from '../config/runtimePaths';

/**
 * Emoticon groups: custom groups flagged `emoticon_enabled`, whose direct images carry keywords. A chat profile links
 * such groups; the model writes `&*keyword*&` and the chat shows the image. Keywords sit on the membership row
 * (`image_groups.emote_keywords`, JSON array): NULL means "the file name", `[]` means none.
 */

export const EMOTICON_KEYWORD_MAX_LENGTH = 40
export const EMOTICON_KEYWORDS_PER_IMAGE = 12
/** What fits comfortably in a system prompt; the UI warns past it. */
export const EMOTICON_PROMPT_BUDGET = 150

export class EmoticonError extends Error {}

export type EmoticonEntry = {
  compositeHash: string
  /** Keywords in effect (stored, or the file name when none were set). */
  keywords: string[]
  /** True when keywords were set explicitly; false when they come from the file name. */
  explicit: boolean
  fileName: string | null
  mimeType: string | null
  width: number | null
  height: number | null
}

type MembershipRow = {
  composite_hash: string
  emote_keywords: string | null
  original_file_path: string | null
  mime_type: string | null
  width: number | null
  height: number | null
}

/** Upload names are `YYYYMMDD_HHMMSS_<random>_<original>.<ext>`; folder scans keep the real name. */
const UPLOAD_PREFIX_PATTERN = /^\d{8}_\d{6}_[0-9a-z]{1,6}_/i

/** Uploads before the UTF-8 fix stored Korean names as latin1 mojibake ("ì\x9B\x83ì\x9D\x8C"); read them back. */
function repairMojibake(name: string) {
  if (![...name].every((char) => char.charCodeAt(0) <= 255) || !/[\u0080-ÿ]/.test(name)) return name
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'))
  } catch {
    return name
  }
}

export function originalNameFromPath(filePath: string | null) {
  if (!filePath) return null
  const base = repairMojibake(path.basename(filePath))
  return base.replace(UPLOAD_PREFIX_PATTERN, '') || base
}

/** One keyword: trimmed, single-spaced, without the `&` / `*` that delimit the chat syntax. */
export function normalizeKeyword(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/[&*\r\n\t[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EMOTICON_KEYWORD_MAX_LENGTH)
}

export function normalizeKeywords(values: unknown): string[] {
  const list = Array.isArray(values) ? values : typeof values === 'string' ? values.split(/[,，]/) : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of list) {
    const keyword = normalizeKeyword(value)
    const key = keyword.toLowerCase()
    if (keyword && !seen.has(key)) {
      seen.add(key)
      result.push(keyword)
    }
    if (result.length >= EMOTICON_KEYWORDS_PER_IMAGE) break
  }
  return result
}

/** The keyword a file name suggests: its name without extension, separators read as spaces. */
export function keywordFromFileName(fileName: string | null) {
  if (!fileName) return ''
  return normalizeKeyword(fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '))
}

function parseStoredKeywords(value: string | null): string[] | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? normalizeKeywords(parsed) : null
  } catch {
    return null
  }
}

function toEntry(row: MembershipRow): EmoticonEntry {
  const stored = parseStoredKeywords(row.emote_keywords)
  const fileName = originalNameFromPath(row.original_file_path)
  const fromName = keywordFromFileName(fileName)
  return {
    compositeHash: row.composite_hash,
    keywords: stored ?? (fromName ? [fromName] : []),
    explicit: stored !== null,
    fileName,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
  }
}

const MEMBERSHIP_SELECT = `
  SELECT ig.composite_hash, ig.emote_keywords,
    (SELECT f.original_file_path FROM image_files f WHERE f.composite_hash = ig.composite_hash AND f.file_status = 'active' ORDER BY f.id LIMIT 1) AS original_file_path,
    (SELECT f.mime_type FROM image_files f WHERE f.composite_hash = ig.composite_hash AND f.file_status = 'active' ORDER BY f.id LIMIT 1) AS mime_type,
    mm.width, mm.height
  FROM image_groups ig
  LEFT JOIN media_metadata mm ON mm.composite_hash = ig.composite_hash
`

type GroupRow = { id: number; name: string; emoticon_enabled: number }

export const EmoticonService = {
  findGroup(groupId: number, database: Database.Database = db) {
    return database.prepare('SELECT id, name, emoticon_enabled FROM groups WHERE id = ?').get(groupId) as GroupRow | undefined
  },

  /** Every emoticon group, with how many images it holds and how many have a keyword. */
  listGroups() {
    const groups = db.prepare('SELECT id, name, description FROM groups WHERE emoticon_enabled = 1 ORDER BY name COLLATE NOCASE').all() as Array<{ id: number; name: string; description: string | null }>
    return groups.map((group) => {
      const entries = EmoticonService.listEntries(group.id)
      return { ...group, imageCount: entries.length, keywordedCount: entries.filter((entry) => entry.keywords.length > 0).length }
    })
  },

  listEntries(groupId: number, database: Database.Database = db): EmoticonEntry[] {
    const rows = database.prepare(`${MEMBERSHIP_SELECT} WHERE ig.group_id = ? ORDER BY ig.order_index ASC, ig.added_date ASC, ig.id ASC`).all(groupId) as MembershipRow[]
    return rows.map(toEntry)
  },

  /**
   * Set keywords for images in a group (null: back to the file name). A keyword may belong to one image per group;
   * clashes are refused and reported, the rest are saved.
   */
  setKeywords(groupId: number, items: Array<{ compositeHash: string; keywords: unknown }>, database: Database.Database = db) {
    const group = EmoticonService.findGroup(groupId, database)
    if (!group) throw new EmoticonError('그룹을 찾을 수 없어.')

    const entries = new Map(EmoticonService.listEntries(groupId, database).map((entry) => [entry.compositeHash, entry]))
    const next = new Map<string, string[] | null>()
    const missing: string[] = []
    for (const item of items) {
      if (!entries.has(item.compositeHash)) {
        missing.push(item.compositeHash)
        continue
      }
      next.set(item.compositeHash, item.keywords === null ? null : normalizeKeywords(item.keywords))
    }

    // Keywords in effect after the change, to check clashes against the whole group.
    const effective = new Map<string, string[]>()
    for (const [hash, entry] of entries) {
      const change = next.get(hash)
      if (change === undefined) effective.set(hash, entry.keywords)
      else if (change === null) effective.set(hash, keywordFromFileName(entry.fileName) ? [keywordFromFileName(entry.fileName)] : [])
      else effective.set(hash, change)
    }
    const owners = new Map<string, string[]>()
    for (const [hash, keywords] of effective) {
      for (const keyword of keywords) {
        const key = keyword.toLowerCase()
        owners.set(key, [...(owners.get(key) ?? []), hash])
      }
    }
    const conflicts: Array<{ compositeHash: string; keyword: string; usedBy: string[] }> = []
    const update = database.prepare('UPDATE image_groups SET emote_keywords = ? WHERE group_id = ? AND composite_hash = ?')
    let updated = 0
    database.transaction(() => {
      for (const [hash, keywords] of next) {
        const clash = (keywords ?? effective.get(hash) ?? []).filter((keyword) => (owners.get(keyword.toLowerCase()) ?? []).length > 1)
        if (clash.length > 0) {
          conflicts.push(...clash.map((keyword) => ({ compositeHash: hash, keyword, usedBy: (owners.get(keyword.toLowerCase()) ?? []).filter((owner) => owner !== hash) })))
          continue
        }
        update.run(keywords === null ? null : JSON.stringify(keywords), groupId, hash)
        updated += 1
      }
    })()
    return { updated, conflicts, missing }
  },

  /** Add images to a group as manual members, optionally with keywords (default: their file names). */
  addImages(groupId: number, items: Array<{ compositeHash: string; keywords?: unknown }>, database: Database.Database = db) {
    const group = EmoticonService.findGroup(groupId, database)
    if (!group) throw new EmoticonError('그룹을 찾을 수 없어.')
    const insert = database.prepare(`
      INSERT INTO image_groups (group_id, composite_hash, collection_type, order_index)
      VALUES (?, ?, 'manual', COALESCE((SELECT MAX(order_index) + 1 FROM image_groups WHERE group_id = ?), 0))
      ON CONFLICT(group_id, composite_hash) DO UPDATE SET collection_type = 'manual'
    `)
    const exists = database.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?')
    const added: string[] = []
    const missing: string[] = []
    database.transaction(() => {
      for (const item of items) {
        if (!exists.get(item.compositeHash)) {
          missing.push(item.compositeHash)
          continue
        }
        insert.run(groupId, item.compositeHash, groupId)
        added.push(item.compositeHash)
      }
    })()
    const withKeywords = items.filter((item) => added.includes(item.compositeHash) && item.keywords !== undefined).map((item) => ({ compositeHash: item.compositeHash, keywords: item.keywords }))
    const keywordResult = withKeywords.length > 0 ? EmoticonService.setKeywords(groupId, withKeywords, database) : { updated: 0, conflicts: [], missing: [] }
    return { added: added.length, missing, conflicts: keywordResult.conflicts }
  },

  /**
   * The emoticons a chat can use: images of the linked emoticon groups that have keywords. When groups share a
   * keyword, the group listed first wins.
   */
  forGroups(groupIds: number[]) {
    const byKeyword = new Map<string, string>()
    const result: Array<{ groupId: number; compositeHash: string; keywords: string[]; mimeType: string | null }> = []
    for (const groupId of groupIds) {
      const group = EmoticonService.findGroup(groupId)
      if (!group || group.emoticon_enabled !== 1) continue
      for (const entry of EmoticonService.listEntries(groupId)) {
        const keywords = entry.keywords.filter((keyword) => !byKeyword.has(keyword.toLowerCase()))
        if (keywords.length === 0) continue
        for (const keyword of keywords) byKeyword.set(keyword.toLowerCase(), entry.compositeHash)
        result.push({ groupId, compositeHash: entry.compositeHash, keywords, mimeType: entry.mimeType })
      }
    }
    return result
  },

  /** Whether an image belongs to one of these emoticon groups (gate for serving it to chat users). */
  isInGroups(compositeHash: string, groupIds: number[]) {
    if (groupIds.length === 0) return false
    const row = db.prepare(`
      SELECT 1 FROM image_groups ig JOIN groups g ON g.id = ig.group_id
      WHERE ig.composite_hash = ? AND g.emoticon_enabled = 1 AND ig.group_id IN (${groupIds.map(() => '?').join(',')})
      LIMIT 1
    `).get(compositeHash, ...groupIds)
    return Boolean(row)
  },

  activeFile(compositeHash: string) {
    const row = db.prepare("SELECT original_file_path, mime_type FROM image_files WHERE composite_hash = ? AND file_status = 'active' ORDER BY id LIMIT 1").get(compositeHash) as { original_file_path: string; mime_type: string | null } | undefined
    return row ? { path: resolveUploadsPath(row.original_file_path), mimeType: row.mime_type } : null
  },
}
