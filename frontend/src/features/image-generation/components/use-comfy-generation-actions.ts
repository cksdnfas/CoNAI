import { useState } from 'react'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import type { GenerationImageSaveOptions, WorkflowMarkedField } from '@/lib/api-image-generation'
import {
  buildWorkflowPromptData,
  getErrorMessage,
  hasWorkflowFieldValue,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'

type ConnectedServerLike = {
  id: number
  name: string
}

type ComfyServerTestLike = {
  status?: {
    is_connected?: boolean
  }
}

/** Manage workflow validation and ComfyUI generation requests for one or many servers. */
export function useComfyGenerationActions({
  selectedWorkflow,
  selectedWorkflowFields,
  workflowDraft,
  selectedServerId,
  activeServers,
  connectedServers,
  comfyServerTests,
  imageSaveOptions,
  onHistoryRefresh,
  showSnackbar,
}: {
  selectedWorkflow: { id: number } | null
  selectedWorkflowFields: WorkflowMarkedField[]
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  selectedServerId: string
  activeServers: ConnectedServerLike[]
  connectedServers: ConnectedServerLike[]
  comfyServerTests: Record<number, ComfyServerTestLike>
  imageSaveOptions?: GenerationImageSaveOptions
  onHistoryRefresh: () => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
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

  /** Queue one generation job for a specific ComfyUI server. */
  const handleGenerateOnServer = async (serverId: number) => {
    if (!selectedWorkflow) {
      return null
    }

    const promptData = buildWorkflowPromptData(selectedWorkflowFields, workflowDraft)
    return createGenerationQueueJob({
      service_type: 'comfyui',
      workflow_id: selectedWorkflow.id,
      workflow_name: 'name' in selectedWorkflow ? String(selectedWorkflow.name ?? '') : null,
      requested_server_id: serverId,
      request_summary: 'name' in selectedWorkflow ? `${String(selectedWorkflow.name ?? 'ComfyUI workflow')} queue job` : `ComfyUI workflow ${selectedWorkflow.id} queue job`,
      request_payload: {
        prompt_data: promptData,
        imageSaveOptions,
      },
    })
  }

  /** Generate once on the currently selected server. */
  const handleGenerateSelected = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    const serverId = Number(selectedServerId)
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

    try {
      setIsComfyGenerating(true)
      const response = await handleGenerateOnServer(serverId)
      onHistoryRefresh()
      showSnackbar({ message: response?.message || `${server.name} 큐에 생성 작업을 넣었어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  /** Generate once on every connected server in parallel. */
  const handleGenerateAllServers = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    if (connectedServers.length === 0) {
      showSnackbar({ message: '연결된 ComfyUI 서버가 없어.', tone: 'error' })
      return
    }

    try {
      setIsComfyGenerating(true)
      const results = await Promise.allSettled(connectedServers.map((server) => handleGenerateOnServer(server.id)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - successCount

      onHistoryRefresh()

      if (failedCount === 0) {
        showSnackbar({ message: `${successCount}개 서버 큐에 생성 작업을 넣었어.`, tone: 'info' })
      } else if (successCount === 0) {
        showSnackbar({ message: '모든 서버 큐 등록이 실패했어.', tone: 'error' })
      } else {
        showSnackbar({ message: `${successCount}개 서버 큐 등록 성공, ${failedCount}개 서버 실패.`, tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '전체 서버 생성 요청에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  return {
    isComfyGenerating,
    handleGenerateOnServer,
    handleGenerateSelected,
    handleGenerateAllServers,
  }
}
