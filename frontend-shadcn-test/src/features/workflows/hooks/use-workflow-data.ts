import { useCallback, useState } from 'react'
import { workflowApi, type Workflow } from '@/services/workflow-api'
import { buildPromptDataWithWildcards, initializeFormData } from '../../../../legacy-src/pages/Workflows/utils/promptBuilder'
import type { PromptParseResult } from '../types/prompt.types'

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as {
      response?: { data?: { error?: string } }
      message?: string
    }
    return maybeError.response?.data?.error || maybeError.message || 'Unknown error'
  }
  return 'Unknown error'
}

export function useWorkflowData(workflowId: string | undefined) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})

  const loadWorkflow = useCallback(async () => {
    if (!workflowId) {
      return
    }

    try {
      setLoading(true)
      const response = await workflowApi.getWorkflow(parseInt(workflowId, 10))
      const workflowData: Workflow = response.data
      setWorkflow(workflowData)
      setFormData(initializeFormData(workflowData))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    setFormData((previous) => ({
      ...previous,
      [fieldId]: value,
    }))
  }, [])

  const getPromptData = useCallback(async (): Promise<PromptParseResult> => {
    const result = await buildPromptDataWithWildcards(workflow, formData)
    return {
      data: result.data as Record<string, unknown>,
      emptyWildcards: result.emptyWildcards,
    }
  }, [formData, workflow])

  return {
    loading,
    error,
    setError,
    workflow,
    formData,
    loadWorkflow,
    handleFieldChange,
    getPromptData,
  }
}
