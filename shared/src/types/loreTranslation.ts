/** The stored title/keys/content are model text. This is a separately versioned reader translation. */
export type LoreTranslation = {
  language: 'en' | 'ko' | 'ja' | 'zh'
  title: string
  keys: string[]
  content: string
  sourceHash?: string
}
export type BilingualLore = {
  language?: 'en' | 'ko' | 'ja' | 'zh'
  translation?: LoreTranslation | null
}
