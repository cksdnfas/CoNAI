import { createContext, useContext, useMemo, useRef, useState } from 'react'
import type { ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import type { ChatProfile, ModelSlot } from '@/lib/api-codex-chat'
import type { Draft } from './chat-profile-editor-fields'
import { BACKGROUND_SLOT, REFERENCE_SLOT, type ProfileAssetRuns } from './chat-profile-asset-runs'

export type ProfileEditorSection = 'character' | 'appearance' | 'model' | 'memory' | 'tools' | 'look'

/** Draft keys the chat may fill, and the section that shows each. Tool grants and access are never among them. */
const DRAFT_KEYS = {
  name: 'character', tagline: 'character', systemPrompt: 'character', promptSections: 'character', greeting: 'character', alternateGreetings: 'character', authorNote: 'character',
  appearance: 'appearance', engine: 'model', modelSlotId: 'model', lorebookIds: 'memory', blockIds: 'look', isEnabled: 'character',
} as const satisfies Partial<Record<keyof Draft, ProfileEditorSection>>
type DraftKey = keyof typeof DRAFT_KEYS

/** Long texts are cut for reading only; the model writes them whole through profile.draft. */
const READ_TEXT = 6000
const cut = (value: string) => (value.length > READ_TEXT ? `${value.slice(0, READ_TEXT)}… (${value.length}자)` : value)

/** Which draft keys still hold what the chat filled; a manual edit clears the mark. */
export const ProfileAssistContext = createContext<{ filled: (key: keyof Draft) => boolean; sectionFilled: (section: ProfileEditorSection) => boolean }>({ filled: () => false, sectionFilled: () => false })
export const useProfileAssist = () => useContext(ProfileAssistContext)
/** The outline a field gets while it holds the chat's value. */
export const ASSIST_FILLED_CLASS = 'ring-1 ring-primary/50'

/**
 * Registers the open profile editor with a connected chat: it reads the draft, fills it (draft: nothing is saved),
 * switches sections, and asks to save or generate images through review cards.
 */
export function useProfileEditorChatPage({ open, profile, draft, setDraft, dirty, section, go, slots, lorebooks, blocks, runs, save }: {
  open: boolean
  profile: ChatProfile | null
  draft: Draft
  setDraft: (update: (current: Draft) => Draft) => void
  dirty: boolean
  section: ProfileEditorSection
  go: (section: ProfileEditorSection) => void
  slots: ModelSlot[]
  lorebooks?: Array<{ id: number; name: string }>
  blocks?: Array<{ id: number; name: string }>
  runs: ProfileAssetRuns
  save: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [filledValues, setFilledValues] = useState(new Map<DraftKey, string>())

  const assist = useMemo(() => {
    const filled = (key: keyof Draft) => {
      const value = filledValues.get(key as DraftKey)
      return value !== undefined && JSON.stringify(draft[key]) === value
    }
    return { filled, sectionFilled: (target: ProfileEditorSection) => (Object.keys(DRAFT_KEYS) as DraftKey[]).some((key) => DRAFT_KEYS[key] === target && filled(key)) }
  }, [draft, filledValues])

  const assetKeys = [REFERENCE_SLOT, BACKGROUND_SLOT, ...runs.emotionNames]
  const assets = {
    preset: runs.preset?.name ?? null,
    hasReference: Boolean(draft.referenceHash),
    hasAvatar: Boolean(draft.avatarHash ?? draft.avatar),
    hasBackground: Boolean(draft.backgroundHash),
    expressionNames: runs.emotionNames,
    slots: Object.fromEntries(assetKeys.map((key) => { const state = runs.slotState(key); return [key, { working: state.working, failed: state.failed, candidates: state.candidates.length }] })),
  }
  const ids = <T extends { id: number }>(items: T[] | undefined) => (items ?? []).map((item) => item.id)
  const draftSchema = pageObject({
    name: pageText(60), tagline: pageText(200), systemPrompt: pageText(20000),
    promptSections: pageArray(pageObject({ title: pageText(80), content: pageText(20000), enabled: { type: 'boolean' } }, ['title', 'content']), 30),
    greeting: pageText(20000), alternateGreetings: pageArray(pageText(20000), 100), authorNote: pageText(4000), appearance: pageText(20000),
    engine: pageChoice(['llm', 'codex', 'claude']),
    ...(slots.length ? { modelSlotId: pageChoice(slots.map((slot) => slot.id)) } : {}),
    ...(lorebooks?.length ? { lorebookIds: pageArray(pageChoice(ids(lorebooks)), 20) } : {}),
    ...(blocks?.length ? { blockIds: pageArray(pageChoice(ids(blocks)), 20) } : {}),
    isEnabled: { type: 'boolean' },
  })

  useChatPageRegistration(open ? {
    kind: 'settings',
    title: profile ? t({ ko: '프로필 편집 · {name}', en: 'Edit profile · {name}' }, { name: profile.name }) : t({ ko: '프로필 추가', en: 'Add profile' }),
    resourceId: profile ? `profile:${profile.id}` : 'profile:new',
    priority: 10,
    dirty,
    fields: [],
    data: {
      section,
      profile: {
        saved: Boolean(profile), id: profile?.id ?? null, name: draft.name, tagline: draft.tagline, systemPrompt: cut(draft.systemPrompt),
        promptSections: draft.promptSections.map((entry) => ({ title: entry.title, content: cut(entry.content), enabled: entry.enabled !== false })),
        greeting: cut(draft.greeting), alternateGreetings: draft.alternateGreetings.map(cut), authorNote: draft.authorNote, appearance: cut(draft.appearance ?? ''),
        engine: draft.engine, modelSlotId: draft.modelSlotId, lorebookIds: draft.lorebookIds, blockIds: draft.blockIds, isEnabled: draft.isEnabled,
      },
      // What a save card shows as the contents it will store.
      selected: { name: draft.name, tagline: draft.tagline, engine: draft.engine, modelSlotId: draft.modelSlotId, greeting: draft.greeting.slice(0, 200), appearance: (draft.appearance ?? '').slice(0, 200) },
      modelSlots: slots.map((slot) => ({ id: slot.id, label: slot.label, isDefault: slot.isDefault })),
      lorebooks: (lorebooks ?? []).map((book) => ({ id: book.id, name: book.name })),
      blocks: (blocks ?? []).map((block) => ({ id: block.id, name: block.name })),
      assets,
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('profile.section', t({ ko: '편집 항목 열기', en: 'Open editor section' }), t({ ko: '편집기의 항목(캐릭터·외형·모델·기억·도구·꾸미기)을 열어.', en: 'Open an editor section.' }), pageObject({ section: pageChoice(['character', 'appearance', 'model', 'memory', 'tools', 'look']) }, ['section'])),
      pageAction('profile.draft', t({ ko: '프로필 초안 채우기', en: 'Fill profile draft' }), t({ ko: '주어진 항목만 편집기 초안에 채워. 저장하지 않아. appearance는 이미지 프롬프트용 외형 태그야.', en: 'Fill only the given keys into the editor draft; nothing is saved. appearance is image-prompt tags for the look.' }), draftSchema),
      pageAction('profile.save', t({ ko: '프로필 저장', en: 'Save profile' }), t({ ko: '편집기의 현재 초안을 저장해.', en: 'Save the editor draft as it is.' }), pageObject({}), 'save'),
      ...(runs.preset ? [pageAction('profile.assets', t({ ko: '캐릭터 이미지 생성', en: 'Generate character images' }), t({ ko: '기준 이미지(reference)·배경(background)·표정(expressions, names는 assets.expressionNames 중에서)을 생성해. 새 프로필이면 먼저 저장되고, 빈 칸에는 첫 결과가 바로 들어가.', en: 'Generate the reference, background or expressions (names from assets.expressionNames). A new profile is saved first; empty slots take the first result.' }), pageObject({ kind: pageChoice(['reference', 'background', 'expressions']), names: pageArray(pageChoice(runs.emotionNames.length ? runs.emotionNames : ['-']), 32) }, ['kind']), 'save')] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      if (id === 'profile.section') { go(String(args.section) as ProfileEditorSection); return }
      if (id === 'profile.save') { await save(); return }
      if (id === 'profile.assets') {
        const kind = String(args.kind)
        if (kind === 'expressions') {
          const names = Array.isArray(args.names) && args.names.length ? args.names.map(String) : runs.emotionNames
          if (!names.length) throw new Error('생성할 표정 이름이 없어.')
          await runs.start({ kind: 'expressions', names }, true)
        } else await runs.start({ kind: kind as 'reference' | 'background' }, true)
        return
      }
      if (id !== 'profile.draft') throw new Error('프로필 편집기에 없는 작업이야.')
      const input = pageRecord(args)
      const keys = (Object.keys(input) as DraftKey[]).filter((key) => key in DRAFT_KEYS)
      if (!keys.length) throw new Error('채울 항목이 없어.')
      const before = draftRef.current
      const next: Partial<Draft> = {}
      for (const key of keys) {
        const value = input[key]
        ;(next as Record<string, unknown>)[key] = key === 'promptSections' && Array.isArray(value)
          ? value.map((entry) => ({ ...(entry as Record<string, unknown>), enabled: (entry as Record<string, unknown>).enabled !== false }))
          : value
      }
      setDraft((current) => ({ ...current, ...next }))
      setFilledValues((old) => { const map = new Map(old); keys.forEach((key) => map.set(key, JSON.stringify((next as Record<string, unknown>)[key]))); return map })
      const first = DRAFT_KEYS[keys[0]]
      if (first !== section) go(first)
      return {
        isCurrent: () => keys.every((key) => JSON.stringify(draftRef.current[key]) === JSON.stringify((next as Record<string, unknown>)[key])),
        restore: () => {
          setDraft((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, before[key]])) }))
          setFilledValues((old) => { const map = new Map(old); keys.forEach((key) => map.delete(key)); return map })
        },
      }
    },
  } : null)

  return assist
}
