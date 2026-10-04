import sharp from 'sharp'
import { PngExtractor } from '../metadata/extractors/pngExtractor'
import { ChatProfileError, normalizeAlternateGreetings, type ChatProfileInput, type ChatPromptSection } from './chatProfiles'
import { normalizeLorebook } from './chatLorebook'

export const CHAT_CARD_MAX_BYTES = 8 * 1024 * 1024
const text = (value: unknown, limit = 20_000) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A card is data only. No profile, image file, connection, tool permission or remote URL is installed here. */
export async function importChatCard(buffer: Buffer, providerName: string): Promise<ChatProfileInput> {
  if (buffer.length > CHAT_CARD_MAX_BYTES) throw new ChatProfileError('카드는 8MB까지 가져올 수 있어.')
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  let parsed: Record<string, unknown>
  let avatar: string | null = null
  try {
    let json = buffer.toString('utf8')
    if (png) {
      const chunks = PngExtractor.extractTextChunks(buffer, ['chara', 'ccv3'])
      const encoded = (chunks.ccv3 || chunks.chara || '').replace(/\s/g, '')
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Missing card')
      json = Buffer.from(encoded, 'base64').toString('utf8')
      const image = await sharp(buffer, { limitInputPixels: 25_000_000, animated: false }).rotate().resize(128, 128, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
      avatar = `data:image/webp;base64,${image.toString('base64')}`
    }
    parsed = object(JSON.parse(json.replace(/^\uFEFF/, '')))
  } catch {
    throw new ChatProfileError('캐릭터 카드 PNG 또는 JSON을 읽지 못했어.')
  }
  if (parsed.spec !== undefined && parsed.spec !== 'chara_card_v2' && parsed.spec !== 'chara_card_v3') throw new ChatProfileError('지원하지 않는 카드 버전이야.')
  const data = parsed.spec ? object(parsed.data) : parsed
  const name = text(data.name, 60)
  if (!name) throw new ChatProfileError('카드에 캐릭터 이름이 없어.')
  const sections: ChatPromptSection[] = []
  for (const [key, title, kind] of [
    ['description', '캐릭터', 'text'], ['personality', '성격', 'text'], ['scenario', '상황', 'text'],
    ['post_history_instructions', '추가 지시', 'text'], ['mes_example', '대화 예시', 'dialogue'],
  ] as const) {
    const content = text(data[key])
    if (content) sections.push({ id: `card-${key}`, title, kind, content, enabled: true })
  }
  const book = object(data.character_book)
  const entries = Array.isArray(book.entries) ? book.entries.slice(0, 100).map((value, index) => {
    const entry = object(value)
    return { id: `card-lore-${index}`, keys: entry.keys, content: entry.content, enabled: entry.enabled, constant: entry.constant, order: entry.insertion_order, caseSensitive: entry.case_sensitive }
  }) : []
  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20).map((tag) => tag.slice(0, 100)).join(', ') : ''
  return {
    name, avatar, engine: 'llm', providerName, mcpEnabled: false,
    tagline: text(data.tagline, 200) || text(data.creator_notes, 200) || tags.slice(0, 200),
    systemPrompt: text(data.system_prompt).replace(/\{\{\s*original\s*\}\}/gi, '').trim(),
    promptSections: sections, greeting: text(data.first_mes), alternateGreetings: normalizeAlternateGreetings(data.alternate_greetings),
    lorebook: normalizeLorebook(entries),
    loreScanDepth: typeof book.scan_depth === 'number' && Number.isFinite(book.scan_depth) ? Math.max(1, Math.min(100, Math.round(book.scan_depth))) : 4,
    loreTokenBudget: typeof book.token_budget === 'number' && Number.isFinite(book.token_budget) ? Math.max(0, Math.min(32768, Math.round(book.token_budget))) : 1024,
  }
}
