import { useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { CHAT_SKILL_LIMITS, chatPageActionAllowed, normalizeSkillSectionPath, skillSectionGroup, skillSectionPathKey, type ChatPageData, type ChatPageField, type ChatPageValue } from '@conai/shared'
import type { WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageFreeText, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { ChatSkill } from '@/lib/api-codex-chat'
import { insertSection, newSectionKey, sectionPathKey, type SectionDraft, type SectionProblem, type SkillDraft } from './chat-skill-draft'
import { useSettingsEditorChatPage } from './use-settings-editor-chat-page'

/** A page field holds at most 8000 characters per string; longer text goes as consecutive parts. */
const FIELD_TEXT = 8000
/** Section text in `data.sections`; `data.openSection` carries all of the open one. */
const DATA_CONTENT = 1000
/** Above the settings editors (20): the skill editor also opens on top of a generation preset or profile editor. */
const SKILL_EDITOR_PRIORITY = 25

/** `section` is the section path: "path" is a refused MCP argument name (server file paths). */
type SectionChange = { action: 'add' | 'update' | 'remove'; section: string; newPath?: string; title?: string; summary?: string; content?: string }

/** A section path as saved, or an error naming what was given. */
function validPath(value: string) {
  const path = normalizeSkillSectionPath(value)
  if (path === null) throw new Error(`${value}: 섹션 경로는 "이름" 또는 "그룹/이름"이야 (글자·숫자로 시작, 글자·숫자·.·_·-).`)
  return path
}

/** Applies section changes in order the way the server files them; the open item follows the last one touched. */
function applySectionChanges(draft: SkillDraft, pane: string, changes: SectionChange[]) {
  let sections = draft.sections
  let target = pane
  const indexOf = (path: string, except?: string) => sections.findIndex((section) => section.key !== except && sectionPathKey(section) === skillSectionPathKey(path))
  for (const change of changes) {
    const path = validPath(change.section)
    const index = indexOf(path)
    if (change.action === 'add') {
      if (index >= 0) throw new Error(`${path}: 이미 있는 섹션이야. update로 고쳐.`)
      if (sections.length >= CHAT_SKILL_LIMITS.sections) throw new Error(`섹션은 ${CHAT_SKILL_LIMITS.sections}개까지야.`)
      const added: SectionDraft = { key: newSectionKey(), savedPath: null, path, title: change.title ?? '', summary: change.summary ?? '', content: change.content ?? '' }
      sections = insertSection(sections, added)
      target = `section:${added.key}`
      continue
    }
    if (index < 0) throw new Error(`${path}: 그 경로의 섹션이 없어.`)
    const section = sections[index]
    if (change.action === 'remove') {
      sections = sections.filter((other) => other.key !== section.key)
      if (target === `section:${section.key}`) target = 'overview'
      continue
    }
    const renamed = change.newPath === undefined ? section.path : validPath(change.newPath)
    if (change.newPath !== undefined && indexOf(renamed, section.key) >= 0) throw new Error(`${renamed}: 같은 경로의 섹션이 이미 있어.`)
    const updated: SectionDraft = {
      ...section, path: renamed,
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.summary !== undefined ? { summary: change.summary } : {}),
      ...(change.content !== undefined ? { content: change.content } : {}),
    }
    const moved = skillSectionPathKey(skillSectionGroup(renamed) ?? '') !== skillSectionPathKey(skillSectionGroup(section.path.trim()) ?? '')
    sections = moved ? insertSection(sections.filter((other) => other.key !== section.key), updated) : sections.map((other) => (other.key === section.key ? updated : other))
    target = `section:${section.key}`
  }
  return { draft: { ...draft, sections }, pane: target }
}

function fieldText(value: string): ChatPageValue {
  if (value.length <= FIELD_TEXT) return value
  const parts: string[] = []
  for (let start = 0; start < value.length; start += FIELD_TEXT) parts.push(value.slice(start, start + FIELD_TEXT))
  return parts
}
const patchText = (value: ChatPageValue) => (Array.isArray(value) ? value.join('') : String(value))

/**
 * Registers the open skill editor with a connected chat where it can be saved from. The overview fields are plain
 * fields; `section` opens an item (also read-only, so the chat can read a whole section in `data.openSection`).
 * Sections are added, changed and removed by path with `skill.sections`, undone as one step. All of it is a draft;
 * saving is the `resource.save` review card.
 */
export function useSkillEditorChatPage({ open, skill, draft, setDraft, problems, guidedBy, brokenGuides, pane, setPane, readOnly, dirty, save }: {
  open: boolean
  skill: ChatSkill | null
  draft: SkillDraft
  setDraft: (draft: SkillDraft) => void
  problems: Map<string, SectionProblem | null>
  /** Generation presets whose guide is the saved section at `path` (or its group). */
  guidedBy: (path: string | null) => string[]
  /** Saved guide sections the draft renamed or removed, with the presets whose guide that breaks. */
  brokenGuides: Array<{ path: string; change: 'renamed' | 'removed'; presets: string[] }>
  /** `overview`, `section:<key>`, or a check pane. */
  pane: string
  setPane: (pane: string) => void
  readOnly: boolean
  dirty: boolean
  save?: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const current = useRef({ draft, pane })
  current.current = { draft, pane }
  const openSection = pane.startsWith('section:') ? draft.sections.find((section) => `section:${section.key}` === pane) : undefined
  const locked = readOnly ? { editable: false as const } : {}
  const fields: ChatPageField[] = [
    { id: 'name', label: t({ ko: '이름 (use_skill이 부르는 이름)', en: 'Name (what use_skill is called with)' }), type: 'text', value: draft.name, ...locked },
    { id: 'description', label: t({ ko: '언제 쓰는지 (시스템 프롬프트에 항상 들어감)', en: 'When to use (always in the system prompt)' }), type: 'text', value: draft.description, ...locked },
    { id: 'category', label: t({ ko: '분류 (목록 묶음)', en: 'Category (list grouping)' }), type: 'text', value: draft.category, ...locked },
    { id: 'instructions', label: t({ ko: '개요 (use_skill 첫 결과, 아래에 섹션 목차가 붙음)', en: 'Overview (use_skill first result, the section table follows)' }), type: 'text', value: fieldText(draft.instructions), ...locked },
    { id: 'section', label: t({ ko: '열린 항목 (빈 값 = 개요, 아니면 섹션 경로; 열린 섹션 전체는 data.openSection)', en: 'Open item (empty = overview, else a section path; the whole open section is data.openSection)' }), type: 'text', value: openSection?.path ?? '', viewOnly: true },
  ]

  const sectionsAction = pageAction('skill.sections', t({ ko: '스킬 섹션 고치기', en: 'Edit skill sections' }), t({ ko: '섹션 경로("이름" 또는 "그룹/이름")로 차례대로 add/update(바꿀 것만, newPath는 경로 변경)/remove 해. 저장하지 않아. summary는 목차의 "언제 읽는지" 한 줄, content는 use_skill이 돌려주는 본문. data.sections에 guidedBy가 있는 섹션을 옮기거나 지우면 저장 시 그 생성 프리셋의 가이드가 끊겨(data.brokenGuides). 먼저 물어봐.', en: 'Add, update (only what changes; newPath renames) or remove sections by path ("name" or "group/name"), in order; nothing is saved. summary is the one-line "when to read it" in the table, content what use_skill returns. Renaming or removing a section with guidedBy in data.sections breaks those generation presets\' guides on save (data.brokenGuides); ask first.' }), pageObject({
    changes: pageArray(pageObject({
      action: pageChoice(['add', 'update', 'remove']),
      section: pageText(CHAT_SKILL_LIMITS.sectionPath),
      newPath: pageText(CHAT_SKILL_LIMITS.sectionPath),
      title: pageText(CHAT_SKILL_LIMITS.sectionTitle),
      summary: pageText(CHAT_SKILL_LIMITS.sectionSummary),
      content: pageText(CHAT_SKILL_LIMITS.sectionContent),
    }, ['action', 'section']), CHAT_SKILL_LIMITS.sections, 1),
  }, ['changes']))

  useSettingsEditorChatPage({
    // A proposal card opens this editor on the chat page too, where settings editors are not connected.
    open: open && chatPageActionAllowed(pathname, 'resource.save'),
    priority: SKILL_EDITOR_PRIORITY,
    dirty, fields,
    title: skill ? t({ ko: '스킬 편집 · {name}', en: 'Edit skill · {name}' }, { name: skill.name }) : t({ ko: '스킬 추가', en: 'Add skill' }),
    resourceId: `skill:${skill?.id ?? 'new'}`,
    data: {
      skill: { id: skill?.id ?? null, revision: skill?.revision ?? null, source: skill?.source ?? 'user', readOnly, sectionLimit: CHAT_SKILL_LIMITS.sections },
      sections: draft.sections.map((section) => ({
        path: section.path, title: section.title, summary: section.summary, length: section.content.length,
        content: pageFreeText(section.content.slice(0, DATA_CONTENT)), problem: problems.get(section.key) ?? null,
        // Presets whose guide is this section as saved (or its group); a new section is not linked yet.
        guidedBy: section.savedPath === null ? [] : guidedBy(section.savedPath),
      })),
      brokenGuides,
      openSection: openSection ? { path: openSection.path, title: openSection.title, summary: openSection.summary, content: pageFreeText(openSection.content) } : null,
      selected: { name: draft.name, category: draft.category, sections: draft.sections.length },
    },
    apply: (patch) => {
      if (readOnly && Object.keys(patch).some((key) => key !== 'section')) throw new Error('플러그인 스킬은 여기서 고칠 수 없어.')
      let next = current.current.draft
      for (const key of ['name', 'description', 'category', 'instructions'] as const) if (patch[key] !== undefined) next = { ...next, [key]: patchText(patch[key]) }
      if (next !== current.current.draft) setDraft(next)
      if (patch.section === undefined) return
      const wanted = patchText(patch.section).trim()
      if (!wanted) {
        setPane('overview')
        return
      }
      const key = skillSectionPathKey(validPath(wanted))
      const found = next.sections.find((section) => sectionPathKey(section) === key)
      if (!found) throw new Error(`${wanted}: 그 경로의 섹션이 없어.`)
      setPane(`section:${found.key}`)
    },
    actions: readOnly ? [] : [sectionsAction],
    applyAction: (id: string, args: Record<string, ChatPageData>): WorkflowUndo => {
      if (id !== 'skill.sections' || readOnly || !Array.isArray(args.changes)) throw new Error('스킬 편집기에 없는 작업이야.')
      const before = current.current.draft
      const result = applySectionChanges(before, current.current.pane, args.changes as unknown as SectionChange[])
      setDraft(result.draft)
      if (result.pane !== current.current.pane) setPane(result.pane)
      return { isCurrent: () => current.current.draft === result.draft, restore: () => setDraft(before) }
    },
    save,
  })
}
