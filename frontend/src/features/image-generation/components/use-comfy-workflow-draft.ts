import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import {
  buildWorkflowDraft,
  clearPersistedComfyWorkflowDraft,
  deleteComfyWorkflowDraftInputAssets,
  loadPersistedComfyWorkflowDraft,
  persistComfyWorkflowDraft,
} from '../image-generation-drafts'
import { hasWorkflowDraftDifference } from '../history-settings-mapping'
import type { WorkflowFieldDraftValue } from '../image-generation-shared'

type DraftIdentity = { owner: string; workflowId: number }

/** Shared account-scoped draft, delayed persistence and explicit reset for private and public workflows. */
export function useComfyWorkflowDraft(owner: string, workflow: { id: number; name?: string | null } | null, fields: WorkflowMarkedField[]) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [identity, setIdentity] = useState<DraftIdentity | null>(null)
  const loaded = useRef<DraftIdentity | null>(null)
  const pending = useRef<{ owner: string; workflowId: number; draft: Record<string, WorkflowFieldDraftValue> } | null>(null)
  const persistTimer = useRef<number | null>(null)
  const workflowId = workflow?.id ?? null

  useEffect(() => {
    if (workflowId === null) {
      loaded.current = null
      setIdentity(null)
      setDraft({})
      return
    }
    const sameDraft = loaded.current?.owner === owner && loaded.current.workflowId === workflowId
    const restored = { ...buildWorkflowDraft(fields), ...loadPersistedComfyWorkflowDraft(owner, workflowId, fields) }
    const validIds = new Set(fields.map((field) => field.id))
    setDraft((current) => sameDraft
      ? { ...restored, ...Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))) }
      : restored)
    const nextIdentity = { owner, workflowId }
    loaded.current = nextIdentity
    setIdentity(nextIdentity)
  }, [fields, owner, workflowId])

  const draftOwnerId = identity?.owner === owner && identity.workflowId === workflowId ? identity.workflowId : null
  useEffect(() => {
    if (draftOwnerId === null) return
    pending.current = { owner, workflowId: draftOwnerId, draft }
    const timer = window.setTimeout(() => {
      persistComfyWorkflowDraft(owner, draftOwnerId, draft)
      pending.current = null
      persistTimer.current = null
    }, 250)
    persistTimer.current = timer
    return () => {
      window.clearTimeout(timer)
      if (persistTimer.current === timer) persistTimer.current = null
    }
  }, [draft, draftOwnerId, owner])
  useEffect(() => () => {
    const value = pending.current
    if (value?.owner === owner && value.workflowId === draftOwnerId) {
      persistComfyWorkflowDraft(value.owner, value.workflowId, value.draft)
      pending.current = null
    }
  }, [draftOwnerId, owner])

  const discardPending = () => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current)
    persistTimer.current = null
    pending.current = null
  }
  const persistDraft = (nextDraft: Record<string, WorkflowFieldDraftValue>) => {
    // Compare by value: a field-definition refresh replaces the loaded object without changing the account or workflow.
    if (draftOwnerId === null || loaded.current?.owner !== owner || loaded.current.workflowId !== draftOwnerId) return false
    discardPending()
    persistComfyWorkflowDraft(owner, draftOwnerId, nextDraft)
    return true
  }
  const resetDraft = async () => {
    if (!workflow || draftOwnerId !== workflow.id) return false
    const resetOwner = owner
    const resetWorkflowId = workflow.id
    const baseDraft = buildWorkflowDraft(fields)
    if (hasWorkflowDraftDifference(fields, draft, baseDraft)) {
      const confirmed = await confirm({
        title: t({ ko: '워크플로우 입력을 초기화할까?', en: 'Reset the workflow inputs?' }),
        description: t({
          ko: '{name}의 입력값이 기본값으로 돌아가고 저장된 초안도 지워져. 업로드한 입력 이미지는 서버에서도 삭제돼. 되돌릴 수 없어.',
          en: 'All inputs of {name} go back to their defaults and the saved draft is cleared. Uploaded input images are also deleted from the server. This cannot be undone.',
        }, { name: workflow.name ?? '' }),
        confirmLabel: t({ ko: '초기화', en: 'Reset' }),
        tone: 'destructive',
      })
      if (!confirmed) return false
    }
    if (loaded.current?.owner !== resetOwner || loaded.current.workflowId !== resetWorkflowId) return false
    void deleteComfyWorkflowDraftInputAssets(draft)
    discardPending()
    clearPersistedComfyWorkflowDraft(owner, workflow.id)
    setDraft(baseDraft)
    return true
  }

  return { workflowDraft: draft, setWorkflowDraft: setDraft, workflowDraftOwnerId: draftOwnerId, persistDraft, resetDraft }
}
