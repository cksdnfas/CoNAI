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

export type ChatStyle = {
  typeface: ChatTypeface
  /** Colour dialogue / narration / thoughts and tell the model to mark them. */
  roleplay: boolean
  colors: ChatStyleColors
  /** Background image dimming, 0–90 (%). */
  backgroundDim: number
  /** Background image blur, 0–20 (px). */
  backgroundBlur: number
}

export const DEFAULT_CHAT_STYLE: ChatStyle = {
  typeface: 'sans',
  roleplay: false,
  colors: { dialogue: '', narration: '#e8c872', thought: '#9aa4b2' },
  backgroundDim: 55,
  backgroundBlur: 0,
}

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
  }
}

const ROLEPLAY_GUIDANCE = [
  'Roleplay formatting: the chat colours these three kinds of text differently, so keep to them.',
  '- *Narration, actions and descriptions* go in single asterisks.',
  '- "Spoken lines" go in double quotes.',
  "- 'Inner thoughts' go in single quotes.",
  'Do not use asterisks for bold or other emphasis in roleplay replies.',
].join('\n')

/** The part of the system prompt that tells the model about the profile's display conventions. */
export function buildChatStyleGuidance(style: ChatStyle) {
  return style.roleplay ? ROLEPLAY_GUIDANCE : ''
}
