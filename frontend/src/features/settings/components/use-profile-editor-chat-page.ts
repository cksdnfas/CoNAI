import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { CHAT_PROFILE_LIMITS, CHAT_PROFILE_TEXT_LIMITS, CHAT_TRANSLATION_LANGUAGES, type ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import type { ChatProfile, ModelSlot } from '@/lib/api-codex-chat'
import type { CharacterSetting } from '@/lib/api-character-library'
import { settingDraftOf } from '@/features/characters/character-library-shared'
import { enginePatch, judgePresetPatch, type Draft } from './chat-profile-editor-fields'
import { applyRoleChoice } from './chat-model-role-select'
import { BACKGROUND_SLOT, REFERENCE_SLOT, type AssetRuns } from './chat-profile-asset-runs'
import { newPromptSectionId } from './chat-profile-sections'
import type { ProfileCharacterLink } from './use-profile-character-link'

export type ProfileEditorSection = 'basic' | 'character' | 'appearance' | 'model' | 'memory' | 'tools' | 'look'

/**
 * Draft keys the chat may fill, and the section that shows each. Tool grants and access are never among them (tool
 * scopes and list, the page assistant switch, allowed groups, generation presets, agent use — which lets other profiles
 * call this one's tools); the agent description is.
 */
const DRAFT_KEYS = {
  name: 'basic', tagline: 'basic', systemPrompt: 'character', promptSections: 'character', greeting: 'character', alternateGreetings: 'character', authorNote: 'character',
  openingHistory: 'character', greetingPosition: 'character',
  appearance: 'appearance', engine: 'model', modelSlotId: 'model', lorebookIds: 'memory', blockIds: 'look', isEnabled: 'basic',
  temperature: 'model', maxTokens: 'model', contextTokens: 'model', reasoningBudgetTokens: 'model', visionEnabled: 'model', contentRatingMode: 'model', contentRatingTierId: 'model',
  summaryEnabled: 'model', summarySlotId: 'model', summaryTriggerTurns: 'model', summaryPrompt: 'model',
  translationSlotId: 'model', translationModelLanguage: 'model', translationDisplayLanguage: 'model', translationInstructions: 'model',
  suggestEnabled: 'model', suggestSlotId: 'model', suggestProfileId: 'model', judgePresetId: 'model', judgeSlotId: 'model',
  contextTurns: 'memory', loreRecursionDepth: 'memory', allowLoreProposals: 'memory', linkedFiles: 'memory',
  toolOutputLimit: 'tools', agentDescription: 'tools',
} as const satisfies Partial<Record<keyof Draft, ProfileEditorSection>>
type DraftKey = keyof typeof DRAFT_KEYS

/** Keys a page value of 0 clears (the action schema has no null): a role's model row, a picked id or an optional cap. */
const ZERO_CLEARS = new Set<DraftKey>(['summarySlotId', 'translationSlotId', 'suggestSlotId', 'judgeSlotId', 'judgePresetId', 'suggestProfileId', 'contentRatingTierId', 'contextTokens', 'maxTokens', 'reasoningBudgetTokens'])
const LANGUAGES = CHAT_TRANSLATION_LANGUAGES.map((language) => language.id)

/** A filled page value as the draft holds it: 0 (or −1 for temperature) for "unset", linked files with their write flag. */
function draftValue(key: DraftKey, value: ChatPageData, current: Draft): unknown {
  if (ZERO_CLEARS.has(key) && value === 0) return null
  if (key === 'contextTokens' && typeof value === 'number' && value < CHAT_PROFILE_LIMITS.contextTokens.min) {
    throw new Error(`contextTokens: 0 or ${CHAT_PROFILE_LIMITS.contextTokens.min}–${CHAT_PROFILE_LIMITS.contextTokens.max}`)
  }
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
export function useProfileEditorChatPage({ open, profile, draft, setDraft, dirty, section, go, slots, lorebooks, blocks, runs, link, save }: {
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
  runs: AssetRuns
  /** The library link; while synced the look (appearance, images, generation) is the setting's. */
  link: ProfileCharacterLink
  save: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const draftRef = useRef(draft)
  draftRef.current = draft
  // While synced (and loaded) the look read and filled here is the linked setting's draft.
  const look = link.synced && link.setting.ready ? link.setting.draft : draft
  const lookRuns = link.synced ? link.runs : runs
  const [filledValues, setFilledValues] = useState(new Map<DraftKey, string>())

  const assist = useMemo(() => {
    const filled = (key: keyof Draft) => {
      const value = filledValues.get(key as DraftKey)
      return value !== undefined && JSON.stringify(key === 'appearance' ? look.appearance : draft[key]) === value
    }
    return { filled, sectionFilled: (target: ProfileEditorSection) => (Object.keys(DRAFT_KEYS) as DraftKey[]).some((key) => DRAFT_KEYS[key] === target && filled(key)) }
  }, [draft, filledValues, look.appearance])

  const slotRuns = (key: string) => (key === BACKGROUND_SLOT ? runs : lookRuns)
  const assetKeys = [REFERENCE_SLOT, BACKGROUND_SLOT, ...lookRuns.emotionNames]
  const assets = {
    preset: lookRuns.preset?.name ?? null,
    hasReference: Boolean(look.referenceHash),
    hasAvatar: Boolean(look.avatarHash ?? (link.synced ? null : draft.avatar)),
    hasBackground: Boolean(draft.backgroundHash),
    expressionNames: lookRuns.emotionNames,
    slots: Object.fromEntries(assetKeys.map((key) => { const state = slotRuns(key).slotState(key); return [key, { working: state.working, failed: state.failed, candidates: state.candidates.length }] })),
  }
  // The synced profiles a change of the setting reaches (an overwrite's review card names them).
  const syncedProfiles = link.otherSyncedProfiles.slice(0, 50).map((entry) => entry.name)
  const characterLink = draft.characterLink
    ? { settingId: draft.characterLink.settingId, synced: draft.characterLink.synced, setting: link.label, linkedProfileCount: link.linkedCount, syncedProfiles, loaded: !draft.characterLink.synced || link.setting.ready }
    : null
  // Background stays the profile's (its own runs, also while synced); reference and expressions follow the look.
  const assetKinds = [...(lookRuns.preset ? ['reference'] : []), ...(runs.preset ? ['background'] : []), ...(lookRuns.preset ? ['expressions'] : [])]
  const linkSchema = {
    ...pageObject({ settingId: { ...pageNumber(0, undefined, true), description: '0 removes the link (the profile keeps its own look)' }, synced: { type: 'boolean', description: 'true (default): the look is the setting’s, edits reach every synced profile; false: an own copy remembering the origin' } }, ['settingId']),
    description: 'Character library setting the look links to',
  }
  const storeSchema = pageObject({
    mode: pageChoice(characterLink && !characterLink.synced ? ['create', 'overwrite'] : ['create']),
    folderId: { ...pageNumber(0, undefined, true), description: 'create: library folder id (0: top level)' },
    name: { ...pageText(CHAT_PROFILE_TEXT_LIMITS.name), description: 'create: the new setting’s name (default: the profile name)' },
  }, ['mode'])
  const ids = <T extends { id: number }>(items: T[] | undefined) => (items ?? []).map((item) => item.id)
  const draftSchema = pageObject({
    name: pageText(CHAT_PROFILE_TEXT_LIMITS.name), tagline: pageText(CHAT_PROFILE_TEXT_LIMITS.tagline), systemPrompt: pageText(CHAT_PROFILE_TEXT_LIMITS.text),
    promptSections: pageArray(pageObject({ id: pageText(100), title: pageText(CHAT_PROFILE_TEXT_LIMITS.sectionTitle), content: pageText(CHAT_PROFILE_TEXT_LIMITS.text), kind: pageChoice(['text', 'dialogue', 'post']), enabled: { type: 'boolean' } }, ['title', 'content']), CHAT_PROFILE_TEXT_LIMITS.sections),
    greeting: pageText(CHAT_PROFILE_TEXT_LIMITS.text), alternateGreetings: pageArray(pageText(CHAT_PROFILE_TEXT_LIMITS.text), CHAT_PROFILE_TEXT_LIMITS.alternateGreetings), authorNote: pageText(CHAT_PROFILE_TEXT_LIMITS.authorNote), appearance: pageText(CHAT_PROFILE_TEXT_LIMITS.text),
    openingHistory: { ...pageArray(pageObject({ role: pageChoice(['user', 'assistant']), content: pageText(CHAT_PROFILE_TEXT_LIMITS.text) }, ['role', 'content']), CHAT_PROFILE_TEXT_LIMITS.openingHistory), description: 'Saved as real messages at the start of every new chat' },
    greetingPosition: { ...pageNumber(0, CHAT_PROFILE_TEXT_LIMITS.openingHistory, true), description: 'openingHistory messages before the greeting' },
    engine: pageChoice(['llm', 'codex', 'claude']),
    ...(slots.length ? { modelSlotId: pageChoice(slots.map((slot) => slot.id)) } : {}),
    ...(lorebooks?.length ? { lorebookIds: pageArray(pageChoice(ids(lorebooks)), 20) } : {}),
    ...(blocks?.length ? { blockIds: pageArray(pageChoice(ids(blocks)), 20) } : {}),
    isEnabled: { type: 'boolean' },
    temperature: { ...pageNumber(-1, CHAT_PROFILE_LIMITS.temperature.max), description: '-1: default' },
    maxTokens: { ...pageNumber(0, CHAT_PROFILE_LIMITS.maxTokens.max, true), description: '0: default; a ceiling, cut to the room left' },
    contextTokens: { ...pageNumber(0, CHAT_PROFILE_LIMITS.contextTokens.max, true), description: `Max context (API LLM, direct and pi). 0: the server's own size (no token cap when it does not say); otherwise at least ${CHAT_PROFILE_LIMITS.contextTokens.min}, and the smaller of it and the server's size counts` },
    reasoningBudgetTokens: { ...pageNumber(0, undefined, true), description: '0: not sent. API LLM reasoning_budget_tokens, Claude Code thinking budget' },
    visionEnabled: { type: 'boolean' },
    contentRatingMode: pageChoice(['model', 'custom']),
    contentRatingTierId: { ...pageNumber(0, undefined, true), description: '0: none' },
    summaryEnabled: { type: 'boolean' },
    ...(slots.length ? {
      summarySlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: summary representative model (follows chat when unset)' },
      translationSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: off' },
      suggestSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: suggestions representative model (follows chat when unset)' },
      judgeSlotId: { ...pageChoice([0, ...slots.map((slot) => slot.id)]), description: '0: preset\'s' },
    } : {}),
    summaryTriggerTurns: pageNumber(CHAT_PROFILE_LIMITS.summaryTriggerTurns.min, CHAT_PROFILE_LIMITS.summaryTriggerTurns.max, true),
    summaryPrompt: pageText(CHAT_PROFILE_TEXT_LIMITS.summaryPrompt),
    translationModelLanguage: pageChoice(LANGUAGES),
    translationDisplayLanguage: pageChoice(LANGUAGES),
    translationInstructions: pageText(CHAT_PROFILE_TEXT_LIMITS.translationInstructions),
    suggestEnabled: { type: 'boolean' },
    suggestProfileId: { ...pageNumber(0, undefined, true), description: '0: none' },
    judgePresetId: { ...pageNumber(0, undefined, true), description: '0: none' },
    contextTurns: pageNumber(CHAT_PROFILE_LIMITS.contextTurns.min, CHAT_PROFILE_LIMITS.contextTurns.max, true),
    loreRecursionDepth: { ...pageNumber(CHAT_PROFILE_LIMITS.loreRecursionDepth.min, CHAT_PROFILE_LIMITS.loreRecursionDepth.max, true), description: '0: off' },
    allowLoreProposals: { type: 'boolean' },
    linkedFiles: pageArray(pageObject({ id: pageText(32), write: { type: 'boolean' } }, ['id']), 20),
    toolOutputLimit: pageNumber(CHAT_PROFILE_LIMITS.toolOutputLimit.min, CHAT_PROFILE_LIMITS.toolOutputLimit.max, true),
    agentDescription: { ...pageText(CHAT_PROFILE_TEXT_LIMITS.agentDescription), description: 'What it can do and when to call it (used while agentEnabled, which the user turns on)' },
    ...(link.canView ? { characterLink: linkSchema } : {}),
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
        greeting: cut(draft.greeting), alternateGreetings: draft.alternateGreetings.map(cut), authorNote: draft.authorNote, appearance: cut(look.appearance ?? ''),
        characterLink,
        openingHistory: draft.openingHistory.map((message) => ({ role: message.role, content: cut(message.content) })), greetingPosition: draft.greetingPosition,
        engine: draft.engine, modelSlotId: draft.modelSlotId, lorebookIds: draft.lorebookIds, blockIds: draft.blockIds, isEnabled: draft.isEnabled,
        temperature: draft.temperature, maxTokens: draft.maxTokens, contextTokens: draft.contextTokens, reasoningBudgetTokens: draft.reasoningBudgetTokens, visionEnabled: draft.visionEnabled, contentRatingMode: draft.contentRatingMode, contentRatingTierId: draft.contentRatingTierId,
        summaryEnabled: draft.summaryEnabled, summarySlotId: draft.summarySlotId, summaryTriggerTurns: draft.summaryTriggerTurns, summaryPrompt: brief(draft.summaryPrompt),
        translationSlotId: draft.translationSlotId, translationModelLanguage: draft.translationModelLanguage, translationDisplayLanguage: draft.translationDisplayLanguage, translationInstructions: brief(draft.translationInstructions),
        suggestEnabled: draft.suggestEnabled, suggestSlotId: draft.suggestSlotId, suggestProfileId: draft.suggestProfileId, judgePresetId: draft.judgePresetId, judgeSlotId: draft.judgeSlotId,
        contextTurns: draft.contextTurns, loreRecursionDepth: draft.loreRecursionDepth, allowLoreProposals: draft.allowLoreProposals,
        linkedFiles: draft.linkedFiles.map((link) => ({ id: link.id, write: link.write })), toolOutputLimit: draft.toolOutputLimit,
        agentEnabled: draft.agentEnabled, agentDescription: draft.agentDescription,
        // Grants (and agent use) stay manual. Engine fills above use the editor's engine switch patch.
        pageAssist: draft.pageAssist,
      },
      // What a save card shows as the contents it will store.
      selected: { name: draft.name, tagline: draft.tagline, engine: draft.engine, modelSlotId: draft.modelSlotId, greeting: draft.greeting.slice(0, 200), appearance: (look.appearance ?? '').slice(0, 200), characterLink },
      modelSlots: slots.map((slot) => ({ id: slot.id, label: slot.label, ...(slot.kind === 'route' ? { reaches: slot.model || null } : {}), ...(slot.isDefault ? { isDefault: true } : {}) })),
      lorebooks: (lorebooks ?? []).map((book) => ({ id: book.id, name: book.name })),
      blocks: (blocks ?? []).map((block) => ({ id: block.id, name: block.name })),
      assets,
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('profile.section', t({ ko: '편집 항목 열기', en: 'Open editor section' }), t({ ko: '편집기의 항목(기본 정보·캐릭터·외형·모델·기억·도구·꾸미기)을 열어.', en: 'Open an editor section.' }), pageObject({ section: pageChoice(['basic', 'character', 'appearance', 'model', 'memory', 'tools', 'look']) }, ['section'])),
      pageAction('profile.draft', t({ ko: '프로필 초안 채우기', en: 'Fill profile draft' }), t({ ko: '주어진 항목만 편집기 초안에 채워. 저장하지 않아. appearance는 이미지 프롬프트용 외형 태그야.', en: 'Fill only the given keys into the editor draft; nothing is saved. appearance is image-prompt tags for the look.' }), draftSchema),
      pageAction('profile.save', t({ ko: '프로필 저장', en: 'Save profile' }), t({ ko: '편집기의 현재 초안을 저장해.', en: 'Save the editor draft as it is.' }), pageObject({}), 'save'),
      ...(link.canEdit && !characterLink?.synced ? [pageAction('profile.character_save', t({ ko: '외형을 라이브러리에 저장', en: 'Store look in library' }), t({ ko: '편집기의 지금 외형(외형 태그·기준 이미지·아바타)을 캐릭터 라이브러리에 저장하고 프로필을 그 설정과 동기화해. create는 새 설정(folderId·name), overwrite는 동기화가 끊긴 원본에 덮어써(그 설정과 동기화 중인 프로필도 바뀌어). 새 프로필이면 먼저 저장돼.', en: 'Store the editor’s current look in the character library and sync the profile to it: create makes a new setting (folderId, name); overwrite writes over the detached origin (its synced profiles change too). A new profile is saved first.' }), storeSchema, 'save')] : []),
      ...(assetKinds.length ? [pageAction('profile.assets', t({ ko: '캐릭터 이미지 생성', en: 'Generate character images' }), t({ ko: '기준 이미지(reference)·배경(background)·표정(expressions, names는 assets.expressionNames 중에서)을 생성해. 새 프로필이면 먼저 저장되고, 빈 칸에는 첫 결과가 바로 들어가.', en: 'Generate the reference, background or expressions (names from assets.expressionNames). A new profile is saved first; empty slots take the first result.' }), pageObject({ kind: pageChoice(assetKinds), names: pageArray(pageChoice(lookRuns.emotionNames.length ? lookRuns.emotionNames : ['-']), 32) }, ['kind']), 'save')] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      if (id === 'profile.section') { go(String(args.section) as ProfileEditorSection); return }
      if (id === 'profile.save') { await save(); return }
      if (id === 'profile.character_save') {
        const mode = String(args.mode)
        if (mode === 'overwrite') await link.store({ mode: 'overwrite' })
        else await link.store({ mode: 'create', folderId: Number(args.folderId) > 0 ? Number(args.folderId) : null, name: String(args.name ?? '').trim() || draftRef.current.name })
        return
      }
      if (id === 'profile.assets') {
        const kind = String(args.kind)
        if (!assetKinds.includes(kind)) throw new Error('이 이미지를 만들 수 있는 생성 프리셋이 없어.')
        if (link.synced && !link.setting.ready && kind !== 'background') throw new Error('연결된 외형 설정을 아직 불러오는 중이야. 잠시 뒤 다시 해줘.')
        if (kind === 'expressions') {
          const names = Array.isArray(args.names) && args.names.length ? args.names.map(String) : lookRuns.emotionNames
          if (!names.length) throw new Error('생성할 표정 이름이 없어.')
          await lookRuns.start({ kind: 'expressions', names }, true)
        } else await slotRuns(kind === 'background' ? BACKGROUND_SLOT : REFERENCE_SLOT).start({ kind: kind as 'reference' | 'background' }, true)
        return
      }
      if (id !== 'profile.draft') throw new Error('프로필 편집기에 없는 작업이야.')
      const input = pageRecord(args)
      const before = draftRef.current
      const beforeLink = before.characterLink
      // The synced setting's draft as it was (an undo of a link change brings back its unsaved edits).
      const settingBase = link.setting.baseRef.current
      const settingSnapshot = beforeLink?.synced && settingBase?.id === beforeLink.settingId ? { base: settingBase, draft: link.setting.draftRef.current } : null
      // The link first: a synced link's look is the setting's, which then takes a filled appearance.
      let linkChange: Partial<Draft> | null = null
      let primed: CharacterSetting | null = null
      if (input.characterLink !== undefined && link.canView) {
        const raw = input.characterLink === null ? null : pageRecord(input.characterLink)
        const next = raw && Number(raw.settingId) > 0 ? { settingId: Number(raw.settingId), synced: raw.synced !== false } : null
        if (link.dirty && beforeLink && next && next.settingId !== beforeLink.settingId) {
          throw new Error('연결된 외형 설정에 저장 안 한 변경이 있어. 다른 설정으로 바꾸면 사라지니 먼저 저장하거나 사람이 직접 바꾸게 해줘.')
        }
        if (next) primed = await link.prime(next.settingId)
        assertCurrent()
        linkChange = link.linkPatch(next, primed)
      }
      const resultLink = linkChange ? linkChange.characterLink ?? null : beforeLink
      // The link's setting changes (synced to another one, or no longer synced): the setting editor reloads.
      const settingSwitched = linkChange !== null && !(resultLink?.synced && beforeLink?.synced && resultLink.settingId === beforeLink.settingId)
      const settingAppearance = input.appearance !== undefined && Boolean(resultLink?.synced)
      if (settingAppearance && !link.canEdit) throw new Error('라이브러리 편집 권한이 없어서 동기화 중인 외형은 고칠 수 없어.')
      if (settingAppearance && !(link.synced && link.setting.ready && resultLink?.settingId === link.link?.settingId)) {
        throw new Error('새로 연결한 외형 설정은 불러온 뒤에 appearance를 채워줘 (그 설정의 초안에 들어가).')
      }
      const keys = (Object.keys(input) as DraftKey[]).filter((key) => key in DRAFT_KEYS && !(settingAppearance && key === 'appearance'))
      if (!keys.length && !linkChange && !settingAppearance) throw new Error('채울 항목이 없어.')
      const filled: Partial<Draft> = { ...linkChange }
      for (const key of keys) (filled as Record<string, unknown>)[key] = draftValue(key, input[key], before)
      const settingBefore = link.setting.draftRef.current.appearance
      const settingValue = settingAppearance ? String(input.appearance) : null
      if (settingValue !== null) link.setting.patch({ appearance: settingValue })
      // The setting draft right after this fill, when the fill touched it: a later edit there ends the undo.
      const settingAfter = !resultLink?.synced || (!linkChange && settingValue === null) ? null
        : settingSwitched ? (primed ? settingDraftOf(primed) : null)
          : { ...link.setting.draftRef.current, ...(settingValue !== null ? { appearance: settingValue } : {}) }
      const next: Partial<Draft> = { ...(filled.engine ? enginePatch(filled.engine, before) : {}), ...filled }
      if (keys.includes('suggestProfileId')) {
        Object.assign(next, filled.suggestProfileId == null ? { suggestProfileId: null } : applyRoleChoice('suggest', `profile:${filled.suggestProfileId}`))
      }
      // Explicit model slots win over a writer in the same fill.
      for (const [key, role] of [['modelSlotId', 'chat'], ['summarySlotId', 'summary'], ['translationSlotId', 'translation'], ['suggestSlotId', 'suggest']] as const) {
        if (!keys.includes(key)) continue
        // `suggestSlotId: 0/null` is what page data shows while a writer is active: it never replaces the writer just set.
        if (key === 'suggestSlotId' && filled.suggestSlotId == null && filled.suggestProfileId != null) continue
        Object.assign(next, applyRoleChoice(role, filled[key] == null ? (role === 'translation' ? 'off' : 'inherit') : `slot:${filled[key]}`))
      }
      if (keys.includes('judgePresetId')) Object.assign(next, judgePresetPatch(filled.judgePresetId ?? null))
      // Explicit enabled flags win when a fill also picks a source; source pairings own all other dependent fields.
      for (const key of ['summaryEnabled', 'suggestEnabled'] as const) {
        if (keys.includes(key)) next[key] = filled[key]
      }
      const changedKeys = Object.keys(next) as (keyof Draft)[]
      setDraft((current) => ({ ...current, ...next }))
      setFilledValues((old) => {
        const map = new Map(old)
        keys.forEach((key) => map.set(key, JSON.stringify(next[key])))
        if (settingValue !== null) map.set('appearance', JSON.stringify(settingValue))
        return map
      })
      const first = keys.length ? DRAFT_KEYS[keys[0]] : 'appearance'
      if (first !== section) go(first)
      return {
        isCurrent: () => changedKeys.every((key) => JSON.stringify(draftRef.current[key]) === JSON.stringify(next[key]))
          && (settingAfter === null || JSON.stringify(link.setting.draftRef.current) === JSON.stringify(settingAfter)),
        restore: () => {
          // Back to the setting the profile was synced to: its editor reloads it from the draft it had.
          if (settingSwitched && settingSnapshot) link.setting.seed(settingSnapshot.base, settingSnapshot.draft)
          else if (settingValue !== null) link.setting.patch({ appearance: settingBefore })
          setDraft((current) => ({ ...current, ...Object.fromEntries(changedKeys.map((key) => [key, before[key]])) }))
          setFilledValues((old) => { const map = new Map(old); keys.forEach((key) => map.delete(key)); if (settingValue !== null) map.delete('appearance'); return map })
        },
      }
    },
  } : null)

  return assist
}
