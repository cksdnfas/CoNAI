import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { enqueueSnackbar } from 'notistack'
import { workflowApi, type MarkedField, type Workflow } from '@/services/workflow-api'
import { generationHistoryApi } from '@/services/generation-history-api'
import type { ComfyUIServer } from '@/services/comfyui-server-api'
import { hasEmptyPrompts } from '../utils/prompt-builder'
import type { ServerGenerationStatus } from '../types/workflow.types'
import type { PromptParseResult } from '../types/prompt.types'

interface UseImageGenerationProps {
  workflowId: string | undefined
  workflow: Workflow | null
  formData: Record<string, unknown>
  getPromptData: () => Promise<PromptParseResult>
  selectedGroupId: number | null
  servers: ComfyUIServer[]
  setGenerationStatus: React.Dispatch<React.SetStateAction<Record<number, ServerGenerationStatus>>>
  setError: (error: string | null) => void
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as {
      response?: { data?: { error?: string } }
      message?: string
    }
    return maybeError.response?.data?.error || maybeError.message || 'Generation failed'
  }
  return 'Generation failed'
}

export function useImageGeneration({
  workflowId,
  workflow,
  formData,
  getPromptData,
  selectedGroupId,
  servers,
  setGenerationStatus,
  setError,
}: UseImageGenerationProps) {
  const { t } = useTranslation(['workflows'])
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const queryClient = useQueryClient()

  const pollGenerationStatus = useCallback(
    async (serverId: number, apiHistoryId: number): Promise<void> => {
      const maxAttempts = 150
      let attempts = 0
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      return await new Promise((resolve, reject) => {
        const checkStatus = async () => {
          attempts += 1

          try {
            const response = await generationHistoryApi.getById(apiHistoryId, true)
            const data = response.record

            if (data.generation_status === 'completed' || data.generation_status === 'failed') {
              if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
              }

              setGenerationStatus((previous) => ({
                ...previous,
                [serverId]: {
                  status: data.generation_status as 'completed' | 'failed',
                  historyId: apiHistoryId,
                  error: data.error_message,
                },
              }))

              if (data.generation_status === 'completed') {
                setHistoryRefreshKey((previous) => {
                  const nextKey = previous + 1
                  void queryClient.invalidateQueries({ queryKey: ['images'] })
                  setTimeout(() => resolve(), 0)
                  return nextKey
                })
              } else {
                reject(new Error(data.error_message || 'Generation failed'))
              }
              return
            }

            if (attempts >= maxAttempts) {
              if (timeoutId) {
                clearTimeout(timeoutId)
              }
              reject(new Error('Generation timeout (5 minutes)'))
              return
            }

            timeoutId = setTimeout(checkStatus, 2000)
          } catch {
            if (attempts >= maxAttempts) {
              if (timeoutId) {
                clearTimeout(timeoutId)
              }
              reject(new Error('Status check failed after timeout'))
              return
            }
            timeoutId = setTimeout(checkStatus, 2000)
          }
        }

        void checkStatus()
      })
    },
    [queryClient, setGenerationStatus],
  )

  const handleGenerateOnServer = useCallback(
    async (serverId: number): Promise<void> => {
      const server = servers.find((item) => item.id === serverId)
      if (!server) {
        return
      }

      if (workflow?.marked_fields) {
        const missingFields = workflow.marked_fields.filter(
          (field: MarkedField) => field.required && !formData[field.id],
        )

        if (missingFields.length > 0) {
          setError(t('workflows:generate.missingFields', { fields: missingFields.map((field) => field.label).join(', ') }))
          return
        }
      }

      try {
        setGenerationStatus((previous) => ({
          ...previous,
          [serverId]: { status: 'generating', progress: 0 },
        }))
        setError(null)

        const parseResult = await getPromptData()

        if (parseResult.emptyWildcards && parseResult.emptyWildcards.length > 0) {
          const uniqueEmpty = Array.from(new Set(parseResult.emptyWildcards))
          enqueueSnackbar(`다음 와일드카드에 ComfyUI 항목이 없습니다: ${uniqueEmpty.join(', ')}`, {
            variant: 'warning',
            autoHideDuration: 5000,
          })
        }

        if (hasEmptyPrompts(parseResult.data)) {
          const errorMessage = t('workflows:generate.emptyPrompt')
          setError(errorMessage)
          enqueueSnackbar(errorMessage, { variant: 'error', autoHideDuration: 5000 })
          setGenerationStatus((previous) => ({
            ...previous,
            [serverId]: { status: 'failed', error: errorMessage },
          }))
          return
        }

        if (!workflowId) {
          throw new Error('Workflow id is missing')
        }

        const response = await workflowApi.generateImageOnServer(
          parseInt(workflowId, 10),
          serverId,
          parseResult.data,
          selectedGroupId || undefined,
        )

        const apiHistoryId = response.data.history_id
        if (!apiHistoryId) {
          throw new Error('Failed to start image generation')
        }

        setGenerationStatus((previous) => ({
          ...previous,
          [serverId]: {
            status: 'generating',
            historyId: apiHistoryId,
          },
        }))

        await pollGenerationStatus(serverId, apiHistoryId)
      } catch (generateError) {
        setGenerationStatus((previous) => ({
          ...previous,
          [serverId]: {
            status: 'failed',
            error: getErrorMessage(generateError),
          },
        }))
        throw generateError
      }
    },
    [formData, getPromptData, pollGenerationStatus, selectedGroupId, servers, setError, setGenerationStatus, t, workflow, workflowId],
  )

  return {
    historyRefreshKey,
    handleGenerateOnServer,
  }
}
