import sharp from 'sharp'
import { PngExtractor } from '../metadata/extractors/pngExtractor'
import { ChatProfileError, normalizeAlternateGreetings, type ChatProfileInput, type ChatPromptSection } from './chatProfiles'
import { ChatLorebookStore, isRegexKeyword, normalizeLorebook, type ChatLoreEntry } from './chatLorebook'
import { localizeImages } from './chatCardAssets'
import { rewriteMediaLinks } from './chatMediaLinks'

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

/** What a card import kept as it was, kept in another form, and left out — so a working import is not taken for an identical one. */
export type ChatCardImportReport = { kept: string[]; converted: string[]; dropped: string[] }

/** Per-entry world info settings this app has no equivalent for, by how they read in the report. */
const UNSUPPORTED_LORE_FIELDS: Array<[string, (row: Record<string, unknown>, extensions: Record<string, unknown>) => boolean]> = [
  ['삽입 위치·깊이', (row, ext) => (typeof row.position === 'number' && row.position !== 0) || (typeof row.position === 'string' && !['', 'before_char', 'after_char'].includes(row.position)) || typeof row.depth === 'number' || typeof ext.depth === 'number'],
  ['발동 확률', (row, ext) => (row.useProbability === true || ext.useProbability === true) && Number(row.probability ?? ext.probability ?? 100) < 100],
  ['유지·쿨다운·지연', (row, ext) => [row.sticky, row.cooldown, row.delay, ext.sticky, ext.cooldown, ext.delay].some((value) => typeof value === 'number' && value > 0)],
  ['포함 그룹', (row, ext) => Boolean(row.group || ext.group)],
  ['재귀 설정', (row, ext) => [row.excludeRecursion, row.preventRecursion, row.delayUntilRecursion, ext.exclude_recursion, ext.prevent_recursion].some((value) => value === true)],
  ['항목별 탐색 깊이', (row, ext) => typeof row.scanDepth === 'number' || typeof ext.scan_depth === 'number'],
]
const KNOWN_MACRO = /^\{\{\s*(char|user|original)\s*\}\}$/i

function lorebookReport(raw: unknown[], entries: ChatLoreEntry[], report: ChatCardImportReport) {
  if (entries.length === 0) return
  report.kept.push(`로어북 ${entries.length}개 항목`)
  const regex = entries.filter((entry) => [...entry.keys, ...entry.secondaryKeys].some(isRegexKeyword)).length
  if (regex) report.converted.push(`정규식 키워드가 있는 로어 ${regex}개 (안전 제한 안에서만 동작)`)
  for (const [label, test] of UNSUPPORTED_LORE_FIELDS) {
    const count = raw.filter((value) => {
      const row = object(value)
      return test(row, object(row.extensions))
    }).length
    if (count) report.dropped.push(`로어 ${label} (${count}개 항목)`)
  }
}

/** A card is data only. Its lorebook becomes a shared lorebook; no profile, file, connection or tool is installed. */
export async function importChatCard(buffer: Buffer, providerName: string): Promise<ChatProfileInput & { importReport: ChatCardImportReport }> {
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
  const report: ChatCardImportReport = { kept: [], converted: [], dropped: [] }
  const sections: ChatPromptSection[] = []
  for (const [key, title, kind] of [
    ['description', '캐릭터', 'text'], ['personality', '성격', 'text'], ['scenario', '상황', 'text'],
    ['post_history_instructions', '대화 뒤 지시', 'post'], ['mes_example', '대화 예시', 'dialogue'],
  ] as const) {
    const content = text(data[key]).replace(/\{\{\s*original\s*\}\}/gi, '').trim()
    if (content) {
      sections.push({ id: `card-${key}`, title, kind, content, enabled: true })
      report.kept.push(title)
    }
  }
  // SillyTavern's character note at a depth: the profile's author's note, which goes in at the lore depth.
  const extensions = object(data.extensions)
  const depthPrompt = object(extensions.depth_prompt)
  const authorNote = text(depthPrompt.prompt).replace(/\{\{\s*original\s*\}\}/gi, '').trim()
  if (authorNote) report.converted.push(`캐릭터 노트 → 작가 노트${typeof depthPrompt.depth === 'number' ? ` (깊이 ${depthPrompt.depth} 대신 로어 깊이를 따름)` : ''}`)
  if (Array.isArray(extensions.regex_scripts) && extensions.regex_scripts.length) report.dropped.push(`정규식 스크립트 ${extensions.regex_scripts.length}개`)
  // Web images and videos in the card's text are copied into the image library under the character's group (hosts
  // get blocked, links die); failures keep the link.
  const systemPrompt = text(data.system_prompt).replace(/\{\{\s*original\s*\}\}/gi, '').trim()
  const greeting = text(data.first_mes)
  const alternateGreetings = normalizeAlternateGreetings(data.alternate_greetings)
  const media = await localizeImages([systemPrompt, greeting, ...alternateGreetings, ...sections.map((section) => section.content)], { characterName: name })
  const localized = (value: string) => rewriteMediaLinks(value, media.saved)
  if (media.saved.size) report.converted.push(`이미지 ${media.saved.size}개 → 라이브러리 '채팅 카드/${name}' 그룹`)
  if (media.failed.length || media.remaining) report.dropped.push(`받지 못한 이미지 ${media.failed.length + media.remaining}개 (원래 링크 그대로, 캐릭터 탭 '이미지'에서 다시 받기)`)
  const book = object(data.character_book)
  const entries = bookEntries(book)
  const lorebookIds = entries.length > 0 ? [ChatLorebookStore.create({ name: text(book.name, 80) || name, entries }).id] : []
  lorebookReport(Array.isArray(book.entries) ? book.entries : Object.values(object(book.entries)), entries, report)
  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20).map((tag) => tag.slice(0, 100)).join(', ') : ''
  if (systemPrompt) report.kept.push('시스템 프롬프트')
  if (greeting) report.kept.push(alternateGreetings.length ? `첫 인사와 다른 인사 ${alternateGreetings.length}개` : '첫 인사')
  if (avatar) report.kept.push('아바타')
  // Only {{char}} and {{user}} are filled; any other macro reaches the model as written.
  const macros = [...new Set([systemPrompt, greeting, ...alternateGreetings, authorNote, ...sections.map((section) => section.content)].join('\n').match(/\{\{[^{}]{1,40}\}\}/g) ?? [])]
    .filter((macro) => !KNOWN_MACRO.test(macro))
  if (macros.length) report.dropped.push(`지원하지 않는 매크로: ${macros.slice(0, 8).join(' ')}${macros.length > 8 ? ' …' : ''}`)
  return {
    importReport: report,
    authorNote: authorNote || undefined,
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
