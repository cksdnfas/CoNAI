import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import type { GenerationWorkflow, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { createComfyModuleFromWorkflow, getModuleDefinitions } from '@/lib/api-module-graph'
import { getErrorMessage, type ModuleFieldOption } from '../image-generation-shared'
import type { ComfyModuleSaveModal } from './comfy-module-save-modal'

/** State, overwrite candidates and save action for wrapping a ComfyUI workflow as a graph module. */
export function useComfyModuleSave({
  workflowById,
  resolveWorkflowFields,
}: {
  workflowById: Map<number, GenerationWorkflow>
  resolveWorkflowFields: (workflow: GenerationWorkflow | null) => WorkflowMarkedField[]
}) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [moduleSaveWorkflowId, setModuleSaveWorkflowId] = useState<number | null>(null)
  const [isSavingComfyModule, setIsSavingComfyModule] = useState(false)
  const [comfyModuleName, setComfyModuleName] = useState('')
  const [comfyModuleDescription, setComfyModuleDescription] = useState('')
  const [comfyExposedFieldIds, setComfyExposedFieldIds] = useState<string[]>([])
  const [comfyOverwriteModuleId, setComfyOverwriteModuleId] = useState<number | null>(null)

  const moduleDefinitionsQuery = useQuery({
    queryKey: ['module-definitions', 'comfy-overwrite-candidates'],
    queryFn: () => getModuleDefinitions(false),
  })

  const moduleSaveWorkflow = useMemo(
    () => moduleSaveWorkflowId === null ? null : workflowById.get(moduleSaveWorkflowId) ?? null,
    [moduleSaveWorkflowId, workflowById],
  )
  const moduleSaveWorkflowFields = useMemo(() => resolveWorkflowFields(moduleSaveWorkflow), [resolveWorkflowFields, moduleSaveWorkflow])
  const comfyModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => (
    moduleSaveWorkflowFields.map((field) => ({
      key: field.id,
      label: field.label,
      dataType: field.type === 'number' ? 'number' : field.type === 'image' ? 'image' : field.type === 'node' ? 'json' : 'text',
      options: field.options,
    }))
  ), [moduleSaveWorkflowFields])

  const comfyOverwriteCandidates = useMemo(() => {
    if (!moduleSaveWorkflow) {
      return []
    }

    return (moduleDefinitionsQuery.data ?? []).filter((module) => (
      module.engine_type === 'comfyui'
      && module.authoring_source === 'comfyui_workflow_wrap'
      && module.source_workflow_id === moduleSaveWorkflow.id
    ))
  }, [moduleDefinitionsQuery.data, moduleSaveWorkflow])

  useEffect(() => {
    if (!moduleSaveWorkflow) {
      setComfyModuleName('')
      setComfyModuleDescription('')
      setComfyExposedFieldIds([])
      setComfyOverwriteModuleId(null)
      if (isModuleSaveModalOpen) {
        setIsModuleSaveModalOpen(false)
      }
      return
    }

    setComfyModuleName(`${moduleSaveWorkflow.name} 모듈`)
    setComfyModuleDescription(moduleSaveWorkflow.description ?? '')
    setComfyExposedFieldIds(moduleSaveWorkflowFields.map((field) => field.id))
  }, [isModuleSaveModalOpen, moduleSaveWorkflow, moduleSaveWorkflowFields])

  const handleOpenModuleSave = useCallback((workflowId: number) => {
    setModuleSaveWorkflowId(workflowId)
    setIsModuleSaveModalOpen(true)
  }, [])

  const handleCreateComfyModule = async () => {
    if (!moduleSaveWorkflow) {
      return
    }

    const moduleName = comfyModuleName.trim()
    if (moduleName.length === 0 || isSavingComfyModule) {
      return
    }

    if (comfyModuleFieldOptions.length > 0 && comfyExposedFieldIds.length === 0) {
      showSnackbar({ message: t({ ko: '최소 1개는 입력 가능 필드로 열어줘.', en: 'Expose at least one editable field.' }), tone: 'error' })
      return
    }

    try {
      setIsSavingComfyModule(true)
      await createComfyModuleFromWorkflow(moduleSaveWorkflow.id, {
        name: moduleName,
        description: comfyModuleDescription.trim() || undefined,
        exposed_field_ids: comfyExposedFieldIds,
        target_module_id: comfyOverwriteModuleId ?? undefined,
      })
      setIsModuleSaveModalOpen(false)
      setModuleSaveWorkflowId(null)
      setComfyOverwriteModuleId(null)
      void moduleDefinitionsQuery.refetch()
      showSnackbar({ message: comfyOverwriteModuleId ? t({ ko: '{name} 워크플로우로 기존 모듈을 덮어썼어.', en: 'Overwrote the existing module with the {name} workflow.' }, { name: moduleSaveWorkflow.name }) : t({ ko: '{name} 워크플로우를 모듈로 저장했어.', en: 'Saved the {name} workflow as a module.' }, { name: moduleSaveWorkflow.name }), tone: 'info' })
      navigate('/generation?tab=workflows')
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'ComfyUI 모듈 저장에 실패했어.', en: 'Failed to save the ComfyUI module.' })), tone: 'error' })
    } finally {
      setIsSavingComfyModule(false)
    }
  }

  const moduleSaveModalProps: ComponentProps<typeof ComfyModuleSaveModal> = {
    open: isModuleSaveModalOpen,
    moduleName: comfyModuleName,
    moduleDescription: comfyModuleDescription,
    fieldOptions: comfyModuleFieldOptions,
    exposedFieldIds: comfyExposedFieldIds,
    isSaving: isSavingComfyModule,
    overwriteCandidates: comfyOverwriteCandidates,
    overwriteModuleId: comfyOverwriteModuleId,
    onClose: () => {
      setIsModuleSaveModalOpen(false)
      setModuleSaveWorkflowId(null)
      setComfyOverwriteModuleId(null)
    },
    onModuleNameChange: setComfyModuleName,
    onModuleDescriptionChange: setComfyModuleDescription,
    onExposedFieldIdsChange: setComfyExposedFieldIds,
    onOverwriteModuleIdChange: (moduleId) => {
      setComfyOverwriteModuleId(moduleId)
      const module = comfyOverwriteCandidates.find((item) => item.id === moduleId)
      if (module) {
        setComfyModuleName(module.name)
        setComfyModuleDescription(module.description ?? '')
      }
    },
    onSave: () => void handleCreateComfyModule(),
  }

  return { handleOpenModuleSave, moduleSaveModalProps }
}
