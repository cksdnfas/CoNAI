import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { CHAT_TRANSLATION_LANGUAGES, type ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import type { ChatProfile, ModelSlot } from '@/lib/api-codex-chat'
import type { Draft } from './chat-profile-editor-fields'
import { BACKGROUND_SLOT, REFERENCE_SLOT, type ProfileAssetRuns } from './chat-profile-asset-runs'
import { newPromptSectionId } from './chat-profile-sections'

export type ProfileEditorSection = 'character' | 'appearance' | 'model' | 'memory' | 'tools' | 'look'

/**
 * Draft keys the chat may fill, and the section that shows each. Tool grants and access are never among them (tool
 * scopes and list, the page assistant switch, allowed groups, generation presets).
 */
const DRAFT_KEYS = {
  name: 'character', tagline: 'character', systemPrompt: 'character', promptSections: 'character', greeting: 'character', alternateGreetings: 'character', authorNote: 'character',
  openingHistory: 'character', greetingPosition: 'character',
  appearance: 'appearance', engine: 'model', modelSlotId: 'model', lorebookIds: 'memory', blockIds: 'look', isEnabled: 'character',
  temperature: 'model', maxTokens: 'model', visionEnabled: 'model', contentRatingMode: 'model', contentRatingTierId: 'model',
  summaryEnabled: 'model', summarySlotId: 'model', summaryTriggerTurns: 'model', summaryPrompt: 'model',
  translationSlotId: 'model', translationModelLanguage: 'model', translationDisplayLanguage: 'model', translationInstructions: 'model',
  suggestEnabled: 'model', suggestSlotId: 'model', suggestProfileId: 'model', judgePresetId: 'model', judgeSlotId: 'model',
  contextTurns: 'memory', contextTokens: 'memory', loreRecursionDepth: 'memory', allowLoreProposals: 'memory', linkedFiles: 'memory',
  maxToolRounds: 'tools', toolOutputLimit: 'tools',
} as const satisfies Partial<Record<keyof Draft, ProfileEditorSection>>
type DraftKey = keyof typeof DRAFT_KEYS

/** Keys a page value of 0 clears (the action schema has no null): a role's model row, a picked id or an optional cap. */
const ZERO_CLEARS = new Set<DraftKey>(['summarySlotId', 'translationSlotId', 'suggestSlotId', 'judgeSlotId', 'judgePresetId', 'suggestProfileId', 'contentRatingTierId', 'contextTokens', 'maxTokens'])
const LANGUAGES = CHAT_TRANSLATION_LANGUAGES.map((language) => language.id)

/** A filled page value as the draft holds it: 0 (or −1 for temperature) for "unset", linked files with their write flag. */
function draftValue(key: DraftKey, value: ChatPageData, current: Draft): unknown {
  if (ZERO_CLEARS.has(key) && value === 0) return null
  if (key === 'temperature' && typeof value === 'number' && value < 0) return null
  if (key === 'linkedFiles' && Array.isArray(value)) return value.map((entry) => ({ id: String((entry as Record<string, unknown>).id), write: (entry as Record<string, unknown>).write === true }))
  if (key === 'promptSections' && Array.isArray(value)) {
    // The whole array is resent to change one section: an entry keeps what it leaves out from the section with its id,
    // and content that is still the cut read-out keeps the full text. A repeated id gets a new one.
    const byId = new Map(current.promptSections.map((section) => [section.id, section]))
    const seen = new Set<string>()
    return value.map((entry) => {
      const section = entry as Record<string, unknown>
      const id = typeof section.id === 'string' && section.id && !seen.has(section.id) ? section.id : newPromptSectionId()
      seen.add(id)
      const existing = byId.get(id)
      const kind = section.kind === 'text' || section.kind === 'dialogue' || section.kind === 'post' ? section.kind : existing?.kind ?? 'text'
      const content = existing && section.content === cut(existing.content) ? existing.content : section.content
      return { ...section, id, kind, content, enabled: section.enabled !== false }
    })
  }
  if (key === 'openingHistory' && Array.isArray(value)) {
    // Resent whole like the sections: a message whose content is still the cut read-out keeps the full text in its place.
    return value.map((entry, index) => {
      const message = entry as Record<string, unknown>
      const existing = current.openingHistory[index]
      const content = existing && message.content === cut(existing.content) ? existing.content : String(message.content ?? '')
      return { role: message.role === 'user' ? 'user' : 'assistant', content }
    })
  }
  return value
}

/** Long texts are cut for reading only; the model writes them whole through profile.draft. */
const READ_TEXT = 6000
const cut = (value: string) => (value.length > READ_TEXT ? `${value.slice(0, READ_TEXT)}… (${value.length}자)` : value)
/** Settings prose rides every request while the editor is connected: only its start is shown. */
const brief = (value: string) => (value.length > 300 ? `${value.slice(0, 300)}… (${value.length}자)` : value)

/** Which draft keys still hold what the chat filled; a manual edit clears the mark. */
export const ProfileAssistContext = createContext<{ filled: (key: keyof Draft) => boolean; sectionFilled: (section: ProfileEditorSection) => boolean }>({ filled: () => false, sectionFilled: () => false })
export const useProfileAssist = () => useContext(ProfileAssistContext)
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
    promptSections: pageArray(pageObject({ id: pageText(100), title: pageText(80), content: pageText(20000), kind: pageChoice(['text', 'dialogue', 'post']), enabled: { type: 'boolean' } }, ['title', 'content']), 30),
    greeting: pageText(20000), alternateGreetings: pageArray(pageText(20000), 100), authorNote: pageText(4000), appearance: pageText(20000),
    openingHistory: { ...pageArray(pageObject({ role: pageChoice(['user', 'assistant']), content: pageText(20000) }, ['role', 'content']), 100), description: 'Saved as real messages at the start of every new chat' },
    greetingPosition: { ...pageNumber(0, 100, true), description: 'openingHistory messages before the greeting' },
    engine: pageChoice(['llm', 'codex', 'claude']),
    ...(slots.length ? { modelSlotId: pageChoice(slots.map((slot) => slot.id)) } : {}),
    ...(lorebooks?.length ? { lorebookIds: pageArray(pageChoice(ids(lorebooks)), 20) } : {}),
    ...(blocks?.length ? { blockIds: pageArray(pageChoice(ids(blocks)), 20) } : {}),
    isEnabled: { type: 'boolean' },
    temperature: { ...pageNumber(-1, 2), description: '-1: default' },
    maxTokens: { ...pageNumber(0, 1_000_000, true), description: '0: default' },
    visionEnabled: { type: 'boolean' },
    contentRatingMode: pageChoice(['model', 'custom']),
    contentRatingTierId: { ...pageNumber(0, undefined, true), description: '0: none' },
    summaryEnabled: { type: 'boolean' },
    ...(slots.length ? {
      summarySlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: chat model' },
      translationSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: off' },
      suggestSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: chat model' },
      judgeSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: preset\'s' },
    } : {}),
    summaryTriggerTurns: pageNumber(1, 200, true),
    summaryPrompt: pageText(4000),
    translationModelLanguage: pageChoice(LANGUAGES),
    translationDisplayLanguage: pageChoice(LANGUAGES),
    translationInstructions: pageText(4000),
    suggestEnabled: { type: 'boolean' },
    suggestProfileId: { ...pageNumber(0, undefined, true), description: '0: none' },
    judgePresetId: { ...pageNumber(0, undefined, true), description: '0: none' },
    contextTurns: pageNumber(1, 200, true),
    contextTokens: { ...pageNumber(0, 4_000_000, true), description: '0: none' },
    loreRecursionDepth: { ...pageNumber(0, 5, true), description: '0: off' },
    allowLoreProposals: { type: 'boolean' },
    linkedFiles: pageArray(pageObject({ id: pageText(32), write: { type: 'boolean' } }, ['id']), 20),
    maxToolRounds: pageNumber(1, 20, true),
    toolOutputLimit: pageNumber(500, 100_000, true),
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
        promptSections: draft.promptSections.map((entry) => ({ id: entry.id, title: entry.title, content: cut(entry.content), kind: entry.kind, enabled: entry.enabled !== false })),
        greeting: cut(draft.greeting), alternateGreetings: draft.alternateGreetings.map(cut), authorNote: draft.authorNote, appearance: cut(draft.appearance ?? ''),
        openingHistory: draft.openingHistory.map((message) => ({ role: message.role, content: cut(message.content) })), greetingPosition: draft.greetingPosition,
        engine: draft.engine, modelSlotId: draft.modelSlotId, lorebookIds: draft.lorebookIds, blockIds: draft.blockIds, isEnabled: draft.isEnabled,
        temperature: draft.temperature, maxTokens: draft.maxTokens, visionEnabled: draft.visionEnabled, contentRatingMode: draft.contentRatingMode, contentRatingTierId: draft.contentRatingTierId,
        summaryEnabled: draft.summaryEnabled, summarySlotId: draft.summarySlotId, summaryTriggerTurns: draft.summaryTriggerTurns, summaryPrompt: brief(draft.summaryPrompt),
        translationSlotId: draft.translationSlotId, translationModelLanguage: draft.translationModelLanguage, translationDisplayLanguage: draft.translationDisplayLanguage, translationInstructions: brief(draft.translationInstructions),
        suggestEnabled: draft.suggestEnabled, suggestSlotId: draft.suggestSlotId, suggestProfileId: draft.suggestProfileId, judgePresetId: draft.judgePresetId, judgeSlotId: draft.judgeSlotId,
        contextTurns: draft.contextTurns, contextTokens: draft.contextTokens, loreRecursionDepth: draft.loreRecursionDepth, allowLoreProposals: draft.allowLoreProposals,
        linkedFiles: draft.linkedFiles.map((link) => ({ id: link.id, write: link.write })), maxToolRounds: draft.maxToolRounds, toolOutputLimit: draft.toolOutputLimit,
        // Set by hand in the editor, never filled: the engine above, and these grants.
        pageAssist: draft.pageAssist,
      },
      // What a save card shows as the contents it will store.
      selected: { name: draft.name, tagline: draft.tagline, engine: draft.engine, modelSlotId: draft.modelSlotId, greeting: draft.greeting.slice(0, 200), appearance: (draft.appearance ?? '').slice(0, 200) },
      modelSlots: slots.map((slot) => ({ id: slot.id, label: slot.label, ...(slot.kind === 'route' ? { reaches: slot.model || null } : {}), ...(slot.isDefault ? { isDefault: true } : {}) })),
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
      for (const key of keys) (next as Record<string, unknown>)[key] = draftValue(key, input[key], before)
      // The editor's own pairings: no judge preset leaves no judge model; a suggesting chat profile replaces a user profile.
      if (keys.includes('judgePresetId') && next.judgePresetId === null && !keys.includes('judgeSlotId')) { next.judgeSlotId = null; keys.push('judgeSlotId') }
      const extra: Partial<Draft> = keys.includes('suggestProfileId') && next.suggestProfileId != null ? { suggestUserProfileId: null } : {}
      setDraft((current) => ({ ...current, ...next, ...extra }))
      setFilledValues((old) => { const map = new Map(old); keys.forEach((key) => map.set(key, JSON.stringify((next as Record<string, unknown>)[key]))); return map })
      const first = DRAFT_KEYS[keys[0]]
      if (first !== section) go(first)
      return {
        isCurrent: () => keys.every((key) => JSON.stringify(draftRef.current[key]) === JSON.stringify((next as Record<string, unknown>)[key])),
        restore: () => {
          setDraft((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, before[key]])), ...('suggestUserProfileId' in extra ? { suggestUserProfileId: before.suggestUserProfileId } : {}) }))
          setFilledValues((old) => { const map = new Map(old); keys.forEach((key) => map.delete(key)); return map })
        },
      }
    },
  } : null)

  return assist
}
