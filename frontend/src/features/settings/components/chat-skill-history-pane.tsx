import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { skillSectionPathKey } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorPaneHeader } from '@/components/ui/editor-split'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import {
  CHAT_SKILLS_QUERY_KEY,
  chatSkillQueryKey,
  chatSkillVersionsQueryKey,
  getChatSkillVersion,
  isChatRevisionConflict,
  listChatSkillVersions,
  restoreChatSkill,
  type ChatSkill,
  type ChatSkillSnapshot,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { skillSnapshotOf } from './chat-skill-draft'

type Change = { id: string; label: string; before: string | null; after: string | null }

const sectionText = (section: ChatSkillSnapshot['sections'][number]) => `${section.title}\n${section.summary}\n\n${section.content}`

/**
 * What differs between an earlier version and the saved skill, field by field and section by section (by path), plus
 * the section order when the sections both have are listed differently.
 */
function versionChanges(version: ChatSkillSnapshot, current: ChatSkillSnapshot, labels: Record<'name' | 'description' | 'category' | 'instructions' | 'order', string>): Change[] {
  const changes: Change[] = (['name', 'description', 'category', 'instructions'] as const)
    .filter((key) => version[key] !== current[key])
    .map((key) => ({ id: key, label: labels[key], before: version[key], after: current[key] }))
  const now = new Map(current.sections.map((section) => [skillSectionPathKey(section.path), section]))
  const then = new Map(version.sections.map((section) => [skillSectionPathKey(section.path), section]))
  for (const [key, section] of then) {
    const other = now.get(key)
    if (!other) changes.push({ id: `section:${key}`, label: section.path, before: sectionText(section), after: null })
    else if (sectionText(section) !== sectionText(other) || section.path !== other.path) changes.push({ id: `section:${key}`, label: other.path, before: sectionText(section), after: sectionText(other) })
  }
  for (const [key, section] of now) if (!then.has(key)) changes.push({ id: `section:${key}`, label: section.path, before: null, after: sectionText(section) })
  const shared = (sections: ChatSkillSnapshot['sections'], other: Map<string, unknown>) => sections.map((section) => skillSectionPathKey(section.path)).filter((key) => other.has(key))
  const thenOrder = shared(version.sections, now)
  const nowOrder = shared(current.sections, then)
  if (thenOrder.some((key, index) => key !== nowOrder[index])) {
    changes.push({ id: 'order', label: labels.order, before: version.sections.map((section) => section.path).join('\n'), after: current.sections.map((section) => section.path).join('\n') })
  }
  return changes
}

/**
 * 기록: earlier revisions of the saved skill, one opened against what is saved now, and restoring it (a new revision;
 * refused when the skill changed since the person looked).
 */
export function SkillHistoryPane({ skill, dirty, onRestored, onLatest }: {
  skill: ChatSkill
  dirty: boolean
  onRestored: (skill: ChatSkill) => void
  /** A restore refused as stale hands over the current skill. */
  onLatest: (skill: ChatSkill) => void
}) {
  const { t, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [revision, setRevision] = useState<number | null>(null)
  const versionsQuery = useQuery({ queryKey: chatSkillVersionsQueryKey(skill.id), queryFn: () => listChatSkillVersions(skill.id) })
  const versionQuery = useQuery({
    queryKey: [...chatSkillVersionsQueryKey(skill.id), revision],
    queryFn: () => getChatSkillVersion(skill.id, revision ?? 0),
    enabled: revision !== null,
    staleTime: Infinity,
  })
  const restoreMutation = useMutation({
    mutationFn: (from: number) => restoreChatSkill(skill.id, from, skill.revision),
    onSuccess: async (restored, from) => {
      queryClient.setQueryData(chatSkillQueryKey(restored.id), restored)
      onRestored(restored)
      setRevision(null)
      await queryClient.invalidateQueries({ queryKey: CHAT_SKILLS_QUERY_KEY })
      showSnackbar({ message: t({ ko: 'r{from} 내용으로 되돌렸어 (새 버전 r{revision}).', en: 'Restored r{from} as r{revision}.' }, { from, revision: restored.revision }), tone: 'info' })
    },
    onError: async (error) => {
      if (isChatRevisionConflict(error)) {
        onLatest(error.current as ChatSkill)
        await queryClient.invalidateQueries({ queryKey: chatSkillVersionsQueryKey(skill.id) })
        showSnackbar({ message: t({ ko: '다른 곳에서 먼저 바뀌었어. 최신 내용을 확인하고 다시 되돌려줘.', en: 'It changed elsewhere first. Check the latest and restore again.' }), tone: 'info' })
        return
      }
      showSnackbar({ message: getErrorMessage(error, t({ ko: '되돌리지 못했어.', en: 'Could not restore.' })), tone: 'error' })
    },
  })

  const handleRestore = async (from: number) => {
    const confirmed = await confirm({
      title: t({ ko: 'r{revision}으로 되돌리기', en: 'Restore r{revision}' }, { revision: from }),
      description: dirty
        ? t({ ko: '이 버전 내용을 새 버전으로 저장해. 편집기의 저장 안 한 변경은 사라져.', en: 'Saves this version as a new revision. Unsaved edits in the editor are lost.' })
        : t({ ko: '이 버전 내용을 새 버전으로 저장해. 지금 내용은 기록에 남아.', en: 'Saves this version as a new revision. The current contents stay in the history.' }),
      confirmLabel: t({ ko: '되돌리기', en: 'Restore' }),
      tone: dirty ? 'destructive' : undefined,
    })
    if (confirmed) restoreMutation.mutate(from)
  }

  const labels = { name: t({ ko: '이름', en: 'Name' }), description: t({ ko: '언제 쓰는지', en: 'When to use' }), category: t({ ko: '분류', en: 'Category' }), instructions: t({ ko: '개요', en: 'Overview' }), order: t({ ko: '섹션 순서', en: 'Section order' }) }
  const versions = versionsQuery.data?.versions ?? []
  const changes = versionQuery.data ? versionChanges(versionQuery.data.snapshot, skillSnapshotOf(skill), labels) : []

  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '기록', en: 'History' })}
        info={t({ ko: '저장할 때마다 이전 내용이 남아 (최근 것부터). 고르면 지금 저장된 내용과 비교해.', en: 'Each save keeps the earlier contents (newest first). Pick one to compare it with what is saved now.' })}
      />
      <Text variant="caption">{t({ ko: '지금 저장된 버전: r{revision}', en: 'Saved now: r{revision}' }, { revision: versionsQuery.data?.current ?? skill.revision })}</Text>
      {versionsQuery.isPending ? <LoadingState /> : null}
      {versionsQuery.isError ? <ErrorState size="compact" error={versionsQuery.error} onRetry={() => void versionsQuery.refetch()} /> : null}
      {versionsQuery.isSuccess && versions.length === 0 ? <EmptyState size="compact" icon={History} title={t({ ko: '아직 이전 버전이 없어', en: 'No earlier versions yet' })} /> : null}
      <div className="mt-2">
        {versions.map((version) => (
          <ListRow key={version.revision} asChild interactive selected={version.revision === revision} trailing={<span className="text-xs tabular-nums">{t({ ko: '섹션 {count}', en: '{count} sections' }, { count: version.sectionCount })}</span>}>
            <button type="button" onClick={() => setRevision(version.revision === revision ? null : version.revision)}>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">r{version.revision}</span>
              <span className="min-w-0 truncate">{version.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(version.savedDate)}</span>
            </button>
          </ListRow>
        ))}
      </div>
      {revision !== null ? (
        <div className="mt-4 space-y-3">
          {versionQuery.isPending ? <LoadingState /> : null}
          {versionQuery.isError ? <ErrorState size="compact" error={versionQuery.error} onRetry={() => void versionQuery.refetch()} /> : null}
          {versionQuery.isSuccess ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Text variant="title" className="flex-1">{t({ ko: 'r{revision} → 지금 · 바뀐 곳 {count}', en: 'r{revision} → now · {count} changes' }, { revision, count: changes.length })}</Text>
                <Button size="sm" variant="secondary" disabled={restoreMutation.isPending || skill.source === 'plugin'} onClick={() => void handleRestore(revision)}>
                  {t({ ko: '이 버전으로 되돌리기', en: 'Restore this version' })}
                </Button>
              </div>
              {changes.length === 0 ? <Text variant="caption">{t({ ko: '지금과 같아.', en: 'Same as now.' })}</Text> : null}
              {changes.map((change) => (
                <div key={change.id} className="space-y-1.5">
                  <Text variant="label" mono={change.id.startsWith('section:')}>{change.label}</Text>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="min-w-0 space-y-1">
                      <Text variant="caption">{t({ ko: 'r{revision}', en: 'r{revision}' }, { revision })}</Text>
                      {change.before === null ? <Text variant="caption">{t({ ko: '없음', en: 'None' })}</Text> : <CodeBlock maxHeight="sm">{change.before}</CodeBlock>}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Text variant="caption">{t({ ko: '지금', en: 'Now' })}</Text>
                      {change.after === null ? <Text variant="caption">{t({ ko: '없음', en: 'None' })}</Text> : <CodeBlock maxHeight="sm">{change.after}</CodeBlock>}
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
