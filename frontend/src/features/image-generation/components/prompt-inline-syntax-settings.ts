import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { getPromptEditorSettings, savePromptEditorSettings } from '@/lib/api-prompts'

/** Popups that react to plain words; their order decides which one shows when both match. */
export type PromptInlineSyntaxSource = 'preprocess' | 'tag'
/** Every popup trigger: `random` is the `@` / `__` random-source palette. */
export type PromptInlineTrigger = PromptInlineSyntaxSource | 'random'

export type PromptInlineSyntaxSettings = {
  priority: PromptInlineSyntaxSource[]
  triggers: Record<PromptInlineTrigger, boolean>
  characterRelatedTags: boolean
  /** Insert Danbooru tags as `blue_hair` instead of `blue hair`. */
  tagUnderscores: boolean
  suppressCompletedTokenPopups: true
}

export const PROMPT_INLINE_SYNTAX_SOURCE_LABELS: Record<PromptInlineTrigger, { ko: string; en: string; syntax: string }> = {
  random: { ko: '랜덤 소스 팔레트', en: 'Random source palette', syntax: '@ · __ · Ctrl+Space' },
  preprocess: { ko: '전처리', en: 'Preprocess', syntax: 'keyword' },
  tag: { ko: '태그 추천', en: 'Tag Suggestion', syntax: 'word' },
}

const STORAGE_KEY = 'conai.prompt-inline.syntax-settings'
const SETTINGS_CHANGED_EVENT = 'conai:prompt-inline-syntax-settings-changed'
const DEFAULT_PRIORITY: PromptInlineSyntaxSource[] = ['preprocess', 'tag']
export const PROMPT_INLINE_TRIGGERS: PromptInlineTrigger[] = ['random', 'preprocess', 'tag']

export const DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS: PromptInlineSyntaxSettings = {
  priority: DEFAULT_PRIORITY,
  triggers: {
    random: true,
    preprocess: true,
    tag: true,
  },
  characterRelatedTags: true,
  tagUnderscores: false,
  suppressCompletedTokenPopups: true,
}

function isPromptInlineSyntaxSource(value: unknown): value is PromptInlineSyntaxSource {
  return value === 'preprocess' || value === 'tag'
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

  // 예전 설정의 wildcard 트리거는 팔레트(random) 트리거로 이어받는다
  const rawTriggers = (raw.triggers && typeof raw.triggers === 'object' ? raw.triggers : {}) as Partial<Record<PromptInlineTrigger | 'wildcard', boolean>>
  const legacyRandomTrigger = rawTriggers.random ?? rawTriggers.wildcard
  const triggers = Object.fromEntries(PROMPT_INLINE_TRIGGERS.map((trigger) => {
    const rawValue = trigger === 'random' ? legacyRandomTrigger : rawTriggers[trigger]
    return [trigger, typeof rawValue === 'boolean' ? rawValue : true]
  })) as PromptInlineSyntaxSettings['triggers']

  return {
    priority,
    triggers,
    characterRelatedTags: typeof raw.characterRelatedTags === 'boolean' ? raw.characterRelatedTags : true,
    tagUnderscores: typeof raw.tagUnderscores === 'boolean' ? raw.tagUnderscores : false,
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

const SERVER_SETTINGS_QUERY_KEY = ['prompt-editor-settings'] as const
/** One upload of browser-only settings per page load, for accounts that never saved settings on the server. */
let localSettingsUploaded = false

/**
 * Prompt editor settings, saved per account on the server so they follow the user across browsers.
 * localStorage keeps a copy for an instant first render and for users who cannot reach the prompt API.
 */
export function usePromptInlineSyntaxSettings() {
  const [settings, setSettings] = useState<PromptInlineSyntaxSettings>(() => readPromptInlineSyntaxSettings())
  const { canViewPrompts } = useFeaturePermissions()
  const queryClient = useQueryClient()
  const serverQuery = useQuery({
    queryKey: SERVER_SETTINGS_QUERY_KEY,
    queryFn: getPromptEditorSettings,
    enabled: canViewPrompts,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const saveMutation = useMutation({
    mutationFn: (next: PromptInlineSyntaxSettings) => savePromptEditorSettings(next),
    onSuccess: (saved) => queryClient.setQueryData(SERVER_SETTINGS_QUERY_KEY, saved),
  })
  const { mutate: saveToServer } = saveMutation

  // 서버 값이 오면 그걸 따르고, 서버에 아직 없으면 이 브라우저 설정을 한 번 올린다
  useEffect(() => {
    if (!serverQuery.isSuccess) {
      return
    }
    if (serverQuery.data) {
      const fromServer = normalizePromptInlineSyntaxSettings(serverQuery.data)
      if (JSON.stringify(fromServer) !== JSON.stringify(readPromptInlineSyntaxSettings())) {
        writePromptInlineSyntaxSettings(fromServer)
      }
      return
    }
    if (!localSettingsUploaded) {
      localSettingsUploaded = true
      saveToServer(readPromptInlineSyntaxSettings())
    }
  }, [saveToServer, serverQuery.data, serverQuery.isSuccess])

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
    if (canViewPrompts) {
      saveToServer(normalized)
    }
  }

  return { settings, setSettings: updateSettings }
}
