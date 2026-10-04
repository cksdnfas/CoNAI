/**
 * How a profile's chats look: typeface, roleplay text colours and the chat background. The model only follows a
 * text convention (the guidance below); the browser does the styling, so nothing the model writes runs as code.
 */
export type ChatTypeface = 'sans' | 'serif' | 'mono'

export type ChatStyleColors = {
  /** "Spoken lines" in double quotes. Empty: the theme's text colour. */
  dialogue: string
  /** *Narration and actions* in asterisks. */
  narration: string
  /** 'Inner thoughts' in single quotes. */
  thought: string
}

/**
 * A designed card the model fills in: it writes a ```key fenced block of JSON values, and the chat renders `template`
 * (HTML with {{field}} slots, styled by `css`) with them. The template is the profile author's; the model only supplies
 * values, which are inserted as text.
 */
export type ChatDisplayBlock = {
  id: string
  /** Fence language the model writes, e.g. `status`. */
  key: string
  /** When and how the model should use the block; goes into the system prompt. */
  instruction: string
  /** Example JSON values: shown to the model as the format, and used for the editor preview. */
  example: string
  template: string
  css: string
  enabled: boolean
}

/** Another character who can speak in this profile's replies, marked by a `[Name]` line. */
export type ChatCastMember = {
  id: string
  name: string
  /** Small data URL (resized in the browser). */
  avatar: string | null
  /** Name colour, `#rrggbb`; empty for the default. */
  color: string
}

export type ChatStyle = {
  typeface: ChatTypeface
  /** Colour dialogue / narration / thoughts and tell the model to mark them. */
  roleplay: boolean
  colors: ChatStyleColors
  /** Background image dimming, 0–90 (%). */
  backgroundDim: number
  /** Background image blur, 0–20 (px). */
  backgroundBlur: number
  blocks: ChatDisplayBlock[]
  /** Characters besides the profile itself; replies switch speaker with `[Name]` lines. */
  cast: ChatCastMember[]
}

export const DEFAULT_CHAT_STYLE: ChatStyle = {
  typeface: 'sans',
  roleplay: false,
  colors: { dialogue: '', narration: '#e8c872', thought: '#9aa4b2' },
  backgroundDim: 55,
  backgroundBlur: 0,
  blocks: [],
  cast: [],
}

const MAX_CAST = 8
const CAST_NAME_MAX_LENGTH = 40
const CAST_AVATAR_MAX_LENGTH = 120_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

const MAX_BLOCKS = 12
const BLOCK_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const BLOCK_TEXT_LIMITS = { instruction: 2000, example: 4000, template: 20_000, css: 20_000 } as const

/** Large enough for a ~1600px WebP; resized in the browser before upload. */
export const BACKGROUND_MAX_LENGTH = 4_000_000
export const BACKGROUND_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function color(value: unknown, fallback: string) {
  if (value === '') return ''
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback
}

function bounded(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? fallback : Math.round(Math.min(max, Math.max(min, number)))
}

function normalizeBlocks(value: unknown): ChatDisplayBlock[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  return value.slice(0, MAX_BLOCKS).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key.trim().toLowerCase() : ''
    // An unnamed block is kept (being written in the editor) but never offered to the model.
    if (key && (!BLOCK_KEY_PATTERN.test(key) || seen.has(key))) return []
    if (key) seen.add(key)
    const field = (name: keyof typeof BLOCK_TEXT_LIMITS) => (typeof record[name] === 'string' ? (record[name] as string).slice(0, BLOCK_TEXT_LIMITS[name]) : '')
    return [{
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : `b${index}-${Date.now().toString(36)}`,
      key,
      instruction: field('instruction').trim(),
      example: field('example').trim(),
      template: field('template'),
      css: field('css'),
      enabled: record.enabled !== false,
    }]
  })
}

function normalizeCast(value: unknown): ChatCastMember[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, MAX_CAST).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    // Brackets and line breaks would break the `[Name]` marker.
    const name = typeof record.name === 'string' ? record.name.replace(/[[\]\r\n]/g, '').trim().slice(0, CAST_NAME_MAX_LENGTH) : ''
    const avatar = typeof record.avatar === 'string' && record.avatar.length <= CAST_AVATAR_MAX_LENGTH && AVATAR_PATTERN.test(record.avatar) ? record.avatar : null
    return [{
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : `c${index}-${Date.now().toString(36)}`,
      name,
      avatar,
      color: color(record.color, ''),
    }]
  })
}

export function normalizeChatStyle(value: unknown): ChatStyle {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      raw = null
    }
  }
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const colors = (record.colors && typeof record.colors === 'object' ? record.colors : {}) as Record<string, unknown>
  return {
    typeface: record.typeface === 'serif' || record.typeface === 'mono' ? record.typeface : 'sans',
    roleplay: record.roleplay === true,
    colors: {
      dialogue: color(colors.dialogue, DEFAULT_CHAT_STYLE.colors.dialogue),
      narration: color(colors.narration, DEFAULT_CHAT_STYLE.colors.narration),
      thought: color(colors.thought, DEFAULT_CHAT_STYLE.colors.thought),
    },
    backgroundDim: bounded(record.backgroundDim, 0, 90, DEFAULT_CHAT_STYLE.backgroundDim),
    backgroundBlur: bounded(record.backgroundBlur, 0, 20, DEFAULT_CHAT_STYLE.backgroundBlur),
    blocks: normalizeBlocks(record.blocks),
    cast: normalizeCast(record.cast),
  }
}

const ROLEPLAY_GUIDANCE = [
  'Roleplay formatting: the chat colours these three kinds of text differently, so keep to them.',
  '- *Narration, actions and descriptions* go in single asterisks.',
  '- "Spoken lines" go in double quotes.',
  "- 'Inner thoughts' go in single quotes.",
  'Do not use asterisks for bold or other emphasis in roleplay replies.',
].join('\n')

function buildBlocksGuidance(blocks: ChatDisplayBlock[]) {
  const usable = blocks.filter((block) => block.enabled && block.key && block.template.trim())
  if (usable.length === 0) {
    return ''
  }
  const fence = '```'
  return [
    'Display blocks: the chat renders these fenced blocks as designed cards. Write one exactly in this form (the fence name, then a single JSON object with the same fields), only where its instruction says. Values are plain text; never put HTML or Markdown in them.',
    ...usable.map((block) => [
      `- ${block.key}: ${block.instruction || 'use when it fits'}`,
      `${fence}${block.key}`,
      block.example || '{}',
      fence,
    ].join('\n')),
  ].join('\n')
}

function buildCastGuidance(cast: ChatCastMember[], profileName: string) {
  const names = cast.map((member) => member.name).filter(Boolean)
  if (names.length === 0) {
    return ''
  }
  return [
    `Characters: ${[profileName, ...names].join(', ')}. You voice all of them.`,
    'When another character speaks or acts, start that part with a line containing only their name in square brackets, then their text on the next lines. Switch back the same way.',
    `Text before the first such line belongs to ${profileName}. Example:`,
    `[${names[0]}]`,
    '"..."',
    `[${profileName}]`,
    '"..."',
  ].join('\n')
}

/** The part of the system prompt that tells the model about the profile's display conventions. */
export function buildChatStyleGuidance(style: ChatStyle, profileName: string) {
  return [style.roleplay ? ROLEPLAY_GUIDANCE : '', buildCastGuidance(style.cast, profileName), buildBlocksGuidance(style.blocks)].filter(Boolean).join('\n\n')
}
