/**
 * A lorebook's keywords are English, plus those of one more language the book names (its key language), so the same
 * book matches a chat held in English (through a translation model) and one held in that language.
 */

/** Key languages offered by name; any other language is typed in. */
export const LORE_KEY_LANGUAGES = [
  { id: 'ko', label: '한국어', short: 'KO' },
  { id: 'ja', label: '日本語', short: 'JA' },
  { id: 'zh', label: '中文', short: 'ZH' },
] as const

export const LORE_KEY_LANGUAGE_MAX_LENGTH = 40

/** A stored key language: trimmed, '' and English (the base keys) as none. */
export function normalizeLoreKeyLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const language = value.trim().replace(/\s+/g, ' ').slice(0, LORE_KEY_LANGUAGE_MAX_LENGTH)
  return language && !/^(en|english|영어)$/i.test(language) ? language : null
}

/** The short tag a key row shows: `KO` for a listed language, else the start of the typed name. */
export function loreKeyLanguageTag(language: string) {
  return LORE_KEY_LANGUAGES.find((item) => item.id === language)?.short ?? [...language].slice(0, 3).join('').toUpperCase()
}

export function loreKeyLanguageLabel(language: string) {
  return LORE_KEY_LANGUAGES.find((item) => item.id === language)?.label ?? language
}

const LANGUAGE_SCRIPTS: Record<string, RegExp> = {
  ko: /[ᄀ-ᇿ㄰-㆏가-힣]/,
  ja: /[぀-ヿㇰ-ㇿ一-鿿]/,
  zh: /[㐀-䶿一-鿿]/,
}
/** Any letter outside the Latin script: how a typed language (Русский, ไทย) is told from English. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u

/** Whether a keyword is written in the key language's script; a `/regex/` keyword never is (it stays where it was put). */
export function isLoreKeyInLanguage(key: string, language: string) {
  if (/^\/.+\/[a-z]*$/s.test(key)) return false
  return (LANGUAGE_SCRIPTS[language] ?? NON_LATIN_LETTER).test(key)
}

type LanguageKeyed = { keys: string[]; secondaryKeys?: string[]; localKeys?: string[]; localSecondaryKeys?: string[] }

/**
 * Moves the keywords written in the key language's script out of the English lists into the language's own (an
 * imported or AI-made entry mixes them). Without a key language the entry is left as it is. A language written in
 * Latin letters (Français) cannot be told apart, so its keywords stay where they are.
 */
export function sortLoreKeysByLanguage<T extends LanguageKeyed>(entry: T, language: string | null): T {
  if (!language) return entry
  const split = (base: string[] = [], local: string[] = []) => {
    const moved = base.filter((key) => isLoreKeyInLanguage(key, language))
    if (moved.length === 0) return null
    return { base: base.filter((key) => !moved.includes(key)), local: [...new Set([...local, ...moved])].slice(0, 20) }
  }
  const primary = split(entry.keys, entry.localKeys)
  const secondary = split(entry.secondaryKeys, entry.localSecondaryKeys)
  if (!primary && !secondary) return entry
  return {
    ...entry,
    ...(primary ? { keys: primary.base, localKeys: primary.local } : {}),
    ...(secondary ? { secondaryKeys: secondary.base, localSecondaryKeys: secondary.local } : {}),
  }
}
