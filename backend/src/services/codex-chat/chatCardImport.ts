import sharp from 'sharp'
import { PngExtractor } from '../metadata/extractors/pngExtractor'
import { ChatProfileError, normalizeAlternateGreetings, type ChatProfileInput, type ChatPromptSection } from './chatProfiles'
import { ChatLorebookStore, normalizeLorebook, type ChatLoreEntry } from './chatLorebook'
import { localizeImages, rewriteImageLinks } from './chatCardAssets'

export const CHAT_CARD_MAX_BYTES = 8 * 1024 * 1024
const text = (value: unknown, limit = 20_000) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const isPng = (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

/** The JSON of a card PNG (its chara / ccv3 chunk) or of a JSON file. */
function readJsonFile(buffer: Buffer, failure: string): Record<string, unknown> {
  try {
    let json = buffer.toString('utf8')
    if (isPng(buffer)) {
      const chunks = PngExtractor.extractTextChunks(buffer, ['chara', 'ccv3'])
      const encoded = (chunks.ccv3 || chunks.chara || '').replace(/\s/g, '')
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Missing card')
      json = Buffer.from(encoded, 'base64').toString('utf8')
    }
    return object(JSON.parse(json.replace(/^﻿/, '')))
  } catch {
    throw new ChatProfileError(failure)
  }
}

/** World info keeps entries as an object keyed by uid; card books and NovelAI lorebooks as an array. */
function bookEntries(book: Record<string, unknown>): ChatLoreEntry[] {
  const entries = Array.isArray(book.entries) ? book.entries : Object.values(object(book.entries))
  return normalizeLorebook(entries)
}

/** A card is data only. Its lorebook becomes a shared lorebook; no profile, file, connection or tool is installed. */
export async function importChatCard(buffer: Buffer, providerName: string): Promise<ChatProfileInput> {
  if (buffer.length > CHAT_CARD_MAX_BYTES) throw new ChatProfileError('카드는 8MB까지 가져올 수 있어.')
  const parsed = readJsonFile(buffer, '캐릭터 카드 PNG 또는 JSON을 읽지 못했어.')
  let avatar: string | null = null
  if (isPng(buffer)) {
    try {
      const image = await sharp(buffer, { limitInputPixels: 25_000_000, animated: false }).rotate().resize(128, 128, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
      avatar = `data:image/webp;base64,${image.toString('base64')}`
    } catch {
      throw new ChatProfileError('캐릭터 카드 PNG 또는 JSON을 읽지 못했어.')
    }
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
  // Web images in the card's text are copied into CoNAI (hosts get blocked, links die); failures keep the link.
  const systemPrompt = text(data.system_prompt).replace(/\{\{\s*original\s*\}\}/gi, '').trim()
  const greeting = text(data.first_mes)
  const alternateGreetings = normalizeAlternateGreetings(data.alternate_greetings)
  const { saved } = await localizeImages([systemPrompt, greeting, ...alternateGreetings, ...sections.map((section) => section.content)])
  const localized = (value: string) => rewriteImageLinks(value, saved)
  const book = object(data.character_book)
  const entries = bookEntries(book)
  const lorebookIds = entries.length > 0 ? [ChatLorebookStore.create({ name: text(book.name, 80) || name, entries }).id] : []
  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20).map((tag) => tag.slice(0, 100)).join(', ') : ''
  return {
    name, avatar, engine: 'llm', providerName, mcpEnabled: false,
    tagline: text(data.tagline, 200) || text(data.creator_notes, 200) || tags.slice(0, 200),
    systemPrompt: localized(systemPrompt),
    promptSections: sections.map((section) => ({ ...section, content: localized(section.content) })),
    greeting: localized(greeting),
    alternateGreetings: alternateGreetings.map(localized),
    lorebookIds,
    loreScanDepth: typeof book.scan_depth === 'number' && Number.isFinite(book.scan_depth) ? Math.max(1, Math.min(100, Math.round(book.scan_depth))) : 4,
    loreTokenBudget: typeof book.token_budget === 'number' && Number.isFinite(book.token_budget) ? Math.max(0, Math.min(32768, Math.round(book.token_budget))) : 1024,
  }
}

/**
 * A lorebook file: SillyTavern world info, a character card (PNG or JSON) with a book, a bare card book, a NovelAI
 * lorebook, or this app's own { name, entries }. `fileName` names a book that carries no name.
 */
export function readLorebookFile(buffer: Buffer, fileName: string): { name: string; entries: ChatLoreEntry[] } {
  if (buffer.length > CHAT_CARD_MAX_BYTES) throw new ChatProfileError('로어북은 8MB까지 가져올 수 있어.')
  const parsed = readJsonFile(buffer, '로어북 JSON 또는 카드 PNG를 읽지 못했어.')
  const card = parsed.spec ? object(parsed.data) : parsed
  const book = card.character_book !== undefined ? object(card.character_book) : parsed
  const entries = bookEntries(book)
  if (entries.length === 0) throw new ChatProfileError('가져올 로어 항목이 없어.')
  const baseName = fileName.replace(/\.[^.]+$/, '')
  return { name: text(book.name, 80) || text(card.name, 80) || text(baseName, 80), entries }
}
