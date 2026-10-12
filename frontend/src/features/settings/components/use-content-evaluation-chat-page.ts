import { useLayoutEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TOPIC_EVALUATION_LIMITS, type ContentEvaluationSettings, type ContentEvaluationTopic } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots } from '@/lib/api-codex-chat'
import { createRandomUuid } from '@/lib/random-uuid'
import { contentEvaluationAuthored, contentEvaluationChatActions, contentEvaluationChatData, contentEvaluationModelPatch, contentEvaluationTopicPatch, type ContentEvaluationDraftPatch } from './content-evaluation-chat'

/** Register this LLM view above the settings overview; edits remain in its existing save-bar draft. */
export function useContentEvaluationChatPage({ draft, onPatch, isSaving, dirty, onSave, onOpenTopic }: {
  draft: ContentEvaluationSettings | null
  onPatch: (patch: ContentEvaluationDraftPatch) => void
  isSaving: boolean
  dirty: boolean
  onSave: () => Promise<void>
  onOpenTopic: (topic: ContentEvaluationTopic) => void
}) {
  const { t } = useI18n()
  const models = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: draft !== null }).data ?? []
  const current = useRef(draft)
  useLayoutEffect(() => { current.current = draft }, [draft])
  const restorePoint = (patch: ContentEvaluationDraftPatch) => {
    if (!draft) throw new Error('주제 관련도 설정을 다시 불러와줘.')
    const after = { ...draft, ...patch }
    return {
      isCurrent: () => current.current !== null && contentEvaluationAuthored(current.current) === contentEvaluationAuthored(after),
      restore: () => onPatch({ modelSlotId: draft.modelSlotId, topics: draft.topics }),
    }
  }
  useChatPageRegistration(draft ? {
    kind: 'settings', title: t({ ko: '설정 · 게시판 · 주제 관련도', en: 'Settings · Posts · Topic relevance' }), resourceId: 'content-evaluation', priority: 5, dirty,
    fields: [{ id: 'modelSlotId', label: t({ ko: '판단 모델 ID (0: 사용 안 함)', en: 'Judge model id (0: off)' }), type: 'number', min: 0, integer: true, value: draft.modelSlotId ?? 0, hint: 'Choose an id from data.models; 0 disables the judge.' }],
    data: contentEvaluationChatData(draft, models), actions: contentEvaluationChatActions(t),
    apply: patch => { if (patch.modelSlotId !== undefined) onPatch(contentEvaluationModelPatch(patch.modelSlotId, models)) },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (isSaving) throw new Error('설정 저장이 끝난 뒤 다시 요청해줘.')
      if (id === 'settings.save') { await onSave(); return }
      if (id === 'resource.open') {
        if (args.topicId === undefined && draft.topics.length >= TOPIC_EVALUATION_LIMITS.totalTopics) throw new Error('평가 주제는 최대 100개까지 등록할 수 있어.')
        const topic = args.topicId === undefined
          ? { id: createRandomUuid(), name: '', description: '', enabled: draft.topics.filter(item => item.enabled).length < TOPIC_EVALUATION_LIMITS.activeTopics }
          : draft.topics.find(item => item.id === args.topicId)
        if (!topic) throw new Error('목록에 없는 평가 주제야.')
        onOpenTopic(topic)
        return
      }
      if (id !== 'settings.content_topic') throw new Error('주제 관련도 화면에 없는 작업이야.')
      const patch = contentEvaluationTopicPatch(draft.topics, args)
      const undo = restorePoint(patch)
      onPatch(patch)
      return undo
    },
  } : null, { preserveOnSearchChange: true })
  return restorePoint
}
