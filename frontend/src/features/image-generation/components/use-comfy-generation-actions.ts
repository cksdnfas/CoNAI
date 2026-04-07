import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { generateComfyUIImage } from '@/lib/api'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation'
import type { GenerationImageSaveOptions, WorkflowMarkedField } from '@/lib/api-image-generation'
import {
  buildWorkflowPromptData,
  getErrorMessage,
  hasWorkflowFieldValue,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'
import { prependGenerationHistoryRecords } from '../generation-history-cache'

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

  /** Send one generation request to a specific server. */
  const handleGenerateOnServer = async (serverId: number) => {
    if (!selectedWorkflow) {
      return null
    }

    const promptData = buildWorkflowPromptData(selectedWorkflowFields, workflowDraft)
    return generateComfyUIImage(selectedWorkflow.id, {
      prompt_data: promptData,
      server_id: serverId,
      imageSaveOptions,
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
      if (selectedWorkflow && response?.data.history_id) {
        const optimisticRecord: GenerationHistoryRecord = {
          id: response.data.history_id,
          service_type: 'comfyui',
          generation_status: response.data.status,
          workflow_id: selectedWorkflow.id,
          workflow_name: 'name' in selectedWorkflow ? String(selectedWorkflow.name ?? '') : null,
          width: null,
          height: null,
          created_at: new Date().toISOString(),
        }
        prependGenerationHistoryRecords(queryClient, 'comfyui', [optimisticRecord], selectedWorkflow.id)
      }
      onHistoryRefresh()
      showSnackbar({ message: response?.data.message || `${server.name}에 생성 요청을 시작했어.`, tone: 'info' })
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

      const optimisticRecords: GenerationHistoryRecord[] = []
      results.forEach((result) => {
        if (result.status !== 'fulfilled' || !result.value) {
          return
        }

        const responseData = result.value.data
        const historyId = responseData.history_id
        if (!selectedWorkflow || !historyId) {
          return
        }

        optimisticRecords.push({
          id: historyId,
          service_type: 'comfyui',
          generation_status: responseData.status,
          workflow_id: selectedWorkflow.id,
          workflow_name: 'name' in selectedWorkflow ? String(selectedWorkflow.name ?? '') : null,
          width: null,
          height: null,
          created_at: new Date().toISOString(),
        })
      })

      if (optimisticRecords.length > 0 && selectedWorkflow) {
        prependGenerationHistoryRecords(queryClient, 'comfyui', optimisticRecords, selectedWorkflow.id)
        onHistoryRefresh()
      }

      if (failedCount === 0) {
        showSnackbar({ message: `${successCount}개 서버에 생성 요청을 보냈어.`, tone: 'info' })
      } else if (successCount === 0) {
        showSnackbar({ message: '모든 서버 생성 요청이 실패했어.', tone: 'error' })
      } else {
        showSnackbar({ message: `${successCount}개 서버 성공, ${failedCount}개 서버 실패.`, tone: 'error' })
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
