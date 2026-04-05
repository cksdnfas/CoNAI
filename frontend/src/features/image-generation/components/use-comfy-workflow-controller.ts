import { useEffect, useMemo, useState } from 'react'
import type { GenerationWorkflow, GenerationWorkflowDetail } from '@/lib/api'
import { buildWorkflowDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'

/** Manage selected workflow state, workflow field drafts, and workflow editor opening flows for the Comfy panel. */
export function useComfyWorkflowController({
  workflows,
  selectedWorkflowDetail,
  showSnackbar,
}: {
  workflows: GenerationWorkflow[]
  selectedWorkflowDetail: GenerationWorkflowDetail | null
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [workflowEditorState, setWorkflowEditorState] = useState<any | null>(null)

  const selectedWorkflow = useMemo(() => {
    if (!selectedWorkflowId) {
      return null
    }

    const selectedId = Number(selectedWorkflowId)
    if (!Number.isFinite(selectedId)) {
      return null
    }

    if (selectedWorkflowDetail && selectedWorkflowDetail.id === selectedId) {
      return selectedWorkflowDetail
    }

    return (workflows.find((workflow) => workflow.id === selectedId) as GenerationWorkflowDetail | undefined) ?? null
  }, [selectedWorkflowDetail, selectedWorkflowId, workflows])

  const selectedWorkflowFields = selectedWorkflow?.marked_fields ?? []

  useEffect(() => {
    if (workflows.length === 0) {
      if (selectedWorkflowId.length > 0) {
        setSelectedWorkflowId('')
      }
      return
    }

    const stillExists = workflows.some((workflow) => String(workflow.id) === selectedWorkflowId)
    if (!stillExists) {
      setSelectedWorkflowId(String(workflows[0].id))
    }
  }, [selectedWorkflowId, workflows])

  useEffect(() => {
    setWorkflowDraft(buildWorkflowDraft(selectedWorkflowFields))
  }, [selectedWorkflowFields])

  /** Update one workflow field draft value. */
  const handleWorkflowFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  /** Open the workflow editor in create mode. */
  const handleOpenCreateWorkflow = () => {
    setWorkflowEditorState({
      mode: 'create',
      workflowId: null,
      name: '',
      description: '',
      workflowJson: '',
    })
  }

  /** Open the workflow editor in edit mode for the currently selected workflow. */
  const handleOpenEditWorkflow = () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 워크플로우를 선택해줘.', tone: 'error' })
      return
    }

    setWorkflowEditorState({
      mode: 'edit',
      workflowId: selectedWorkflow.id,
      name: selectedWorkflow.name,
      description: selectedWorkflow.description ?? '',
      workflowJson: (selectedWorkflow as any).workflow_json ?? '',
    })
  }

  return {
    selectedWorkflowId,
    setSelectedWorkflowId,
    workflowDraft,
    setWorkflowDraft,
    workflowEditorState,
    setWorkflowEditorState,
    selectedWorkflow,
    selectedWorkflowFields,
    handleWorkflowFieldChange,
    handleOpenCreateWorkflow,
    handleOpenEditWorkflow,
  }
}
