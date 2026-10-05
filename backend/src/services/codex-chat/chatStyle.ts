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
 * A rule the server holds a block field to when the model writes it (hand edits are free): a number range, how far
 * it may move in one reply, the values it may take, or that the model may not change it at all.
 */
export type ChatBlockField = {
  name: string
  min: number | null
  max: number | null
  /** Largest change per reply (numbers). */
  step: number | null
  /** Allowed values (any type is compared as text); empty: any. */
  values: string[]
  readonly: boolean
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
  /** How the values move (e.g. "affinity moves by at most 5 a turn"); read by the model with the current values. */
  rules: string
  /** One-line template of the folded status strip, e.g. `{{place}} · HP {{hp}}`; empty picks the first scalar fields. */
  summary: string
  /** Rules the server enforces on the model's updates, by field. */
  fields: ChatBlockField[]
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
  /** Linked emoticon groups (custom groups with `emoticon_enabled`), in priority order. */
  emoticonGroupIds: number[]
}

export const DEFAULT_CHAT_STYLE: ChatStyle = {
  typeface: 'sans',
  roleplay: false,
  colors: { dialogue: '', narration: '#e8c872', thought: '#9aa4b2' },
  backgroundDim: 55,
  backgroundBlur: 0,
  blocks: [],
  cast: [],
  emoticonGroupIds: [],
}

const MAX_EMOTICON_GROUPS = 10

const MAX_CAST = 8
const CAST_NAME_MAX_LENGTH = 40
const CAST_AVATAR_MAX_LENGTH = 120_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

const MAX_BLOCKS = 12
const MAX_BLOCK_FIELDS = 40
const BLOCK_FIELD_NAME_MAX_LENGTH = 60
const BLOCK_FIELD_VALUE_MAX_LENGTH = 80
const MAX_BLOCK_FIELD_VALUES = 40
const BLOCK_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const BLOCK_TEXT_LIMITS = { instruction: 2000, example: 4000, template: 20_000, css: 20_000, rules: 2000, summary: 300 } as const

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

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeFields(value: unknown): ChatBlockField[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, MAX_BLOCK_FIELDS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, BLOCK_FIELD_NAME_MAX_LENGTH) : ''
    // An unnamed rule is kept while it is being written in the editor; a repeated name keeps its first rule.
    if (name && seen.has(name)) return []
    if (name) seen.add(name)
    const values = Array.isArray(record.values)
      ? [...new Set(record.values.map((item) => (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item).trim().slice(0, BLOCK_FIELD_VALUE_MAX_LENGTH) : '')).filter(Boolean))].slice(0, MAX_BLOCK_FIELD_VALUES)
      : []
    const min = optionalNumber(record.min)
    const max = optionalNumber(record.max)
    const step = optionalNumber(record.step)
    return [{ name, min, max: max !== null && min !== null && max < min ? min : max, step: step !== null && step < 0 ? null : step, values, readonly: record.readonly === true }]
  })
}

/** A field's rule as one line for the model ('' when the rule says nothing), e.g. `affinity: 0~100, 한 번에 ±5까지`. */
export function fieldRuleText(field: ChatBlockField) {
  if (!field.name) return ''
  if (field.readonly) return `${field.name}: 고정값, 바꾸지 마`
  const parts: string[] = []
  if (field.min !== null || field.max !== null) parts.push(`${field.min ?? ''}~${field.max ?? ''}`)
  if (field.step !== null) parts.push(`한 번에 ±${field.step}까지`)
  if (field.values.length > 0) parts.push(`${field.values.join(' | ')} 중 하나`)
  return parts.length > 0 ? `${field.name}: ${parts.join(', ')}` : ''
}

export function fieldRuleLines(block: Pick<ChatDisplayBlock, 'fields'>) {
  return block.fields.map(fieldRuleText).filter(Boolean)
}

/**
 * One block as stored. The key is lowercased; an invalid key empties it (an unnamed block is kept while it is being
 * written in the editor but never offered to the model). Null for anything that is not an object.
 */
export function normalizeBlock(value: unknown, index = 0): ChatDisplayBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const rawKey = typeof record.key === 'string' ? record.key.trim().toLowerCase() : ''
  const key = BLOCK_KEY_PATTERN.test(rawKey) ? rawKey : ''
  const field = (name: keyof typeof BLOCK_TEXT_LIMITS) => (typeof record[name] === 'string' ? (record[name] as string).slice(0, BLOCK_TEXT_LIMITS[name]) : '')
  return {
    id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : `b${index}-${Date.now().toString(36)}`,
    key,
    instruction: field('instruction').trim(),
    example: field('example').trim(),
    template: field('template'),
    css: field('css'),
    rules: field('rules').trim(),
    summary: field('summary').trim(),
    fields: normalizeFields(record.fields),
    enabled: record.enabled !== false,
  }
}

function normalizeBlocks(value: unknown): ChatDisplayBlock[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  return value.slice(0, MAX_BLOCKS).flatMap((entry, index) => {
    const block = normalizeBlock(entry, index)
    if (!block) return []
    // A key the pattern rejects is dropped here (the shared store refuses it instead); a repeated key keeps the first.
    const rawKey = typeof (entry as Record<string, unknown>).key === 'string' ? ((entry as Record<string, unknown>).key as string).trim() : ''
    if (rawKey && (!block.key || seen.has(block.key))) return []
    if (block.key) seen.add(block.key)
    return [block]
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
    emoticonGroupIds: Array.isArray(record.emoticonGroupIds)
      ? [...new Set(record.emoticonGroupIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_EMOTICON_GROUPS)
      : [],
  }
}

const ROLEPLAY_GUIDANCE = [
  'Roleplay formatting: the chat colours these three kinds of text differently, so keep to them.',
  '- *Narration, actions and descriptions* go in single asterisks.',
  '- "Spoken lines" go in double quotes.',
  "- 'Inner thoughts' go in single quotes.",
  'Do not use asterisks for bold or other emphasis in roleplay replies.',
  'Every reply mixes at least one narration part and one spoken line, in this shape:',
  "*She looks up from the sketchbook and smiles.* \"Oh, you made it!\" 'A bit late, though…'",
].join('\n')

function buildBlocksGuidance(blocks: ChatDisplayBlock[]) {
  // A block without a template still shows (as a plain list of its fields), so it is offered to the model too.
  const usable = blocks.filter((block) => block.enabled && block.key)
  if (usable.length === 0) {
    return ''
  }
  const fence = '```'
  return [
    'Status blocks: the chat keeps a running state for each block below and shows it in a status panel. The current values come with the conversation under "현재 상태" (inside [참고 설정]); treat them as the facts of the scene and act consistently with them.',
    'To change values, write a fenced block (the fence name, then one JSON object) holding ONLY the fields that changed: leave unchanged fields out, set a field to null to remove it, write lists whole. Put it at the end of the reply, at most once per block, and leave it out when nothing changed. Values are plain text; never put HTML or Markdown in them.',
    ...usable.map((block) => [
      `- ${block.key}: ${block.instruction || 'update when the scene changes it'}`,
      block.rules ? `  Rules: ${block.rules}` : '',
      ...fieldRuleLines(block).map((line) => `  Field rule: ${line}`),
      '  Fields (with their starting values):',
      `${fence}${block.key}`,
      block.example || '{}',
      fence,
    ].filter(Boolean).join('\n')),
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
