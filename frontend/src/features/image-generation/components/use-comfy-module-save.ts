import { useEffect, useMemo, useState } from 'react'
import { createComfyModuleFromWorkflow } from '@/lib/api'
import type { WorkflowMarkedField } from '@/lib/api-image-generation'
import {
  buildComfyModuleFieldOptions,
  buildComfyModuleSnapshot,
  buildComfyModuleUiSchema,
  getErrorMessage,
  type ModuleFieldOption,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'

/** Manage Comfy module-save modal state and module creation from the selected workflow draft. */
export function useComfyModuleSave({
  selectedWorkflow,
  selectedWorkflowFields,
  workflowDraft,
  showSnackbar,
}: {
  selectedWorkflow: { id: number } | null
  selectedWorkflowFields: WorkflowMarkedField[]
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [moduleSaveName, setModuleSaveName] = useState('Comfy Module')
  const [moduleSaveDescription, setModuleSaveDescription] = useState('')
  const [moduleExposedFieldKeys, setModuleExposedFieldKeys] = useState<string[]>([])

  const comfyModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => buildComfyModuleFieldOptions(selectedWorkflowFields), [selectedWorkflowFields])

  useEffect(() => {
    const allowedKeys = new Set(comfyModuleFieldOptions.map((field) => field.key))
    setModuleExposedFieldKeys((current) => current.filter((key) => allowedKeys.has(key)))
  }, [comfyModuleFieldOptions])

  /** Open the Comfy module-save modal after validating workflow availability. */
  const handleOpenModuleSave = () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 워크플로우를 선택해줘.', tone: 'error' })
      return
    }

    setIsModuleSaveModalOpen(true)
  }

  /** Close the Comfy module-save modal without changing draft state. */
  const handleCloseModuleSave = () => {
    setIsModuleSaveModalOpen(false)
  }

  /** Save the current Comfy workflow draft as a reusable module definition. */
  const handleCreateModule = async () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 워크플로우를 선택해줘.', tone: 'error' })
      return
    }

    const moduleName = moduleSaveName.trim()
    if (!moduleName) {
      showSnackbar({ message: '모듈 이름을 입력해줘.', tone: 'error' })
      return
    }

    try {
      const snapshot = buildComfyModuleSnapshot(selectedWorkflowFields, workflowDraft)
      const exposedFields = comfyModuleFieldOptions
        .filter((field) => moduleExposedFieldKeys.includes(field.key))
        .map((field) => ({
          key: field.key,
          label: field.label,
          data_type: field.dataType,
        }))
      const uiSchema = buildComfyModuleUiSchema(comfyModuleFieldOptions, workflowDraft, moduleExposedFieldKeys)

      await createComfyModuleFromWorkflow({
        name: moduleName,
        description: moduleSaveDescription.trim() || undefined,
        workflow_id: selectedWorkflow.id,
        snapshot,
        exposed_fields: exposedFields,
        ui_schema: uiSchema,
      })

      setIsModuleSaveModalOpen(false)
      showSnackbar({ message: '현재 ComfyUI 설정을 모듈로 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 모듈 저장에 실패했어.'), tone: 'error' })
    }
  }

  return {
    isModuleSaveModalOpen,
    moduleSaveName,
    setModuleSaveName,
    moduleSaveDescription,
    setModuleSaveDescription,
    moduleExposedFieldKeys,
    setModuleExposedFieldKeys,
    comfyModuleFieldOptions,
    handleOpenModuleSave,
    handleCloseModuleSave,
    handleCreateModule,
  }
}
