import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileText, History, Info, Plus, TriangleAlert } from 'lucide-react'
import { CHAT_SKILL_LIMITS, rawTokenEstimate, skillSectionPathKey } from '@conai/shared'
import { SaveConflictAlert, SaveConflictOverwriteButton } from '@/components/common/save-conflict-alert'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorSplit, type EditorNavGroup } from '@/components/ui/editor-split'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_GENERATION_PRESETS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SKILLS_QUERY_KEY,
  chatSkillQueryKey,
  createChatSkill,
  getChatSkill,
  isChatRevisionConflict,
  listChatGenerationPresets,
  listChatSkills,
  updateChatSkill,
  type ChatSkill,
  type ChatSkillSnapshot,
} from '@/lib/api-codex-chat'
import { PLUGINS_QUERY_KEY, listPlugins } from '@/lib/api-plugins'
import { getErrorMessage } from '@/lib/error-message'
import { useChatResourceDelete, useChatSkillExport } from './use-chat-resource-actions'
import {
  EMPTY_SKILL,
  draftSnapshot,
  hasHeadingToSplit,
  insertSection,
  moveSection,
  newSectionKey,
  overviewTokens,
  presetsGuidedBy,
  sameSkillContents,
  sectionGroups,
  sectionPathKey,
  sectionProblems,
  sectionTokens,
  skillDraftOf,
  skillProblem,
  skillSnapshotOf,
  splitOverviewByHeadings,
  uniqueSectionPath,
  type SectionDraft,
  type SkillDraft,
} from './chat-skill-draft'
import { SkillOverviewPane, SkillSectionPane, useTokenLabel } from './chat-skill-editor-panes'
import { SkillHistoryPane } from './chat-skill-history-pane'
import { SkillPreviewPane } from './chat-skill-preview-pane'
import { CHAT_DOCK_INSET } from './use-settings-editor-chat-page'
import { useSkillEditorChatPage } from './use-skill-editor-chat-page'

/**
 * Create or edit one shared skill package: the overview (name, "when to use", category, what use_skill returns first)
 * and its sections, filed by path in a tree; plus what the model will see and the saved history. An existing skill
 * loads in full by id. Saving replaces the sections in order, checked against the revision it was opened at; a plugin's
 * skill opens read-only. Saving reaches every profile that links it; `onSaved` hands the skill back.
 */
export function ChatSkillEditorModal({ open, skillId, initial, imported, onClose, onSaved }: {
  open: boolean
  /** Null: a new skill. */
  skillId: number | null
  /** Starting values for a new skill (a proposal opened in the editor, an imported file). */
  initial?: ChatSkillSnapshot
  /** A new skill read from a file: its notes are shown and it saves as imported. */
  imported?: { warnings: string[] }
  onClose: () => void
  onSaved?: (skill: ChatSkill) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const tokenLabel = useTokenLabel()
  // Always refetched on open: the draft is built only from data fetched after that (a cached copy may be older).
  const skillQuery = useQuery({ queryKey: chatSkillQueryKey(skillId ?? 0), queryFn: ({ signal }) => getChatSkill(skillId ?? 0, signal), enabled: open && skillId !== null, staleTime: 0 })
  // Categories already in use, offered while typing one.
  const listQuery = useQuery({ queryKey: CHAT_SKILLS_QUERY_KEY, queryFn: listChatSkills, enabled: open })
  // Generation presets whose guide is a section here, warned about before it is renamed or deleted.
  const presetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets, enabled: open && skillId !== null })
  /** The stored skill the draft is based on (its revision is what a save checks against). */
  const [base, setBase] = useState<ChatSkill | null>(null)
  const [saved, setSaved] = useState<ChatSkillSnapshot>(EMPTY_SKILL)
  const [draft, setDraft] = useState<SkillDraft>(() => skillDraftOf(EMPTY_SKILL))
  /** `overview`, `section:<key>`, `preview` or `history`. */
  const [pane, setPane] = useState('overview')
  const [showingList, setShowingList] = useState(true)
  /** The newer skill a save was refused for; the draft stays until the person picks. */
  const [conflict, setConflict] = useState<ChatSkill | null>(null)
  /** Which skill the draft was opened for, so a background refetch never replaces the edits. */
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  /** When the editor opened for which skill; only a fetch finished after it may start the draft. */
  const [session, setSession] = useState<{ id: string | null; at: number }>({ id: null, at: 0 })
  const sessionId = open ? String(skillId ?? 'new') : null
  const draftRef = useRef(draft)
  draftRef.current = draft

  const fresh = skillQuery.data !== undefined && session.id === sessionId && skillQuery.dataUpdatedAt >= session.at
  const loaded = skillId === null ? 'new' : fresh ? `skill:${skillId}` : null
  const adopt = (skill: ChatSkill | null, start: ChatSkillSnapshot) => {
    const next = skillDraftOf(start)
    setBase(skill)
    // In tree order like the draft, so a stored order the tree cannot show is not mistaken for an edit.
    setSaved(draftSnapshot(next))
    setDraft(next)
    setConflict(null)
  }
  useLayoutEffect(() => {
    if (session.id !== sessionId) setSession({ id: sessionId, at: Date.now() })
    if (!open) {
      setOpenedFor(null)
      return
    }
    if (loaded === null || openedFor === loaded) return
    const skill = skillId === null ? null : skillQuery.data ?? null
    adopt(skill, skill ? skillSnapshotOf(skill) : (initial ?? EMPTY_SKILL))
    setPane('overview')
    setShowingList(true)
    setOpenedFor(loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opens once per skill; later refetches never reset the draft
  }, [open, sessionId, loaded, openedFor])

  const readOnly = base?.source === 'plugin'
  const pluginsQuery = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins, enabled: open && readOnly })
  const pluginName = base?.pluginId ? (pluginsQuery.data?.find((plugin) => plugin.manifest.id === base.pluginId)?.manifest.name ?? base.pluginId) : ''

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_SKILLS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
      // A preset's guide shows the section's current title (or that it is gone).
      queryClient.invalidateQueries({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY }),
    ])
  }
  const guidedBy = (path: string | null) => (base ? presetsGuidedBy(presetsQuery.data ?? [], base.id, path) : [])
  const saveMutation = useMutation({
    /** `revision`: save over that newer revision (the person chose to overwrite). */
    mutationFn: (revision?: number) => {
      const input = draftSnapshot(draftRef.current)
      if (!base) return createChatSkill({ ...input, ...(imported ? { source: 'import' as const } : {}) })
      return updateChatSkill(base.id, { ...input, revision: revision ?? base.revision })
    },
    onSuccess: async (result) => {
      setConflict(null)
      queryClient.setQueryData(chatSkillQueryKey(result.id), result)
      await refresh()
      onSaved?.(result)
      onClose()
    },
    onError: (error) => {
      if (isChatRevisionConflict(error)) {
        setConflict(error.current as ChatSkill)
        return
      }
      showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
    },
  })
  const deleteMutation = useChatResourceDelete(onClose)
  const exportMutation = useChatSkillExport()
  const loadLatest = async (latest: ChatSkill) => {
    const confirmed = await confirm({
      title: t({ ko: '최신 내용 불러오기', en: 'Load the latest' }),
      description: t({ ko: '다른 곳에서 저장한 r{revision}을 불러와. 여기서 고친 내용은 사라져.', en: 'Loads r{revision}, saved elsewhere. Your edits here are lost.' }, { revision: latest.revision }),
      confirmLabel: t({ ko: '불러오기', en: 'Load' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (!confirmed) return
    queryClient.setQueryData(chatSkillQueryKey(latest.id), latest)
    adopt(latest, skillSnapshotOf(latest))
    setPane('overview')
  }

  const contents = useMemo(() => draftSnapshot(draft), [draft])
  // An imported file is not stored anywhere yet, so closing it asks first like an edit.
  const dirty = openedFor !== null && (imported !== undefined || !sameSkillContents(contents, saved))
  const problems = useMemo(() => sectionProblems(draft.sections), [draft.sections])
  const filled = draft.name.trim() !== '' && draft.description.trim() !== '' && draft.instructions.trim() !== ''
  const overLimit = skillProblem(draft)
  const sectionsValid = [...problems.values()].every((problem) => problem === null)
  const canSave = !readOnly && openedFor !== null && filled && overLimit === null && sectionsValid && !saveMutation.isPending && (dirty || !base)

  const setSections = (sections: SectionDraft[]) => setDraft((current) => ({ ...current, sections }))
  const patchSection = (key: string, patch: Partial<Omit<SectionDraft, 'key'>>) => setDraft((current) => ({ ...current, sections: current.sections.map((section) => (section.key === key ? { ...section, ...patch } : section)) }))
  const go = (next: string) => {
    setPane(next)
    setShowingList(false)
  }
  const addSection = (group: string | null) => {
    const key = newSectionKey()
    const name = t({ ko: '새-섹션', en: 'new-section' })
    setSections(insertSection(draft.sections, { key, savedPath: null, path: uniqueSectionPath(draft.sections, group ? `${group}/${name}` : name), title: '', summary: '', content: '' }))
    go(`section:${key}`)
  }
  const removeSection = async (section: SectionDraft) => {
    const guides = section.savedPath === null ? [] : guidedBy(section.savedPath)
    if (guides.length > 0) {
      const confirmed = await confirm({
        title: t({ ko: '섹션 삭제', en: 'Delete section' }),
        description: t({ ko: '생성 프리셋 {names}이(가) 이 섹션(또는 그 그룹)을 가이드로 써. 저장하면 그 가이드를 찾을 수 없게 될 수 있어.', en: 'Generation presets {names} use this section (or its group) as their guide. After saving, that guide may be gone.' }, { names: guides.join(', ') }),
        confirmLabel: t({ ko: '삭제', en: 'Delete' }),
        tone: 'destructive',
      })
      if (!confirmed) return
    }
    setSections(draftRef.current.sections.filter((other) => other.key !== section.key))
    setPane('overview')
  }
  const handleSplit = async () => {
    // Split only on demand: it reads the whole overview.
    const split = splitOverviewByHeadings(draftRef.current)
    if (!split) {
      showSnackbar({ message: t({ ko: '나눌 ## 제목이 없어 (코드 블록 안의 제목은 빼고).', en: 'No ## heading to split at (headings in code blocks do not count).' }), tone: 'info' })
      return
    }
    const count = split.sections.length - draftRef.current.sections.length
    const confirmed = await confirm({
      title: t({ ko: '## 제목으로 섹션 나누기', en: 'Split ## headings into sections' }),
      description: t({ ko: '개요의 ## 제목 {count}개를 각각 섹션으로 옮겨. 첫 ## 앞의 글은 개요에 남아. 섹션마다 목차 요약은 직접 채워줘.', en: 'Moves {count} ## headings of the overview into sections of their own; text before the first one stays the overview. Fill in each table line yourself.' }, { count }),
      confirmLabel: t({ ko: '나누기', en: 'Split' }),
    })
    if (confirmed) setDraft(splitOverviewByHeadings(draftRef.current) ?? draftRef.current)
  }

  // A section the chat or an undo removed falls back to the overview.
  const openSection = pane.startsWith('section:') ? draft.sections.find((section) => `section:${section.key}` === pane) : undefined
  const shownPane = pane.startsWith('section:') && !openSection ? 'overview' : pane

  const renamedGuides = (section: SectionDraft) => (section.savedPath !== null && sectionPathKey(section) !== skillSectionPathKey(section.savedPath) ? guidedBy(section.savedPath) : [])
  // Saved sections a guide points at that the draft renamed or removed, however that happened (here or from the chat).
  const brokenGuides = useMemo(() => {
    if (!base) return []
    const kept = new Set(draft.sections.flatMap((section) => (section.savedPath === null ? [] : [skillSectionPathKey(section.savedPath)])))
    const broken: Array<{ path: string; change: 'renamed' | 'removed'; presets: string[] }> = []
    for (const section of saved.sections) {
      const key = skillSectionPathKey(section.path)
      const now = draft.sections.find((other) => other.savedPath !== null && skillSectionPathKey(other.savedPath) === key)
      const change = !kept.has(key) ? 'removed' : now && sectionPathKey(now) !== key ? 'renamed' : null
      if (change === null) continue
      const presets = presetsGuidedBy(presetsQuery.data ?? [], base.id, section.path)
      if (presets.length > 0) broken.push({ path: section.path, change, presets })
    }
    return broken
  }, [base, draft.sections, saved.sections, presetsQuery.data])

  const save = () => { if (canSave) saveMutation.mutate(undefined) }
  useSkillEditorChatPage({
    open: open && openedFor !== null,
    skill: base,
    draft,
    setDraft,
    problems,
    guidedBy,
    brokenGuides,
    pane: shownPane,
    setPane: go,
    readOnly,
    dirty,
    save: canSave ? () => saveMutation.mutateAsync(undefined) : undefined,
  })

  // Per-section counts are cached by section object, so typing re-estimates only the section being edited.
  const overview = overviewTokens(draft)
  const total = rawTokenEstimate(`${draft.name}: ${draft.description}`) + overview + draft.sections.reduce((sum, section) => sum + sectionTokens(section), 0)
  const sectionItem = (section: SectionDraft) => {
    const problem = problems.get(section.key)
    const name = section.path.slice(section.path.indexOf('/') + 1)
    return {
      id: `section:${section.key}`,
      label: section.title.trim() || name || t({ ko: '새 섹션', en: 'New section' }),
      trailing: problem
        ? <Tip content={t({ ko: '저장하려면 고쳐야 해', en: 'Needs fixing before saving' })}><TriangleAlert className="text-warning" aria-label={t({ ko: '고칠 곳 있음', en: 'Needs fixing' })} /></Tip>
        : tokenLabel(sectionTokens(section)),
    }
  }
  const groups = sectionGroups(draft.sections)
  const full = draft.sections.length >= CHAT_SKILL_LIMITS.sections
  const addButton = (group: string | null) => readOnly ? null : (
    <IconButton size="icon-xs" variant="ghost" disabled={full} onClick={() => addSection(group)} label={group ? t({ ko: '{group}에 섹션 추가', en: 'Add a section to {group}' }, { group }) : t({ ko: '섹션 추가', en: 'Add section' })}><Plus /></IconButton>
  )
  const navGroups: EditorNavGroup[] = [
    { id: 'overview', items: [{ id: 'overview', label: t({ ko: '개요', en: 'Overview' }), trailing: tokenLabel(overview) }] },
    ...groups.map(({ group, sections }) => ({
      id: group === null ? 'sections' : `group:${skillSectionPathKey(group)}`,
      label: group === null ? <>{t({ ko: '섹션', en: 'Sections' })} <span className="tabular-nums">{draft.sections.length}</span></> : `${group}/`,
      actions: addButton(group),
      items: sections.map(sectionItem),
    })),
    {
      id: 'check',
      label: t({ ko: '확인', en: 'Check' }),
      items: [
        { id: 'preview', label: <span className="inline-flex items-center gap-1.5"><Eye />{t({ ko: '모델이 보는 모습', en: 'What the model sees' })}</span> },
        ...(base && !readOnly ? [{ id: 'history', label: <span className="inline-flex items-center gap-1.5"><History />{t({ ko: '기록', en: 'History' })}</span> }] : []),
      ],
    },
  ]
  const categories = [...new Set((listQuery.data ?? []).map((skill) => skill.category).filter(Boolean))]

  const body = () => {
    if (skillId !== null && skillQuery.isError && openedFor === null) return <ErrorState error={skillQuery.error} onRetry={() => void skillQuery.refetch()} />
    if (openedFor === null) return <LoadingState />
    return (
      <div className="space-y-4">
        {readOnly ? (
          <Alert variant="info">
            <Info />
            <AlertDescription>
              {base?.enabled
                ? t({ ko: '플러그인 {name}의 스킬이라 여기서는 읽기만 할 수 있어.', en: 'This skill belongs to the plugin {name}; it is read-only here.' }, { name: pluginName })
                : t({ ko: '플러그인 {name}의 스킬이라 읽기만 할 수 있어. 플러그인이 꺼져 있어서 지금은 모델에 보이지 않아.', en: 'This skill belongs to the plugin {name} and is read-only. The plugin is off, so models do not see it now.' }, { name: pluginName })}
            </AlertDescription>
          </Alert>
        ) : null}
        {imported && imported.warnings.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4">
                {imported.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {conflict ? (
          <SaveConflictAlert message={t({ ko: '다른 곳에서 이 스킬을 먼저 저장했어 (r{revision}). 고친 내용은 그대로 있어.', en: 'This skill was saved elsewhere first (r{revision}). Your edits are kept.' }, { revision: conflict.revision })}>
            <Button type="button" size="sm" variant="ghost" disabled={saveMutation.isPending} onClick={() => void loadLatest(conflict)}>{t({ ko: '최신 불러오기', en: 'Load latest' })}</Button>
            <SaveConflictOverwriteButton disabled={saveMutation.isPending || !canSave} onClick={() => { setBase(conflict); saveMutation.mutate(conflict.revision) }} />
          </SaveConflictAlert>
        ) : null}
        <EditorSplit
          groups={navGroups}
          current={shownPane}
          onSelect={go}
          showingList={showingList}
          onShowList={() => setShowingList(true)}
          navLabel={t({ ko: '스킬 항목', en: 'Skill items' })}
        >
          {shownPane === 'overview' ? (
            <SkillOverviewPane
              draft={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              readOnly={readOnly}
              categories={categories}
              tokens={{ overview, total }}
              skill={base}
              onSplit={hasHeadingToSplit(draft.instructions) ? () => void handleSplit() : undefined}
            />
          ) : null}
          {openSection ? (
            <SkillSectionPane
              key={openSection.key}
              section={openSection}
              problem={problems.get(openSection.key) ?? null}
              onChange={(patch) => patchSection(openSection.key, patch)}
              onMove={{
                up: moveSection(draft.sections, openSection.key, -1) ? () => setSections(moveSection(draft.sections, openSection.key, -1) ?? draft.sections) : null,
                down: moveSection(draft.sections, openSection.key, 1) ? () => setSections(moveSection(draft.sections, openSection.key, 1) ?? draft.sections) : null,
              }}
              onRemove={() => void removeSection(openSection)}
              readOnly={readOnly}
              tokens={sectionTokens(openSection)}
              usage={base?.sections.find((section) => skillSectionPathKey(section.path) === skillSectionPathKey(openSection.path))}
              renamedGuides={renamedGuides(openSection)}
            />
          ) : null}
          {shownPane === 'preview' ? <SkillPreviewPane draft={contents} skillId={base?.id ?? null} /> : null}
          {shownPane === 'history' && base ? (
            <SkillHistoryPane
              skill={base}
              dirty={dirty}
              onRestored={(restored) => adopt(restored, skillSnapshotOf(restored))}
              onLatest={(latest) => (dirty ? setConflict(latest) : adopt(latest, skillSnapshotOf(latest)))}
            />
          ) : null}
        </EditorSplit>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={base ? (readOnly ? t({ ko: '스킬 보기', en: 'View skill' }) : t({ ko: '스킬 편집', en: 'Edit skill' })) : imported ? t({ ko: '가져온 스킬', en: 'Imported skill' }) : t({ ko: '스킬 추가', en: 'Add skill' })}
      description={base ? `${base.name} · r${base.revision}` : undefined}
      size="xl"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? save : undefined}
    >
      {body()}
      <EditorFooter
        onDelete={base && !readOnly ? () => deleteMutation.mutate({ kind: 'skill', resource: base }) : undefined}
        deleting={deleteMutation.isPending}
        onSave={readOnly ? undefined : save}
        canSave={canSave}
        saving={saveMutation.isPending}
        saveLabel={base ? undefined : t({ ko: '만들기', en: 'Create' })}
      >
        {base ? (
          <IconButton size="icon-sm" variant="ghost" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate(base)} label={dirty ? t({ ko: 'Agent Skills ZIP으로 내보내기 (저장된 내용)', en: 'Export as Agent Skills ZIP (saved contents)' }) : t({ ko: 'Agent Skills ZIP으로 내보내기', en: 'Export as Agent Skills ZIP' })}>
            <Download />
          </IconButton>
        ) : null}
        {!filled && !readOnly && openedFor !== null ? <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><FileText className="size-3.5" aria-hidden />{t({ ko: '이름·언제 쓰는지·개요를 채워야 저장돼', en: 'Needs a name, when to use and an overview' })}</span> : null}
        {overLimit && !readOnly && openedFor !== null ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <TriangleAlert className="size-3.5" aria-hidden />
            {overLimit === 'count'
              ? t({ ko: '섹션은 {max}개까지야. 몇 개 지우거나 합쳐줘.', en: 'At most {max} sections. Delete or merge some.' }, { max: CHAT_SKILL_LIMITS.sections })
              : t({ ko: '개요 쪽 칸이 너무 길어 (이름 {name}·언제 쓰는지 {description}·분류 {category}·개요 {instructions}자까지).', en: 'An overview field is too long (name {name}, when to use {description}, category {category}, overview {instructions} characters).' }, { name: CHAT_SKILL_LIMITS.name, description: CHAT_SKILL_LIMITS.description, category: CHAT_SKILL_LIMITS.category, instructions: CHAT_SKILL_LIMITS.instructions })}
          </span>
        ) : null}
        {brokenGuides.length > 0 && !readOnly ? (
          <Tip content={brokenGuides.map((guide) => (guide.change === 'removed'
            ? t({ ko: '"{path}" 지움 → 생성 프리셋 {names}', en: '"{path}" removed → generation presets {names}' }, { path: guide.path, names: guide.presets.join(', ') })
            : t({ ko: '"{path}" 경로 바뀜 → 생성 프리셋 {names}', en: '"{path}" renamed → generation presets {names}' }, { path: guide.path, names: guide.presets.join(', ') }))).join('\n')}>
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <TriangleAlert className="size-3.5" aria-hidden />
              {t({ ko: '저장하면 생성 프리셋 가이드 {count}곳이 끊겨. 저장한 뒤 그 가이드를 다시 골라줘.', en: 'Saving breaks {count} generation preset guides. Pick those guides again after saving.' }, { count: brokenGuides.length })}
            </span>
          </Tip>
        ) : null}
      </EditorFooter>
    </Modal>
  )
}
