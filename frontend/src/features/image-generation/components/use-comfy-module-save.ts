import { useEffect, useMemo, useState } from 'react'
import { createComfyModuleFromWorkflow, type ModulePortDataType } from '@/lib/api'
import type { WorkflowMarkedField } from '@/lib/api-image-generation'
import { getErrorMessage, type ModuleFieldOption, type WorkflowFieldDraftValue } from '../image-generation-shared'

/** Map one marked workflow field to the closest module-port data type. */
function getComfyModuleFieldDataType(field: WorkflowMarkedField): ModulePortDataType {
  if (field.type === 'image') {
    return 'image'
  }

  if (field.type === 'number') {
    return 'number'
  }

  return 'text'
}

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

  const comfyModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => (
    selectedWorkflowFields.map((field) => ({
      key: field.id,
      label: field.label,
      dataType: getComfyModuleFieldDataType(field),
      options: field.options,
    }))
  ), [selectedWorkflowFields])

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
      await createComfyModuleFromWorkflow(selectedWorkflow.id, {
        name: moduleName,
        description: moduleSaveDescription.trim() || undefined,
        exposed_field_ids: comfyModuleFieldOptions
          .filter((field) => moduleExposedFieldKeys.includes(field.key))
          .map((field) => field.key),
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
