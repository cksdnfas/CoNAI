import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSnackbar } from '@/components/ui/snackbar-context'
import type { CustomDropdownList, GenerationWorkflow, GenerationWorkflowDetail } from '@/lib/api-image-generation-types'
import {
  createGenerationWorkflow,
  deleteGenerationWorkflow,
  getGenerationComfyUIServers,
  getGenerationCustomDropdownLists,
  getGenerationWorkflow,
  getGenerationWorkflows,
} from '@/lib/api-image-generation-workflows'
import { getAppSettings } from '@/lib/api-settings-general'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import {
  buildWorkflowDraft,
  clearPersistedComfyWorkflowDraft,
  deleteComfyWorkflowDraftInputAssets,
  loadPersistedComfyWorkflowDraft,
  persistComfyWorkflowDraft,
} from '../image-generation-drafts'
import {
  getErrorMessage,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'
import { consumeHistorySettingsLoad, usePendingHistorySettingsLoad } from '../history-settings-load-store'
import {
  buildComfyDraftFromHistoryPayload,
  confirmHistorySettingsOverwrite,
  getHistorySettingsLoadedMessage,
  hasWorkflowDraftDifference,
} from '../history-settings-mapping'
import { ComfyWorkflowListSection } from './comfy-home-sections'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ComfyManagementArea } from './comfy-management-area'
import { ComfyModuleSaveModal } from './comfy-module-save-modal'
import { ComfyServerRegistrationModal } from './comfy-server-registration-modal'
import { ComfyWorkflowAuthoringModal } from './comfy-workflow-authoring-modal'
import { ComfyWorkflowControllerPanel } from './comfy-workflow-controller-panel'
import { GenerationToolbarStatus, usePortalTargetById } from './generation-toolbar-status'
import { findAutoCollectedPowerLoraOptions } from './power-lora-loader-utils'
import { useComfyDropdownListActions } from './use-comfy-dropdown-list-actions'
import { useComfyGenerationActions } from './use-comfy-generation-actions'
import { useComfyModuleSave } from './use-comfy-module-save'
import { useComfyServerController } from './use-comfy-server-controller'

type ComfyGenerationPanelProps = {
  onHistoryRefresh: () => void
  selectedWorkflowId: number | null
  onSelectedWorkflowChange: (workflowId: number | null, options?: { replace?: boolean }) => void
  splitPaneScroll?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
  /** Page toolbar slot for the server connection summary. */
  statusPortalTargetId?: string
}

type ComfyWorkflowEditorState = {
  workflow: GenerationWorkflowDetail
}

const COMFY_AUTO_COLLECT_SOURCE_PATH = 'comfyui-default-server-api'
const COMFY_MODEL_PREVIEW_FOLDERS = new Set(['checkpoints', 'loras', 'diffusion_models', 'unet_gguf'])

function resolveComfyModelPreviewFolder(dropdownList: CustomDropdownList) {
  if (!dropdownList.is_auto_collected || dropdownList.source_path !== COMFY_AUTO_COLLECT_SOURCE_PATH) {
    return undefined
  }

  const rootFolder = dropdownList.name.replace(/\s*\(통합\)$/, '').split('/')[0]?.trim()
  return rootFolder && COMFY_MODEL_PREVIEW_FOLDERS.has(rootFolder) ? rootFolder : undefined
}

/** Render the ComfyUI home/workflow views and coordinate server-targeted generation. */
export function ComfyGenerationPanel({
  onHistoryRefresh,
  selectedWorkflowId,
  onSelectedWorkflowChange,
  splitPaneScroll = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
  statusPortalTargetId,
}: ComfyGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  // Which workflow the current draft belongs to; history loads wait until the target workflow's draft is initialized.
  const [workflowDraftOwnerId, setWorkflowDraftOwnerId] = useState<number | null>(null)
  const [queueRegistrationCount, setQueueRegistrationCount] = useState('1')
  const [isAuthoringModalOpen, setIsAuthoringModalOpen] = useState(false)
  const [workflowEditorState, setWorkflowEditorState] = useState<ComfyWorkflowEditorState | null>(null)
  const [isManagementOpen, setIsManagementOpen] = useState(false)
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
    queryKey: ['image-generation-comfyui-servers', 'all'],
    queryFn: () => getGenerationComfyUIServers(false),
  })

  const dropdownListsQuery = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
  })


  const workflowById = useMemo(
    () => new Map<number, GenerationWorkflow>((workflowsQuery.data ?? []).map((workflow) => [workflow.id, workflow])),
    [workflowsQuery.data],
  )
  const selectedWorkflow = useMemo(
    () => selectedWorkflowId === null ? null : workflowById.get(selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowById],
  )

  const dropdownListByName = useMemo(
    () => new Map((dropdownListsQuery.data ?? []).map((list) => [list.name, list])),
    [dropdownListsQuery.data],
  )
  const dropdownListById = useMemo(
    () => new Map((dropdownListsQuery.data ?? []).map((list) => [list.id, list])),
    [dropdownListsQuery.data],
  )
  const loraOptions = useMemo(
    () => findAutoCollectedPowerLoraOptions(dropdownListsQuery.data ?? []),
    [dropdownListsQuery.data],
  )

  const buildDropdownSelectOptions = useCallback((items: string[]) => [
    '__random__',
    ...items.filter((item) => item.trim().length > 0 && item !== '__random__'),
  ], [])

  const resolveWorkflowFields = useCallback((workflow: GenerationWorkflow | null) => {
    if (!workflow) {
      return []
    }

    return (workflow.marked_fields ?? []).map((field) => {
      if (field.dropdown_list_name) {
        const dropdownList = dropdownListByName.get(field.dropdown_list_name)
        if (dropdownList) {
          return {
            ...field,
            type: 'select' as const,
            options: buildDropdownSelectOptions(dropdownList.items),
            model_preview_folder: resolveComfyModelPreviewFolder(dropdownList),
          }
        }
      }

      return field
    })
  }, [buildDropdownSelectOptions, dropdownListByName])

  const selectedWorkflowFields = useMemo(() => resolveWorkflowFields(selectedWorkflow), [resolveWorkflowFields, selectedWorkflow])
  const { handleOpenModuleSave, moduleSaveModalProps } = useComfyModuleSave({
    workflowById,
    resolveWorkflowFields,
  })

  const servers = useMemo(() => serversQuery.data ?? [], [serversQuery.data])
  const activeServers = useMemo(() => servers.filter((server) => server.is_active !== false), [servers])
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
    handleToggleComfyServerActive,
  } = useComfyServerController({
    servers,
    activeServers,
    refetchServers: serversQuery.refetch,
    showSnackbar,
  })
  const generationSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

  const connectedServers = useMemo(
    () => activeServers.filter((server) => comfyServerTests[server.id]?.status?.is_connected === true),
    [activeServers, comfyServerTests],
  )
  const {
    isComfyGenerating,
    fieldIssues: workflowFieldIssues,
    clearFieldIssue: clearWorkflowFieldIssue,
    clearFieldIssues: clearWorkflowFieldIssues,
    revealComfyFieldIssues,
    handleGenerateSelected,
  } = useComfyGenerationActions({
    selectedWorkflow,
    selectedWorkflowFields,
    workflowDraft,
    selectedTarget,
    queueRegistrationCount,
    activeServers,
    connectedServers,
    comfyServerTests,
    imageSaveOptions: {
      format: generationSaveSettings.defaultFormat,
      quality: generationSaveSettings.quality,
      resizeEnabled: generationSaveSettings.resizeEnabled,
      maxWidth: generationSaveSettings.maxWidth,
      maxHeight: generationSaveSettings.maxHeight,
    },
    onHistoryRefresh,
    showSnackbar,
  })

  const refetchDropdownLists = dropdownListsQuery.refetch
  const {
    isRefreshingDropdownLists,
    handleCreateDropdownList,
    handleDeleteDropdownList,
    handleUpdateDropdownList,
    handleScanDropdownLists,
    handleRefreshDropdownLists,
  } = useComfyDropdownListActions({
    dropdownListById,
    refetchDropdownLists,
  })

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowDraft({})
      setWorkflowDraftOwnerId(null)
      return
    }

    const baseDraft = buildWorkflowDraft(selectedWorkflowFields)
    const persistedDraft = loadPersistedComfyWorkflowDraft(selectedWorkflow.id, selectedWorkflowFields)
    const validFieldIds = new Set(selectedWorkflowFields.map((field) => field.id))
    const filteredPersistedDraft = Object.fromEntries(
      Object.entries(persistedDraft).filter(([fieldId]) => validFieldIds.has(fieldId)),
    )

    setWorkflowDraft({
      ...baseDraft,
      ...filteredPersistedDraft,
    })
    setWorkflowDraftOwnerId(selectedWorkflow.id)
  }, [selectedWorkflow, selectedWorkflowFields])

  const pendingHistorySettingsLoad = usePendingHistorySettingsLoad()
  const handledHistorySettingsLoadNonceRef = useRef(0)
  useEffect(() => {
    const request = pendingHistorySettingsLoad
    if (!request || request.serviceType !== 'comfyui' || handledHistorySettingsLoadNonceRef.current === request.nonce) {
      return
    }

    const targetWorkflowId = request.workflowId
    if (targetWorkflowId === null || (workflowsQuery.isSuccess && !workflowById.has(targetWorkflowId))) {
      handledHistorySettingsLoadNonceRef.current = request.nonce
      consumeHistorySettingsLoad(request.nonce)
      showSnackbar({ message: t({ ko: '이 기록의 워크플로우를 찾지 못했어. 삭제됐거나 비활성 상태일 수 있어.', en: 'Could not find the workflow of this record. It may be deleted or inactive.' }), tone: 'error' })
      return
    }

    // 페이지가 워크플로우를 바꾸고 그 워크플로우의 초안이 초기화될 때까지 기다린다.
    if (selectedWorkflow?.id !== targetWorkflowId || workflowDraftOwnerId !== targetWorkflowId) {
      return
    }

    handledHistorySettingsLoadNonceRef.current = request.nonce
    consumeHistorySettingsLoad(request.nonce)
    const result = buildComfyDraftFromHistoryPayload(request.payload, selectedWorkflowFields, workflowDraft)
    if (!result) {
      showSnackbar({ message: t({ ko: '이 기록에는 불러올 워크플로우 입력이 없어.', en: 'This record has no workflow inputs to load.' }), tone: 'error' })
      return
    }

    const hasDraftContent = hasWorkflowDraftDifference(selectedWorkflowFields, workflowDraft, buildWorkflowDraft(selectedWorkflowFields))
    void (async () => {
      if (hasDraftContent && hasWorkflowDraftDifference(selectedWorkflowFields, workflowDraft, result.draft) && !(await confirmHistorySettingsOverwrite(confirm, t))) {
        return
      }

      setWorkflowDraft(result.draft)
      // 드롭다운 목록 갱신 등으로 초안이 저장본에서 다시 초기화돼도 불러온 값이 남도록 바로 저장한다.
      persistComfyWorkflowDraft(targetWorkflowId, result.draft)
      clearWorkflowFieldIssues()
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, result.hasImageInputs), tone: 'info' })
    })()
  }, [
    clearWorkflowFieldIssues,
    confirm,
    pendingHistorySettingsLoad,
    selectedWorkflow?.id,
    selectedWorkflowFields,
    showSnackbar,
    t,
    workflowById,
    workflowDraft,
    workflowDraftOwnerId,
    workflowsQuery.isSuccess,
  ])


  useEffect(() => {
    if (selectedWorkflowId === null) {
      return
    }

    if (workflowsQuery.isSuccess && selectedWorkflow === null) {
      // URL 에 남은 삭제/비활성 워크플로우 id 는 히스토리 항목을 늘리지 않고 조용히 정리한다.
      onSelectedWorkflowChange(null, { replace: true })
    }
  }, [onSelectedWorkflowChange, selectedWorkflow, selectedWorkflowId, workflowsQuery.isSuccess])

  const handleWorkflowFieldChange = useCallback((fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
    clearWorkflowFieldIssue(fieldId)
  }, [clearWorkflowFieldIssue])

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistComfyWorkflowDraft(selectedWorkflowId, workflowDraft)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [selectedWorkflowId, workflowDraft])

  const handleWorkflowImageChange = useCallback(async (fieldId: string, image?: SelectedImageDraft) => {
    handleWorkflowFieldChange(fieldId, image ?? '')
  }, [handleWorkflowFieldChange])

  const handleOpenCreateWorkflow = useCallback(() => {
    setWorkflowEditorState(null)
    setIsAuthoringModalOpen(true)
  }, [])

  const handleOpenWorkflow = useCallback((workflowId: number) => {
    onSelectedWorkflowChange(workflowId)
  }, [onSelectedWorkflowChange])


  const handleAuthoringSaved = async (workflowId: number) => {
    await Promise.all([workflowsQuery.refetch(), dropdownListsQuery.refetch()])
    setWorkflowEditorState(null)
    onSelectedWorkflowChange(workflowId)
    onHistoryRefresh()
  }

  const handleEditWorkflow = async (workflowId: number) => {
    try {
      const workflow = await getGenerationWorkflow(workflowId)

      setWorkflowEditorState({
        workflow,
      })
      setIsAuthoringModalOpen(true)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '워크플로우 정보를 불러오지 못했어.', en: 'Could not load workflow details.' })), tone: 'error' })
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
        result_view_mode: workflow.result_view_mode,
        artifact_directory_mode: workflow.artifact_directory_mode,
        artifact_root_path: workflow.artifact_root_path ?? null,
        color: workflow.color,
      })

      await workflowsQuery.refetch()
      showSnackbar({ message: t({ ko: 'ComfyUI 워크플로우를 복사했어.', en: 'Copied the ComfyUI workflow.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '워크플로우 복사에 실패했어.', en: 'Failed to copy the workflow.' })), tone: 'error' })
    }
  }

  const handleDeleteWorkflow = async (workflowId: number) => {
    const workflow = workflowById.get(workflowId)
    if (!workflow) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '워크플로우 삭제', en: 'Delete workflow' }),
      description: t({ ko: '정말 {name} 워크플로우를 삭제할까?', en: 'Delete the {name} workflow?' }, { name: workflow.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationWorkflow(workflowId)
      await workflowsQuery.refetch()
      if (selectedWorkflowId === workflowId) {
        onSelectedWorkflowChange(null)
      }
      showSnackbar({ message: t({ ko: 'ComfyUI 워크플로우를 삭제했어.', en: 'Deleted the ComfyUI workflow.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '워크플로우 삭제에 실패했어.', en: 'Failed to delete the workflow.' })), tone: 'error' })
    }
  }


  const handleResetWorkflowDraft = useCallback(async () => {
    const baseDraft = buildWorkflowDraft(selectedWorkflowFields)
    if (hasWorkflowDraftDifference(selectedWorkflowFields, workflowDraft, baseDraft)) {
      const confirmed = await confirm({
        title: t({ ko: '워크플로우 입력을 초기화할까?', en: 'Reset the workflow inputs?' }),
        description: t({
          ko: '{name}의 입력값이 기본값으로 돌아가고 저장된 초안도 지워져. 업로드한 입력 이미지는 서버에서도 삭제돼. 되돌릴 수 없어.',
          en: 'All inputs of {name} go back to their defaults and the saved draft is cleared. Uploaded input images are also deleted from the server. This cannot be undone.',
        }, { name: selectedWorkflow?.name ?? '' }),
        confirmLabel: t({ ko: '초기화', en: 'Reset' }),
        tone: 'destructive',
      })
      if (!confirmed) {
        return
      }
    }

    void deleteComfyWorkflowDraftInputAssets(workflowDraft)
    if (selectedWorkflow) {
      clearPersistedComfyWorkflowDraft(selectedWorkflow.id)
    }
    setWorkflowDraft(baseDraft)
    clearWorkflowFieldIssues()
  }, [clearWorkflowFieldIssues, confirm, selectedWorkflow, selectedWorkflowFields, t, workflowDraft])

  const handleOpenSelectedModuleSave = useCallback(() => {
    if (selectedWorkflow) {
      handleOpenModuleSave(selectedWorkflow.id)
    }
  }, [handleOpenModuleSave, selectedWorkflow])

  const handleGenerateSelectedWorkflow = useCallback(() => {
    void handleGenerateSelected()
  }, [handleGenerateSelected])


  const statusPortalTarget = usePortalTargetById(statusPortalTargetId)
  const toolbarStatusContent = (
    <GenerationToolbarStatus
      tone={serversQuery.isPending ? 'pending' : connectedServers.length > 0 ? 'ready' : activeServers.length > 0 ? 'warning' : 'off'}
      label={activeServers.length === 0
        ? t({ ko: '서버 없음', en: 'No servers' })
        : t({ ko: '서버 {connected}/{total}', en: 'Servers {connected}/{total}' }, { connected: connectedServers.length, total: activeServers.length })}
    />
  )

  return (
    <>
      {statusPortalTarget ? createPortal(toolbarStatusContent, statusPortalTarget) : null}
      <div className={cn(splitPaneScroll && selectedWorkflowId !== null ? 'flex min-h-0 flex-1 flex-col gap-5' : 'space-y-5')}>
        {workflowsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '워크플로우를 불러오지 못했어', en: 'Could not load workflows' })}</AlertTitle>
            <AlertDescription>{getErrorMessage(workflowsQuery.error, t({ ko: 'ComfyUI 워크플로우 조회 실패', en: 'Failed to load ComfyUI workflows' }))}</AlertDescription>
          </Alert>
        ) : null}

        {serversQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '서버를 불러오지 못했어', en: 'Could not load servers' })}</AlertTitle>
            <AlertDescription>{getErrorMessage(serversQuery.error, t({ ko: 'ComfyUI 서버 조회 실패', en: 'Failed to load ComfyUI servers' }))}</AlertDescription>
          </Alert>
        ) : null}

        {dropdownListsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '드롭다운 목록을 불러오지 못했어', en: 'Could not load dropdown lists' })}</AlertTitle>
            <AlertDescription>{getErrorMessage(dropdownListsQuery.error, t({ ko: '커스텀 드롭다운 조회 실패', en: 'Failed to load custom dropdown lists' }))}</AlertDescription>
          </Alert>
        ) : null}

        {selectedWorkflowId === null ? (
          <div className="space-y-6">
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

            <ComfyManagementArea
              servers={servers}
              activeServerCount={activeServers.length}
              serverTests={comfyServerTests}
              dropdownLists={dropdownListsQuery.data}
              isManagementOpen={isManagementOpen}
              onToggleManagement={() => setIsManagementOpen((current) => !current)}
              isRefreshingDropdownLists={isRefreshingDropdownLists}
              onCreateManualList={(input) => handleCreateDropdownList(input)}
              onUpdateList={(listId, input) => handleUpdateDropdownList(listId, input)}
              onDeleteList={(listId) => handleDeleteDropdownList(listId)}
              onScanAutoLists={(input) => handleScanDropdownLists(input)}
              onOpenCreateServer={handleOpenCreateServer}
              onEditServer={handleEditServer}
              onDeleteServer={(serverId) => void handleDeleteServer(serverId)}
              onTestServer={(serverId) => void handleTestComfyServer(serverId)}
              onToggleServerActive={(serverId, isActive) => void handleToggleComfyServerActive(serverId, isActive)}
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
            queueRegistrationCount={queueRegistrationCount}
            isGenerating={isComfyGenerating}
            loraOptions={loraOptions}
            isRefreshingDropdownLists={isRefreshingDropdownLists}
            fieldIssues={workflowFieldIssues}
            splitPaneScroll={splitPaneScroll}
            headerPortalTargetId={headerPortalTargetId}
            compactActionBarContentTargetId={compactActionBarContentTargetId}
            onBack={() => onSelectedWorkflowChange(null)}
            onSelectTarget={setSelectedTarget}
            onQueueRegistrationCountChange={setQueueRegistrationCount}
            onFieldChange={handleWorkflowFieldChange}
            onImageChange={handleWorkflowImageChange}
            onRefreshDropdownLists={handleRefreshDropdownLists}
            onResetDraft={() => void handleResetWorkflowDraft()}
            onOpenModuleSave={handleOpenSelectedModuleSave}
            onGenerateSelected={handleGenerateSelectedWorkflow}
            onRevealFieldIssues={revealComfyFieldIssues}
          />
        ) : null}
      </div>

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

      <ComfyModuleSaveModal {...moduleSaveModalProps} />
    </>
  )
}
