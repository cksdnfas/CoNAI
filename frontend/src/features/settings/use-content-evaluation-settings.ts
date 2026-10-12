import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ContentEvaluationSettings } from '@conai/shared'
import { CONTENT_EVALUATION_QUERY_KEY, getContentEvaluationSettings, updateContentEvaluationSettings } from '@/lib/api-content-evaluation'
import { MODEL_SLOTS_QUERY_KEY } from '@/lib/api-codex-chat'
import { POSTS_QUERY_KEY } from '@/lib/api-posts'
import { useI18n } from '@/i18n'
import type { SettingsDraftSection } from './settings-draft-sections'

const authored = (value: Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>) => JSON.stringify({ modelSlotId: value.modelSlotId, topics: value.topics })

export function useContentEvaluationSettings(enabled: boolean) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: [CONTENT_EVALUATION_QUERY_KEY], queryFn: getContentEvaluationSettings, enabled })
  const [draft, setDraft] = useState<ContentEvaluationSettings | null>(null)
  const effective = draft ?? query.data ?? null
  const mutation = useMutation({
    mutationFn: updateContentEvaluationSettings,
    onSuccess: async (saved, submitted) => {
      queryClient.setQueryData([CONTENT_EVALUATION_QUERY_KEY], saved)
      setDraft(current => current && authored(current) !== authored(submitted)
        ? { ...current, revision: saved.revision, definitionVersion: saved.definitionVersion, modelReady: saved.modelReady }
        : null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MODEL_SLOTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
      ])
    },
  })
  const onPatch = (patch: Partial<Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>>) => {
    setDraft(current => {
      const base = current ?? query.data
      return base ? { ...base, ...patch } : null
    })
  }
  const draftSection: SettingsDraftSection = {
    id: 'content-evaluation', label: t({ ko: '주제 관련도', en: 'Topic relevance' }), tab: 'posts',
    isDirty: Boolean(effective && query.data && authored(effective) !== authored(query.data)),
    save: async () => {
      if (effective) await mutation.mutateAsync({ expectedRevision: effective.revision, modelSlotId: effective.modelSlotId, topics: effective.topics })
    },
    discard: () => setDraft(null),
  }
  return { tabProps: { draft: effective, onPatch, isSaving: mutation.isPending, dirty: draftSection.isDirty, onSave: draftSection.save, error: query.error, onReload: () => { void query.refetch() } }, draftSection }
}
