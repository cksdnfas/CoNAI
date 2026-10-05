import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ChatProfileError } from './chatProfileError'
import { normalizeBlock, type ChatDisplayBlock } from './chatStyle'

/**
 * A shared display block: one status card (key, fields, rules, template) kept on its own, so profiles link it by id
 * the way they link lorebooks. Editing the block reaches every linked profile; a chat's state is folded by the
 * block's key, so relinking a block with the same key keeps the chat's values.
 */
export type ChatSharedBlock = {
  id: number
  name: string
  block: ChatDisplayBlock
  /** Profiles that link this block. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export const PROFILE_MAX_BLOCKS = 12
const BLOCK_NAME_MAX_LENGTH = 80

/** The file a block is exported as (and imported from); a bare block or an array of either is accepted too. */
export const BLOCK_FILE_MARK = 'conai_display_block'

export function normalizeBlockIds(value: unknown): number[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, PROFILE_MAX_BLOCKS)
}

type BlockRow = { id: number; name: string; block: string; created_date: string; updated_date: string }

function blockName(value: unknown, fallback: string) {
  return (typeof value === 'string' ? value.trim().slice(0, BLOCK_NAME_MAX_LENGTH) : '') || fallback || '표시 블록'
}

/** A block as saved: always enabled (linking is the switch) and with a valid key the model can write. */
function savedBlock(value: unknown): ChatDisplayBlock {
  const block = normalizeBlock(value)
  if (!block || !block.key) throw new ChatProfileError('블록 이름(```이름)은 영문 소문자로 시작하는 한 단어여야 해.')
  return { ...block, enabled: true }
}

function linkedProfiles() {
  const rows = getUserSettingsDb().prepare("SELECT id, name, block_ids FROM llm_chat_profiles WHERE block_ids IS NOT NULL AND block_ids != '[]' ORDER BY sort_order ASC, id ASC").all() as Array<{ id: number; name: string; block_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, blockIds: normalizeBlockIds(row.block_ids) }))
}

function parseStoredBlock(id: number, text: string): ChatDisplayBlock {
  let raw: unknown = null
  try { raw = JSON.parse(text) } catch { raw = null }
  const block = normalizeBlock(raw) ?? normalizeBlock({ key: '' }) as ChatDisplayBlock
  return { ...block, id: `s${id}`, enabled: true }
}

function toSharedBlock(row: BlockRow, profiles: ReturnType<typeof linkedProfiles>): ChatSharedBlock {
  return {
    id: row.id,
    name: row.name,
    block: parseStoredBlock(row.id, row.block),
    profiles: profiles.filter((profile) => profile.blockIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export const ChatSharedBlockStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_display_blocks ORDER BY name COLLATE NOCASE ASC, id ASC').all() as BlockRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toSharedBlock(row, profiles))
  },

  find(blockId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_display_blocks WHERE id = ?').get(blockId) as BlockRow | undefined
    return row ? toSharedBlock(row, linkedProfiles()) : null
  },

  /** Ids of these that still exist, in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_display_blocks WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /** The blocks a profile links, in link order; a missing block is skipped and a repeated key keeps the first. */
  blocksOf(ids: number[]): ChatDisplayBlock[] {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT id, block FROM chat_display_blocks WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number; block: string }>
    const byId = new Map(rows.map((row) => [row.id, parseStoredBlock(row.id, row.block)]))
    const seen = new Set<string>()
    return ids.flatMap((id) => {
      const block = byId.get(id)
      if (!block || !block.key || seen.has(block.key)) return []
      seen.add(block.key)
      return [block]
    })
  },

  create(input: { name?: unknown; block?: unknown }) {
    const block = savedBlock(input.block)
    const result = getUserSettingsDb().prepare('INSERT INTO chat_display_blocks (name, block) VALUES (?, ?)').run(blockName(input.name, block.key), JSON.stringify(block))
    return ChatSharedBlockStore.find(Number(result.lastInsertRowid)) as ChatSharedBlock
  },

  update(blockId: number, patch: { name?: unknown; block?: unknown }) {
    const current = ChatSharedBlockStore.find(blockId)
    if (!current) return null
    const block = patch.block === undefined ? current.block : savedBlock(patch.block)
    getUserSettingsDb().prepare('UPDATE chat_display_blocks SET name = ?, block = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(
      patch.name === undefined ? current.name : blockName(patch.name, block.key),
      JSON.stringify(block),
      blockId,
    )
    return ChatSharedBlockStore.find(blockId)
  },

  /** Also unlinks the block from every profile. */
  delete(blockId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const unlink = db.prepare('UPDATE llm_chat_profiles SET block_ids = ? WHERE id = ?')
      for (const profile of linkedProfiles()) {
        if (profile.blockIds.includes(blockId)) unlink.run(JSON.stringify(profile.blockIds.filter((id) => id !== blockId)), profile.id)
      }
      return db.prepare('DELETE FROM chat_display_blocks WHERE id = ?').run(blockId).changes > 0
    })()
  },
}

/** What a block file holds: the export shape, a bare block, or an array of either. */
export function readBlockFile(value: unknown): Array<{ name: string; block: ChatDisplayBlock }> {
  const items = Array.isArray(value) ? value : [value]
  const read = items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const inner = record.block && typeof record.block === 'object' ? record.block : record
    const block = normalizeBlock(inner)
    if (!block || !block.key) return []
    return [{ name: blockName(record.name, block.key), block: { ...block, enabled: true } }]
  })
  if (read.length === 0) throw new ChatProfileError('가져올 표시 블록이 없어. 내보낸 블록 JSON을 골라줘.')
  return read.slice(0, 50)
}
