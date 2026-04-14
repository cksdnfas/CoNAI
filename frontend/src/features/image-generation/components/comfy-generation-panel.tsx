import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createComfyModuleFromWorkflow,
  createGenerationCustomDropdownList,
  createGenerationWorkflow,
  deleteGenerationCustomDropdownList,
  deleteGenerationWorkflow,
  getAppSettings,
  getGenerationComfyUIServers,
  getGenerationCustomDropdownLists,
  getGenerationWorkflow,
  getGenerationWorkflows,
  scanGenerationComfyUIModelDropdownLists,
  updateGenerationCustomDropdownList,
  type GenerationWorkflow,
  type GenerationWorkflowDetail,
} from '@/lib/api'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import type { ImageSaveSettings } from '@/types/settings'
import {
  buildWorkflowDraft,
  clearPersistedComfyWorkflowDraft,
  getErrorMessage,
  loadPersistedComfyWorkflowDraft,
  persistComfyWorkflowDraft,
  type ModuleFieldOption,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'
import { ComfyDropdownListsSection, ComfyServerListSection, ComfyWorkflowListSection } from './comfy-home-sections'
import { ComfyModuleSaveModal } from './comfy-module-save-modal'
import { ComfyServerRegistrationModal } from './comfy-server-registration-modal'
import { ComfyWorkflowAuthoringModal } from './comfy-workflow-authoring-modal'
import { ComfyWorkflowControllerPanel } from './comfy-workflow-controller-panel'
import { useComfyGenerationActions } from './use-comfy-generation-actions'
import { useComfyServerController } from './use-comfy-server-controller'

type ComfyGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
  selectedWorkflowId: number | null
  onSelectedWorkflowChange: (workflowId: number | null) => void
  headerPortalTargetId?: string
}

type ComfyWorkflowEditorState = {
  workflow: GenerationWorkflowDetail
}

/** Render the ComfyUI home/workflow views and coordinate server-targeted generation. */
export function ComfyGenerationPanel({
  refreshNonce,
  onHistoryRefresh,
  selectedWorkflowId,
  onSelectedWorkflowChange,
  headerPortalTargetId,
}: ComfyGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [isAuthoringModalOpen, setIsAuthoringModalOpen] = useState(false)
  const [workflowEditorState, setWorkflowEditorState] = useState<ComfyWorkflowEditorState | null>(null)
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [isGenerationSaveOptionsOpen, setIsGenerationSaveOptionsOpen] = useState(false)
  const [generationSaveOptions, setGenerationSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [moduleSaveWorkflowId, setModuleSaveWorkflowId] = useState<number | null>(null)
  const [isSavingComfyModule, setIsSavingComfyModule] = useState(false)
  const [comfyModuleName, setComfyModuleName] = useState('')
  const [comfyModuleDescription, setComfyModuleDescription] = useState('')
  const [comfyExposedFieldIds, setComfyExposedFieldIds] = useState<string[]>([])
  const activeWorkflowId = selectedWorkflowId !== null ? String(selectedWorkflowId) : ''

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const workflowsQuery = useQuery({
    queryKey: ['image-generation-workflows'],
    queryFn: () => getGenerationWorkflows(true),
  })

  const serversQuery = useQuery({
    queryKey: ['image-generation-comfyui-servers'],
    queryFn: () => getGenerationComfyUIServers(true),
  })

  const dropdownListsQuery = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
  })

  const selectedWorkflow = useMemo(
    () => workflowsQuery.data?.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowsQuery.data],
  )
  const moduleSaveWorkflow = useMemo(
    () => workflowsQuery.data?.find((workflow) => workflow.id === moduleSaveWorkflowId) ?? null,
    [moduleSaveWorkflowId, workflowsQuery.data],
  )

  const dropdownListMap = useMemo(
    () => new Map((dropdownListsQuery.data ?? []).map((list) => [list.name, list])),
    [dropdownListsQuery.data],
  )

  const resolveWorkflowFields = useCallback((workflow: GenerationWorkflow | null) => {
    if (!workflow) {
      return []
    }

    return (workflow.marked_fields ?? []).map((field) => {
      if (field.dropdown_list_name) {
        const dropdownList = dropdownListMap.get(field.dropdown_list_name)
        if (dropdownList) {
          return {
            ...field,
            type: 'select' as const,
            options: dropdownList.items,
          }
        }
      }

      return field
    })
  }, [dropdownListMap])

  const selectedWorkflowFields = useMemo(() => resolveWorkflowFields(selectedWorkflow), [resolveWorkflowFields, selectedWorkflow])
  const moduleSaveWorkflowFields = useMemo(() => resolveWorkflowFields(moduleSaveWorkflow), [resolveWorkflowFields, moduleSaveWorkflow])

  const activeServers = useMemo(() => serversQuery.data ?? [], [serversQuery.data])
  const {
    isComfyServerSubmitting,
    comfyServerForm,
    editingServerId,
    comfyServerTests,
    selectedTarget,
    setSelectedTarget,
    isServerModalOpen,
    handleComfyServerFieldChange,
    resetComfyServerEditor,
    handleOpenCreateServer,
    handleCloseServerModal,
    handleTestComfyServer,
    handleSubmitComfyServer,
    handleEditServer,
    handleDeleteServer,
  } = useComfyServerController({
    activeServers,
    refetchServers: serversQuery.refetch,
    showSnackbar,
  })
  useEffect(() => {
    if (!appSettingsQuery.data?.imageSave) {
      return
    }

    setGenerationSaveOptions((current) => current === DEFAULT_IMAGE_SAVE_SETTINGS ? appSettingsQuery.data.imageSave : current)
  }, [appSettingsQuery.data?.imageSave])

  const connectedServers = activeServers.filter((server) => comfyServerTests[server.id]?.status?.is_connected === true)
  const {
    isComfyGenerating,
    handleGenerateSelected,
    handleGenerateAllServers,
  } = useComfyGenerationActions({
    selectedWorkflow,
    selectedWorkflowFields,
    workflowDraft,
    selectedTarget,
    activeServers,
    connectedServers,
    comfyServerTests,
    imageSaveOptions: {
      format: generationSaveOptions.defaultFormat,
      quality: generationSaveOptions.quality,
      resizeEnabled: generationSaveOptions.resizeEnabled,
      maxWidth: generationSaveOptions.maxWidth,
      maxHeight: generationSaveOptions.maxHeight,
    },
    onHistoryRefresh,
    showSnackbar,
  })
  const comfyModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => (
    moduleSaveWorkflowFields.map((field) => ({
      key: field.id,
      label: field.label,
      dataType: field.type === 'number' ? 'number' : field.type === 'image' ? 'image' : 'text',
      options: field.options,
    }))
  ), [moduleSaveWorkflowFields])

  const refetchComfyGenerationSurface = async () => {
    await Promise.all([workflowsQuery.refetch(), serversQuery.refetch(), dropdownListsQuery.refetch()])
  }

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void refetchComfyGenerationSurface()
  }, [refreshNonce])

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowDraft({})
      return
    }

    const baseDraft = buildWorkflowDraft(selectedWorkflowFields)
    const persistedDraft = loadPersistedComfyWorkflowDraft(selectedWorkflow.id)
    const validFieldIds = new Set(selectedWorkflowFields.map((field) => field.id))
    const filteredPersistedDraft = Object.fromEntries(
      Object.entries(persistedDraft).filter(([fieldId]) => validFieldIds.has(fieldId)),
    )

    setWorkflowDraft({
      ...baseDraft,
      ...filteredPersistedDraft,
    })
  }, [selectedWorkflow, selectedWorkflowFields])

  useEffect(() => {
    if (!moduleSaveWorkflow) {
      setComfyModuleName('')
      setComfyModuleDescription('')
      setComfyExposedFieldIds([])
      if (isModuleSaveModalOpen) {
        setIsModuleSaveModalOpen(false)
      }
      return
    }

    setComfyModuleName(`${moduleSaveWorkflow.name} 모듈`)
    setComfyModuleDescription(moduleSaveWorkflow.description ?? '')
    setComfyExposedFieldIds(moduleSaveWorkflowFields.map((field) => field.id))
  }, [isModuleSaveModalOpen, moduleSaveWorkflow, moduleSaveWorkflowFields])

  useEffect(() => {
    if (selectedWorkflowId === null) {
      return
    }

    if (workflowsQuery.isSuccess && selectedWorkflow === null) {
      onSelectedWorkflowChange(null)
    }
  }, [onSelectedWorkflowChange, selectedWorkflow, selectedWorkflowId, workflowsQuery.isSuccess])

  const handleWorkflowFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistComfyWorkflowDraft(selectedWorkflowId, workflowDraft)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [selectedWorkflowId, workflowDraft])

  const handleWorkflowImageChange = async (fieldId: string, image?: SelectedImageDraft) => {
    handleWorkflowFieldChange(fieldId, image ?? '')
  }

  const handleOpenCreateWorkflow = () => {
    setWorkflowEditorState(null)
    setIsAuthoringModalOpen(true)
  }

  const handleOpenWorkflow = (workflowId: number) => {
    onSelectedWorkflowChange(workflowId)
  }

  const handleOpenModuleSave = (workflowId: number) => {
    setModuleSaveWorkflowId(workflowId)
    setIsModuleSaveModalOpen(true)
  }

  const handleAuthoringSaved = async (workflowId: number) => {
    await Promise.all([workflowsQuery.refetch(), dropdownListsQuery.refetch()])
    setWorkflowEditorState(null)
    onSelectedWorkflowChange(workflowId)
  }

  const handleEditWorkflow = async (workflowId: number) => {
    try {
      const workflow = await getGenerationWorkflow(workflowId)

      setWorkflowEditorState({
        workflow,
      })
      setIsAuthoringModalOpen(true)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 정보를 불러오지 못했어.'), tone: 'error' })
    }
  }

  const handleCopyWorkflow = async (workflowId: number) => {
    try {
      const workflow = await getGenerationWorkflow(workflowId)

      const currentNames = new Set((workflowsQuery.data ?? []).map((item) => item.name))
      const baseName = `${workflow.name} 복사본`
      let nextName = baseName
      let suffix = 2
      while (currentNames.has(nextName)) {
        nextName = `${baseName} ${suffix}`
        suffix += 1
      }

      await createGenerationWorkflow({
        name: nextName,
        description: workflow.description,
        workflow_json: workflow.workflow_json,
        marked_fields: workflow.marked_fields,
        is_active: workflow.is_active,
        color: workflow.color,
      })

      await workflowsQuery.refetch()
      showSnackbar({ message: 'ComfyUI 워크플로우를 복사했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 복사에 실패했어.'), tone: 'error' })
    }
  }

  const handleDeleteWorkflow = async (workflowId: number) => {
    const workflow = workflowsQuery.data?.find((item) => item.id === workflowId)
    if (!workflow) {
      return
    }

    const confirmed = window.confirm(`정말 ${workflow.name} 워크플로우를 삭제할까?`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationWorkflow(workflowId)
      await workflowsQuery.refetch()
      if (selectedWorkflowId === workflowId) {
        onSelectedWorkflowChange(null)
      }
      showSnackbar({ message: 'ComfyUI 워크플로우를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleCreateDropdownList = async (input: { name: string; description?: string; items: string[] }) => {
    try {
      await createGenerationCustomDropdownList(input)
      await dropdownListsQuery.refetch()
      showSnackbar({ message: '커스텀 드롭다운 목록을 만들었어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '커스텀 드롭다운 목록 생성에 실패했어.'), tone: 'error' })
    }
  }

  const handleDeleteDropdownList = async (listId: number) => {
    const list = dropdownListsQuery.data?.find((item) => item.id === listId)
    if (!list) {
      return
    }

    const confirmed = window.confirm(`정말 ${list.name} 목록을 삭제할까?`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationCustomDropdownList(listId)
      await dropdownListsQuery.refetch()
      showSnackbar({ message: '드롭다운 목록을 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '드롭다운 목록 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleUpdateDropdownList = async (listId: number, input: { name?: string; description?: string; items?: string[] }) => {
    try {
      await updateGenerationCustomDropdownList(listId, input)
      await dropdownListsQuery.refetch()
      showSnackbar({ message: '드롭다운 목록을 수정했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '드롭다운 목록 수정에 실패했어.'), tone: 'error' })
    }
  }

  const handleScanDropdownLists = async (input: {
    modelFolders: { folderName: string; displayName: string; files: string[] }[]
    sourcePath?: string
    mergeSubfolders?: boolean
    createBoth?: boolean
  }) => {
    try {
      const response = await scanGenerationComfyUIModelDropdownLists(input)
      await dropdownListsQuery.refetch()
      showSnackbar({ message: response.data.message || '자동수집 목록을 갱신했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '자동수집 목록 생성에 실패했어.'), tone: 'error' })
    }
  }

  const handleCreateComfyModule = async () => {
    if (!moduleSaveWorkflow) {
      return
    }

    const moduleName = comfyModuleName.trim()
    if (moduleName.length === 0 || isSavingComfyModule) {
      return
    }

    if (comfyModuleFieldOptions.length > 0 && comfyExposedFieldIds.length === 0) {
      showSnackbar({ message: '최소 1개는 입력 가능 필드로 열어줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingComfyModule(true)
      await createComfyModuleFromWorkflow(moduleSaveWorkflow.id, {
        name: moduleName,
        description: comfyModuleDescription.trim() || undefined,
        exposed_field_ids: comfyExposedFieldIds,
      })
      setIsModuleSaveModalOpen(false)
      setModuleSaveWorkflowId(null)
      showSnackbar({ message: `${moduleSaveWorkflow.name} 워크플로우를 모듈로 저장했어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 모듈 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingComfyModule(false)
    }
  }

  return (
    <>
      <div className="space-y-5">
        {workflowsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>워크플로우를 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(workflowsQuery.error, 'ComfyUI 워크플로우 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {serversQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>서버를 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(serversQuery.error, 'ComfyUI 서버 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {dropdownListsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>드롭다운 목록을 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(dropdownListsQuery.error, '커스텀 드롭다운 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {selectedWorkflowId === null ? (
          <div className="space-y-4">
            <ComfyWorkflowListSection
              workflows={workflowsQuery.data ?? []}
              selectedWorkflowId={activeWorkflowId}
              onSelectWorkflow={handleOpenWorkflow}
              onCreateWorkflow={handleOpenCreateWorkflow}
              onSaveModule={handleOpenModuleSave}
              onEditWorkflow={(workflowId) => void handleEditWorkflow(workflowId)}
              onCopyWorkflow={(workflowId) => void handleCopyWorkflow(workflowId)}
              onDeleteWorkflow={(workflowId) => void handleDeleteWorkflow(workflowId)}
            />

            <ComfyDropdownListsSection
              dropdownLists={dropdownListsQuery.data ?? []}
              onCreateManualList={(input) => handleCreateDropdownList(input)}
              onUpdateList={(listId, input) => handleUpdateDropdownList(listId, input)}
              onDeleteList={(listId) => handleDeleteDropdownList(listId)}
              onScanAutoLists={(input) => handleScanDropdownLists(input)}
            />

            <ComfyServerListSection
              servers={activeServers}
              serverTests={comfyServerTests}
              onOpenCreateServer={handleOpenCreateServer}
              onEditServer={handleEditServer}
              onDeleteServer={(serverId) => void handleDeleteServer(serverId)}
              onTestServer={(serverId) => void handleTestComfyServer(serverId)}
            />
          </div>
        ) : selectedWorkflow ? (
          <ComfyWorkflowControllerPanel
            workflowName={selectedWorkflow.name}
            workflowDescription={selectedWorkflow.description}
            workflowFields={selectedWorkflowFields}
            servers={activeServers}
            serverTests={comfyServerTests}
            selectedTarget={selectedTarget}
            workflowDraft={workflowDraft}
            isGenerating={isComfyGenerating}
            headerPortalTargetId={headerPortalTargetId}
            onBack={() => onSelectedWorkflowChange(null)}
            onSelectTarget={setSelectedTarget}
            onFieldChange={handleWorkflowFieldChange}
            onImageChange={handleWorkflowImageChange}
            onResetDraft={() => {
              if (selectedWorkflow) {
                clearPersistedComfyWorkflowDraft(selectedWorkflow.id)
              }
              setWorkflowDraft(buildWorkflowDraft(selectedWorkflowFields))
            }}
            onOpenModuleSave={() => selectedWorkflow ? handleOpenModuleSave(selectedWorkflow.id) : undefined}
            onOpenSaveOptions={() => setIsGenerationSaveOptionsOpen(true)}
            onGenerateSelected={() => void handleGenerateSelected()}
            onGenerateAll={() => void handleGenerateAllServers()}
          />
        ) : null}
      </div>

      <ImageSaveOptionsModal
        open={isGenerationSaveOptionsOpen}
        title="생성 결과 저장 옵션"
        options={generationSaveOptions}
        sourceInfo={null}
        isSaving={false}
        onClose={() => setIsGenerationSaveOptionsOpen(false)}
        onOptionsChange={(patch) => setGenerationSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => setIsGenerationSaveOptionsOpen(false)}
      />

      <ComfyWorkflowAuthoringModal
        open={isAuthoringModalOpen}
        mode={workflowEditorState ? 'edit' : 'create'}
        initialData={workflowEditorState}
        dropdownLists={dropdownListsQuery.data ?? []}
        onClose={() => {
          setIsAuthoringModalOpen(false)
          setWorkflowEditorState(null)
        }}
        onSaved={(workflowId) => void handleAuthoringSaved(workflowId)}
      />

      <ComfyServerRegistrationModal
        open={isServerModalOpen}
        mode={editingServerId !== null ? 'edit' : 'create'}
        form={comfyServerForm}
        isSubmitting={isComfyServerSubmitting}
        onClose={handleCloseServerModal}
        onReset={resetComfyServerEditor}
        onFieldChange={handleComfyServerFieldChange}
        onSubmit={() => void handleSubmitComfyServer()}
      />

      <ComfyModuleSaveModal
        open={isModuleSaveModalOpen}
        moduleName={comfyModuleName}
        moduleDescription={comfyModuleDescription}
        fieldOptions={comfyModuleFieldOptions}
        exposedFieldIds={comfyExposedFieldIds}
        isSaving={isSavingComfyModule}
        onClose={() => {
          setIsModuleSaveModalOpen(false)
          setModuleSaveWorkflowId(null)
        }}
        onModuleNameChange={setComfyModuleName}
        onModuleDescriptionChange={setComfyModuleDescription}
        onExposedFieldIdsChange={setComfyExposedFieldIds}
        onSave={() => void handleCreateComfyModule()}
      />
    </>
  )
}
