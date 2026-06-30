import { useEffect, useState } from 'react'

export type PromptInlineSyntaxSource = 'danbooru-group' | 'preprocess' | 'wildcard' | 'tag'

export type PromptInlineSyntaxSettings = {
  priority: PromptInlineSyntaxSource[]
  triggers: Record<PromptInlineSyntaxSource, boolean>
  characterRelatedTags: boolean
  suppressCompletedTokenPopups: true
}

export const PROMPT_INLINE_SYNTAX_SOURCE_LABELS: Record<PromptInlineSyntaxSource, { ko: string; en: string; syntax: string }> = {
  'danbooru-group': { ko: '태그 그룹', en: 'Tag Group', syntax: '__Group__' },
  preprocess: { ko: '전처리', en: 'Preprocess', syntax: 'keyword' },
  wildcard: { ko: '와일드카드', en: 'Wildcard', syntax: '++Wildcard++' },
  tag: { ko: '태그 추천', en: 'Tag Suggestion', syntax: 'word' },
}

const STORAGE_KEY = 'conai.prompt-inline.syntax-settings'
const SETTINGS_CHANGED_EVENT = 'conai:prompt-inline-syntax-settings-changed'
const DEFAULT_PRIORITY: PromptInlineSyntaxSource[] = ['danbooru-group', 'preprocess', 'wildcard', 'tag']

export const DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS: PromptInlineSyntaxSettings = {
  priority: DEFAULT_PRIORITY,
  triggers: {
    'danbooru-group': true,
    preprocess: true,
    wildcard: true,
    tag: true,
  },
  characterRelatedTags: true,
  suppressCompletedTokenPopups: true,
}

function isPromptInlineSyntaxSource(value: unknown): value is PromptInlineSyntaxSource {
  return value === 'danbooru-group' || value === 'preprocess' || value === 'wildcard' || value === 'tag'
}

export function normalizePromptInlineSyntaxSettings(value: unknown): PromptInlineSyntaxSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS
  }

  const raw = value as Partial<PromptInlineSyntaxSettings>
  const rawPriority = Array.isArray(raw.priority) ? raw.priority : []
  const priority = [
    ...rawPriority.filter(isPromptInlineSyntaxSource),
    ...DEFAULT_PRIORITY,
  ].filter((source, index, sources) => sources.indexOf(source) === index)

  const rawTriggers = (raw.triggers && typeof raw.triggers === 'object' ? raw.triggers : {}) as Partial<Record<PromptInlineSyntaxSource, boolean>>
  const triggers = Object.fromEntries(DEFAULT_PRIORITY.map((source) => [
    source,
    typeof rawTriggers[source] === 'boolean' ? rawTriggers[source] : true,
  ])) as PromptInlineSyntaxSettings['triggers']

  return {
    priority,
    triggers,
    characterRelatedTags: typeof raw.characterRelatedTags === 'boolean' ? raw.characterRelatedTags : true,
    suppressCompletedTokenPopups: true,
  }
}

export function readPromptInlineSyntaxSettings(): PromptInlineSyntaxSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return normalizePromptInlineSyntaxSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS
  }
}

export function writePromptInlineSyntaxSettings(settings: PromptInlineSyntaxSettings) {
  if (typeof window === 'undefined') {
    return
  }

  const normalized = normalizePromptInlineSyntaxSettings(settings)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: normalized }))
}

export function usePromptInlineSyntaxSettings() {
  const [settings, setSettings] = useState<PromptInlineSyntaxSettings>(() => readPromptInlineSyntaxSettings())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setSettings(readPromptInlineSyntaxSettings())
      }
    }
    const handleSettingsChanged = () => {
      setSettings(readPromptInlineSyntaxSettings())
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged)
    }
  }, [])

  const updateSettings = (nextSettings: PromptInlineSyntaxSettings) => {
    const normalized = normalizePromptInlineSyntaxSettings(nextSettings)
    setSettings(normalized)
    writePromptInlineSyntaxSettings(normalized)
  }

  return { settings, setSettings: updateSettings }
}
