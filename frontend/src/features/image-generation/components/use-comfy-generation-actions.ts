import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import type { GenerationImageSaveOptions, WorkflowMarkedField } from '@/lib/api-image-generation'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import {
  buildWorkflowPromptData,
  getErrorMessage,
  hasWorkflowFieldValue,
  parseNumberInput,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'

type ServerLike = {
  id: number
  name: string
  routing_tags?: string[]
}

type ComfyServerTestLike = {
  status?: {
    is_connected?: boolean
  }
}

const COMFY_QUEUE_REGISTRATION_COUNT_MIN = 1
const COMFY_QUEUE_REGISTRATION_COUNT_MAX = 32

function normalizeRoutingTag(value: string) {
  return value.trim().toLowerCase()
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
  const queryClient = useQueryClient()
  const [isComfyGenerating, setIsComfyGenerating] = useState(false)

  /** Validate the currently selected workflow fields before any generation request. */
  const validateComfyGeneration = () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 ComfyUI 워크플로우를 선택해줘.', tone: 'error' })
      return false
    }

    const missingField = selectedWorkflowFields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id]))
    if (missingField) {
      showSnackbar({ message: `필수 필드가 비어 있어: ${missingField.label}`, tone: 'error' })
      return false
    }

    return true
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
      request_summary: `${selectedWorkflow.name ?? `ComfyUI workflow ${selectedWorkflow.id}`} queue job`,
      request_payload: {
        prompt_data: promptData,
        imageSaveOptions,
      },
    }
  }

  /** Queue one generation job for a specific ComfyUI server. */
  const handleGenerateOnServer = async (serverId: number) => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob({
      ...basePayload,
      requested_server_id: serverId,
    })
  }

  /** Queue one generation job using automatic idle-server routing. */
  const handleGenerateAuto = async () => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob(basePayload)
  }

  /** Queue one generation job that targets a specific routing tag. */
  const handleGenerateOnTag = async (serverTag: string) => {
    const basePayload = buildQueuePayload()
    if (!basePayload) {
      return null
    }

    return createGenerationQueueJob({
      ...basePayload,
      requested_server_tag: serverTag,
    })
  }

  /** Generate one or many queue jobs on the current routing target. */
  const handleGenerateSelected = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    const registrationCount = clampComfyQueueRegistrationCount(queueRegistrationCount)

    try {
      let enqueueJob: (() => Promise<Awaited<ReturnType<typeof createGenerationQueueJob>> | null>) | null = null
      let targetLabel = 'ComfyUI'

      if (selectedTarget === 'auto') {
        if (connectedServers.length === 0) {
          showSnackbar({ message: '연결된 ComfyUI 서버가 없어.', tone: 'error' })
          return
        }

        enqueueJob = () => handleGenerateAuto()
        targetLabel = '자동 분산'
      } else if (selectedTarget.startsWith('tag:')) {
        const selectedTag = normalizeRoutingTag(selectedTarget.slice('tag:'.length))
        const matchingConnectedServers = connectedServers.filter((server) => (server.routing_tags ?? []).includes(selectedTag))
        if (matchingConnectedServers.length === 0) {
          showSnackbar({ message: `연결된 #${selectedTag} 서버가 없어.`, tone: 'error' })
          return
        }

        enqueueJob = () => handleGenerateOnTag(selectedTag)
        targetLabel = `#${selectedTag}`
      } else if (selectedTarget.startsWith('server:')) {
        const serverId = Number(selectedTarget.slice('server:'.length))
        if (!Number.isFinite(serverId)) {
          showSnackbar({ message: '생성할 서버를 먼저 골라줘.', tone: 'error' })
          return
        }

        const server = activeServers.find((item) => item.id === serverId)
        if (!server) {
          showSnackbar({ message: '선택한 서버를 찾지 못했어.', tone: 'error' })
          return
        }

        if (comfyServerTests[serverId]?.status?.is_connected !== true) {
          showSnackbar({ message: '선택한 서버가 아직 연결 확인되지 않았어.', tone: 'error' })
          return
        }

        enqueueJob = () => handleGenerateOnServer(serverId)
        targetLabel = server.name
      } else {
        showSnackbar({ message: '생성 타겟이 올바르지 않아.', tone: 'error' })
        return
      }

      if (!enqueueJob) {
        showSnackbar({ message: '생성 타겟이 올바르지 않아.', tone: 'error' })
        return
      }

      setIsComfyGenerating(true)
      const results = await Promise.allSettled(Array.from({ length: registrationCount }, () => enqueueJob()))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - successCount

      void refreshGenerationQueueViews(queryClient, onHistoryRefresh)

      if (failedCount === 0) {
        showSnackbar({ message: `${targetLabel} 큐에 ${successCount}건 등록했어.`, tone: 'info' })
      } else if (successCount === 0) {
        showSnackbar({ message: `${targetLabel} 큐 등록이 전부 실패했어.`, tone: 'error' })
      } else {
        showSnackbar({ message: `${targetLabel} 큐 등록 ${successCount}건 성공, ${failedCount}건 실패.`, tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  return {
    isComfyGenerating,
    handleGenerateOnServer,
    handleGenerateSelected,
  }
}
