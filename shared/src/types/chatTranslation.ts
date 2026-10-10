/**
 * Languages a chat profile's translation model works between: the model's language (what the chat model reads and
 * writes; the user's messages are translated into it) and the display language (what the user writes and reads; the
 * replies are translated into it).
 */
export const CHAT_TRANSLATION_LANGUAGES = [
  { id: 'ko', label: '한국어', name: 'Korean' },
  { id: 'en', label: 'English', name: 'English' },
  { id: 'ja', label: '日本語', name: 'Japanese' },
  { id: 'zh', label: '简体中文', name: 'Simplified Chinese' },
] as const

export type ChatTranslationLanguage = typeof CHAT_TRANSLATION_LANGUAGES[number]['id']

/** What a profile without a choice of its own uses (the translation's original direction). */
export const CHAT_TRANSLATION_DEFAULTS: { modelLanguage: ChatTranslationLanguage; displayLanguage: ChatTranslationLanguage } = {
  modelLanguage: 'en',
  displayLanguage: 'ko',
}

export function isChatTranslationLanguage(value: unknown): value is ChatTranslationLanguage {
  return CHAT_TRANSLATION_LANGUAGES.some((language) => language.id === value)
}
