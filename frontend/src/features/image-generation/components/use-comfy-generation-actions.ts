import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import type { GenerationImageSaveOptions, WorkflowMarkedField } from '@/lib/api-image-generation'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { revealFirstInvalidField } from './focus-invalid-field'
import { WORKFLOW_FIELD_INVALID_SELECTOR } from './workflow-field-disclosure-card'
import { IMAGE_GENERATION_TARGET_GROUP_KEY, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'
import {
  buildWorkflowPromptData,
  collectWorkflowNodeDraftIssues,
  hasWorkflowFieldValue,
  isValidWorkflowNumberDraftValue,
} from '../image-generation-drafts'
import {
  getErrorMessage,
  parseNumberInput,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'

type ServerLike = {
  id: number
  name: string
  backend_type?: 'comfyui' | 'modal'
  routing_tags?: string[]
}

type ComfyServerTestLike = {
  status?: {
    backend_type?: 'comfyui' | 'modal'
    is_connected?: boolean
  }
}

const COMFY_QUEUE_REGISTRATION_COUNT_MIN = 1
const COMFY_QUEUE_REGISTRATION_COUNT_MAX = 32

function normalizeRoutingTag(value: string) {
  return value.trim().toLowerCase()
}

function isModalServer(server: ServerLike, serverTests: Record<number, ComfyServerTestLike>) {
  return server.backend_type === 'modal' || serverTests[server.id]?.status?.backend_type === 'modal'
}

/** Clamp the requested ComfyUI queue registration count into a safe integer range. */
function clampComfyQueueRegistrationCount(value: string) {
  const parsed = Math.trunc(parseNumberInput(value, COMFY_QUEUE_REGISTRATION_COUNT_MIN))
  return Math.min(COMFY_QUEUE_REGISTRATION_COUNT_MAX, Math.max(COMFY_QUEUE_REGISTRATION_COUNT_MIN, parsed))
}

/** Manage workflow validation and ComfyUI generation requests for one or many servers. */
export function useComfyGenerationActions({
  selectedWorkflow,
  selectedWorkflowFields,
  workflowDraft,
  selectedTarget,
  queueRegistrationCount,
  activeServers,
  connectedServers,
  comfyServerTests,
  imageSaveOptions,
  onHistoryRefresh,
  showSnackbar,
}: {
  selectedWorkflow: { id: number; name?: string | null } | null
  selectedWorkflowFields: WorkflowMarkedField[]
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  selectedTarget: string
  queueRegistrationCount: string
  activeServers: ServerLike[]
  connectedServers: ServerLike[]
  comfyServerTests: Record<number, ComfyServerTestLike>
  imageSaveOptions?: GenerationImageSaveOptions
  onHistoryRefresh: () => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [isComfyGenerating, setIsComfyGenerating] = useState(false)
  // 마지막 생성 시도에서 걸린 필드별 메시지. 필드를 고치면 해당 항목만 지운다.
  const [fieldIssues, setFieldIssues] = useState<Record<string, string>>({})
  const [fieldIssueRevealNonce, setFieldIssueRevealNonce] = useState(0)
  const { requestPath: targetGroupPath } = useGenerationTargetGroupPath(IMAGE_GENERATION_TARGET_GROUP_KEY)
  const selectedWorkflowId = selectedWorkflow?.id ?? null

  useEffect(() => {
    setFieldIssues({})
  }, [selectedWorkflowId])

  useEffect(() => {
    if (fieldIssueRevealNonce === 0) {
      return
    }

    // 카드가 펼쳐진 다음 프레임에 첫 번째 문제 필드로 스크롤/포커스한다.
    const frame = window.requestAnimationFrame(() => {
      revealFirstInvalidField(WORKFLOW_FIELD_INVALID_SELECTOR)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fieldIssueRevealNonce])

  /** Drop the validation mark of one field once the user edits it. */
  const clearFieldIssue = useCallback((fieldId: string) => {
    setFieldIssues((current) => {
      if (!(fieldId in current)) {
        return current
      }

      const next = { ...current }
      delete next[fieldId]
      return next
    })
  }, [])

  const clearFieldIssues = useCallback(() => {
    setFieldIssues({})
  }, [])

  /**
   * Validate the currently selected workflow fields before any generation request.
   * Every offending field is marked in place; the snackbar only summarizes the first one.
   */
  const validateComfyGeneration = () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: t({ ko: '먼저 ComfyUI 워크플로우를 선택해줘.', en: 'Select a ComfyUI workflow first.' }), tone: 'error' })
      return false
    }

    const nextFieldIssues: Record<string, string> = {}
    const summaries: string[] = []
    const nodeIssuesByFieldId = new Map(
      collectWorkflowNodeDraftIssues(selectedWorkflowFields, workflowDraft).map((entry) => [entry.field.id, entry.issue] as const),
    )

    for (const field of selectedWorkflowFields) {
      const value = workflowDraft[field.id]
      const nodeIssue = nodeIssuesByFieldId.get(field.id)
      if (field.required && !hasWorkflowFieldValue(value)) {
        nextFieldIssues[field.id] = t({ ko: '필수 입력이야.', en: 'This field is required.' })
        summaries.push(t({ ko: '필수 필드가 비어 있어: {label}', en: 'A required field is empty: {label}' }, { label: field.label }))
      } else if (field.type === 'number' && hasWorkflowFieldValue(value) && !isValidWorkflowNumberDraftValue(value)) {
        nextFieldIssues[field.id] = t({ ko: '올바른 숫자를 입력해줘.', en: 'Enter a valid number.' })
        summaries.push(t({ ko: '숫자 필드 값이 올바르지 않아: {label}', en: 'Invalid number field value: {label}' }, { label: field.label }))
      } else if (nodeIssue) {
        const issueMessage = t({ ko: nodeIssue.ko, en: nodeIssue.en })
        nextFieldIssues[field.id] = issueMessage
        summaries.push(`${field.label}: ${issueMessage}`)
      }
    }

    setFieldIssues(nextFieldIssues)
    if (summaries.length === 0) {
      return true
    }

    setFieldIssueRevealNonce((current) => current + 1)
    const extraCount = summaries.length - 1
    showSnackbar({
      message: extraCount > 0
        ? t({ ko: '{message} (외 {count}개)', en: '{message} (+{count} more)' }, { message: summaries[0], count: extraCount })
        : summaries[0],
      tone: 'error',
    })
    return false
  }

  /** Mark and focus the invalid fields without submitting (used while Generate is disabled). */
  const revealComfyFieldIssues = () => {
    validateComfyGeneration()
  }

  /** Build the shared request payload for one ComfyUI queue job. */
  const buildQueuePayload = () => {
    if (!selectedWorkflow) {
      return null
    }

    const promptData = buildWorkflowPromptData(selectedWorkflowFields, workflowDraft)
    return {
      service_type: 'comfyui' as const,
      workflow_id: selectedWorkflow.id,
      workflow_name: selectedWorkflow.name ?? null,
      requested_group_path: targetGroupPath,
      request_summary: `${selectedWorkflow.name ?? `ComfyUI workflow ${selectedWorkflow.id}`} queue job`,
      request_payload: {
        prompt_data: promptData,
        imageSaveOptions,
      },
    }
  }

  /** Queue one or many generation jobs for a specific ComfyUI server. */
  const handleGenerateOnServer = async (serverId: number, enqueueCount = 1) => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob({
      ...basePayload,
      requested_server_id: serverId,
      enqueue_count: enqueueCount,
    })
  }

  /** Queue one or many generation jobs using automatic idle-server routing. */
  const handleGenerateAuto = async (enqueueCount = 1) => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob({ ...basePayload, enqueue_count: enqueueCount })
  }

  /** Queue one or many generation jobs that target a specific routing tag. */
  const handleGenerateOnTag = async (serverTag: string, enqueueCount = 1) => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob({
      ...basePayload,
      requested_server_tag: serverTag,
      enqueue_count: enqueueCount,
    })
  }

  /** Generate one or many queue jobs on the current routing target. */
  const handleGenerateSelected = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    const registrationCount = clampComfyQueueRegistrationCount(queueRegistrationCount)

    try {
      // PAYLOAD-3: one request carries the count. Firing N requests re-uploaded the whole
      // payload — up to 5MB of base64 img2img input — once per copy.
      let enqueueJob: ((count: number) => Promise<Awaited<ReturnType<typeof createGenerationQueueJob>> | null>) | null = null
      let targetLabel = 'ComfyUI'

      if (selectedTarget === 'auto') {
        const connectedComfyServers = connectedServers.filter((server) => !isModalServer(server, comfyServerTests))
        if (connectedComfyServers.length === 0) {
          showSnackbar({ message: t({ ko: '연결된 ComfyUI 서버가 없어.', en: 'No ComfyUI server is connected.' }), tone: 'error' })
          return
        }

        enqueueJob = (count) => handleGenerateAuto(count)
        targetLabel = t({ ko: '자동 분산', en: 'Auto routing' })
      } else if (selectedTarget.startsWith('tag:')) {
        const selectedTag = normalizeRoutingTag(selectedTarget.slice('tag:'.length))
        const matchingServers = activeServers.filter((server) => {
          if (!(server.routing_tags ?? []).includes(selectedTag)) {
            return false
          }

          return isModalServer(server, comfyServerTests) || comfyServerTests[server.id]?.status?.is_connected === true
        })
        if (matchingServers.length === 0) {
          showSnackbar({ message: t({ ko: '연결된 #{tag} 서버가 없어.', en: 'No connected #{tag} server.' }, { tag: selectedTag }), tone: 'error' })
          return
        }

        enqueueJob = (count) => handleGenerateOnTag(selectedTag, count)
        targetLabel = `#${selectedTag}`
      } else if (selectedTarget.startsWith('server:')) {
        const serverId = Number(selectedTarget.slice('server:'.length))
        if (!Number.isFinite(serverId)) {
          showSnackbar({ message: t({ ko: '생성할 서버를 먼저 골라줘.', en: 'Choose a server to generate on first.' }), tone: 'error' })
          return
        }

        const server = activeServers.find((item) => item.id === serverId)
        if (!server) {
          showSnackbar({ message: t({ ko: '선택한 서버를 찾지 못했어.', en: 'Could not find the selected server.' }), tone: 'error' })
          return
        }

        if (!isModalServer(server, comfyServerTests) && comfyServerTests[serverId]?.status?.is_connected !== true) {
          showSnackbar({ message: t({ ko: '선택한 서버가 아직 연결 확인되지 않았어.', en: 'The selected server has not been confirmed as connected yet.' }), tone: 'error' })
          return
        }

        enqueueJob = (count) => handleGenerateOnServer(serverId, count)
        targetLabel = server.name
      } else {
        showSnackbar({ message: t({ ko: '생성 타겟이 올바르지 않아.', en: 'The generation target is invalid.' }), tone: 'error' })
        return
      }

      if (!enqueueJob) {
        showSnackbar({ message: t({ ko: '생성 타겟이 올바르지 않아.', en: 'The generation target is invalid.' }), tone: 'error' })
        return
      }

      setIsComfyGenerating(true)
      const response = await enqueueJob(registrationCount)
      const successCount = response?.enqueued_count ?? (response?.record ? 1 : 0)
      const failedCount = registrationCount - successCount

      void refreshGenerationQueueViews(queryClient, onHistoryRefresh)

      if (successCount === 0) {
        showSnackbar({ message: t({ ko: '{target} 큐 등록이 전부 실패했어.', en: 'All {target} queue registrations failed.' }, { target: targetLabel }), tone: 'error' })
      } else if (failedCount <= 0) {
        showSnackbar({ message: t({ ko: '{target} 큐에 {count}건 등록했어.', en: 'Added {count} jobs to the {target} queue.' }, { target: targetLabel, count: successCount }), tone: 'info' })
      } else {
        showSnackbar({ message: t({ ko: '{target} 큐 등록 {succeeded}건 성공, {failed}건 실패.', en: '{target} queue: {succeeded} added, {failed} failed.' }, { target: targetLabel, succeeded: successCount, failed: failedCount }), tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'ComfyUI 생성에 실패했어.', en: 'ComfyUI generation failed.' })), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  return {
    isComfyGenerating,
    fieldIssues,
    clearFieldIssue,
    clearFieldIssues,
    revealComfyFieldIssues,
    handleGenerateOnServer,
    handleGenerateSelected,
  }
}
