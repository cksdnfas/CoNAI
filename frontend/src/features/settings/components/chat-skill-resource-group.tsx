import { useRef, useState } from 'react'
import { useMutation, type UseQueryResult } from '@tanstack/react-query'
import { Activity, FileUp, Link2, Plus, Rows3, Search, Sparkles } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow, ResourceRowStat, ResourceRowStatus } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { importChatSkillFile, type ChatSkillSnapshot, type ChatSkillSummary } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

/** What the skill editor opens: a stored skill by id, or a new one (optionally prefilled, e.g. from an imported file). */
export type ChatSkillEditorTarget = { skillId: number | null; initial?: ChatSkillSnapshot; imported?: { warnings: string[] } }

const SKILL_CLASS = 'text-resource-skill'

function matches(skill: ChatSkillSummary, query: string) {
  return [skill.name, skill.description, skill.category, ...skill.sections.flatMap((section) => [section.title, section.path])].some((text) => text.toLowerCase().includes(query))
}

/** The skills of the resources list: grouped by category, searchable, with a file import that opens the editor. */
export function ChatSkillResourceGroup({ query, onOpen }: { query: UseQueryResult<ChatSkillSummary[]>; onOpen: (target: ChatSkillEditorTarget) => void }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const importRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  // Nothing is saved yet: the editor opens on the draft, and saving there creates the skill.
  const importMutation = useMutation({
    mutationFn: importChatSkillFile,
    onSuccess: ({ draft, warnings }) => onOpen({ skillId: null, initial: draft, imported: { warnings } }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '스킬 파일을 읽지 못했어.', en: 'Could not read the skill file.' })), tone: 'error' }),
  })
  const skills = query.data ?? []
  const needle = search.trim().toLowerCase()
  const shown = needle ? skills.filter((skill) => matches(skill, needle)) : skills
  const byCategory = new Map<string, ChatSkillSummary[]>()
  for (const skill of shown) byCategory.set(skill.category.trim(), [...(byCategory.get(skill.category.trim()) ?? []), skill])
  // Named categories alphabetically, uncategorized last.
  const categories = [...byCategory.keys()].sort((left, right) => (left === '' ? 1 : right === '' ? -1 : left.localeCompare(right)))

  const row = (skill: ChatSkillSummary) => (
    <ResourceRow
      key={skill.id}
      leading={<Sparkles className={SKILL_CLASS} />}
      name={skill.name}
      dimmed={!skill.enabled}
      extra={(
        <>
          {skill.source === 'import' ? <Chip size="sm" tone="muted">{t({ ko: '가져옴', en: 'Imported' })}</Chip> : null}
          {skill.source === 'plugin' ? <Tip content={skill.pluginId}><span className="inline-flex"><Chip size="sm" tone="info">{t({ ko: '플러그인', en: 'Plugin' })}</Chip></span></Tip> : null}
          {!skill.enabled ? <ResourceRowStatus tip={t({ ko: '플러그인이 꺼져 있어서 모델에 보이지 않아', en: 'Its plugin is off, so models do not see it' })}>{t({ ko: '꺼짐', en: 'Off' })}</ResourceRowStatus> : null}
          <Tip content={skill.description}><span className="min-w-0 truncate text-xs text-muted-foreground">{skill.description}</span></Tip>
          {skill.profiles.length === 0 ? <ResourceRowStatus>{t({ ko: '미연결', en: 'Not linked' })}</ResourceRowStatus> : null}
        </>
      )}
      aside={(
        <>
          <ResourceRowStat icon={Rows3} tip={skill.sections.length > 0 ? skill.sections.slice(0, 12).map((section) => section.path).join(', ') : t({ ko: '섹션 없음', en: 'No sections' })}>{skill.sections.length}</ResourceRowStat>
          <ResourceRowStat icon={Activity} tip={skill.lastLoadedAt ? t({ ko: '불러온 횟수 {count} · 마지막 {date}', en: 'Loaded {count} times · last {date}' }, { count: skill.loadCount, date: formatDateTime(skill.lastLoadedAt) }) : t({ ko: '아직 불러온 적 없어', en: 'Not loaded yet' })}>{skill.loadCount}</ResourceRowStat>
          {skill.profiles.length > 0 ? <ResourceRowStat icon={Link2} tip={skill.profiles.map((profile) => profile.name).join(', ')}>{skill.profiles.length}</ResourceRowStat> : null}
        </>
      )}
      onOpen={() => onOpen({ skillId: skill.id })}
    />
  )

  return (
    <RowGroup
      headingClassName={SKILL_CLASS}
      heading={t({ ko: '스킬', en: 'Skills' })}
      count={query.isSuccess ? skills.length : undefined}
      actions={(
        <div className="flex items-center gap-1">
          <input ref={importRef} type="file" accept=".zip,.md,application/zip,text/markdown" className="hidden" aria-label={t({ ko: '스킬 파일', en: 'Skill file' })} onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importMutation.mutate(file)
          }} />
          <IconButton size="icon-sm" variant="ghost" disabled={importMutation.isPending} onClick={() => importRef.current?.click()} label={t({ ko: '스킬 가져오기 (Agent Skills .zip / SKILL.md)', en: 'Import skill (Agent Skills .zip / SKILL.md)' })}><FileUp /></IconButton>
          <IconButton size="icon-sm" variant="ghost" onClick={() => onOpen({ skillId: null })} label={t({ ko: '스킬 추가', en: 'Add skill' })}><Plus /></IconButton>
        </div>
      )}
    >
      {query.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
      {query.isSuccess && skills.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 스킬이 없어', en: 'No skills yet' })}</SettingsEmptyRow> : null}
      {skills.length > 0 ? (
        <div className="space-y-3 pt-2">
          <SearchField className="max-w-sm" value={search} onChange={setSearch} placeholder={t({ ko: '이름·설명·분류·섹션 제목으로 찾기', en: 'Search names, descriptions, categories, section titles' })} />
          {shown.length === 0 ? <EmptyState size="compact" icon={Search} title={t({ ko: '맞는 스킬이 없어', en: 'No matching skills' })} /> : null}
          {categories.length === 1 && categories[0] === ''
            ? <div>{shown.map(row)}</div>
            : categories.map((category) => (
              <RowGroup key={category || '-'} headingAs="h4" heading={category || t({ ko: '분류 없음', en: 'Uncategorized' })} count={byCategory.get(category)?.length}>
                {(byCategory.get(category) ?? []).map(row)}
              </RowGroup>
            ))}
        </div>
      ) : null}
      {query.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(query.error, t({ ko: '스킬을 불러오지 못했어.', en: 'Could not load skills.' }))}</p> : null}
    </RowGroup>
  )
}
